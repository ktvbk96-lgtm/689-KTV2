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
  getLastSyncedMeta,
  LastSyncedMeta,
} from './lib/storage';
import { getBluetoothStatus, tryAutoReconnectBluetooth } from './lib/bluetoothPrinter';
import { getAccessToken, initAuth } from './lib/firebase';
import { appendBillToSheet, syncInventoryToSheet } from './lib/googleSheets';
import { fetchLatestDataFromGas, sendDataToGas, GasFullDataPayload, isPlaceholderGasUrl } from './lib/gasSyncService';
import {
  initMultiDeviceSync,
  pushMultiDeviceUpdate,
  fetchLatestServerSnapshot,
  markCloudSnapshotApplied,
  getDeviceLabel,
  getDeviceType,
  CloudUpdateNotice,
  SyncAction,
  SyncPayload,
  StockDeductionItem,
} from './lib/realtimeSync';
import { deductMultiUnitStockFromCatalog } from './lib/multiUnitInventory';
import {
  generateNextBillNumber,
  calculateRoomSessionFee,
  calculateOpenTimeExtensionsBreakdown,
} from './lib/roomPricing';
import { getEffectivePermissions } from './lib/permissions';
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Zap,
  CloudUpload,
  CloudDownload,
  Clock,
  Database,
  Lock,
} from 'lucide-react';

import { Navbar } from './components/Navbar';
import { PinAuthModal } from './components/PinAuthModal';
import { AdminOverrideModal } from './components/AdminOverrideModal';
import {
  CloudUpdateConfirmModal,
  PushCloudConfirmModal,
  DeviceTypeIcon,
} from './components/CloudSyncModal';
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
    baseBookedHours: undefined,
    extensions: [],
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

  // Application Data States (Initialize empty — NEVER seed mock data or clear existing localStorage on startup)
  const [isInitialServerLoading, setIsInitialServerLoading] = useState<boolean>(true);
  const [isLocalPreviewMode, setIsLocalPreviewMode] = useState<boolean>(false);
  const [isUploadingCloud, setIsUploadingCloud] = useState<boolean>(false);
  const [pendingCloudUpdate, setPendingCloudUpdate] = useState<CloudUpdateNotice | null>(null);
  const [isCloudUpdateModalOpen, setIsCloudUpdateModalOpen] = useState<boolean>(false);
  const [isPushConfirmOpen, setIsPushConfirmOpen] = useState<boolean>(false);
  const [lastCloudSyncMeta, setLastCloudSyncMeta] = useState<LastSyncedMeta | null>(() => getLastSyncedMeta());
  const deferredCloudVersionRef = useRef<number>(0);
  const currentDeviceLabel = getDeviceLabel();
  const currentDeviceType = getDeviceType();
  const [products, setProducts] = useState<Product[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [packages, setPackages] = useState<RoomPackage[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>(getStoredStaff());
  const [settings, setSettings] = useState<AppSettings>(getStoredSettings());
  const [bills, setBills] = useState<BillRecord[]>([]);
  const [debts, setDebts] = useState<DebtRecord[]>([]);

  // Granular Effective Staff Permissions (Admin ALWAYS retains all 8 permissions)
  const effectivePermissions = getEffectivePermissions(currentRole, currentStaff);

  // Admin Override PIN Modal (Temporary approval for unauthorized staff actions)
  const [adminOverrideModal, setAdminOverrideModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    onApproved: (() => void) | null;
  }>({
    isOpen: false,
    title: '',
    description: '',
    onApproved: null,
  });

  const requestAdminOverride = (title: string, description: string, onApproved: () => void) => {
    setAdminOverrideModal({
      isOpen: true,
      title,
      description,
      onApproved,
    });
  };

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

  // Real-time Sync & Multi-Device States
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'syncing'>('idle');
  const [syncMessage, setSyncMessage] = useState<string>('');
  const isLocalPreviewModeRef = useRef<boolean>(false);

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
  const serverOfflineRef = useRef<boolean>(false);

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

  // Keep logged-in staff member's granular permissions synced live when staffList updates
  useEffect(() => {
    if (!currentStaff) return;
    const fresh = staffList.find((s) => s.id === currentStaff.id);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(currentStaff)) {
      setCurrentStaff(fresh);
    }
  }, [staffList, currentStaff]);

  const canAccessTab = (
    tab: 'pos' | 'rooms' | 'stock' | 'debts' | 'reports' | 'settings',
    perms = effectivePermissions
  ): boolean => {
    if (currentRole === 'admin') return true;
    switch (tab) {
      case 'pos':
        return !!perms.posSales;
      case 'rooms':
        return !!perms.roomManagement;
      case 'stock':
        return !!perms.manageStock;
      case 'debts':
        return !!perms.posSales || !!perms.viewReports;
      case 'reports':
        return !!perms.viewReports;
      case 'settings':
        return !!perms.manageStaff;
      default:
        return false;
    }
  };

  const getFirstAllowedTab = (perms = effectivePermissions): 'pos' | 'rooms' | 'stock' | 'debts' | 'reports' | 'settings' => {
    const order: Array<'pos' | 'rooms' | 'stock' | 'debts' | 'reports' | 'settings'> = [
      'pos',
      'rooms',
      'stock',
      'debts',
      'reports',
      'settings',
    ];
    return order.find((t) => canAccessTab(t, perms)) || 'pos';
  };

  // Auto-redirect if activeTab becomes disallowed after login or live permission change
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!canAccessTab(activeTab, effectivePermissions)) {
      setActiveTab(getFirstAllowedTab(effectivePermissions));
    }
  }, [isAuthenticated, activeTab, currentRole, currentStaff, staffList]);

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

  // Set up multi-device real-time sync (Neon Postgres via /api/sync; strictly localStorage-only when DATABASE_URL is absent in Preview)
  useEffect(() => {
    const hydrateFromLocalStorageOnly = () => {
      const cachedProducts = getStoredProducts();
      const cachedRooms = getStoredRooms();
      const cachedPackages = getStoredPackages();
      const cachedStaff = getStoredStaff();
      const cachedBills = getStoredBills();
      const cachedDebts = getStoredDebts();
      if (cachedProducts.length > 0) {
        setProducts(cachedProducts);
        productsRef.current = cachedProducts;
      }
      if (cachedRooms.length > 0) {
        setRooms(cachedRooms);
        roomsRef.current = cachedRooms;
      }
      if (cachedPackages.length > 0) {
        setPackages(cachedPackages);
        packagesRef.current = cachedPackages;
      }
      if (cachedStaff.length > 0) {
        setStaffList(cachedStaff);
        staffRef.current = cachedStaff;
      }
      if (cachedBills.length > 0) {
        setBills(cachedBills);
        billsRef.current = cachedBills;
      }
      if (cachedDebts.length > 0) {
        setDebts(cachedDebts);
        debtsRef.current = cachedDebts;
      }
    };

    const cleanup = initMultiDeviceSync({
      hasLocalData: () => {
        if (
          productsRef.current.length > 0 ||
          roomsRef.current.length > 0 ||
          packagesRef.current.length > 0 ||
          billsRef.current.length > 0 ||
          debtsRef.current.length > 0
        ) {
          return true;
        }
        return (
          getStoredProducts().length > 0 ||
          getStoredRooms().length > 0 ||
          getStoredPackages().length > 0 ||
          getStoredBills().length > 0 ||
          getStoredDebts().length > 0
        );
      },
      onDataReceived: (remoteData, action, meta) => {
        serverOfflineRef.current = false;
        isLocalPreviewModeRef.current = false;
        setIsLocalPreviewMode(false);
        applyRemoteSyncData(remoteData, action, meta);
        if (meta?.lastUpdated || remoteData.lastUpdated) {
          setLastCloudSyncMeta({
            version: meta?.version ?? 0,
            lastUpdated: meta?.lastUpdated || remoteData.lastUpdated || '',
            lastUpdatedByDevice: meta?.lastUpdatedByDevice || remoteData.lastUpdatedByDevice,
            lastUpdatedDeviceType: meta?.lastUpdatedDeviceType || remoteData.lastUpdatedDeviceType,
            lastAction: meta?.lastAction || remoteData.lastAction,
          });
        }
      },
      onCloudUpdateAvailable: (notice) => {
        serverOfflineRef.current = false;
        isLocalPreviewModeRef.current = false;
        setIsLocalPreviewMode(false);
        setIsInitialServerLoading(false);
        // Preserve existing local data on screen until user confirms Cloud update
        if (
          productsRef.current.length === 0 &&
          roomsRef.current.length === 0 &&
          billsRef.current.length === 0
        ) {
          hydrateFromLocalStorageOnly();
        }
        setPendingCloudUpdate(notice);
        if (notice.version > deferredCloudVersionRef.current) {
          setIsCloudUpdateModalOpen(true);
        }
      },
      onLocalPreviewDetected: () => {
        // Preview without DATABASE_URL: strictly localStorage only, zero external DB access
        isLocalPreviewModeRef.current = true;
        setIsLocalPreviewMode(true);
        setIsInitialServerLoading(false);
        setSyncStatus('idle');
        setSyncMessage('Preview Mode: ທຳງານສະເພາະໃນ LocalStorage ຂອງເຄື່ອງນີ້ (ບໍ່ເຊື່ອມຕໍ່ຖານຂໍ້ມູນຈິງ)');
        hydrateFromLocalStorageOnly();
      },
      onStatusChange: (status, message) => {
        if (status === 'connected') {
          serverOfflineRef.current = false;
          setSyncStatus('success');
          setSyncMessage(message || 'Neon Postgres: เชื่อมต่อ Cloud เรียบร้อยแล้ว');
          setTimeout(() => setSyncStatus('idle'), 2500);
        } else if (status === 'syncing') {
          setSyncStatus('loading');
          if (message) setSyncMessage(message);
        } else if (status === 'offline') {
          serverOfflineRef.current = true;
          setSyncStatus('error');
          if (message) setSyncMessage(message);
          if (!isServerHydratedRef.current) {
            setIsInitialServerLoading(false);
            hydrateFromLocalStorageOnly();
          }
        } else if (status === 'error') {
          setSyncStatus('error');
          if (message) setSyncMessage(message);
          setTimeout(() => setSyncStatus('idle'), 4000);
        }
      },
    });

    const bootFallbackTimer = setTimeout(() => {
      setIsInitialServerLoading(false);
    }, 5000);

    return () => {
      clearTimeout(bootFallbackTimer);
      cleanup();
    };
  }, []);

  // User confirmed "อัปเดตเป็นข้อมูลล่าสุด" from Microsoft/WPS-style Cloud Update Modal or Banner
  const handleAcceptCloudUpdate = () => {
    if (!pendingCloudUpdate) return;
    const notice = pendingCloudUpdate;
    applyRemoteSyncData(notice.data, 'syncAll', {
      isInitialSync: true,
      isFullSnapshot: true,
      version: notice.version,
    });
    markCloudSnapshotApplied({
      version: notice.version,
      lastUpdated: notice.lastUpdated,
      lastUpdatedByDevice: notice.lastUpdatedByDevice,
      lastUpdatedDeviceType: notice.lastUpdatedDeviceType,
      lastAction: notice.lastAction,
    });
    setLastCloudSyncMeta({
      version: notice.version,
      lastUpdated: notice.lastUpdated,
      lastUpdatedByDevice: notice.lastUpdatedByDevice,
      lastUpdatedDeviceType: notice.lastUpdatedDeviceType,
      lastAction: notice.lastAction,
    });
    deferredCloudVersionRef.current = notice.version;
    setPendingCloudUpdate(null);
    setIsCloudUpdateModalOpen(false);
    setSyncStatus('success');
    setSyncMessage('อัปเดตเป็นข้อมูลล่าสุดจาก Cloud เรียบร้อยแล้ว');
    showToast(`✅ อัปเดตเป็นข้อมูลล่าสุดจาก ${notice.lastUpdatedByDevice} เรียบร้อยแล้ว!`);
  };

  // User chose "ดูไว้ก่อน / ยังไม่อัปเดต" — dismiss modal and keep top reminder banner
  const handleDeferCloudUpdate = () => {
    if (pendingCloudUpdate) {
      deferredCloudVersionRef.current = pendingCloudUpdate.version;
    }
    setIsCloudUpdateModalOpen(false);
    showToast('ℹ️ ยังคงแสดงข้อมูลเดิมในเครื่อง สามารถกดอัปเดตจากแถบด้านบนได้ทุกเมื่อ');
  };

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

    // Preview without DATABASE_URL: strictly browser localStorage only — NEVER touch external DB/API
    if (isLocalPreviewModeRef.current) {
      return false;
    }

    isPushingRef.current = true;

    const granularPayload: SyncPayload = {
      ...deltaPayload,
      lastUpdated: timestamp,
    };

    let serverAuthoritativeData: SyncPayload | undefined;
    let pushOk = false;

    // 1. Push granular delta to Neon Postgres Serverless API (/api/sync)
    try {
      const result = await pushMultiDeviceUpdate(action, granularPayload);
      if (result.mode === 'local_preview') {
        isLocalPreviewModeRef.current = true;
        setIsLocalPreviewMode(true);
        isPushingRef.current = false;
        return false;
      }
      pushOk = result.success;
      serverAuthoritativeData = result.data;

      if (result.success && result.lastUpdated) {
        setLastCloudSyncMeta({
          version: result.version ?? 0,
          lastUpdated: result.lastUpdated,
          lastUpdatedByDevice: result.lastUpdatedByDevice || currentDeviceLabel,
          lastUpdatedDeviceType: result.lastUpdatedDeviceType || currentDeviceType,
          lastAction: action,
        });
      }

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

    // 2. Forward to Google Sheets Web App only if explicitly configured
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

  // Upload local device stock/rooms/staff/bills into Neon Postgres Cloud (Non-Destructive Merge, NEVER empty overwrite)
  const handleUploadLocalToCloud = async () => {
    if (isLocalPreviewModeRef.current) {
      showToast('ℹ️ ໜ້າ Preview ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ DATABASE_URL (ທຳງານສະເພາະໃນ LocalStorage ຂອງເຄື່ອງນີ້)');
      return;
    }

    const localProducts = productsRef.current.length > 0 ? productsRef.current : getStoredProducts();
    const localRooms = roomsRef.current.length > 0 ? roomsRef.current : getStoredRooms();
    const localPackages = packagesRef.current.length > 0 ? packagesRef.current : getStoredPackages();
    const localStaff = staffRef.current.length > 0 ? staffRef.current : getStoredStaff();
    const localBills = billsRef.current.length > 0 ? billsRef.current : getStoredBills();
    const localDebts = debtsRef.current.length > 0 ? debtsRef.current : getStoredDebts();

    const totalItems =
      localProducts.length +
      localRooms.length +
      localPackages.length +
      localStaff.length +
      localBills.length +
      localDebts.length;

    if (totalItems === 0) {
      showToast('⚠️ ບໍ່ມີຂໍ້ມູນໃນເຄື່ອງນີ້ສຳລັບອັບໂຫຼດຂຶ້ນ Cloud (ປ້ອງກັນການຂຽນທັບຂໍ້ມູນວ່າງ)');
      return;
    }

    setIsUploadingCloud(true);
    setSyncStatus('syncing');
    setSyncMessage('ກຳລັງອັບໂຫຼດຂໍ້ມູນຈາກເຄື່ອງນີ້ຂຶ້ນ Neon Postgres Cloud...');

    try {
      const payload: SyncPayload = {
        ...(localProducts.length > 0 ? { products: localProducts } : {}),
        ...(localRooms.length > 0 ? { rooms: localRooms } : {}),
        ...(localPackages.length > 0 ? { packages: localPackages } : {}),
        ...(localStaff.length > 0 ? { staff: localStaff } : {}),
        ...(localBills.length > 0 ? { bills: localBills } : {}),
        ...(localDebts.length > 0 ? { debts: localDebts } : {}),
        settings,
        lastUpdated: new Date().toISOString(),
      };

      const res = await pushMultiDeviceUpdate('uploadLocalToCloud', payload);
      if (res.mode === 'local_preview') {
        isLocalPreviewModeRef.current = true;
        setIsLocalPreviewMode(true);
        showToast('ℹ️ ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ DATABASE_URL ໃນ Server ນີ້');
        return;
      }

      if (res.success && res.data) {
        applyRemoteSyncData(res.data, 'syncAll', {
          isInitialSync: true,
          isFullSnapshot: true,
          version: res.version,
        });
        if (res.lastUpdated) {
          setLastCloudSyncMeta({
            version: res.version ?? 0,
            lastUpdated: res.lastUpdated,
            lastUpdatedByDevice: res.lastUpdatedByDevice || currentDeviceLabel,
            lastUpdatedDeviceType: res.lastUpdatedDeviceType || currentDeviceType,
            lastAction: 'uploadLocalToCloud',
          });
        }
        setPendingCloudUpdate(null);
        setIsCloudUpdateModalOpen(false);
        setSyncStatus('success');
        setSyncMessage('ส่งข้อมูลจากเครื่องนี้ขึ้น Neon Postgres Cloud เรียบร้อยแล้ว!');
        showToast(
          `☁️ ส่งข้อมูลขึ้น Cloud สำเร็จ! (สินค้า ${res.data.products?.length ?? 0}, ห้อง ${res.data.rooms?.length ?? 0}, พนักงาน ${res.data.staff?.length ?? 0}, บิล ${res.data.bills?.length ?? 0})`
        );
      } else {
        setSyncStatus('error');
        showToast('⚠️ ส่งข้อมูลขึ้น Cloud ไม่สำเร็จ — กรุณาตรวจสอบ DATABASE_URL');
      }
    } catch (err) {
      console.error('Upload local to cloud failed:', err);
      setSyncStatus('error');
      showToast('⚠️ ไม่สามารถส่งข้อมูลขึ้น Cloud ได้');
    } finally {
      setIsUploadingCloud(false);
      setIsPushConfirmOpen(false);
    }
  };

  // Handle PIN Login Success
  const handlePinSuccess = (role: Role, staffMember?: StaffMember) => {
    setIsAuthenticated(true);
    setCurrentRole(role);
    setCurrentStaff(staffMember);
    const nextPerms = getEffectivePermissions(role, staffMember);
    if (role !== 'admin') {
      const order: Array<'pos' | 'rooms' | 'stock' | 'debts' | 'reports' | 'settings'> = [
        'pos',
        'rooms',
        'stock',
        'debts',
        'reports',
        'settings',
      ];
      const allowed = (tab: typeof activeTab) => {
        switch (tab) {
          case 'pos':
            return !!nextPerms.posSales;
          case 'rooms':
            return !!nextPerms.roomManagement;
          case 'stock':
            return !!nextPerms.manageStock;
          case 'debts':
            return !!nextPerms.posSales || !!nextPerms.viewReports;
          case 'reports':
            return !!nextPerms.viewReports;
          case 'settings':
            return !!nextPerms.manageStaff;
        }
      };
      if (!allowed(activeTab)) {
        const firstAllowed = order.find(allowed) || 'pos';
        setActiveTab(firstAllowed);
      }
    }
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
    const dateNow = new Date();
    const openExtBreakdown = calculateOpenTimeExtensionsBreakdown(
      room,
      settings.defaultHourlyRate || 100000,
      dateNow.getTime()
    );
    const openExtBillItems = openExtBreakdown.entries
      .filter((e) => !e.isPaid && e.charge > 0)
      .map((entry) => ({
        productId: `room-ext-${entry.id}`,
        productName: `${entry.label} (${Math.floor(entry.durationMinutes / 60)} ຊມ ${entry.durationMinutes % 60} ນາທີ)`,
        unit: 'ຄັ້ງ',
        quantity: 1,
        multiplier: 1,
        price: entry.charge,
        total: entry.charge,
        costPrice: 0,
      }));
    const itemsTotal =
      room.orders.reduce((sum, o) => sum + o.price * o.quantity, 0) +
      openExtBreakdown.totalUnpaidCharge;
    const subtotal = balanceRoomCharge + itemsTotal;
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
      items: [
        ...room.orders.map((o) => {
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
        ...openExtBillItems,
      ],
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
        baseBookedHours: undefined,
        extensions: [],
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
        setActiveTab={(tab) => {
          if (!canAccessTab(tab, effectivePermissions)) {
            showToast('🔒 ທ່ານບໍ່ມີສິດເຂົ້າເຖິງເມນູນີ້ — ກະລຸນາຕິດຕໍ່ Admin/Owner');
            return;
          }
          setActiveTab(tab);
        }}
        currentRole={currentRole}
        currentUser={currentStaff}
        permissions={effectivePermissions}
        onAccessDenied={(msg) => showToast(msg)}
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

      {/* Real-Time Multi-Device Cloud Sync Status Bar (Neon Postgres / Preview LocalStorage) */}
      <div className="bg-slate-900/90 border-b border-emerald-500/30 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs backdrop-blur-md shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {isLocalPreviewMode ? (
            <Database className="w-4 h-4 text-amber-400 shrink-0" />
          ) : syncStatus === 'error' ? (
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : syncStatus === 'loading' || syncStatus === 'syncing' ? (
            <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span className="text-slate-100 font-semibold">
            {syncMessage ||
              (isLocalPreviewMode
                ? 'Preview Mode: ทำงานเฉพาะใน LocalStorage เครื่องนี้ (ไม่แตะฐานข้อมูลจริง)'
                : '⚡ Neon Postgres Cloud Sync (แจ้งเตือนยืนยันอัปเดตเมื่ออีกเครื่องแก้ไข)')}
          </span>
          <div className="hidden md:flex items-center gap-1.5 ml-1 pl-2 border-l border-slate-700 text-[10px]">
            {isLocalPreviewMode ? (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 font-bold border border-amber-500/30">
                <Database className="w-3 h-3" />
                <span>Local Preview Only</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-bold border border-emerald-500/30">
                <Zap className="w-3 h-3" />
                <span>Neon Cloud</span>
              </span>
            )}
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/90 text-slate-300 font-semibold border border-slate-700">
              <DeviceTypeIcon type={currentDeviceType} className="w-3 h-3 text-cyan-400" />
              <span>เครื่องนี้: {currentDeviceLabel}</span>
            </span>
            {!isLocalPreviewMode && lastCloudSyncMeta?.lastUpdated && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/70 text-slate-300 font-medium border border-slate-700/80">
                <Clock className="w-3 h-3 text-amber-400" />
                <span>
                  อัปเดตล่าสุด:{' '}
                  {new Date(lastCloudSyncMeta.lastUpdated).toLocaleTimeString('th-TH', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  })}
                  {lastCloudSyncMeta.lastUpdatedByDevice
                    ? ` (${lastCloudSyncMeta.lastUpdatedByDevice})`
                    : ''}
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!isLocalPreviewMode && (
            <button
              type="button"
              onClick={async () => {
                const res = await fetchLatestServerSnapshot(true);
                if (res.ok && res.mode === 'neon_postgres') {
                  setPendingCloudUpdate(null);
                  setIsCloudUpdateModalOpen(false);
                  if (res.lastUpdated) {
                    setLastCloudSyncMeta({
                      version: res.version ?? 0,
                      lastUpdated: res.lastUpdated,
                      lastUpdatedByDevice: res.lastUpdatedByDevice,
                      lastUpdatedDeviceType: res.lastUpdatedDeviceType,
                    });
                  }
                  showToast('✅ ดึงข้อมูลล่าสุดจาก Cloud เรียบร้อยแล้ว!');
                } else if (res.mode === 'local_preview') {
                  showToast('ℹ️ หน้า Preview ยังไม่ได้ตั้งค่า DATABASE_URL (ทำงานเฉพาะ LocalStorage)');
                } else {
                  showToast('⚠️ ไม่สามารถเชื่อมต่อ Cloud Server ได้ชั่วคราว');
                }
              }}
              disabled={syncStatus === 'loading' || syncStatus === 'syncing'}
              title="ดึงข้อมูลล่าสุดจาก Neon Postgres Cloud ลงมาแสดงบนเครื่องนี้ทันที"
              className="px-2.5 py-1 rounded-xl bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-100 hover:text-white text-[11px] font-bold flex items-center gap-1.5 border border-emerald-500/45 transition-colors cursor-pointer disabled:opacity-50"
            >
              <CloudDownload className={`w-3.5 h-3.5 ${syncStatus === 'loading' || syncStatus === 'syncing' ? 'animate-pulse' : ''}`} />
              <span>ดึงข้อมูลล่าสุดจาก Cloud</span>
            </button>
          )}
          {!isLocalPreviewMode && (
            <button
              type="button"
              onClick={() => setIsPushConfirmOpen(true)}
              disabled={isUploadingCloud || syncStatus === 'loading' || syncStatus === 'syncing'}
              title="ส่งข้อมูลสต็อก ห้อง พนักงาน และบิลจากเครื่องนี้ขึ้น Neon Postgres Cloud (Merge แบบปลอดภัย)"
              className="px-2.5 py-1 rounded-xl bg-amber-600/25 hover:bg-amber-600/40 text-amber-100 hover:text-white text-[11px] font-bold flex items-center gap-1.5 border border-amber-500/45 transition-colors cursor-pointer disabled:opacity-50"
            >
              <CloudUpload className={`w-3.5 h-3.5 ${isUploadingCloud ? 'animate-bounce' : ''}`} />
              <span>{isUploadingCloud ? 'กำลังส่งข้อมูล...' : 'ส่งข้อมูลเครื่องนี้ขึ้น Cloud'}</span>
            </button>
          )}
          {!isLocalPreviewMode && settings.gasWebAppUrl && !isPlaceholderGasUrl(settings.gasWebAppUrl) && (
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
        </div>
      </div>

      {/* Deferred Cloud Update Reminder Banner (Microsoft / WPS Style) */}
      {!isLocalPreviewMode && pendingCloudUpdate && !isCloudUpdateModalOpen && (
        <div className="bg-gradient-to-r from-cyan-950/95 via-slate-900 to-emerald-950/90 border-b border-cyan-400/50 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs shadow-lg">
          <div className="flex items-center gap-2.5 text-cyan-100 font-semibold">
            <CloudDownload className="w-4 h-4 text-cyan-300 shrink-0 animate-bounce" />
            <span>
              พบข้อมูลอัปเดตล่าสุดจากอีกเครื่อง ({pendingCloudUpdate.lastUpdatedByDevice}) • ต้องการอัปเดตเป็นข้อมูลล่าสุดไหม?
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsCloudUpdateModalOpen(true)}
              className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 text-[11px] font-semibold cursor-pointer"
            >
              ดูรายละเอียด
            </button>
            <button
              type="button"
              onClick={handleAcceptCloudUpdate}
              className="px-3.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1.5 shadow cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>อัปเดตเป็นข้อมูลล่าสุด</span>
            </button>
          </div>
        </div>
      )}

      {/* Initial Server Hydration Banner */}
      {isInitialServerLoading && (
        <div className="bg-cyan-950/80 border-b border-cyan-500/40 px-4 py-2.5 flex items-center justify-center gap-2 text-xs text-cyan-200 font-bold">
          <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
          <span>ກຳລັງດຶງຂໍ້ມູນສິນຄ້າ, ສະຕັອກ ແລະ ບິນທັງໝົດຈາກ Neon Postgres...</span>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 sm:left-auto sm:right-6 sm:translate-x-0 z-50 bg-gradient-to-r from-rose-600 via-amber-600 to-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl border border-white/20 text-xs sm:text-sm font-bold flex items-center gap-2.5 max-w-[92vw] text-center pointer-events-none transition-all animate-bounce">
          <span className="text-base">✨</span>
          <span className="break-words">{toastMessage}</span>
        </div>
      )}

      {/* Main Workspace Body */}
      <main className="flex-1 pb-16">
        {activeTab === 'pos' && canAccessTab('pos', effectivePermissions) && (
          <PosSales
            products={products}
            staffList={staffList}
            activeRooms={rooms}
            settings={settings}
            currentRole={currentRole}
            currentStaff={currentStaff}
            permissions={effectivePermissions}
            onRequestAdminOverride={requestAdminOverride}
            onCheckoutPosSale={handleCheckoutPosSale}
            onTransferToRoom={handleTransferToRoom}
          />
        )}

        {activeTab === 'rooms' && canAccessTab('rooms', effectivePermissions) && (
          <RoomManagement
            rooms={rooms}
            packages={packages}
            products={products}
            staffList={staffList}
            settings={settings}
            currentStaff={currentStaff}
            currentRole={currentRole}
            permissions={effectivePermissions}
            onRequestAdminOverride={requestAdminOverride}
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

        {activeTab === 'stock' && canAccessTab('stock', effectivePermissions) && (
          <InventoryManagement
            products={products}
            currentRole={currentRole}
            permissions={effectivePermissions}
            onRequestAdminOverride={requestAdminOverride}
            settings={settings}
            onSaveProducts={async (updated) => {
              const nowIso = new Date().toISOString();
              const prevProducts = productsRef.current;
              if (updated.length === 0 && prevProducts.length > 0) {
                showToast('⚠️ ລະບົບປ້ອງກັນບໍ່ໃຫ້ລ້າງສິນຄ້າທັງໝົດພ້ອມກັນ (ປ້ອງກັນຂໍ້ມູນຫາຍ)');
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

        {activeTab === 'debts' && canAccessTab('debts', effectivePermissions) && (
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
                showToast('⚠️ ລະບົບປ້ອງກັນບໍ່ໃຫ້ລ້າງຂໍ້ມູນໜີ້ທັງໝົດພ້ອມກັນ');
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

        {activeTab === 'reports' && canAccessTab('reports', effectivePermissions) && (
          <SalesSummary
            bills={bills}
            products={products}
            settings={settings}
            rooms={rooms}
            packages={packages}
            currentRole={currentRole}
            permissions={effectivePermissions}
            onRequestAdminOverride={requestAdminOverride}
            onSyncAllToSheets={handleBulkSyncAllToSheets}
            isSyncingSheets={isSyncingAllSheets}
            onDeleteBill={async (billId) => {
              if (currentRole !== 'admin') {
                showToast('⚠️ ພະນັກງານບໍ່ມີສິດລຶບຂໍ້ມູນບິນ! ສະເພາະ Admin ເທົ່ານັ້ນ');
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
                showToast('⚠️ ພະນັກງານບໍ່ມີສິດລຶບຂໍ້ມູນຫຼາຍບິນ! ສະເພາະ Admin ເທົ່ານັ້ນ');
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
            onReprintBill={(bill) => {
              pendingCheckoutRef.current = null;
              setIsDraftBilling(false);
              setActiveBillingRecord(bill);
            }}
            bluetoothConnected={bluetoothConnected}
            onOpenBluetoothSetup={() => setShowBluetoothModal(true)}
          />
        )}

        {activeTab === 'settings' && canAccessTab('settings', effectivePermissions) && (
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
                showToast('⚠️ ລະບົບປ້ອງກັນບໍ່ໃຫ້ລ້າງສິນຄ້າທັງໝົດພ້ອມກັນ');
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
                showToast('⚠️ ລະບົບປ້ອງກັນບໍ່ໃຫ້ລ້າງປະຫວັດບິນທັງໝົດພ້ອມກັນ');
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
                showToast('⚠️ ລະບົບປ້ອງກັນບໍ່ໃຫ້ລ້າງຂໍ້ມູນໜີ້ທັງໝົດພ້ອມກັນ');
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
            bluetoothConnected={bluetoothConnected}
            onRefreshBluetoothStatus={() => {
              const status = getBluetoothStatus();
              setBluetoothConnected(status.connected);
            }}
          />
        )}

        {/* Access Locked Fallback View */}
        {!canAccessTab(activeTab, effectivePermissions) && (
          <div className="max-w-md mx-auto mt-16 p-6 rounded-3xl bg-slate-900 border border-slate-800 text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Lock className="w-7 h-7" />
            </div>
            <h3 className="text-base font-black text-slate-100">ບໍ່ມີສິດເຂົ້າເຖິງໜ້ານີ້</h3>
            <p className="text-xs text-slate-400">
              ບັນຊີຂອງທ່ານບໍ່ໄດ້ຮັບສິດເຂົ້າເຖິງເມນູນີ້ ກະລຸນາຕິດຕໍ່ Admin/Owner ເພື່ອເປີດສິດໃນໜ້າຕັ້ງຄ່າພະນັກງານ
            </p>
          </div>
        )}
      </main>

      {/* Admin Override PIN Approval Modal */}
      <AdminOverrideModal
        isOpen={adminOverrideModal.isOpen}
        actionTitle={adminOverrideModal.title}
        actionDescription={adminOverrideModal.description}
        settings={settings}
        staffList={staffList}
        onCancel={() =>
          setAdminOverrideModal({ isOpen: false, title: '', description: '', onApproved: null })
        }
        onApprove={(approverName: string) => {
          const cb = adminOverrideModal.onApproved;
          setAdminOverrideModal({ isOpen: false, title: '', description: '', onApproved: null });
          showToast(`✅ ອະນຸມັດໂດຍ ${approverName} (Admin Override)`);
          cb?.();
        }}
      />

      {/* Billing & Thermal Receipt Modal */}
      {activeBillingRecord && (
        <BillingModal
          bill={activeBillingRecord}
          settings={settings}
          currentRole={currentRole}
          permissions={effectivePermissions}
          onRequestAdminOverride={requestAdminOverride}
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

      {/* Cloud Update Confirmation Modal (Microsoft / WPS Style) */}
      <CloudUpdateConfirmModal
        isOpen={isAuthenticated && isCloudUpdateModalOpen && !!pendingCloudUpdate}
        notice={pendingCloudUpdate}
        onConfirmUpdate={handleAcceptCloudUpdate}
        onDefer={handleDeferCloudUpdate}
      />

      {/* Push Local Data to Cloud Safety Confirmation Modal */}
      <PushCloudConfirmModal
        isOpen={isPushConfirmOpen}
        isUploading={isUploadingCloud}
        counts={{
          products: products.length > 0 ? products.length : getStoredProducts().length,
          rooms: rooms.length > 0 ? rooms.length : getStoredRooms().length,
          packages: packages.length > 0 ? packages.length : getStoredPackages().length,
          staff: staffList.length > 0 ? staffList.length : getStoredStaff().length,
          bills: bills.length > 0 ? bills.length : getStoredBills().length,
          debts: debts.length > 0 ? debts.length : getStoredDebts().length,
        }}
        deviceLabel={currentDeviceLabel}
        onConfirmPush={handleUploadLocalToCloud}
        onClose={() => setIsPushConfirmOpen(false)}
      />

    </div>
  );
}
