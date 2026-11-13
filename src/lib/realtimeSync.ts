/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 689 KTV - Real-Time Multi-Device Sync Engine (Vercel Serverless Compatible)
 * Supports seamless synchronization across iOS, Android, and Windows PC.
 * Implements:
 * 1. Read-First / Fetch-First on Load (GET /api/sync — Server is Single Source of Truth)
 * 2. Granular Delta + Timestamp-Guarded Updates (POST /api/sync — No full state overwrite)
 * 3. Smart 3.5s Version Polling (GET /api/sync/version) + Tab Focus/Wakeup + Local BroadcastChannel
 */

import { Product, Room, RoomPackage, StaffMember, AppSettings, DebtRecord, BillRecord } from '../types';

export interface StockDeductionItem {
  productId: string;
  deductQty: number;
}

export interface SyncPayload {
  products?: Product[];
  changedProducts?: Product[];
  deletedProductIds?: string[];
  clearProducts?: boolean;
  stockDeductions?: StockDeductionItem[];
  rooms?: Room[];
  changedRooms?: Room[];
  deletedRoomIds?: string[];
  packages?: RoomPackage[];
  staff?: StaffMember[];
  settings?: Partial<AppSettings>;
  debts?: DebtRecord[];
  changedDebts?: DebtRecord[];
  deletedDebtIds?: string[];
  clearAllDebts?: boolean;
  bills?: BillRecord[];
  changedBills?: BillRecord[];
  deletedBillIds?: string[];
  clearAllBills?: boolean;
  bill?: BillRecord;
  lastUpdated?: string;
  lastSenderId?: string;
}

export type SyncAction =
  | 'saveRooms'
  | 'saveProducts'
  | 'savePackages'
  | 'saveStaff'
  | 'saveDebts'
  | 'saveSettings'
  | 'saveBill'
  | 'saveBills'
  | 'deleteBill'
  | 'deleteBills'
  | 'clearAllBills'
  | 'clearAll'
  | 'resetAll'
  | 'syncAll';

export interface SyncReceiveMeta {
  isInitialSync?: boolean;
  isFullSnapshot?: boolean;
  version?: number;
}

export interface SyncPushResult {
  success: boolean;
  version?: number;
  lastUpdated?: string;
  rejectedStale?: boolean;
  data?: SyncPayload;
}

export interface SyncCallbacks {
  onDataReceived: (payload: SyncPayload, action?: SyncAction, meta?: SyncReceiveMeta) => void;
  onStatusChange?: (status: 'connected' | 'syncing' | 'offline' | 'error', message?: string) => void;
}

// Generate or retrieve persistent Device ID
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem('689ktv_device_id');
    if (!id) {
      const userAgent = navigator.userAgent;
      const platform = /iPhone|iPad|iPod/i.test(userAgent)
        ? 'iOS'
        : /Android/i.test(userAgent)
        ? 'Android'
        : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Macintosh/i.test(userAgent)
        ? 'Mac'
        : 'Device';
      id = `${platform}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      localStorage.setItem('689ktv_device_id', id);
    }
    return id;
  } catch {
    return `device_${Date.now()}`;
  }
}

// BroadcastChannel for instant same-browser / multi-tab synchronization
let broadcastChannel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    broadcastChannel = new BroadcastChannel('689ktv_realtime_channel');
  }
} catch (e) {
  console.warn('BroadcastChannel not supported', e);
}

let currentServerVersion = 0;
let currentServerLastUpdated = '';
let pollTimer: ReturnType<typeof setInterval> | null = null;
let isBroadcasting = false;
let isFetchingState = false;
let activeCallbacks: SyncCallbacks | null = null;

export function getCurrentServerVersion(): number {
  return currentServerVersion;
}

/**
 * Push a granular delta update to the Server (/api/sync) and notify other tabs.
 * Never called automatically on page load — only on explicit user mutations.
 */
export async function pushMultiDeviceUpdate(
  action: SyncAction,
  data: SyncPayload
): Promise<SyncPushResult> {
  isBroadcasting = true;
  const deviceId = getDeviceId();

  // 1. Send via local BroadcastChannel for zero-latency multi-tab updates in same browser
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({
        action,
        data,
        senderDeviceId: deviceId,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.warn('BroadcastChannel error', e);
    }
  }

  // 2. Send granular delta + baseVersion to Vercel Serverless API (/api/sync)
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action,
        data,
        senderDeviceId: deviceId,
        baseVersion: currentServerVersion,
      }),
    });

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (typeof json?.version === 'number') {
          currentServerVersion = json.version;
        }
        if (typeof json?.lastUpdated === 'string') {
          currentServerLastUpdated = json.lastUpdated;
        }
        return {
          success: !!json?.success,
          version: json?.version,
          lastUpdated: json?.lastUpdated,
          rejectedStale: !!json?.rejectedStale,
          data: json?.data,
        };
      }
    }
    return { success: false };
  } catch (err) {
    console.warn('Backend sync note (offline or unreachable):', err);
    return { success: false };
  } finally {
    setTimeout(() => {
      isBroadcasting = false;
    }, 600);
  }
}

/**
 * Fetch latest authoritative snapshot from Server (Read-Only GET /api/sync — never overwrites server)
 */
export async function fetchLatestServerSnapshot(isManual = false): Promise<boolean> {
  if (!activeCallbacks) return false;
  if (isFetchingState) return false;
  isFetchingState = true;

  try {
    if (isManual) {
      activeCallbacks.onStatusChange?.('syncing', 'ກຳລັງດຶງຂໍ້ມູນລ່າສຸດຈາກ Server...');
    }
    const res = await fetch(`/api/sync?_t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (json?.data) {
          if (typeof json.version === 'number') {
            currentServerVersion = json.version;
          }
          if (typeof json.lastUpdated === 'string') {
            currentServerLastUpdated = json.lastUpdated;
          }
          activeCallbacks.onDataReceived(json.data, 'syncAll', {
            isInitialSync: isManual,
            isFullSnapshot: true,
            version: json.version,
          });
          activeCallbacks.onStatusChange?.(
            'connected',
            'ຊິ້ງຫຼາຍເຄື່ອງ Real-time (Polling 3.5s) ເຊື່ອມຕໍ່ແລ້ວ'
          );
          return true;
        }
      }
    }
    return false;
  } catch (err) {
    console.warn('Manual /api/sync fetch note:', err);
    activeCallbacks.onStatusChange?.('offline', 'ໂໝດອອບລາຍ (ບໍ່ສາມາດເຊື່ອມຕໍ່ Server ຊົ່ວຄາວ)');
    return false;
  } finally {
    isFetchingState = false;
  }
}

/**
 * Initialize Multi-Device Real-Time Listener (Fetch-First GET /api/sync + 3.5s Version Polling + Tab Wakeup)
 */
export function initMultiDeviceSync(callbacks: SyncCallbacks): () => void {
  const deviceId = getDeviceId();
  activeCallbacks = callbacks;

  // 1. Read-First on Load (GET /api/sync — Server is the Single Source of Truth)
  const fetchFullState = async (isInitialSync: boolean) => {
    if (isFetchingState) return;
    isFetchingState = true;
    try {
      if (isInitialSync) {
        callbacks.onStatusChange?.('syncing', 'ກຳລັງດຶງຂໍ້ມູນລ່າສຸດຈາກ Server...');
      }
      const res = await fetch(`/api/sync?_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          if (json?.data) {
            if (typeof json.version === 'number') {
              currentServerVersion = json.version;
            }
            if (typeof json.lastUpdated === 'string') {
              currentServerLastUpdated = json.lastUpdated;
            }
            callbacks.onDataReceived(json.data, 'syncAll', {
              isInitialSync,
              isFullSnapshot: true,
              version: json.version,
            });
            callbacks.onStatusChange?.(
              'connected',
              'ຊິ້ງຫຼາຍເຄື່ອງ Real-time (Polling 3.5s) ເຊື່ອມຕໍ່ແລ້ວ'
            );
            return;
          }
        }
      }
      callbacks.onStatusChange?.('offline', 'ບໍ່ສາມາດດຶງ /api/sync ໄດ້ຊົ່ວຄາວ');
    } catch (err) {
      console.warn('Initial /api/sync note:', err);
      callbacks.onStatusChange?.('offline', 'ໂໝດອອບລາຍ (ກຳລັງໃຊ້ຂໍ້ມູນສຳຮອງ)');
    } finally {
      isFetchingState = false;
    }
  };

  fetchFullState(true);

  // 2. Listen on local BroadcastChannel (Same-browser multi-tab instant updates)
  const handleBroadcastMessage = (event: MessageEvent) => {
    const { action, data, senderDeviceId } = event.data || {};
    if (senderDeviceId !== deviceId && data) {
      callbacks.onDataReceived(data, action, {
        isInitialSync: false,
        isFullSnapshot: false,
      });
    }
  };

  if (broadcastChannel) {
    broadcastChannel.addEventListener('message', handleBroadcastMessage);
  }

  // 3. Smart Version Polling every 3.5s via /api/sync/version (100% Vercel Serverless compatible)
  const checkVersion = async () => {
    if (isBroadcasting || isFetchingState) return;
    try {
      const res = await fetch(`/api/sync/version?_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          const versionChanged =
            typeof json?.version === 'number' && json.version !== currentServerVersion;
          const tsChanged =
            typeof json?.lastUpdated === 'string' &&
            json.lastUpdated !== '' &&
            json.lastUpdated !== currentServerLastUpdated;

          if (versionChanged || tsChanged) {
            await fetchFullState(false);
          }
        }
      }
    } catch {
      // Ignore transient network errors during background version poll
    }
  };

  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) {
      checkVersion();
    }
  }, 3500);

  // 4. Immediate sync check when switching tabs, unlocking mobile phone, or reconnecting network
  const handleWakeUp = () => {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) {
      checkVersion();
    }
  };

  window.addEventListener('focus', handleWakeUp);
  document.addEventListener('visibilitychange', handleWakeUp);
  window.addEventListener('online', handleWakeUp);

  // Return cleanup function
  return () => {
    if (pollTimer) clearInterval(pollTimer);
    if (broadcastChannel) {
      broadcastChannel.removeEventListener('message', handleBroadcastMessage);
    }
    window.removeEventListener('focus', handleWakeUp);
    document.removeEventListener('visibilitychange', handleWakeUp);
    window.removeEventListener('online', handleWakeUp);
    activeCallbacks = null;
  };
}
