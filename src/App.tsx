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
import { initMultiDeviceSync, pushMultiDeviceUpdate, SyncAction, getDeviceId } from './lib/realtimeSync';
import { listenToFirebaseStore, pushToFirebaseStore } from './lib/firebaseSync';
import { deductMultiUnitStockFromCatalog } from './lib/multiUnitInventory';
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

/**
 * Smart Conflict Resolution for Rooms:
 * Prevents remote stale listeners, SSE, or in-flight background requests from overwriting
 * locally cleared rooms back to 'in_use' (fixes race conditions during clearing rooms).
 */
export function mergeRoomsSafely(
  localRooms: Room[],
  remoteRooms: Room[],
  lastLocalActionTime: number
): Room[] {
  const isWithinGracePeriod = Date.now() - lastLocalActionTime < 10000; // 10s grace period

  const merged = localRooms.map((local) => {
    const remote = remoteRooms.find((r) => r.id === local.id || (r.name && r.name === local.name));
    if (!remote) return local;

    // 1. If local room was recently cleared (status === 'available') within grace period,
    // and remote still says 'in_use', reject the stale remote state!
    if (isWithinGracePeriod && local.status === 'available' && remote.status !== 'available') {
      return local;
    }

    // 2. Timestamp comparison if both have updatedAt
    const localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
    const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;

    if (remoteTime > 0 && localTime > 0) {
      if (remoteTime < localTime && isWithinGracePeriod) {
        return local;
      }
    }

    // Explicitly guarantee that if remote cleared the room to available, all session fields are completely wiped
    if (remote.status === 'available') {
      return {
        ...local,
        ...remote,
        status: 'available' as const,
        pricingType: 'fixed_hourly' as const,
        openedAt: undefined,
        targetEndTime: undefined,
        bookedHours: 0,
        openedByStaffId: undefined,
        openedByStaffName: undefined,
        packageId: undefined,
        packageName: undefined,
        isPaid: undefined,
        orders: [],
      };
    }

    return {
      ...local,
      ...remote,
    };
  });

  // Append any rooms that exist in remote but not local
  for (const r of remoteRooms) {
    if (!merged.some((m) => m.id === r.id || (r.name && m.name === r.name))) {
      merged.push(r);
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

  // Application Data States
  const [products, setProducts] = useState<Product[]>(getStoredProducts());
  const [rooms, setRooms] = useState<Room[]>(getStoredRooms());
  const [packages, setPackages] = useState<RoomPackage[]>(getStoredPackages());
  const [staffList, setStaffList] = useState<StaffMember[]>(getStoredStaff());
  const [settings, setSettings] = useState<AppSettings>(getStoredSettings());
  const [bills, setBills] = useState<BillRecord[]>(getStoredBills());
  const [debts, setDebts] = useState<DebtRecord[]>(getStoredDebts());

  // Modals
  const [activeBillingRecord, setActiveBillingRecord] = useState<BillRecord | null>(null);
  const [showSheetsModal, setShowSheetsModal] = useState<boolean>(false);
  const [showBluetoothModal, setShowBluetoothModal] = useState<boolean>(false);
  const [bluetoothConnected, setBluetoothConnected] = useState<boolean>(false);
  const [isSyncingAllSheets, setIsSyncingAllSheets] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('');

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
  const lastLocalActionTimeRef = useRef<number>(Date.now());

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

  // Set up multi-device real-time sync across iOS, Android, and Windows PC (SSE + Polling + BroadcastChannel)
  useEffect(() => {
    const cleanup = initMultiDeviceSync({
      onDataReceived: (remoteData) => {
        // Prevent stale remote snapshots from overwriting fresh local updates
        const remoteTime = remoteData.lastUpdated ? new Date(remoteData.lastUpdated).getTime() : 0;
        if (remoteTime > 0 && remoteTime < lastLocalActionTimeRef.current) {
          return;
        }

        let changed = false;

        // 1. Rooms
        if (Array.isArray(remoteData.rooms)) {
          const mergedRooms = mergeRoomsSafely(roomsRef.current, remoteData.rooms, lastRoomLocalActionTimeRef.current);
          if (JSON.stringify(roomsRef.current) !== JSON.stringify(mergedRooms)) {
            setRooms(mergedRooms);
            roomsRef.current = mergedRooms;
            saveStoredRooms(mergedRooms);
            changed = true;
          }
        }

        // 2. Products (Preserve local image URLs if remote stripped them to save network)
        if (Array.isArray(remoteData.products)) {
          const mergedProducts = remoteData.products.map((rp: Product) => {
            const local = productsRef.current.find((lp) => lp.id === rp.id);
            return {
              ...rp,
              imageUrl: rp.imageUrl || local?.imageUrl || '',
            };
          });
          if (JSON.stringify(productsRef.current) !== JSON.stringify(mergedProducts)) {
            setProducts(mergedProducts);
            productsRef.current = mergedProducts;
            saveStoredProducts(mergedProducts);
            changed = true;
          }
        }

        // 3. Packages
        if (Array.isArray(remoteData.packages)) {
          if (JSON.stringify(packagesRef.current) !== JSON.stringify(remoteData.packages)) {
            setPackages(remoteData.packages);
            saveStoredPackages(remoteData.packages);
            changed = true;
          }
        }

        // 4. Staff
        if (Array.isArray(remoteData.staff)) {
          if (JSON.stringify(staffRef.current) !== JSON.stringify(remoteData.staff)) {
            setStaffList(remoteData.staff);
            saveStoredStaff(remoteData.staff);
            changed = true;
          }
        }

        // 5. Debts
        const rDebts = remoteData.debts ?? (remoteData as any).saveDebts?.debts;
        if (Array.isArray(rDebts)) {
          if (JSON.stringify(debtsRef.current) !== JSON.stringify(rDebts)) {
            setDebts(rDebts);
            saveStoredDebts(rDebts);
            changed = true;
          }
        }

        // 6. Bills (Union merge so no recent local bills are dropped)
        if (Array.isArray(remoteData.bills)) {
          const localBills = billsRef.current;
          const map = new Map<string, BillRecord>();
          remoteData.bills.forEach((b: BillRecord) => map.set(b.id, b));
          localBills.forEach((b: BillRecord) => {
            if (!map.has(b.id)) map.set(b.id, b);
          });
          const mergedBills = Array.from(map.values()).sort(
            (a, b) => new Date(b.endTime || 0).getTime() - new Date(a.endTime || 0).getTime()
          );
          if (JSON.stringify(billsRef.current) !== JSON.stringify(mergedBills)) {
            setBills(mergedBills);
            billsRef.current = mergedBills;
            updateStoredBills(mergedBills);
            changed = true;
          }
        } else if (remoteData.bill) {
          const singleBill = remoteData.bill;
          if (!billsRef.current.some((b) => b.id === singleBill.id)) {
            const updated = [singleBill, ...billsRef.current];
            setBills(updated);
            billsRef.current = updated;
            updateStoredBills(updated);
            changed = true;
          }
        }

        // 7. Settings
        if (remoteData.settings && typeof remoteData.settings === 'object') {
          setSettings((prev) => {
            const merged = { ...prev, ...remoteData.settings };
            saveStoredSettings(merged);
            return merged;
          });
        }

        if (changed) {
          showToast('⚡ ອັບເດດ Real-time ຈາກເຄື່ອງອື່ນອັດຕະໂນມັດແລ້ວ!');
        }
      },
      onStatusChange: (status, message) => {
        if (status === 'connected') {
          setSyncStatus('success');
          setSyncMessage(message || 'Real-time: ພ້ອມຊິ້ງຫຼາຍເຄື່ອງ (iOS, Android, Windows)');
          setTimeout(() => setSyncStatus('idle'), 2500);
        } else if (status === 'syncing') {
          setSyncStatus('loading');
          if (message) setSyncMessage(message);
        } else if (status === 'offline') {
          setSyncStatus('idle');
          if (message) setSyncMessage(message);
        } else if (status === 'error') {
          setSyncStatus('error');
          if (message) setSyncMessage(message);
          setTimeout(() => setSyncStatus('idle'), 4000);
        }
      },
    });

    // 2. Real-time Firebase Firestore Cloud Database Listener (Project: ktv-e97cb)
    const unsubFirebase = listenToFirebaseStore((remoteData) => {
      // Ignore if this update was pushed by this exact device
      if (remoteData.lastSenderId && remoteData.lastSenderId === getDeviceId()) {
        return;
      }

      // Prevent stale Firestore document from overwriting fresh local updates
      const remoteTime = remoteData.lastUpdated ? new Date(remoteData.lastUpdated).getTime() : 0;
      if (remoteTime > 0 && remoteTime < lastLocalActionTimeRef.current) {
        return;
      }

      let changed = false;

      // 1. Rooms
      const rRooms = remoteData.rooms ?? remoteData.saveRooms?.rooms;
      if (Array.isArray(rRooms)) {
        const mergedRooms = mergeRoomsSafely(roomsRef.current, rRooms, lastRoomLocalActionTimeRef.current);
        if (JSON.stringify(roomsRef.current) !== JSON.stringify(mergedRooms)) {
          setRooms(mergedRooms);
          roomsRef.current = mergedRooms;
          saveStoredRooms(mergedRooms);
          changed = true;
        }
      }

      // 2. Products (Safely merge to keep rich local image URLs if remote stripped them)
      const rProducts = remoteData.products ?? remoteData.saveProducts?.products;
      if (Array.isArray(rProducts)) {
        const mergedProducts = rProducts.map((rp: Product) => {
          const local = productsRef.current.find((lp) => lp.id === rp.id);
          return {
            ...rp,
            imageUrl: rp.imageUrl || local?.imageUrl || '',
          };
        });
        if (JSON.stringify(productsRef.current) !== JSON.stringify(mergedProducts)) {
          setProducts(mergedProducts);
          productsRef.current = mergedProducts;
          saveStoredProducts(mergedProducts);
          changed = true;
        }
      }

      // 3. Packages
      const rPackages = remoteData.packages ?? remoteData.savePackages?.packages;
      if (Array.isArray(rPackages)) {
        if (JSON.stringify(packagesRef.current) !== JSON.stringify(rPackages)) {
          setPackages(rPackages);
          packagesRef.current = rPackages;
          saveStoredPackages(rPackages);
          changed = true;
        }
      }

      // 4. Staff
      const rStaff = remoteData.staff ?? remoteData.saveStaff?.staff;
      if (Array.isArray(rStaff)) {
        if (JSON.stringify(staffRef.current) !== JSON.stringify(rStaff)) {
          setStaffList(rStaff);
          staffRef.current = rStaff;
          saveStoredStaff(rStaff);
          changed = true;
        }
      }

      // 5. Debts
      const rDebts = remoteData.debts ?? remoteData.saveDebts?.debts;
      if (Array.isArray(rDebts)) {
        if (JSON.stringify(debtsRef.current) !== JSON.stringify(rDebts)) {
          setDebts(rDebts);
          debtsRef.current = rDebts;
          saveStoredDebts(rDebts);
          changed = true;
        }
      }

      // 6. Bills (Union merge so no recent local bills are dropped)
      const rBills = remoteData.bills ?? remoteData.saveBills?.bills;
      if (Array.isArray(rBills)) {
        const localBills = billsRef.current;
        const map = new Map<string, BillRecord>();
        rBills.forEach((b: BillRecord) => map.set(b.id, b));
        localBills.forEach((b: BillRecord) => {
          if (!map.has(b.id)) map.set(b.id, b);
        });
        const mergedBills = Array.from(map.values()).sort(
          (a, b) => new Date(b.endTime || 0).getTime() - new Date(a.endTime || 0).getTime()
        );
        if (JSON.stringify(billsRef.current) !== JSON.stringify(mergedBills)) {
          setBills(mergedBills);
          billsRef.current = mergedBills;
          updateStoredBills(mergedBills);
          changed = true;
        }
      } else if (remoteData.bill ?? remoteData.saveBill?.bill) {
        const singleBill = remoteData.bill ?? remoteData.saveBill?.bill;
        if (!billsRef.current.some((b) => b.id === singleBill.id)) {
          const updated = [singleBill, ...billsRef.current];
          setBills(updated);
          billsRef.current = updated;
          updateStoredBills(updated);
          changed = true;
        }
      }

      // 7. Settings
      const rSettings = remoteData.settings ?? remoteData.saveSettings?.settings;
      if (rSettings && typeof rSettings === 'object') {
        setSettings((prev) => {
          const merged = { ...prev, ...rSettings };
          saveStoredSettings(merged);
          return merged;
        });
      }

      if (changed) {
        showToast('🔥 ອັບເດດ Cloud Real-time (Firebase ktv-e97cb) ສຳເລັດແລ້ວ!');
      }
    });

    return () => {
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
    payload: any
  ): Promise<boolean> => {
    // Ensure bills, debts, products, and rooms are always captured in full so all devices and forms get immediate Sales Summary, Debt, Room & Stock sync!
    const currentBills = payload.bills !== undefined ? payload.bills : getStoredBills();
    const currentDebts = payload.debts !== undefined ? payload.debts : getStoredDebts();
    const currentProducts = payload.products !== undefined ? payload.products : getStoredProducts();
    const currentRooms = payload.rooms !== undefined ? payload.rooms : getStoredRooms();
    const currentPackages = payload.packages !== undefined ? payload.packages : getStoredPackages();
    const currentStaff = payload.staff !== undefined ? payload.staff : getStoredStaff();

    const timestamp = new Date().toISOString();
    lastLocalActionTimeRef.current = Date.now();

    const enrichedPayload = {
      ...payload,
      bills: currentBills,
      debts: currentDebts,
      products: currentProducts,
      rooms: currentRooms,
      packages: currentPackages,
      staff: currentStaff,
      lastUpdated: timestamp,
    };

    // 1. Instantly push to Backend Server & SSE to notify all iOS, Android & Windows devices
    try {
      await pushMultiDeviceUpdate(action, enrichedPayload);
    } catch (e) {
      console.warn('Realtime push note (running in local mode):', e);
    }

    // 2. Also push to Firebase Firestore Cloud (ktv-e97cb)
    try {
      const deviceId = getDeviceId();
      const firestoreData: any = {
        lastSenderId: deviceId,
        lastAction: action,
        lastUpdated: timestamp,
        bills: currentBills,
        debts: currentDebts,
        products: currentProducts,
        rooms: currentRooms,
        packages: currentPackages,
        staff: currentStaff,
        settings: settings,
      };
      await pushToFirebaseStore(firestoreData);
    } catch (e) {
      console.warn('Firebase push note:', e);
    }

    // 3. Also forward to Google Sheets Web App if configured
    if (!settings.gasWebAppUrl || isPlaceholderGasUrl(settings.gasWebAppUrl) || settings.realtimeSyncEnabled === false) return true;

    // Pause polling temporarily during local push (7s lock to allow Sheets write)
    isPushingRef.current = true;
    setSyncStatus('syncing');
    setSyncMessage('ກຳລັງຊິ້ງຂໍ້ມູນລົງ Google Sheets...');

    try {
      const res = await sendDataToGas(settings.gasWebAppUrl, action, payload);
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
        return false;
      }
    } catch (err: any) {
      console.warn('Google Sheets sync note:', err);
      setSyncStatus('error');
      setSyncMessage('ບັນທຶກໃນເຄື່ອງສຳເລັດ (ບໍ່ສາມາດເຊື່ອມຕໍ່ Sheets ໄດ້)');
      setTimeout(() => setSyncStatus('idle'), 4000);
      return false;
    } finally {
      setTimeout(() => {
        isPushingRef.current = false;
      }, 7000);
    }
  };

  // Function to fetch latest data from Google Sheets (Multi-device auto loading with timeout & diffing)
  const fetchFromGas = async (isManual = false, isSilent = false) => {
    if (!settings.gasWebAppUrl || isPlaceholderGasUrl(settings.gasWebAppUrl)) return;

    if (!isSilent) {
      setSyncStatus('loading');
      setSyncMessage(isManual ? 'ກຳລັງດຶງຂໍ້ມູນລ່າສຸດ...' : 'ກວດສອບ ແລະ ດຶງຂໍ້ມູນລ່າສຸດຈາກ Google Sheets...');
    }

    const fetchStartTime = Date.now();
    try {
      // 7.5s AbortController timeout prevents freezing or infinite spinning
      const res = await fetchLatestDataFromGas(settings.gasWebAppUrl, 7500);
      if (res.success && res.data) {
        let hasAnyUpdates = false;

        // 1. Sync Products if remote changed
        if (res.data.products && Array.isArray(res.data.products)) {
          const currentStr = JSON.stringify(productsRef.current);
          const newStr = JSON.stringify(res.data.products);
          if (currentStr !== newStr) {
            setProducts(res.data.products);
            productsRef.current = res.data.products;
            saveStoredProducts(res.data.products);
            hasAnyUpdates = true;
          }
        }

        // 2. Sync Rooms if remote changed (Safely guarded against in-flight race conditions)
        if (res.data.rooms && Array.isArray(res.data.rooms)) {
          if (fetchStartTime >= lastRoomLocalActionTimeRef.current) {
            const mergedRooms = mergeRoomsSafely(roomsRef.current, res.data.rooms, lastRoomLocalActionTimeRef.current);
            const currentStr = JSON.stringify(roomsRef.current);
            const newStr = JSON.stringify(mergedRooms);
            if (currentStr !== newStr) {
              setRooms(mergedRooms);
              roomsRef.current = mergedRooms;
              saveStoredRooms(mergedRooms);
              hasAnyUpdates = true;
            }
          }
        }

        // 3. Sync Packages if remote changed
        if (res.data.packages && Array.isArray(res.data.packages)) {
          const currentStr = JSON.stringify(packagesRef.current);
          const newStr = JSON.stringify(res.data.packages);
          if (currentStr !== newStr) {
            setPackages(res.data.packages);
            saveStoredPackages(res.data.packages);
            hasAnyUpdates = true;
          }
        }

        // 4. Sync Staff if remote changed
        if (res.data.staff && Array.isArray(res.data.staff)) {
          const currentStr = JSON.stringify(staffRef.current);
          const newStr = JSON.stringify(res.data.staff);
          if (currentStr !== newStr) {
            setStaffList(res.data.staff);
            saveStoredStaff(res.data.staff);
            hasAnyUpdates = true;
          }
        }

        // 5. Sync Debts if remote changed
        if (res.data.debts && Array.isArray(res.data.debts)) {
          const currentStr = JSON.stringify(debtsRef.current);
          const newStr = JSON.stringify(res.data.debts);
          if (currentStr !== newStr) {
            setDebts(res.data.debts);
            saveStoredDebts(res.data.debts);
            hasAnyUpdates = true;
          }
        }

        // 6. Sync Bills if remote changed
        if (res.data.bills && Array.isArray(res.data.bills)) {
          const currentStr = JSON.stringify(billsRef.current);
          const newStr = JSON.stringify(res.data.bills);
          if (currentStr !== newStr) {
            setBills(res.data.bills);
            updateStoredBills(res.data.bills);
            hasAnyUpdates = true;
          }
        }

        const nowStr = new Date().toISOString();
        const updatedSettings = { ...settings, lastSyncedAt: nowStr };
        setSettings(updatedSettings);
        saveStoredSettings(updatedSettings);

        if (hasAnyUpdates && isSilent) {
          showToast('🔄 ອັບເດດຂໍ້ມູນລ່າສຸດຈາກ Google Sheets ອັດຕະໂນມັດແລ້ວ');
        }

        if (!isSilent) {
          setSyncStatus('success');
          setSyncMessage('ດຶງຂໍ້ມູນລ່າສຸດຈາກ Sheets ສຳເລັດແລ້ວ (ອອນໄລນ໌)');
          setTimeout(() => setSyncStatus('idle'), 2500);
        }
      } else if (!isSilent) {
        setSyncStatus('error');
        setSyncMessage(res.error || 'ບໍ່ສາມາດເຊື່ອມຕໍ່ Sheets ໄດ້ (ກຳລັງໃຊ້ຂໍ້ມູນໃນເຄື່ອງ)');
        setTimeout(() => setSyncStatus('idle'), 4000);
      }
    } catch {
      if (!isSilent) {
        setSyncStatus('error');
        setSyncMessage('ຂໍ້ຜິດພາດການດຶງຂໍ້ມູນ (ກຳລັງໃຊ້ຂໍ້ມູນໃນເຄື່ອງ)');
        setTimeout(() => setSyncStatus('idle'), 4000);
      }
    }
  };

  // Continuous background real-time sync polling loop (every 5 seconds)
  // Ensures tablet, mobile phone, and PC all stay strictly in sync without page refresh
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

    // Run active background polling every 5 seconds (only when real URL is configured)
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

  // Helper: Deduct stock from products (Multi-unit aware: single bottle vs pack x24)
  const deductProductsStock = (
    itemsToDeduct: {
      productId: string;
      quantity: number;
      multiplier?: number;
      selectedUnitType?: 'single' | 'pack';
    }[]
  ) => {
    const updated = deductMultiUnitStockFromCatalog(products, itemsToDeduct);
    setProducts(updated);
    saveStoredProducts(updated);
    triggerGasSync('saveProducts', { products: updated });
    return updated;
  };

  // Handle PIN Login Success
  const handlePinSuccess = (role: Role, staffMember?: StaffMember) => {
    setIsAuthenticated(true);
    setCurrentRole(role);
    setCurrentStaff(staffMember);
    showToast(`ຍິນດີຕ້ອນຮັບ ${staffMember?.name || (role === 'admin' ? 'Admin' : 'ພະນັກງານ')} ເຂົ້າສູ່ 689 KTV!`);
  };

  // Checkout POS Sale directly (Supports both single bottle & pack x24)
  const handleCheckoutPosSale = async (
    cart: CartItem[],
    discount: number,
    paymentMethod: 'cash' | 'transfer',
    cashReceived?: number
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
    const dateStr = dateNow.toISOString().slice(0, 10).replace(/-/g, '');
    const billNumber = `689-${dateStr}-${(bills.length + 1).toString().padStart(3, '0')}`;

    // Deduct stock with proper unit multiplier (single = x1, pack = x24 bottles)
    const updatedProducts = deductProductsStock(
      cart.map((c) => ({
        productId: c.product.id,
        quantity: c.quantity,
        multiplier: c.multiplier || (c.selectedUnitType === 'pack' ? (c.product.packMultiplier || 24) : 1),
        selectedUnitType: c.selectedUnitType,
      }))
    );

    const newBill: BillRecord = {
      id: 'bill-' + Date.now(),
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

    // Immediately save to Sales Summary (bills storage & state & real-time sync)
    saveStoredBill(newBill);
    const updatedBills = getStoredBills();
    billsRef.current = updatedBills;
    setBills(updatedBills);
    lastLocalActionTimeRef.current = Date.now();
    await triggerGasSync('saveBill', { bill: newBill, bills: updatedBills, products: updatedProducts });

    setActiveBillingRecord(newBill);
  };

  // Transfer Cart items to a KTV Room (Multi-unit aware)
  const handleTransferToRoom = async (roomId: string, cart: CartItem[]) => {
    const targetRoom = rooms.find((r) => r.id === roomId);
    if (!targetRoom) return;

    // Deduct stock immediately (handles multiplier e.g. 1 pack * 24 bottles)
    const updatedProducts = deductProductsStock(
      cart.map((c) => ({
        productId: c.product.id,
        quantity: c.quantity,
        multiplier: c.multiplier || (c.selectedUnitType === 'pack' ? (c.product.packMultiplier || 24) : 1),
        selectedUnitType: c.selectedUnitType,
      }))
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
        orderedAt: new Date().toISOString(),
        sellerId: c.sellerId,
        sellerName: c.sellerName,
        customPrice: c.customPrice,
        isStockDeducted: true,
      };
    });

    const updatedRooms = rooms.map((r) => {
      if (r.id === roomId) {
        return {
          ...r,
          orders: [...r.orders, ...newOrders],
        };
      }
      return r;
    });

    lastRoomLocalActionTimeRef.current = Date.now();
    lastLocalActionTimeRef.current = Date.now();
    roomsRef.current = updatedRooms;
    setRooms(updatedRooms);
    saveStoredRooms(updatedRooms);
    await triggerGasSync('saveRooms', { rooms: updatedRooms, products: updatedProducts });
    showToast(`ໂອນ ${cart.length} ລາຍການ ເຂົ້າ ${targetRoom.name} ແລະ ຫັກສະຕັອກສຳເລັດແລ້ວ!`);
  };

  // Checkout KTV Room
  const handleCheckoutRoom = async (
    room: Room,
    roomCharge: number,
    durationMinutes: number,
    startStr?: string,
    endStr?: string,
    timeRangeStr?: string
  ) => {
    // If room is marked as already paid, room fee is 0 ₭ (calculate only time)!
    const effectiveRoomCharge = room.isPaid ? 0 : roomCharge;
    const itemsTotal = room.orders.reduce((sum, o) => sum + o.price * o.quantity, 0);
    const subtotal = effectiveRoomCharge + itemsTotal;
    const dateNow = new Date();
    const dateStr = dateNow.toISOString().slice(0, 10).replace(/-/g, '');
    const billNumber = `689-${dateStr}-${(bills.length + 1).toString().padStart(3, '0')}`;

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
          ? `${formattedStart} - ${formattedEnd} (${Math.floor(durationMinutes / 60)} ຊມ ${durationMinutes % 60} ນາທີ - ຕາມເວລາຈິງ${room.isPaid ? ' - ຈ່າຍແລ້ວ' : ''})`
          : `${formattedStart} ຫາ ${formattedEnd} (ກຳນົດ: ${formattedStart} ຫາ ${formattedTarget || formattedEnd}${room.isPaid ? ' - ຈ່າຍແລ້ວ' : ''})`
        : undefined);

    const newBill: BillRecord = {
      id: 'bill-' + Date.now(),
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
      durationMinutes,
      pricingType: room.pricingType,
      roomCharge: effectiveRoomCharge,
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

    // Deduct stock for any room orders not yet deducted (Multi-unit aware: single bottle vs pack x24)
    const undeductedOrders = (room.orders || []).filter((o: any) => !o.isStockDeducted && o.product?.category !== 'service');
    let latestProducts = products;
    if (undeductedOrders.length > 0) {
      latestProducts = deductProductsStock(
        undeductedOrders.map((o) => ({
          productId: o.product.id,
          quantity: o.quantity,
          multiplier: o.multiplier || (o.selectedUnitType === 'pack' ? (o.product.packMultiplier || 24) : 1),
          selectedUnitType: o.selectedUnitType,
        }))
      );
    }

    // Reset room status to available - CLEAR EVERYTHING COMPLETELY (hours: 0, orders: [], session dates cleared)
    const updatedRooms = rooms.map((r) => {
      if (r.id === room.id || (room.name && r.name === room.name)) {
        return {
          ...r,
          status: 'available' as const,
          pricingType: 'fixed_hourly' as const,
          openedAt: undefined,
          targetEndTime: undefined,
          bookedHours: 0,
          openedByStaffId: undefined,
          openedByStaffName: undefined,
          packageId: undefined,
          packageName: undefined,
          isPaid: undefined,
          orders: [],
          updatedAt: new Date().toISOString(),
        };
      }
      return r;
    });

    lastRoomLocalActionTimeRef.current = Date.now();
    lastLocalActionTimeRef.current = Date.now();
    roomsRef.current = updatedRooms;
    setRooms(updatedRooms);
    saveStoredRooms(updatedRooms);

    // Immediately save bill to Sales Summary (bills storage & state & real-time sync)
    saveStoredBill(newBill);
    const updatedBills = getStoredBills();
    billsRef.current = updatedBills;
    setBills(updatedBills);

    await triggerGasSync('saveBill', { bill: newBill, bills: updatedBills, products: latestProducts, rooms: updatedRooms });

    setActiveBillingRecord(newBill);
  };

  // Finalize payment from billing modal
  const handleConfirmBillingPayment = async (completedBill: BillRecord) => {
    saveStoredBill(completedBill);
    const updatedBills = getStoredBills();
    billsRef.current = updatedBills;
    setBills(updatedBills);
    lastLocalActionTimeRef.current = Date.now();

    // CRITICAL: Guarantee room is completely cleared back to available when billing is confirmed!
    let updatedRoomsToSync = roomsRef.current;
    if (completedBill.roomName || completedBill.roomId) {
      updatedRoomsToSync = roomsRef.current.map((r) => {
        if (
          (completedBill.roomId && r.id === completedBill.roomId) ||
          (completedBill.roomName && r.name === completedBill.roomName)
        ) {
          return {
            ...r,
            status: 'available' as const,
            pricingType: 'fixed_hourly' as const,
            openedAt: undefined,
            targetEndTime: undefined,
            bookedHours: 0,
            openedByStaffId: undefined,
            openedByStaffName: undefined,
            packageId: undefined,
            packageName: undefined,
            isPaid: undefined,
            orders: [],
            updatedAt: new Date().toISOString(),
          };
        }
        return r;
      });
      lastRoomLocalActionTimeRef.current = Date.now();
      roomsRef.current = updatedRoomsToSync;
      setRooms(updatedRoomsToSync);
      saveStoredRooms(updatedRoomsToSync);
    }

    await triggerGasSync('saveBill', { bill: completedBill, bills: updatedBills, rooms: updatedRoomsToSync });

    // If checked out as debt, auto-create Debt Record
    if (completedBill.payment?.method === 'debt') {
      const debtInfo = completedBill.payment.debtInfo;
      const newDebt: DebtRecord = {
        id: 'debt-' + Date.now(),
        customerName: debtInfo?.customerName || 'ລູກຄ້າຕິດໜີ້',
        customerPhone: debtInfo?.customerPhone,
        billId: completedBill.id,
        billNumber: completedBill.billNumber,
        roomName: completedBill.roomName,
        totalAmount: completedBill.total,
        paidAmount: 0,
        remainingAmount: completedBill.total,
        status: 'unpaid',
        createdAt: completedBill.endTime,
        dueDate: debtInfo?.dueDate,
        photoUrl: debtInfo?.photoUrl,
        note: debtInfo?.note || 'ຕິດໜີ້ຈາກໃບບິນ ' + completedBill.billNumber,
        staffName: completedBill.staffName,
        payments: [],
      };
      const updatedDebts = [newDebt, ...debtsRef.current];
      setDebts(updatedDebts);
      saveStoredDebts(updatedDebts);
      triggerGasSync('saveDebts', { debts: updatedDebts });
    }

    setActiveBillingRecord(null);
    showToast(`ເຊັກບິນ ${completedBill.billNumber} ສຳເລັດແລ້ວ!`);
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

      {/* Real-time Multi-Device Sync Status Bar (iOS, Android, Windows PC) */}
      <div className="bg-slate-900/95 border-b border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-2">
          {syncStatus === 'loading' || syncStatus === 'syncing' ? (
            <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
          ) : syncStatus === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400" />
          ) : (
            <Zap className="w-4 h-4 text-emerald-400" />
          )}
          <span
            className={
              syncStatus === 'error'
                ? 'text-rose-300 font-semibold'
                : syncStatus === 'loading' || syncStatus === 'syncing'
                ? 'text-amber-300 font-semibold'
                : 'text-slate-300'
            }
          >
            {syncMessage || 'Real-time: ພ້ອມຊິ້ງຫຼາຍເຄື່ອງທັນທີ (iOS, Android, Windows)'}
          </span>
          <div className="hidden sm:flex items-center gap-1.5 ml-2 pl-2 border-l border-slate-700/60 text-[10px] text-slate-400">
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold border border-slate-700">
              <Smartphone className="w-3 h-3 text-rose-400" />
              <span>iOS / Android</span>
            </span>
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold border border-slate-700">
              <Monitor className="w-3 h-3 text-blue-400" />
              <span>Windows PC</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {settings.gasWebAppUrl && (
            <button
              onClick={() => fetchFromGas(true)}
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
              lastRoomLocalActionTimeRef.current = Date.now();
              roomsRef.current = updated;
              setRooms(updated);
              saveStoredRooms(updated);
              await triggerGasSync('saveRooms', { rooms: updated });
            }}
            onCheckoutRoom={handleCheckoutRoom}
          />
        )}

        {activeTab === 'stock' && (
          <InventoryManagement
            products={products}
            currentRole={currentRole}
            settings={settings}
            onSaveProducts={async (updated) => {
              setProducts(updated);
              productsRef.current = updated;
              saveStoredProducts(updated);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('saveProducts', { products: updated });
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
              setDebts(updated);
              debtsRef.current = updated;
              saveStoredDebts(updated);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('saveDebts', { debts: updated });
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
              const updated = billsRef.current.filter((b) => b.id !== billId);
              setBills(updated);
              billsRef.current = updated;
              updateStoredBills(updated);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('saveBills', { bills: updated });
              showToast('ລຶບໃບບິນສຳເລັດແລ້ວ!');
            }}
            onDeleteBills={async (billIds) => {
              if (currentRole !== 'admin') {
                showToast('⚠️ ພະນັກງານບໍ່ມີສິດລຶບຂໍ້ມູນ! ສະເພາະ Admin ເທົ່ານັ້ນ');
                return;
              }
              const idSet = new Set(billIds);
              const updated = billsRef.current.filter((b) => !idSet.has(b.id));
              setBills(updated);
              billsRef.current = updated;
              updateStoredBills(updated);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('saveBills', { bills: updated });
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
              await triggerGasSync('saveBills', { bills: [] });
              showToast('ລ້າງປະຫວັດບິນທັງໝົດສຳເລັດແລ້ວ!');
            }}
            onReprintBill={(bill) => setActiveBillingRecord(bill)}
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
              setStaffList(newStaff);
              staffRef.current = newStaff;
              saveStoredStaff(newStaff);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('saveStaff', { staff: newStaff });
            }}
            onSavePackages={async (newPkgs) => {
              setPackages(newPkgs);
              packagesRef.current = newPkgs;
              saveStoredPackages(newPkgs);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('savePackages', { packages: newPkgs });
            }}
            onSaveRooms={async (newRooms) => {
              lastRoomLocalActionTimeRef.current = Date.now();
              lastLocalActionTimeRef.current = Date.now();
              setRooms(newRooms);
              roomsRef.current = newRooms;
              saveStoredRooms(newRooms);
              await triggerGasSync('saveRooms', { rooms: newRooms });
              showToast('ບັນທຶກຂໍ້ມູນຫ້ອງ KTV ສຳເລັດແລ້ວ!');
            }}
            onSaveProducts={async (newProducts) => {
              setProducts(newProducts);
              productsRef.current = newProducts;
              saveStoredProducts(newProducts);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('saveProducts', { products: newProducts });
            }}
            onSaveBills={async (newBills) => {
              setBills(newBills);
              billsRef.current = newBills;
              updateStoredBills(newBills);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('saveBills', { bills: newBills });
            }}
            onSaveDebts={async (newDebts) => {
              setDebts(newDebts);
              debtsRef.current = newDebts;
              saveStoredDebts(newDebts);
              lastLocalActionTimeRef.current = Date.now();
              await triggerGasSync('saveDebts', { debts: newDebts });
            }}
            onMasterReset={() => {
              setProducts(INITIAL_PRODUCTS);
              saveStoredProducts(INITIAL_PRODUCTS);
              setRooms(INITIAL_ROOMS);
              saveStoredRooms(INITIAL_ROOMS);
              setPackages(INITIAL_PACKAGES);
              saveStoredPackages(INITIAL_PACKAGES);
              setStaffList(INITIAL_STAFF);
              saveStoredStaff(INITIAL_STAFF);
              setBills([]);
              updateStoredBills([]);
              setDebts([]);
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
          onClose={() => setActiveBillingRecord(null)}
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
