/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Role,
  StaffMember,
  Product,
  Room,
  RoomOrder,
  RoomPackage,
  AppSettings,
  BillRecord,
  DebtRecord,
  CartItem,
} from './types';
import {
  getStoredProducts,
  saveStoredProducts,
  getStoredRooms,
  saveStoredRooms,
  getStoredPackages,
  saveStoredPackages,
  getStoredStaff,
  saveStoredStaff,
  getStoredSettings,
  saveStoredSettings,
  getStoredBills,
  saveStoredBill,
  updateStoredBills,
  getStoredDebts,
  saveStoredDebts,
  purgeMockLocalStorage,
} from './lib/storage';
import {
  INITIAL_PRODUCTS,
  INITIAL_ROOMS,
  INITIAL_PACKAGES,
  INITIAL_STAFF,
  INITIAL_SETTINGS,
} from './lib/initialData';
import { getBluetoothStatus, tryAutoReconnectBluetooth } from './lib/bluetoothPrinter';
import { getAccessToken, initAuth } from './lib/firebase';
import { appendBillToSheet, syncInventoryToSheet } from './lib/googleSheets';
import { fetchLatestDataFromGas, sendDataToGas, GasFullDataPayload, isPlaceholderGasUrl } from './lib/gasSyncService';
import {
  initMultiDeviceSync,
  pushMultiDeviceUpdate,
  fetchLatestServerSnapshot,
  SyncAction,
  SyncPayload,
  StockDeductionItem,
  getDeviceId,
} from './lib/realtimeSync';
import { listenToFirebaseStore, pushToFirebaseStore } from './lib/firebaseSync';
import { deductMultiUnitStockFromCatalog } from './lib/multiUnitInventory';
import { generateNextBillNumber, calculateRoomSessionFee } from './lib/roomPricing';
import { RefreshCw, CheckCircle2, AlertCircle, Smartphone, Monitor, Globe, Zap } from 'lucide-react';

import { Navbar } from './components/Navbar';
import { PinAuthModal } from './components/PinAuthModal';
import { PosSales } from './components/PosSales';
import { RoomManagement } from './components/RoomManagement';
import { InventoryManagement } from './components/InventoryManagement';
import { DebtManagement } from './components/DebtManagement';
import { SalesSummary } from './components/SalesSummary';
import { SettingsModal } from './components/SettingsModal';
import { BillingModal } from './components/BillingModal';
import { GoogleSheetsSyncModal } from './components/GoogleSheetsSyncModal';
import { BluetoothModal } from './components/BluetoothModal';
import { getThemeConfig } from './lib/theme';

function parseIsoTs(val?: string): number {
  if (!val) return 0;
  const ms = Date.parse(val);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeAvailableRoom(room: Room): Room {
  return {
    ...room,
    status: 'available' as const,
    pricingType: 'fixed_hourly' as const,
    openedAt: undefined,
    targetEndTime: undefined,
    bookedHours: 0,
    openedByStaffId: undefined,
    openedByStaffName: undefined,
    packageId: undefined,
    packageName: undefined,
    packagePrice: undefined,
    isPaid: undefined,
    orders: [],
  };
}

/**
 * Smart Conflict Resolution for Rooms:
 * Compares per-room updatedAt timestamps and preserves short in-flight local edits (<8s)
 * without ever discarding newer or authoritative server room states.
 */
export function mergeRoomsSafely(
  localRooms: Room[],
  remoteRooms: Room[],
  lastLocalActionTime: number,
  isFullSnapshot = false
): Room[] {
  const now = Date.now();
  const isWithinGracePeriod = now - lastLocalActionTime < 8000;
  const merged: Room[] = [];

  for (const remote of remoteRooms) {
    const local = localRooms.find((r) => r.id === remote.id || (remote.name && r.name === remote.name));
    if (!local) {
      merged.push(remote.status === 'available' ? normalizeAvailableRoom(remote) : remote);
      continue;
    }

    const localTime = parseIsoTs(local.updatedAt);
    const remoteTime = parseIsoTs(remote.updatedAt);

    // Keep in-flight local edit ONLY if strictly newer than remote and within short grace window
    if (localTime > 0 && now - localTime < 8000 && (remoteTime === 0 || localTime > remoteTime)) {
      merged.push(local);
      continue;
    }

    if (isWithinGracePeriod && local.status === 'available' && remote.status !== 'available' && remoteTime <= localTime) {
      merged.push(local);
      continue;
    }

    if (remote.status === 'available') {
      merged.push(normalizeAvailableRoom({ ...local, ...remote }));
    } else {
      merged.push({ ...local, ...remote });
    }
  }

  // Keep locally created rooms not yet on remote ONLY if recently modified (<8s) or partial delta
  for (const local of localRooms) {
    const existsOnRemote = remoteRooms.some(
      (r) => r.id === local.id || (local.name && r.name === local.name)
    );
    if (!existsOnRemote) {
      const localTime = parseIsoTs(local.updatedAt);
      if (!isFullSnapshot || (localTime > 0 && now - localTime < 8000)) {
        merged.push(local);
      }
    }
  }

  return merged;
}

function mergeEntitiesByUpdatedAt<T extends { id: string; updatedAt?: string }>(
  localItems: T[],
  remoteItems: T[],
  isFullSnapshot = false,
  preserveField?: (local: T, remote: T) => T
): T[] {
  const now = Date.now();
  const merged: T[] = [];

  for (const remote of remoteItems) {
    const local = localItems.find((item) => item.id === remote.id);
    if (!local) {
      merged.push(remote);
      continue;
    }
    const localTime = parseIsoTs(local.updatedAt);
    const remoteTime = parseIsoTs(remote.updatedAt);

    if (localTime > 0 && now - localTime < 8000 && (remoteTime === 0 || localTime > remoteTime)) {
      merged.push(local);
    } else {
      merged.push(preserveField ? preserveField(local, remote) : remote);
    }
  }

  for (const local of localItems) {
    if (!remoteItems.some((r) => r.id === local.id)) {
      const localTime = parseIsoTs(local.updatedAt);
      if (!isFullSnapshot || (localTime > 0 && now - localTime < 8000)) {
        merged.push(local);
      }
    }
  }

  return merged;
}

export default function App() {
  // Authentication & Role
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentRole, setCurrentRole] = useState<Role>('staff');
  const [currentStaff, setCurrentStaff] = useState<StaffMember | undefined>(undefined);

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState<'pos' | 'rooms' | 'stock' | 'debts' | 'reports' | 'settings'>('pos');

  // Scrub any leftover Local Test Mode mock bills/debts before hydrating from real Server
  useEffect(() => {
    purgeMockLocalStorage();
  }, []);

  // Application Data States (Initialize empty — MUST fetch real products, stock & bills from Server first!)
  const [isInitialServerLoading, setIsInitialServerLoading] = useState<boolean>(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [packages, setPackages] = useState<RoomPackage[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>(getStoredStaff());
  const [settings, setSettings] = useState<AppSettings>(getStoredSettings());
  const [bills, setBills] = useState<BillRecord[]>([]);
  const [debts, setDebts] = useState<DebtRecord[]>([]);

  // Modals
  const [activeBillingRecord, setActiveBillingRecord] = useState<BillRecord | null>(null);
  const [isDraftBilling, setIsDraftBilling] = useState<boolean>(false);
  const [showSheetsModal, setShowSheetsModal] = useState<boolean>(false);
  const [showBluetoothModal, setShowBluetoothModal] = useState<boolean>(false);
  const [bluetoothConnected, setBluetoothConnected] = useState<boolean>(false);
  const [isSyncingAllSheets, setIsSyncingAllSheets] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('');

  // Pending draft checkout state: prevents saving canceled bills to Sales Summary or clearing rooms prematurely
  const pendingCheckoutRef = useRef<
    | {
        mode: 'pos_sale';
        billId: string;
        cart: CartItem[];
        onPosConfirmed?: () => void;
      }
    | {
        mode: 'room_checkout';
        billId: string;
        room: Room;
      }
    | {
        mode: 'room_split';
        billId: string;
        roomId: string;
        roomName: string;
        splitOrders: RoomOrder[];
        splitOrderIds: string[];
      }
    | null
  >(null);

  // Google Apps Script Real-time Sync & Multi-Device States
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'syncing'>('idle');
  const [syncMessage, setSyncMessage] = useState<string>('');

  // Refs to track current state for race-condition-free background sync
  const productsRef = useRef<Product[]>(products);
  const roomsRef = useRef<Room[]>(rooms);
  const packagesRef = useRef<RoomPackage[]>(packages);
  const staffRef = useRef<StaffMember[]>(staffList);
  const debtsRef = useRef<DebtRecord[]>(debts);
  const billsRef = useRef<BillRecord[]>(bills);
  const isPushingRef = useRef<boolean>(false);
  const lastRoomLocalActionTimeRef = useRef<number>(0);
  // Start at 0 so newly opened devices ALWAYS accept the Server snapshot first (never blocked by boot Date.now())
  const lastLocalActionTimeRef = useRef<number>(0);
  const lastServerUpdatedMsRef = useRef<number>(0);
  const isServerHydratedRef = useRef<boolean>(false);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    packagesRef.current = packages;
  }, [packages]);

  useEffect(() => {
    staffRef.current = staffList;
  }, [staffList]);

  useEffect(() => {
    debtsRef.current = debts;
  }, [debts]);

  useEffect(() => {
    billsRef.current = bills;
  }, [bills]);

  // Apply authoritative full snapshot or granular remote update to local state & localStorage
  const applyRemoteSyncData = (
    remoteData: SyncPayload,
    action?: SyncAction,
    meta?: { isInitialSync?: boolean; isFullSnapshot?: boolean; version?: number }
  ) => {
    const isInitialSync = !!meta?.isInitialSync;
    const isFullSnapshot = !!meta?.isFullSnapshot;
    const now = Date.now();
    let changed = false;

    if (remoteData.lastUpdated) {
      const ts = parseIsoTs(remoteData.lastUpdated);
      if (ts > lastServerUpdatedMsRef.current) {
        lastServerUpdatedMsRef.current = ts;
      }
    }

    const hasServerData =
      (meta?.version ?? 0) > 1 ||
      (remoteData.rooms?.length ?? 0) > 0 ||
      (remoteData.products?.length ?? 0) > 0 ||
      (remoteData.bills?.length ?? 0) > 0 ||
      (remoteData.debts?.length ?? 0) > 0;

    if (isInitialSync) {
      isServerHydratedRef.current = true;
      setIsInitialServerLoading(false);
      // On brand-new empty server (v1 with 0 items), keep empty or cached non-mock server data
      if (!hasServerData) return;
    }

    // 1. Rooms
    if (Array.isArray(remoteData.rooms)) {
      const nextRooms = isInitialSync
        ? remoteData.rooms.map((r) => (r.status === 'available' ? normalizeAvailableRoom(r) : r))
        : mergeRoomsSafely(roomsRef.current, remoteData.rooms, lastRoomLocalActionTimeRef.current, isFullSnapshot);
      if (JSON.stringify(roomsRef.current) !== JSON.stringify(nextRooms)) {
        setRooms(nextRooms);
        roomsRef.current = nextRooms;
        saveStoredRooms(nextRooms);
        changed = true;
      }
    } else if (Array.isArray(remoteData.changedRooms) || Array.isArray(remoteData.deletedRoomIds)) {
      let nextRooms = [...roomsRef.current];
      if (Array.isArray(remoteData.changedRooms) && remoteData.changedRooms.length > 0) {
        nextRooms = mergeRoomsSafely(nextRooms, remoteData.changedRooms, lastRoomLocalActionTimeRef.current, false);
      }
      if (Array.isArray(remoteData.deletedRoomIds) && remoteData.deletedRoomIds.length > 0) {
        const delSet = new Set(remoteData.deletedRoomIds);
        nextRooms = nextRooms.filter((r) => !delSet.has(r.id));
      }
      if (JSON.stringify(roomsRef.current) !== JSON.stringify(nextRooms)) {
        setRooms(nextRooms);
        roomsRef.current = nextRooms;
        saveStoredRooms(nextRooms);
        changed = true;
      }
    }

    // 2. Products
    if (Array.isArray(remoteData.products)) {
      const nextProducts = isInitialSync
        ? remoteData.products.map((rp) => {
            const local = productsRef.current.find((lp) => lp.id === rp.id);
            return { ...rp, imageUrl: rp.imageUrl || local?.imageUrl || '' };
          })
        : mergeEntitiesByUpdatedAt(productsRef.current, remoteData.products, isFullSnapshot, (local, remote) => ({
            ...remote,
            imageUrl: remote.imageUrl || local.imageUrl || '',
          }));
      if (JSON.stringify(productsRef.current) !== JSON.stringify(nextProducts)) {
        setProducts(nextProducts);
        productsRef.current = nextProducts;
        saveStoredProducts(nextProducts);
        changed = true;
      }
    } else if (remoteData.clearProducts) {
      if (productsRef.current.length > 0) {
        setProducts([]);
        productsRef.current = [];
        saveStoredProducts([]);
        changed = true;
      }
    } else if (Array.isArray(remoteData.changedProducts) || Array.isArray(remoteData.deletedProductIds)) {
      let nextProducts = [...productsRef.current];
      if (Array.isArray(remoteData.changedProducts) && remoteData.changedProducts.length > 0) {
        nextProducts = mergeEntitiesByUpdatedAt(
          nextProducts,
          remoteData.changedProducts,
          false,
          (local, remote) => ({ ...remote, imageUrl: remote.imageUrl || local.imageUrl || '' })
        );
      }
      if (Array.isArray(remoteData.deletedProductIds) && remoteData.deletedProductIds.length > 0) {
        const delSet = new Set(remoteData.deletedProductIds);
        nextProducts = nextProducts.filter((p) => !delSet.has(p.id));
      }
      if (JSON.stringify(productsRef.current) !== JSON.stringify(nextProducts)) {
        setProducts(nextProducts);
        productsRef.current = nextProducts;
        saveStoredProducts(nextProducts);
        changed = true;
      }
    }

    // 3. Packages
    if (Array.isArray(remoteData.packages) && (isInitialSync ? remoteData.packages.length > 0 : true)) {
      if (JSON.stringify(packagesRef.current) !== JSON.stringify(remoteData.packages)) {
        setPackages(remoteData.packages);
        packagesRef.current = remoteData.packages;
        saveStoredPackages(remoteData.packages);
        changed = true;
      }
    }

    // 4. Staff
    if (Array.isArray(remoteData.staff) && (isInitialSync ? remoteData.staff.length > 0 : true)) {
      if (JSON.stringify(staffRef.current) !== JSON.stringify(remoteData.staff)) {
        setStaffList(remoteData.staff);
        staffRef.current = remoteData.staff;
        saveStoredStaff(remoteData.staff);
        changed = true;
      }
    }

    // 5. Debts
    const rDebts = remoteData.debts ?? (remoteData as any).saveDebts?.debts;
    if (Array.isArray(rDebts)) {
      const nextDebts = isInitialSync
        ? rDebts
        : mergeEntitiesByUpdatedAt(debtsRef.current, rDebts, isFullSnapshot);
      if (JSON.stringify(debtsRef.current) !== JSON.stringify(nextDebts)) {
        setDebts(nextDebts);
        debtsRef.current = nextDebts;
        saveStoredDebts(nextDebts);
        changed = true;
      }
    } else if (remoteData.clearAllDebts) {
      if (debtsRef.current.length > 0) {
        setDebts([]);
        debtsRef.current = [];
        saveStoredDebts([]);
        changed = true;
      }
    } else if (Array.isArray(remoteData.changedDebts) || Array.isArray(remoteData.deletedDebtIds)) {
      let nextDebts = [...debtsRef.current];
      if (Array.isArray(remoteData.changedDebts) && remoteData.changedDebts.length > 0) {
        nextDebts = mergeEntitiesByUpdatedAt(nextDebts, remoteData.changedDebts, false);
      }
      if (Array.isArray(remoteData.deletedDebtIds) && remoteData.deletedDebtIds.length > 0) {
        const delSet = new Set(remoteData.deletedDebtIds);
        nextDebts = nextDebts.filter((d) => !delSet.has(d.id));
      }
      if (JSON.stringify(debtsRef.current) !== JSON.stringify(nextDebts)) {
        setDebts(nextDebts);
        debtsRef.current = nextDebts;
        saveStoredDebts(nextDebts);
        changed = true;
      }
    }

    // 6. Bills (Server is authoritative on Fetch-First; keep recent in-flight local bills <8s during live sync)
    if (remoteData.clearAllBills || action === 'clearAllBills') {
      if (billsRef.current.length > 0) {
        setBills([]);
        billsRef.current = [];
        updateStoredBills([]);
        changed = true;
      }
    } else if (Array.isArray(remoteData.bills)) {
      let nextBills: BillRecord[];
      if (isInitialSync) {
        nextBills = [...remoteData.bills];
      } else {
        const map = new Map<string, BillRecord>();
        remoteData.bills.forEach((b) => map.set(b.id, b));
        billsRef.current.forEach((b) => {
          if (!map.has(b.id)) {
            const bTs = parseIsoTs(b.updatedAt || b.endTime);
            if (!isFullSnapshot || (bTs > 0 && now - bTs < 8000)) {
              map.set(b.id, b);
            }
          }
        });
        nextBills = Array.from(map.values()).sort(
          (a, b) => new Date(b.endTime || 0).getTime() - new Date(a.endTime || 0).getTime()
        );
      }
      if (JSON.stringify(billsRef.current) !== JSON.stringify(nextBills)) {
        setBills(nextBills);
        billsRef.current = nextBills;
        updateStoredBills(nextBills);
        changed = true;
      }
    } else if (remoteData.bill || Array.isArray(remoteData.changedBills) || Array.isArray(remoteData.deletedBillIds)) {
      let nextBills = [...billsRef.current];
      const upserts = [
        ...(remoteData.bill ? [remoteData.bill] : []),
        ...(Array.isArray(remoteData.changedBills) ? remoteData.changedBills : []),
      ];
      for (const b of upserts) {
        const trimNum = (b.billNumber || '').trim();
        const idx = nextBills.findIndex(
          (ex) => ex.id === b.id || (trimNum && (ex.billNumber || '').trim() === trimNum)
        );
        if (idx >= 0) nextBills[idx] = b;
        else nextBills.unshift(b);
      }
      if (Array.isArray(remoteData.deletedBillIds) && remoteData.deletedBillIds.length > 0) {
        const delSet = new Set(remoteData.deletedBillIds);
        nextBills = nextBills.filter((b) => !delSet.has(b.id));
      }
      if (JSON.stringify(billsRef.current) !== JSON.stringify(nextBills)) {
        setBills(nextBills);
        billsRef.current = nextBills;
        updateStoredBills(nextBills);
        changed = true;
      }
    }

    // 7. Settings
    if (remoteData.settings && typeof remoteData.settings === 'object') {
      setSettings((prev) => {
        const merged = { ...prev, ...remoteData.settings };
        if (JSON.stringify(prev) !== JSON.stringify(merged)) {
          saveStoredSettings(merged);
        }
        return merged;
      });
    }

    if (changed && !isInitialSync) {
      showToast('⚡ ອັບເດດ Real-time ຈາກເຄື່ອງອື່ນອັດຕະໂນມັດແລ້ວ!');
    }
  };

  // Set up multi-device real-time sync across iOS, Android, and Windows PC (Fetch First + SSE + 3.5s Polling + BroadcastChannel)
  useEffect(() => {
    const cleanup = initMultiDeviceSync({
      onDataReceived: (remoteData, action, meta) => {
        applyRemoteSyncData(remoteData, action, meta);
      },
      onStatusChange: (status, message) => {
        if (status === 'connected') {
          setSyncStatus('success');
          setSyncMessage(message || 'Real-time: ພ້ອມຊິ້ງຫຼາຍເຄື່ອງ (PC & ມືຖື)');
          setTimeout(() => setSyncStatus('idle'), 2500);
        } else if (status === 'syncing') {
          setSyncStatus('loading');
          if (message) setSyncMessage(message);
        } else if (status === 'offline') {
          setSyncStatus('error');
          if (message) setSyncMessage(message);
          // Only if Server is genuinely unreachable on boot, fall back cleanly to non-mock local cache
          if (!isServerHydratedRef.current) {
            setIsInitialServerLoading(false);
            const cachedProducts = getStoredProducts();
            const cachedRooms = getStoredRooms();
            const cachedPackages = getStoredPackages();
            const cachedBills = getStoredBills();
            const cachedDebts = getStoredDebts();
            if (cachedProducts.length > 0) setProducts(cachedProducts);
            if (cachedRooms.length > 0) setRooms(cachedRooms);
            if (cachedPackages.length > 0) setPackages(cachedPackages);
            if (cachedBills.length > 0) setBills(cachedBills);
            if (cachedDebts.length > 0) setDebts(cachedDebts);
          }
        } else if (status === 'error') {
          setSyncStatus('error');
          if (message) setSyncMessage(message);
          setTimeout(() => setSyncStatus('idle'), 4000);
        }
      },
    });

    // Safety fallback in case initial fetch takes too long
    const bootFallbackTimer = setTimeout(() => {
      setIsInitialServerLoading(false);
    }, 5000);

    // 2. Real-time Firebase Firestore Cloud Database Listener (Project: ktv-e97cb)
    const unsubFirebase = listenToFirebaseStore((remoteData) => {
      // Ignore if this update was pushed by this exact device
      if (remoteData.lastSenderId && remoteData.lastSenderId === getDeviceId()) {
        return;
      }

      // Wait until real Express Server has hydrated first, and NEVER let older Firestore docs overwrite newer Server state
      if (!isServerHydratedRef.current) {
        return;
      }

      const remoteTime = remoteData.lastUpdated ? new Date(remoteData.lastUpdated).getTime() : 0;
      if (
        remoteTime === 0 ||
        remoteTime <= Math.max(lastLocalActionTimeRef.current, lastServerUpdatedMsRef.current)
      ) {
        return;
      }

      applyRemoteSyncData(
        {
          rooms: remoteData.rooms ?? remoteData.saveRooms?.rooms,
          products: remoteData.products ?? remoteData.saveProducts?.products,
          packages: remoteData.packages ?? remoteData.savePackages?.packages,
          staff: remoteData.staff ?? remoteData.saveStaff?.staff,
          debts: remoteData.debts ?? remoteData.saveDebts?.debts,
          bills: remoteData.bills ?? remoteData.saveBills?.bills,
          bill: remoteData.bill ?? remoteData.saveBill?.bill,
          settings: remoteData.settings ?? remoteData.saveSettings?.settings,
          lastUpdated: remoteData.lastUpdated,
        },
        'syncAll',
        { isInitialSync: false, isFullSnapshot: true }
      );
      showToast('🔥 ອັບເດດ Cloud Real-time (Firebase ktv-e97cb) ສຳເລັດແລ້ວ!');
    });

    return () => {
      clearTimeout(bootFallbackTimer);
      cleanup();
      unsubFirebase();
    };
  }, []);

  // Listen for Bluetooth connection events and try auto-reconnecting on startup
  useEffect(() => {
    const current = getBluetoothStatus();
    if (current.connected) {
      setBluetoothConnected(true);
    } else {
      tryAutoReconnectBluetooth().then((status) => {
        if (status.connected) {
          setBluetoothConnected(true);
        }
      });
    }

    const handleConnected = (e: any) => {
      setBluetoothConnected(true);
      const name = e?.detail?.deviceName || 'Bluetooth Thermal Printer';
      showToast(`🖨️ ເຊື່ອມຕໍ່ເຄື່ອງພິມ "${name}" ສຳເລັດແລ້ວ!`);
    };

    const handleDisconnected = () => {
      setBluetoothConnected(false);
      showToast('⚠️ ຕັດການເຊື່ອມຕໍ່ເຄື່ອງພິມ Bluetooth ແລ້ວ');
    };

    window.addEventListener('689ktv_bluetooth_connected', handleConnected);
    window.addEventListener('689ktv_bluetooth_disconnected', handleDisconnected);

    return () => {
      window.removeEventListener('689ktv_bluetooth_connected', handleConnected);
      window.removeEventListener('689ktv_bluetooth_disconnected', handleDisconnected);
    };
  }, []);

  const triggerGasSync = async (
    action: SyncAction,
    deltaPayload: SyncPayload
  ): Promise<boolean> => {
    const timestamp = new Date().toISOString();
    lastLocalActionTimeRef.current = Date.now();
    isPushingRef.current = true;

    const granularPayload: SyncPayload = {
      ...deltaPayload,
      lastUpdated: timestamp,
    };

    let serverAuthoritativeData: SyncPayload | undefined;
    let pushOk = false;

    // 1. Instantly push granular delta to Express Backend Server & SSE
    try {
      const result = await pushMultiDeviceUpdate(action, granularPayload);
      pushOk = result.success;
      serverAuthoritativeData = result.data;

      if (result.data && result.rejectedStale) {
        applyRemoteSyncData(result.data, 'syncAll', {
          isInitialSync: true,
          isFullSnapshot: true,
          version: result.version,
        });
        showToast('⚠️ ພົບການອັບເດດໃໝ່ກວ່າຈາກເຄື່ອງອື່ນ — ດຶງຂໍ້ມູນລ່າສຸດໃຫ້ແລ້ວ');
      } else if (result.data) {
        applyRemoteSyncData(result.data, action, {
          isInitialSync: false,
          isFullSnapshot: true,
          version: result.version,
        });
      }
    } catch (e) {
      console.warn('Multi-device server push note:', e);
    }

    // 2. Sync authoritative merged state to Firebase Firestore Cloud (ktv-e97cb)
    try {
      const deviceId = getDeviceId();
      const cloudState = serverAuthoritativeData || {
        bills: billsRef.current,
        debts: debtsRef.current,
        products: productsRef.current,
        rooms: roomsRef.current,
        packages: packagesRef.current,
        staff: staffRef.current,
        settings,
      };
      await pushToFirebaseStore({
        lastSenderId: deviceId,
        lastAction: action,
        lastUpdated: serverAuthoritativeData?.lastUpdated || timestamp,
        bills: cloudState.bills ?? billsRef.current,
        debts: cloudState.debts ?? debtsRef.current,
        products: cloudState.products ?? productsRef.current,
        rooms: cloudState.rooms ?? roomsRef.current,
        packages: cloudState.packages ?? packagesRef.current,
        staff: cloudState.staff ?? staffRef.current,
        settings: cloudState.settings ?? settings,
      });
    } catch (e) {
      console.warn('Firebase push note:', e);
    }

    // 3. Forward to Google Sheets Web App if configured
    if (!settings.gasWebAppUrl || isPlaceholderGasUrl(settings.gasWebAppUrl) || settings.realtimeSyncEnabled === false) {
      setTimeout(() => {
        isPushingRef.current = false;
      }, 600);
      return pushOk;
    }

    setSyncStatus('syncing');
    setSyncMessage('ກຳລັງຊິ້ງຂໍ້ມູນລົງ Google Sheets...');

    try {
      const gasPayload = {
        ...granularPayload,
        ...(serverAuthoritativeData
          ? {
              bills: serverAuthoritativeData.bills,
              debts: serverAuthoritativeData.debts,
              products: serverAuthoritativeData.products,
              rooms: serverAuthoritativeData.rooms,
              packages: serverAuthoritativeData.packages,
              staff: serverAuthoritativeData.staff,
            }
          : {}),
      };
      const res = await sendDataToGas(settings.gasWebAppUrl, action, gasPayload);
      if (res.success) {
        setSyncStatus('success');
        setSyncMessage(res.message || 'ຊິ້ງຂໍ້ມູນລົງ Google Sheets ສຳເລັດແລ້ວ');
        const nowStr = new Date().toISOString();
        const updatedSettings = { ...settings, lastSyncedAt: nowStr };
        setSettings(updatedSettings);
        saveStoredSettings(updatedSettings);
        setTimeout(() => setSyncStatus('idle'), 2500);
        return true;
      } else {
        setSyncStatus('error');
        setSyncMessage(res.error || 'ບັນທຶກໃນເຄື່ອງສຳເລັດ (Google Sheets ຢູ່ໃນໂໝດອອບລາຍ)');
        setTimeout(() => setSyncStatus('idle'), 4000);
        return pushOk;
      }
    } catch (err: any) {
      console.warn('Google Sheets sync note:', err);
      setSyncStatus('error');
      setSyncMessage('ບັນທຶກໃນເຄື່ອງສຳເລັດ (ບໍ່ສາມາດເຊື່ອມຕໍ່ Sheets ໄດ້)');
      setTimeout(() => setSyncStatus('idle'), 4000);
      return pushOk;
    } finally {
      setTimeout(() => {
        isPushingRef.current = false;
      }, 7000);
    }
  };

  // Function to fetch latest data from Google Sheets (Multi-device auto loading with timeout & safe timestamp merge)
  const fetchFromGas = async (isManual = false, isSilent = false) => {
    if (!settings.gasWebAppUrl || isPlaceholderGasUrl(settings.gasWebAppUrl)) return;

    if (!isSilent) {
      setSyncStatus('loading');
      setSyncMessage(isManual ? 'ກຳລັງດຶງຂໍ້ມູນລ່າສຸດຈາກ Google Sheets...' : 'ກວດສອບ ແລະ ດຶງຂໍ້ມູນລ່າສຸດຈາກ Google Sheets...');
    }

    const fetchStartTime = Date.now();
    try {
      const res = await fetchLatestDataFromGas(settings.gasWebAppUrl, 7500);
      if (res.success && res.data) {
        if (fetchStartTime >= lastLocalActionTimeRef.current) {
          applyRemoteSyncData(
            {
              products: res.data.products,
              rooms: res.data.rooms,
              packages: res.data.packages,
              staff: res.data.staff,
              debts: res.data.debts,
              bills: res.data.bills,
            },
            'syncAll',
            { isInitialSync: false, isFullSnapshot: true }
          );
        }

        const nowStr = new Date().toISOString();
        const updatedSettings = { ...settings, lastSyncedAt: nowStr };
        setSettings(updatedSettings);
        saveStoredSettings(updatedSettings);

        if (!isSilent) {
          setSyncStatus('success');
          setSyncMessage('ດຶງຂໍ້ມູນລ່າສຸດຈາກ Sheets ສຳເລັດແລ້ວ (ອອນໄລນ໌)');
          setTimeout(() => setSyncStatus('idle'), 2500);
        }
      } else if (!isSilent) {
        setSyncStatus('error');
        setSyncMessage(res.error || 'ບໍ່ສາມາດເຊື່ອມຕໍ່ Sheets ໄດ້ (ກຳລັງໃຊ້ຂໍ້ມູນ Server)');
        setTimeout(() => setSyncStatus('idle'), 4000);
      }
    } catch {
      if (!isSilent) {
        setSyncStatus('error');
        setSyncMessage('ຂໍ້ຜິດພາດການດຶງຂໍ້ມູນ Sheets');
        setTimeout(() => setSyncStatus('idle'), 4000);
      }
    }
  };

  // Continuous background Google Sheets polling loop (every 5 seconds when configured)
  useEffect(() => {
    if (settings.gasWebAppUrl && !isPlaceholderGasUrl(settings.gasWebAppUrl)) {
      fetchFromGas(false, false);
    }

    const handleFocusOrVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        settings.gasWebAppUrl &&
        !isPlaceholderGasUrl(settings.gasWebAppUrl) &&
        settings.realtimeSyncEnabled !== false &&
        !isPushingRef.current
      ) {
        fetchFromGas(false, true);
      }
    };

    window.addEventListener('focus', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);
    window.addEventListener('online', handleFocusOrVisible);

    const intervalId = setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        settings.gasWebAppUrl &&
        !isPlaceholderGasUrl(settings.gasWebAppUrl) &&
        settings.realtimeSyncEnabled !== false &&
        !isPushingRef.current &&
        navigator.onLine !== false
      ) {
        fetchFromGas(false, true);
      }
    }, 5000);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
      window.removeEventListener('online', handleFocusOrVisible);
    };
  }, [settings.gasWebAppUrl, settings.realtimeSyncEnabled]);

  // Check Bluetooth and Storage Events
  useEffect(() => {
    const checkBt = () => {
      const status = getBluetoothStatus();
      setBluetoothConnected(status.connected);
    };
    checkBt();
    const btInterval = setInterval(checkBt, 4000);

    const handleStorageUpdate = () => {
      setProducts(getStoredProducts());
      setRooms(getStoredRooms());
      setBills(getStoredBills());
      setDebts(getStoredDebts());
    };

    window.addEventListener('storage', handleStorageUpdate);
    window.addEventListener('689ktv_products_updated', handleStorageUpdate);
    window.addEventListener('689ktv_rooms_updated', handleStorageUpdate);
    window.addEventListener('689ktv_bills_updated', handleStorageUpdate);
    window.addEventListener('689ktv_debts_updated', handleStorageUpdate);

    return () => {
      clearInterval(btInterval);
      window.removeEventListener('storage', handleStorageUpdate);
      window.removeEventListener('689ktv_products_updated', handleStorageUpdate);
      window.removeEventListener('689ktv_rooms_updated', handleStorageUpdate);
      window.removeEventListener('689ktv_bills_updated', handleStorageUpdate);
      window.removeEventListener('689ktv_debts_updated', handleStorageUpdate);
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  // Helper: Deduct stock locally and return atomic stockDeductions for Server (Multi-unit aware)
  const deductProductsStock = (
    itemsToDeduct: {
      productId: string;
      quantity: number;
      multiplier?: number;
      selectedUnitType?: 'single' | 'pack';
    }[],
    skipSyncPush = false
  ): { updatedProducts: Product[]; stockDeductions: StockDeductionItem[] } => {
    const baseProducts = productsRef.current;
    const deductionMap = new Map<string, number>();

    for (const item of itemsToDeduct) {
      const prod = baseProducts.find((p) => p.id === item.productId);
      if (!prod || prod.category === 'service') continue;
      const mult =
        item.multiplier ||
        (item.selectedUnitType === 'pack' ? (prod.packMultiplier || 24) : 1);
      const baseQty = Math.max(0, Number(item.quantity) || 0) * mult;
      if (baseQty > 0) {
        deductionMap.set(prod.id, (deductionMap.get(prod.id) || 0) + baseQty);
      }
    }

    const stockDeductions: StockDeductionItem[] = Array.from(deductionMap.entries()).map(
      ([productId, deductQty]) => ({ productId, deductQty })
    );

    const nowIso = new Date().toISOString();
    const rawUpdated = deductMultiUnitStockFromCatalog(baseProducts, itemsToDeduct);
    const updatedProducts = rawUpdated.map((p) =>
      deductionMap.has(p.id) ? { ...p, updatedAt: nowIso } : p
    );

    setProducts(updatedProducts);
    productsRef.current = updatedProducts;
    saveStoredProducts(updatedProducts);

    if (!skipSyncPush && stockDeductions.length > 0) {
      triggerGasSync('saveProducts', { stockDeductions });
    }
    return { updatedProducts, stockDeductions };
  };

  // Handle PIN Login Success
  const handlePinSuccess = (role: Role, staffMember?: StaffMember) => {
    setIsAuthenticated(true);
    setCurrentRole(role);
    setCurrentStaff(staffMember);
    showToast(`ຍິນດີຕ້ອນຮັບ ${staffMember?.name || (role === 'admin' ? 'Admin' : 'ພະນັກງານ')} ເຂົ້າສູ່ 689 KTV!`);
  };

  // Checkout POS Sale (Draft Mode: does NOT deduct stock or save to Sales Summary until confirmed!)
  const handleCheckoutPosSale = async (
    cart: CartItem[],
    discount: number,
    paymentMethod: 'cash' | 'transfer',
    cashReceived?: number,
    onConfirmedCallback?: () => void
  ) => {
    const subtotal = cart.reduce((sum, item) => {
      const isPack = item.selectedUnitType === 'pack' && !!item.product.hasMultiUnit;
      const mult = item.multiplier || (isPack ? (item.product.packMultiplier || 24) : 1);
      const price =
        item.customPrice !== undefined
          ? item.customPrice
          : isPack && item.product.packSalePrice
          ? item.product.packSalePrice
          : item.product.salePrice * (isPack ? mult : 1);
      return sum + price * item.quantity;
    }, 0);

    const total = Math.max(0, subtotal - discount);
    const dateNow = new Date();
    const billNumber = generateNextBillNumber(billsRef.current, dateNow);

    const draftBill: BillRecord = {
      id: 'bill-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      billNumber,
      type: 'pos_sale',
      endTime: dateNow.toISOString(),
      roomCharge: 0,
      items: cart.map((c) => {
        const isPack = c.selectedUnitType === 'pack' && !!c.product.hasMultiUnit;
        const multiplier = c.multiplier || (isPack ? (c.product.packMultiplier || 24) : 1);
        const unitLabel = c.unitLabel || (isPack ? (c.product.packUnit || 'ແພັກ') : c.product.unit);
        const unitPrice =
          c.customPrice !== undefined
            ? c.customPrice
            : isPack && c.product.packSalePrice
            ? c.product.packSalePrice
            : c.product.salePrice * (isPack ? multiplier : 1);
        const costPrice = isPack
          ? (c.product.packCostPrice || c.product.costPrice * multiplier)
          : c.product.costPrice;

        return {
          productId: c.product.id,
          productName: isPack ? `${c.product.name} (${unitLabel} x${multiplier})` : c.product.name,
          unit: unitLabel,
          quantity: c.quantity,
          multiplier,
          selectedUnitType: c.selectedUnitType,
          price: unitPrice,
          total: unitPrice * c.quantity,
          sellerId: c.sellerId,
          sellerName: c.sellerName,
          costPrice,
        };
      }),
      subtotal,
      discount,
      tax: 0,
      total,
      payment: {
        method: paymentMethod,
        cashReceived,
        change: paymentMethod === 'cash' && cashReceived && cashReceived > total ? cashReceived - total : 0,
      },
      staffName: currentStaff?.name || (currentRole === 'admin' ? 'Admin' : 'ພະນັກງານ'),
    };

    pendingCheckoutRef.current = {
      mode: 'pos_sale',
      billId: draftBill.id,
      cart: [...cart],
      onPosConfirmed: onConfirmedCallback,
    };
    setIsDraftBilling(true);
    setActiveBillingRecord(draftBill);
  };

  // Transfer Cart items to a KTV Room (Multi-unit aware + Atomic Granular Server Sync)
  const handleTransferToRoom = async (roomId: string, cart: CartItem[]) => {
    const targetRoom = roomsRef.current.find((r) => r.id === roomId);
    if (!targetRoom) return;

    const nowIso = new Date().toISOString();

    // Deduct stock locally and compute atomic stockDeductions (server deducts safely without overwriting concurrent edits)
    const { stockDeductions } = deductProductsStock(
      cart.map((c) => ({
        productId: c.product.id,
        quantity: c.quantity,
        multiplier: c.multiplier || (c.selectedUnitType === 'pack' ? (c.product.packMultiplier || 24) : 1),
        selectedUnitType: c.selectedUnitType,
      })),
      true
    );

    const newOrders = cart.map((c) => {
      const isPack = c.selectedUnitType === 'pack' && !!c.product.hasMultiUnit;
      const multiplier = c.multiplier || (isPack ? (c.product.packMultiplier || 24) : 1);
      const unitLabel = c.unitLabel || (isPack ? (c.product.packUnit || 'ແພັກ') : c.product.unit);
      const unitPrice =
        c.customPrice !== undefined
          ? c.customPrice
          : isPack && c.product.packSalePrice
          ? c.product.packSalePrice
          : c.product.salePrice * (isPack ? multiplier : 1);

      return {
        id: 'ord-' + Date.now() + Math.random().toString(36).substr(2, 4),
        product: c.product,
        quantity: c.quantity,
        selectedUnitType: c.selectedUnitType,
        unitLabel,
        multiplier,
        price: unitPrice,
        orderedAt: nowIso,
        sellerId: c.sellerId,
        sellerName: c.sellerName,
        customPrice: c.customPrice,
        isStockDeducted: true,
      };
    });

    const updatedTargetRoom: Room = {
      ...targetRoom,
      orders: [...(targetRoom.orders || []), ...newOrders],
      updatedAt: nowIso,
    };

    const updatedRooms = roomsRef.current.map((r) => (r.id === roomId ? updatedTargetRoom : r));

    lastRoomLocalActionTimeRef.current = Date.now();
    lastLocalActionTimeRef.current = Date.now();
    roomsRef.current = updatedRooms;
    setRooms(updatedRooms);
    saveStoredRooms(updatedRooms);

    // Send ONLY the changed room + atomic stockDeductions (never overwrite full state)
    await triggerGasSync('saveRooms', {
      changedRooms: [updatedTargetRoom],
      stockDeductions,
    });
    showToast(`ໂອນ ${cart.length} ລາຍການ ເຂົ້າ ${targetRoom.name} ແລະ ຫັກສະຕັອກສຳເລັດແລ້ວ!`);
  };

  // Checkout KTV Room (Draft Mode: does NOT clear room, deduct stock, or save to Sales Summary until confirmed!)
  const handleCheckoutRoom = async (
    room: Room,
    roomCharge: number,
    durationMinutes: number,
    startStr?: string,
    endStr?: string,
    timeRangeStr?: string
  ) => {
    const effectiveDuration = Math.max(1, durationMinutes || 0);
    const actualRoomCharge =
      roomCharge > 0
        ? roomCharge
        : calculateRoomSessionFee(
            room,
            packagesRef.current,
            settings.defaultHourlyRate || 100000,
            effectiveDuration
          );
    const balanceRoomCharge = room.isPaid ? 0 : actualRoomCharge;
    const itemsTotal = room.orders.reduce((sum, o) => sum + o.price * o.quantity, 0);
    const subtotal = balanceRoomCharge + itemsTotal;
    const dateNow = new Date();
    const billNumber = generateNextBillNumber(billsRef.current, dateNow);

    const formattedStart =
      startStr ||
      (room.openedAt
        ? new Date(room.openedAt).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '');
    const formattedEnd =
      endStr ||
      dateNow.toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false });
    const formattedTarget = room.targetEndTime
      ? new Date(room.targetEndTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false })
      : '';

    const timeRangeFormatted =
      timeRangeStr ||
      (formattedStart
        ? (room.pricingType === 'open_time' || !formattedTarget)
          ? `${formattedStart} - ${formattedEnd} (${Math.floor(effectiveDuration / 60)} ຊມ ${effectiveDuration % 60} ນາທີ - ຕາມເວລາຈິງ${room.isPaid ? ' - ຈ່າຍແລ້ວ' : ''})`
          : `${formattedStart} ຫາ ${formattedEnd} (ກຳນົດ: ${formattedStart} ຫາ ${formattedTarget || formattedEnd}${room.isPaid ? ' - ຈ່າຍແລ້ວ' : ''})`
        : undefined);

    const draftBill: BillRecord = {
      id: 'bill-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      billNumber,
      type: 'ktv_room',
      roomId: room.id,
      roomName: room.name,
      packageName: room.packageName,
      bookedHours: room.bookedHours,
      startTime: room.openedAt,
      endTime: dateNow.toISOString(),
      targetEndTime: room.targetEndTime,
      timeRangeFormatted,
      durationMinutes: effectiveDuration,
      pricingType: room.pricingType,
      roomCharge: actualRoomCharge,
      isRoomChargePaid: !!room.isPaid,
      items: room.orders.map((o) => {
        const isPack = o.selectedUnitType === 'pack' && !!o.product.hasMultiUnit;
        const multiplier = o.multiplier || (isPack ? (o.product.packMultiplier || 24) : 1);
        const unitLabel = o.unitLabel || (isPack ? (o.product.packUnit || 'ແພັກ') : o.product.unit);
        return {
          productId: o.product.id,
          productName: isPack ? `${o.product.name} (${unitLabel} x${multiplier})` : o.product.name,
          unit: unitLabel,
          quantity: o.quantity,
          multiplier,
          selectedUnitType: o.selectedUnitType,
          price: o.price,
          total: o.price * o.quantity,
          sellerId: o.sellerId,
          sellerName: o.sellerName,
          costPrice: isPack ? (o.product.packCostPrice || o.product.costPrice * multiplier) : o.product.costPrice,
        };
      }),
      subtotal,
      discount: 0,
      tax: 0,
      total: subtotal,
      payment: {
        method: 'cash',
        cashReceived: subtotal,
        change: 0,
      },
      staffName: currentStaff?.name || (currentRole === 'admin' ? 'Admin' : 'ພະນັກງານ'),
    };

    pendingCheckoutRef.current = {
      mode: 'room_checkout',
      billId: draftBill.id,
      room,
    };
    setIsDraftBilling(true);
    setActiveBillingRecord(draftBill);
  };

  // Split Checkout selected product orders inside an open KTV room (room stays open!)
  const handleSplitCheckoutRoom = (room: Room, selectedOrders: RoomOrder[]) => {
    if (!selectedOrders || selectedOrders.length === 0) return;

    const subtotal = selectedOrders.reduce((sum, o) => sum + o.price * o.quantity, 0);
    const dateNow = new Date();
    const billNumber = generateNextBillNumber(billsRef.current, dateNow);

    const draftBill: BillRecord = {
      id: 'bill-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      billNumber,
      type: 'pos_sale',
      isSplitItemBill: true,
      roomId: room.id,
      roomName: `${room.name} (ແຍກຈ່າຍ)`,
      endTime: dateNow.toISOString(),
      roomCharge: 0,
      items: selectedOrders.map((o) => {
        const isPack = o.selectedUnitType === 'pack' && !!o.product.hasMultiUnit;
        const multiplier = o.multiplier || (isPack ? (o.product.packMultiplier || 24) : 1);
        const unitLabel = o.unitLabel || (isPack ? (o.product.packUnit || 'ແພັກ') : o.product.unit);
        return {
          productId: o.product.id,
          productName: isPack ? `${o.product.name} (${unitLabel} x${multiplier})` : o.product.name,
          unit: unitLabel,
          quantity: o.quantity,
          multiplier,
          selectedUnitType: o.selectedUnitType,
          price: o.price,
          total: o.price * o.quantity,
          sellerId: o.sellerId,
          sellerName: o.sellerName,
          costPrice: isPack ? (o.product.packCostPrice || o.product.costPrice * multiplier) : o.product.costPrice,
        };
      }),
      subtotal,
      discount: 0,
      tax: 0,
      total: subtotal,
      payment: {
        method: 'cash',
        cashReceived: subtotal,
        change: 0,
      },
      staffName: currentStaff?.name || (currentRole === 'admin' ? 'Admin' : 'ພະນັກງານ'),
    };

    pendingCheckoutRef.current = {
      mode: 'room_split',
      billId: draftBill.id,
      roomId: room.id,
      roomName: room.name,
      splitOrders: selectedOrders,
      splitOrderIds: selectedOrders.map((o) => o.id),
    };
    setIsDraftBilling(true);
    setActiveBillingRecord(draftBill);
  };

  // Cancel Draft Bill cleanly WITHOUT saving to Sales Summary or altering room/cart/stock
  const handleCancelBillingDraft = () => {
    const wasDraft = isDraftBilling || !!pendingCheckoutRef.current;
    pendingCheckoutRef.current = null;
    setIsDraftBilling(false);
    setActiveBillingRecord(null);
    if (wasDraft) {
      showToast('ຍົກເລີກບິນແລ້ວ (ບໍ່ໄດ້ບັນທຶກລົງສະຫຼຸບຍອດຂາຍ)');
    }
  };

  // Finalize payment from billing modal (ONLY commits stock, room state & Sales Summary on confirmation!)
  const handleConfirmBillingPayment = async (completedBill: BillRecord) => {
    const draftMeta = pendingCheckoutRef.current;
    const isConfirmingDraft = !!draftMeta && draftMeta.billId === completedBill.id;

    // If simply viewing/reprinting an already-saved bill from history, close safely without side effects
    if (!isConfirmingDraft) {
      setIsDraftBilling(false);
      setActiveBillingRecord(null);
      return;
    }

    const nowIso = new Date().toISOString();
    let stockDeductions: StockDeductionItem[] = [];
    const changedRooms: Room[] = [];

    if (draftMeta.mode === 'pos_sale') {
      const res = deductProductsStock(
        draftMeta.cart.map((c) => ({
          productId: c.product.id,
          quantity: c.quantity,
          multiplier: c.multiplier || (c.selectedUnitType === 'pack' ? (c.product.packMultiplier || 24) : 1),
          selectedUnitType: c.selectedUnitType,
        })),
        true
      );
      stockDeductions = res.stockDeductions;
      draftMeta.onPosConfirmed?.();
    } else if (draftMeta.mode === 'room_checkout') {
      const liveRoom =
        roomsRef.current.find(
          (r) =>
            r.id === draftMeta.room.id ||
            (draftMeta.room.name && r.name === draftMeta.room.name)
        ) || draftMeta.room;

      const undeductedOrders = (liveRoom.orders || []).filter(
        (o) => !o.isStockDeducted && o.product?.category !== 'service'
      );
      if (undeductedOrders.length > 0) {
        const res = deductProductsStock(
          undeductedOrders.map((o) => ({
            productId: o.product.id,
            quantity: o.quantity,
            multiplier: o.multiplier || (o.selectedUnitType === 'pack' ? (o.product.packMultiplier || 24) : 1),
            selectedUnitType: o.selectedUnitType,
          })),
          true
        );
        stockDeductions = res.stockDeductions;
      }

      const clearedRoom: Room = {
        ...liveRoom,
        status: 'available' as const,
        pricingType: 'fixed_hourly' as const,
        openedAt: undefined,
        targetEndTime: undefined,
        bookedHours: 0,
        openedByStaffId: undefined,
        openedByStaffName: undefined,
        packageId: undefined,
        packageName: undefined,
        packagePrice: undefined,
        isPaid: undefined,
        orders: [],
        updatedAt: nowIso,
      };
      changedRooms.push(clearedRoom);

      const updatedRoomsToSync = roomsRef.current.map((r) =>
        r.id === liveRoom.id || (liveRoom.name && r.name === liveRoom.name) ? clearedRoom : r
      );
      lastRoomLocalActionTimeRef.current = Date.now();
      roomsRef.current = updatedRoomsToSync;
      setRooms(updatedRoomsToSync);
      saveStoredRooms(updatedRoomsToSync);
    } else if (draftMeta.mode === 'room_split') {
      const undeductedSplit = draftMeta.splitOrders.filter(
        (o) => !o.isStockDeducted && o.product?.category !== 'service'
      );
      if (undeductedSplit.length > 0) {
        const res = deductProductsStock(
          undeductedSplit.map((o) => ({
            productId: o.product.id,
            quantity: o.quantity,
            multiplier: o.multiplier || (o.selectedUnitType === 'pack' ? (o.product.packMultiplier || 24) : 1),
            selectedUnitType: o.selectedUnitType,
          })),
          true
        );
        stockDeductions = res.stockDeductions;
      }

      const paidIdSet = new Set(draftMeta.splitOrderIds);
      const updatedRoomsToSync = roomsRef.current.map((r) => {
        if (r.id === draftMeta.roomId) {
          const updatedRoom: Room = {
            ...r,
            orders: (r.orders || []).filter((ord) => !paidIdSet.has(ord.id)),
            updatedAt: nowIso,
          };
          changedRooms.push(updatedRoom);
          return updatedRoom;
        }
        return r;
      });
      lastRoomLocalActionTimeRef.current = Date.now();
      roomsRef.current = updatedRoomsToSync;
      setRooms(updatedRoomsToSync);
      saveStoredRooms(updatedRoomsToSync);
    }

    // Save bill ONCE into Sales Summary & storage with updatedAt timestamp
    const stampedBill: BillRecord = {
      ...completedBill,
      updatedAt: nowIso,
    };
    saveStoredBill(stampedBill);
    const updatedBills = getStoredBills();
    billsRef.current = updatedBills;
    setBills(updatedBills);
    lastLocalActionTimeRef.current = Date.now();

    // Send ONLY the new bill + changed room(s) + atomic stockDeductions to Server
    await triggerGasSync('saveBill', {
      bill: stampedBill,
      ...(changedRooms.length > 0 ? { changedRooms } : {}),
      ...(stockDeductions.length > 0 ? { stockDeductions } : {}),
    });

    // If checked out as debt, auto-create Debt Record (guarded against duplicate creation)
    if (
      stampedBill.payment?.method === 'debt' &&
      !debtsRef.current.some((d) => d.billId === stampedBill.id)
    ) {
      const debtInfo = stampedBill.payment.debtInfo;
      const newDebt: DebtRecord = {
        id: 'debt-' + Date.now(),
        customerName: debtInfo?.customerName || 'ລູກຄ້າຕິດໜີ້',
        customerPhone: debtInfo?.customerPhone,
        billId: stampedBill.id,
        billNumber: stampedBill.billNumber,
        roomName: stampedBill.roomName,
        totalAmount: stampedBill.total,
        paidAmount: 0,
        remainingAmount: stampedBill.total,
        status: 'unpaid',
        createdAt: stampedBill.endTime,
        updatedAt: nowIso,
        dueDate: debtInfo?.dueDate,
        photoUrl: debtInfo?.photoUrl,
        note: debtInfo?.note || 'ຕິດໜີ້ຈາກໃບບິນ ' + stampedBill.billNumber,
        staffName: stampedBill.staffName,
        payments: [],
      };
      const updatedDebts = [newDebt, ...debtsRef.current];
      debtsRef.current = updatedDebts;
      setDebts(updatedDebts);
      saveStoredDebts(updatedDebts);
      await triggerGasSync('saveDebts', { changedDebts: [newDebt] });
    }

    const successToast =
      draftMeta.mode === 'room_split'
        ? `ແຍກຈ່າຍບິນ ${stampedBill.billNumber} (${draftMeta.roomName}) ສຳເລັດ! ຫ້ອງຍັງເປີດຢູ່`
        : `ເຊັກບິນ ${stampedBill.billNumber} ສຳເລັດແລ້ວ!`;

    pendingCheckoutRef.current = null;
    setIsDraftBilling(false);
    setActiveBillingRecord(null);
    showToast(successToast);
  };

  // Sync bill to Google Sheets
  const handleSyncBillToGoogleSheet = async (billToSync: BillRecord): Promise<boolean> => {
    if (!settings.googleSheetId) return false;
    const token = await getAccessToken();
    if (!token) return false;

    return await appendBillToSheet(token, settings.googleSheetId, billToSync);
  };

  // Bulk sync all bills & inventory to Google Sheets
  const handleBulkSyncAllToSheets = async () => {
    if (!settings.googleSheetId) {
      setShowSheetsModal(true);
      return;
    }
    const token = await getAccessToken();
    if (!token) {
      setShowSheetsModal(true);
      return;
    }

    setIsSyncingAllSheets(true);
    try {
      await syncInventoryToSheet(token, settings.googleSheetId, products);
      for (const bill of bills) {
        await appendBillToSheet(token, settings.googleSheetId, bill);
      }
      showToast('ຊິ້ງຂໍ້ມູນທັງໝົດລົງ Google Sheets ສຳເລັດແລ້ວ!');
    } catch (err: any) {
      alert('ຊິ້ງລົງ Google Sheets ບໍ່ສຳເລັດ: ' + err.message);
    } finally {
      setIsSyncingAllSheets(false);
    }
  };

  const themeConfig = getThemeConfig(settings.appTheme);

  // App UI Font Scale for PC & Tablets (Phetsarath font)
  const appFontSizeStyle: React.CSSProperties = {
    fontFamily: "'Phetsarath', 'Phetsarath OT', 'Noto Sans Lao', system-ui, sans-serif",
    fontSize:
      settings.appFontSize === 'xlarge'
        ? '18.5px'
        : settings.appFontSize === 'medium'
        ? '15px'
        : settings.appFontSize === 'normal'
        ? '13.5px'
        : '16.5px', // default large
  };

  return (
    <div
      style={appFontSizeStyle}
      className={`w-full min-h-[100dvh] overflow-x-hidden ${themeConfig.bgClass} flex flex-col font-sans selection:bg-rose-500 selection:text-white transition-colors duration-300`}
    >
      {/* 4-Digit PIN Lock Screen Modal (Right after opening or when locked) */}
      {!isAuthenticated && (
        <PinAuthModal
          settings={settings}
          staffList={staffList}
          onSuccess={handlePinSuccess}
        />
      )}

      {/* Main Top Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentRole={currentRole}
        currentUser={currentStaff}
        onLockScreen={() => setIsAuthenticated(false)}
        onOpenSheetsModal={() => setShowSheetsModal(true)}
        onOpenBluetoothModal={() => setShowBluetoothModal(true)}
        onSelectTheme={(themeId) => {
          const updated = { ...settings, appTheme: themeId };
          setSettings(updated);
          saveStoredSettings(updated);
          showToast(`ປ່ຽນໂທນສີເປັນ "${getThemeConfig(themeId).nameLao}" ສຳເລັດ!`);
        }}
        bluetoothConnected={bluetoothConnected}
        sheetsConfigured={!!settings.googleSheetId}
        settings={settings}
        pendingDebtsCount={debts.filter((d) => d.status !== 'paid' && d.remainingAmount > 0).length}
      />

      {/* Real-Time Multi-Device Sync Status Bar */}
      <div className="bg-slate-900/90 border-b border-emerald-500/30 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-2">
          {syncStatus === 'error' ? (
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : syncStatus === 'loading' || syncStatus === 'syncing' ? (
            <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span className="text-slate-100 font-semibold">
            {syncMessage || '⚡ ຊິ້ງຂໍ້ມູນ Server ຫຼາຍອຸປະກອນ Real-time (Fetch-First + Granular Merge)'}
          </span>
          <div className="hidden sm:flex items-center gap-1.5 ml-2 pl-2 border-l border-slate-700 text-[10px] text-emerald-300">
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-bold border border-emerald-500/30">
              <Zap className="w-3 h-3" />
              <span>Real-time 3.5s + SSE</span>
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/90 text-slate-300 font-semibold border border-slate-700">
              <Monitor className="w-3 h-3" />
              <Smartphone className="w-3 h-3" />
              <span>PC &amp; Mobile</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {settings.gasWebAppUrl && !isPlaceholderGasUrl(settings.gasWebAppUrl) && (
            <button
              onClick={() => fetchFromGas(true, false)}
              disabled={syncStatus === 'loading' || syncStatus === 'syncing'}
              title="ດຶງຂໍ້ມູນລ່າສຸດຈາກ Google Sheets"
              className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-[11px] font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${syncStatus === 'loading' || syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
              <span>ດຶງ Sheets</span>
            </button>
          )}
          <button
            onClick={async () => {
              const ok = await fetchLatestServerSnapshot(true);
              if (ok) {
                showToast('✅ ດຶງຂໍ້ມູນລ່າສຸດຈາກ Server ສຳເລັດແລ້ວ!');
              } else {
                showToast('⚠️ ບໍ່ສາມາດເຊື່ອມຕໍ່ Server ໄດ້ຊົ່ວຄາວ');
              }
            }}
            disabled={syncStatus === 'loading' || syncStatus === 'syncing'}
            title="ດຶງຂໍ້ມູນລ່າສຸດຈາກ Server"
            className="px-2.5 py-1 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-200 hover:text-white text-[11px] font-semibold flex items-center gap-1.5 border border-emerald-500/40 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${syncStatus === 'loading' || syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
            <span>ດຶງຂໍ້ມູນລ່າສຸດ (Sync Server)</span>
          </button>
        </div>
      </div>

      {/* Initial Server Hydration Banner (prevents showing stale/empty state before Server loads) */}
      {isInitialServerLoading && (
        <div className="bg-cyan-950/80 border-b border-cyan-500/40 px-4 py-2.5 flex items-center justify-center gap-2 text-xs text-cyan-200 font-bold">
          <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
          <span>ກຳລັງດຶງຂໍ້ມູນສິນຄ້າ, ສະຕັອກ ແລະ ບິນທັງໝົດຈາກ Server ຈິງລົງມາສະແດງ...</span>
        </div>
      )}

      {/* Toast Notification Banner (Centered on Mobile & Tablet, Bottom-Right on Desktop) */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 sm:left-auto sm:right-6 sm:translate-x-0 z-50 bg-gradient-to-r from-rose-600 via-amber-600 to-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl border border-white/20 text-xs sm:text-sm font-bold flex items-center gap-2.5 max-w-[92vw] text-center pointer-events-none transition-all animate-bounce">
          <span className="text-base">✨</span>
          <span className="break-words">{toastMessage}</span>
        </div>
      )}

      {/* Main Workspace Body */}
      <main className="flex-1 pb-16">
        {activeTab === 'pos' && (
          <PosSales
            products={products}
            staffList={staffList}
            activeRooms={rooms}
            settings={settings}
            currentStaff={currentStaff}
            onCheckoutPosSale={handleCheckoutPosSale}
            onTransferToRoom={handleTransferToRoom}
          />
        )}

        {activeTab === 'rooms' && (
          <RoomManagement
            rooms={rooms}
            packages={packages}
            products={products}
            staffList={staffList}
            settings={settings}
            currentStaff={currentStaff}
            currentRole={currentRole}
            onUpdateRooms={async (updated) => {
              const nowIso = new Date().toISOString();
              const prevRooms = roomsRef.current;
              const changedRooms: Room[] = [];
              const stampedAll = updated.map((r) => {
                const prev = prevRooms.find((p) => p.id === r.id);
                if (!prev || JSON.stringify(prev) !== JSON.stringify(r)) {
                  const stamped = { ...r, updatedAt: nowIso };
                  changedRooms.push(stamped);
                  return stamped;
                }
                return r;
              });
              const deletedRoomIds = prevRooms
                .filter((p) => !updated.some((r) => r.id === p.id))
                .map((p) => p.id);

              lastRoomLocalActionTimeRef.current = Date.now();
              roomsRef.current = stampedAll;
              setRooms(stampedAll);
              saveStoredRooms(stampedAll);
              if (changedRooms.length > 0 || deletedRoomIds.length > 0) {
                await triggerGasSync('saveRooms', {
                  ...(changedRooms.length > 0 ? { changedRooms } : {}),
                  ...(deletedRoomIds.length > 0 ? { deletedRoomIds } : {}),
                });
              }
            }}
            onCheckoutRoom={handleCheckoutRoom}
            onSplitCheckoutRoom={handleSplitCheckoutRoom}
          />
        )}

        {activeTab === 'stock' && (
          <InventoryManagement
            products={products}
            currentRole={currentRole}
            settings={settings}
            onSaveProducts={async (updated) => {
              const nowIso = new Date().toISOString();
              const prevProducts = productsRef.current;
              if (updated.length === 0 && prevProducts.length > 0) {
                setProducts([]);
                productsRef.current = [];
                saveStoredProducts([]);
                lastLocalActionTimeRef.current = Date.now();
                await triggerGasSync('saveProducts', { clearProducts: true });
                showToast('✅ ບັນທຶກ ແລະ ອັບເດດສະຕັອກສິນຄ້າສຳເລັດແລ້ວ!');
                return;
              }
              const changedProducts: Product[] = [];
              const stampedAll = updated.map((prod) => {
                const prev = prevProducts.find((p) => p.id === prod.id);
                if (!prev || JSON.stringify(prev) !== JSON.stringify(prod)) {
                  const stamped = { ...prod, updatedAt: nowIso };
                  changedProducts.push(stamped);
                  return stamped;
                }
                return prod;
              });
              const deletedProductIds = prevProducts
                .filter((p) => !updated.some((u) => u.id === p.id))
                .map((p) => p.id);

              setProducts(stampedAll);
              productsRef.current = stampedAll;
              saveStoredProducts(stampedAll);
              lastLocalActionTimeRef.current = Date.now();
              if (changedProducts.length > 0 || deletedProductIds.length > 0) {
                await triggerGasSync('saveProducts', {
                  ...(changedProducts.length > 0 ? { changedProducts } : {}),
                  ...(deletedProductIds.length > 0 ? { deletedProductIds } : {}),
                });
              }
              showToast('✅ ບັນທຶກ ແລະ ອັບເດດສະຕັອກສິນຄ້າສຳເລັດແລ້ວ!');
            }}
          />
        )}

        {activeTab === 'debts' && (
          <DebtManagement
            debts={debts}
            rooms={rooms}
            staffList={staffList}
            settings={settings}
            currentRole={currentRole}
            currentStaff={currentStaff}
            onSaveDebts={async (updated) => {
              const nowIso = new Date().toISOString();
              const prevDebts = debtsRef.current;
              if (updated.length === 0 && prevDebts.length > 0) {
                setDebts([]);
                debtsRef.current = [];
                saveStoredDebts([]);
                lastLocalActionTimeRef.current = Date.now();
                await triggerGasSync('saveDebts', { clearAllDebts: true });
                showToast('ອັບເດດຂໍ້ມູນຍອດຄ້າງຊຳລະສຳເລັດແລ້ວ!');
                return;
              }
              const changedDebts: DebtRecord[] = [];
              const stampedAll = updated.map((d) => {
                const prev = prevDebts.find((p) => p.id === d.id);
                if (!prev || JSON.stringify(prev) !== JSON.stringify(d)) {
                  const stamped = { ...d, updatedAt: nowIso };
                  changedDebts.push(stamped);
                  return stamped;
                }
                return d;
              });
              const deletedDebtIds = prevDebts
                .filter((p) => !updated.some((u) => u.id === p.id))
                .map((p) => p.id);

              setDebts(stampedAll);
              debtsRef.current = stampedAll;
              saveStoredDebts(stampedAll);
              lastLocalActionTimeRef.current = Date.now();
              if (changedDebts.length > 0 || deletedDebtIds.length > 0) {
                await triggerGasSync('saveDebts', {
                  ...(changedDebts.length > 0 ? { changedDebts } : {}),
                  ...(deletedDebtIds.length > 0 ? { deletedDebtIds } : {}),
                });
              }
              showToast('ອັບເດດຂໍ້ມູນຍອດຄ້າງຊຳລະສຳເລັດແລ້ວ!');
            }}
            onOpenBluetoothModal={() => setShowBluetoothModal(true)}
          />
        )}

        {activeTab === 'reports' && (
          <SalesSummary
            bills={bills}
            products={products}
            settings={settings}
            rooms={rooms}
            packages={packages}
            currentRole={currentRole}
            onSyncAllToSheets={handleBulkSyncAllToSheets}
            isSyncingSheets={isSyncingAllSheets}
            onDeleteBill={async (billId) => {
              if (currentRole !== 'admin') {
                showToast('⚠️ ພະນັກງານບໍ່ມີສິດລຶບຂໍ້ມູນ! ສະເພາະ Admin ເທົ່ານັ້ນ');
                return;
              }
              const target = billsRef.current.find((b) => b.id === billId);
              const targetNum = target?.billNumber?.trim();
              const removedIds = billsRef.current
                .filter((b) => b.id === billId || (targetNum && b.billNumber?.trim() === targetNum))
                .map((b) => b.id);
              const updated = billsRef.current.filter((b) => !removedIds.includes(b.id));
              setBills(updated);
              billsRef.current = updated;
              updateStoredBills(updated);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('deleteBill', { deletedBillIds: removedIds.length ? removedIds : [billId] });
              showToast('ລຶບໃບບິນສຳເລັດແລ້ວ!');
            }}
            onDeleteBills={async (billIds) => {
              if (currentRole !== 'admin') {
                showToast('⚠️ ພະນັກງານບໍ່ມີສິດລຶບຂໍ້ມູນ! ສະເພາະ Admin ເທົ່ານັ້ນ');
                return;
              }
              const idSet = new Set(billIds);
              const numSet = new Set(
                billsRef.current
                  .filter((b) => idSet.has(b.id) && b.billNumber?.trim())
                  .map((b) => b.billNumber.trim())
              );
              const removedIds = billsRef.current
                .filter((b) => idSet.has(b.id) || (b.billNumber?.trim() && numSet.has(b.billNumber.trim())))
                .map((b) => b.id);
              const updated = billsRef.current.filter((b) => !removedIds.includes(b.id));
              setBills(updated);
              billsRef.current = updated;
              updateStoredBills(updated);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('deleteBills', { deletedBillIds: removedIds.length ? removedIds : billIds });
              showToast(`ລຶບຂໍ້ມູນ ${billIds.length} ໃບບິນສຳເລັດແລ້ວ!`);
            }}
            onClearAllBills={async () => {
              if (currentRole !== 'admin') {
                showToast('⚠️ ພະນັກງານບໍ່ມີສິດລຶບຂໍ້ມູນ! ສະເພາະ Admin ເທົ່ານັ້ນ');
                return;
              }
              setBills([]);
              billsRef.current = [];
              updateStoredBills([]);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('clearAllBills', { clearAllBills: true });
              showToast('ລ້າງປະຫວັດບິນທັງໝົດສຳເລັດແລ້ວ!');
            }}
            onReprintBill={(bill) => {
              pendingCheckoutRef.current = null;
              setIsDraftBilling(false);
              setActiveBillingRecord(bill);
            }}
            bluetoothConnected={bluetoothConnected}
            onOpenBluetoothSetup={() => setShowBluetoothModal(true)}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsModal
            settings={settings}
            staffList={staffList}
            currentRole={currentRole}
            packages={packages}
            rooms={rooms}
            products={products}
            bills={bills}
            debts={debts}
            onSaveSettings={async (newSettings) => {
              setSettings(newSettings);
              saveStoredSettings(newSettings);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('saveSettings', { settings: newSettings });
              showToast('ບັນທຶກການຕັ້ງຄ່າຮ້ານສຳເລັດແລ້ວ!');
            }}
            onSaveStaff={async (newStaff) => {
              const nowIso = new Date().toISOString();
              const stampedStaff = newStaff.map((s) => ({ ...s, updatedAt: nowIso }));
              setStaffList(stampedStaff);
              staffRef.current = stampedStaff;
              saveStoredStaff(stampedStaff);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('saveStaff', { staff: stampedStaff });
            }}
            onSavePackages={async (newPkgs) => {
              const nowIso = new Date().toISOString();
              const stampedPkgs = newPkgs.map((p) => ({ ...p, updatedAt: nowIso }));
              setPackages(stampedPkgs);
              packagesRef.current = stampedPkgs;
              saveStoredPackages(stampedPkgs);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('savePackages', { packages: stampedPkgs });
            }}
            onSaveRooms={async (newRooms) => {
              const nowIso = new Date().toISOString();
              const prevRooms = roomsRef.current;
              const changedRooms: Room[] = [];
              const stampedAll = newRooms.map((r) => {
                const prev = prevRooms.find((p) => p.id === r.id);
                if (!prev || JSON.stringify(prev) !== JSON.stringify(r)) {
                  const stamped = { ...r, updatedAt: nowIso };
                  changedRooms.push(stamped);
                  return stamped;
                }
                return r;
              });
              const deletedRoomIds = prevRooms
                .filter((p) => !newRooms.some((r) => r.id === p.id))
                .map((p) => p.id);

              lastRoomLocalActionTimeRef.current = Date.now();
              lastLocalActionTimeRef.current = Date.now();
              setRooms(stampedAll);
              roomsRef.current = stampedAll;
              saveStoredRooms(stampedAll);
              if (changedRooms.length > 0 || deletedRoomIds.length > 0) {
                await triggerGasSync('saveRooms', {
                  ...(changedRooms.length > 0 ? { changedRooms } : {}),
                  ...(deletedRoomIds.length > 0 ? { deletedRoomIds } : {}),
                });
              }
              showToast('ບັນທຶກຂໍ້ມູນຫ້ອງ KTV ສຳເລັດແລ້ວ!');
            }}
            onSaveProducts={async (newProducts) => {
              const nowIso = new Date().toISOString();
              const prevProducts = productsRef.current;
              if (newProducts.length === 0 && prevProducts.length > 0) {
                setProducts([]);
                productsRef.current = [];
                saveStoredProducts([]);
                lastLocalActionTimeRef.current = Date.now();
                await triggerGasSync('saveProducts', { clearProducts: true });
                return;
              }
              const changedProducts: Product[] = [];
              const stampedAll = newProducts.map((prod) => {
                const prev = prevProducts.find((p) => p.id === prod.id);
                if (!prev || JSON.stringify(prev) !== JSON.stringify(prod)) {
                  const stamped = { ...prod, updatedAt: nowIso };
                  changedProducts.push(stamped);
                  return stamped;
                }
                return prod;
              });
              const deletedProductIds = prevProducts
                .filter((p) => !newProducts.some((u) => u.id === p.id))
                .map((p) => p.id);

              setProducts(stampedAll);
              productsRef.current = stampedAll;
              saveStoredProducts(stampedAll);
              lastLocalActionTimeRef.current = Date.now();
              if (changedProducts.length > 0 || deletedProductIds.length > 0) {
                await triggerGasSync('saveProducts', {
                  ...(changedProducts.length > 0 ? { changedProducts } : {}),
                  ...(deletedProductIds.length > 0 ? { deletedProductIds } : {}),
                });
              }
            }}
            onSaveBills={async (newBills) => {
              const nowIso = new Date().toISOString();
              const prevBills = billsRef.current;
              if (newBills.length === 0 && prevBills.length > 0) {
                setBills([]);
                billsRef.current = [];
                updateStoredBills([]);
                lastLocalActionTimeRef.current = Date.now();
                await triggerGasSync('clearAllBills', { clearAllBills: true });
                return;
              }
              const changedBills: BillRecord[] = [];
              const stampedAll = newBills.map((b) => {
                const prev = prevBills.find((p) => p.id === b.id);
                if (!prev || JSON.stringify(prev) !== JSON.stringify(b)) {
                  const stamped = { ...b, updatedAt: nowIso };
                  changedBills.push(stamped);
                  return stamped;
                }
                return b;
              });
              const deletedBillIds = prevBills
                .filter((p) => !newBills.some((u) => u.id === p.id))
                .map((p) => p.id);

              setBills(stampedAll);
              billsRef.current = stampedAll;
              updateStoredBills(stampedAll);
              lastLocalActionTimeRef.current = Date.now();
              if (changedBills.length > 0 || deletedBillIds.length > 0) {
                await triggerGasSync('saveBills', {
                  ...(changedBills.length > 0 ? { changedBills } : {}),
                  ...(deletedBillIds.length > 0 ? { deletedBillIds } : {}),
                });
              }
            }}
            onSaveDebts={async (newDebts) => {
              const nowIso = new Date().toISOString();
              const prevDebts = debtsRef.current;
              if (newDebts.length === 0 && prevDebts.length > 0) {
                setDebts([]);
                debtsRef.current = [];
                saveStoredDebts([]);
                lastLocalActionTimeRef.current = Date.now();
                await triggerGasSync('saveDebts', { clearAllDebts: true });
                return;
              }
              const changedDebts: DebtRecord[] = [];
              const stampedAll = newDebts.map((d) => {
                const prev = prevDebts.find((p) => p.id === d.id);
                if (!prev || JSON.stringify(prev) !== JSON.stringify(d)) {
                  const stamped = { ...d, updatedAt: nowIso };
                  changedDebts.push(stamped);
                  return stamped;
                }
                return d;
              });
              const deletedDebtIds = prevDebts
                .filter((p) => !newDebts.some((u) => u.id === p.id))
                .map((p) => p.id);

              setDebts(stampedAll);
              debtsRef.current = stampedAll;
              saveStoredDebts(stampedAll);
              lastLocalActionTimeRef.current = Date.now();
              if (changedDebts.length > 0 || deletedDebtIds.length > 0) {
                await triggerGasSync('saveDebts', {
                  ...(changedDebts.length > 0 ? { changedDebts } : {}),
                  ...(deletedDebtIds.length > 0 ? { deletedDebtIds } : {}),
                });
              }
            }}
            onMasterReset={() => {
              setProducts(INITIAL_PRODUCTS);
              productsRef.current = INITIAL_PRODUCTS;
              saveStoredProducts(INITIAL_PRODUCTS);
              setRooms(INITIAL_ROOMS);
              roomsRef.current = INITIAL_ROOMS;
              saveStoredRooms(INITIAL_ROOMS);
              setPackages(INITIAL_PACKAGES);
              packagesRef.current = INITIAL_PACKAGES;
              saveStoredPackages(INITIAL_PACKAGES);
              setStaffList(INITIAL_STAFF);
              staffRef.current = INITIAL_STAFF;
              saveStoredStaff(INITIAL_STAFF);
              setBills([]);
              billsRef.current = [];
              updateStoredBills([]);
              setDebts([]);
              debtsRef.current = [];
              saveStoredDebts([]);
              setSettings(INITIAL_SETTINGS);
              saveStoredSettings(INITIAL_SETTINGS);
              triggerGasSync('resetAll', {
                products: INITIAL_PRODUCTS,
                rooms: INITIAL_ROOMS,
                packages: INITIAL_PACKAGES,
                staff: INITIAL_STAFF,
                bills: [],
                debts: [],
                settings: INITIAL_SETTINGS,
              });
              showToast('💥 ລ້າງລະບົບ ແລະ ຄືນຄ່າເລີ່ມຕົ້ນທຸກຟັງຊັນສຳເລັດແລ້ວ!');
            }}
            bluetoothConnected={bluetoothConnected}
            onRefreshBluetoothStatus={() => {
              const status = getBluetoothStatus();
              setBluetoothConnected(status.connected);
            }}
          />
        )}
      </main>

      {/* Billing & Thermal Receipt Modal */}
      {activeBillingRecord && (
        <BillingModal
          bill={activeBillingRecord}
          settings={settings}
          isDraftBill={isDraftBilling}
          onClose={() => {
            if (isDraftBilling) {
              handleCancelBillingDraft();
            } else {
              setActiveBillingRecord(null);
            }
          }}
          onCancelBill={handleCancelBillingDraft}
          onConfirmPayment={handleConfirmBillingPayment}
          bluetoothConnected={bluetoothConnected}
          onOpenBluetoothSetup={() => setShowBluetoothModal(true)}
          onSyncGoogleSheet={handleSyncBillToGoogleSheet}
          onUpdateSettings={(newSettings) => {
            setSettings(newSettings);
            saveStoredSettings(newSettings);
          }}
        />
      )}

      {/* Google Sheets Sync Modal */}
      {showSheetsModal && (
        <GoogleSheetsSyncModal
          settings={settings}
          bills={bills}
          products={products}
          rooms={rooms}
          packages={packages}
          staffList={staffList}
          debts={debts}
          onClose={() => setShowSheetsModal(false)}
          onUpdateSettings={(newSettings) => {
            setSettings(newSettings);
            saveStoredSettings(newSettings);
          }}
          onApplyRemoteData={(data) => {
            if (data.products && Array.isArray(data.products) && data.products.length > 0) {
              setProducts(data.products);
              saveStoredProducts(data.products);
            }
            if (data.rooms && Array.isArray(data.rooms) && data.rooms.length > 0) {
              setRooms(data.rooms);
              saveStoredRooms(data.rooms);
            }
            if (data.packages && Array.isArray(data.packages) && data.packages.length > 0) {
              setPackages(data.packages);
              saveStoredPackages(data.packages);
            }
            if (data.staff && Array.isArray(data.staff) && data.staff.length > 0) {
              setStaffList(data.staff);
              saveStoredStaff(data.staff);
            }
            if (data.debts && Array.isArray(data.debts) && data.debts.length > 0) {
              setDebts(data.debts);
              saveStoredDebts(data.debts);
            }
            showToast('ອັບເດດຂໍ້ມູນຈາກ Google Sheets ເຂົ້າສູ່ລະບົບຮຽບຮ້ອຍແລ້ວ!');
          }}
        />
      )}

      {/* Bluetooth Setup Modal */}
      {showBluetoothModal && (
        <BluetoothModal
          settings={settings}
          bluetoothConnected={bluetoothConnected}
          onClose={() => setShowBluetoothModal(false)}
          onRefreshStatus={() => {
            const status = getBluetoothStatus();
            setBluetoothConnected(status.connected);
          }}
          onUpdateSettings={(newSettings) => {
            setSettings(newSettings);
            saveStoredSettings(newSettings);
          }}
        />
      )}

    </div>
  );
}
