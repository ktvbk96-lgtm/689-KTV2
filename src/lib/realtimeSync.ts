/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 689 KTV - Real-Time Multi-Device Sync Engine
 * Supports seamless, instant synchronization across iOS, Android, and Windows PC.
 * Implements:
 * 1. Fetch First on Load (Server is Single Source of Truth)
 * 2. Granular Delta + Timestamp-Guarded Updates (No full state overwrite)
 * 3. Server-Sent Events (SSE) + 3.5s Version Polling + Tab Focus/Wakeup + Local BroadcastChannel
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
let eventSource: EventSource | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let isBroadcasting = false;
let isFetchingState = false;
let activeCallbacks: SyncCallbacks | null = null;

export function getCurrentServerVersion(): number {
  return currentServerVersion;
}

/**
 * Push a granular delta update to the Server and notify all other devices (iOS, Android, Windows)
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

  // 2. Send granular delta + baseVersion to Backend Server (/api/sync)
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
 * Fetch latest authoritative snapshot from Server (never pushes local data to server)
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
          activeCallbacks.onDataReceived(json.data, 'syncAll', {
            isInitialSync: isManual,
            isFullSnapshot: true,
            version: json.version,
          });
          activeCallbacks.onStatusChange?.(
            'connected',
            'ຊິ້ງຫຼາຍເຄື່ອງ Real-time (SSE + 3.5s) ເຊື່ອມຕໍ່ແລ້ວ'
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
 * Initialize Multi-Device Real-Time Listener (Fetch-First + SSE + 3.5s Polling + Tab Wakeup)
 */
export function initMultiDeviceSync(callbacks: SyncCallbacks): () => void {
  const deviceId = getDeviceId();
  activeCallbacks = callbacks;

  // 1. Fetch First on Load (Server is the Single Source of Truth)
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
            callbacks.onDataReceived(json.data, 'syncAll', {
              isInitialSync,
              isFullSnapshot: true,
              version: json.version,
            });
            callbacks.onStatusChange?.(
              'connected',
              'ຊິ້ງຫຼາຍເຄື່ອງ Real-time (SSE + 3.5s) ເຊື່ອມຕໍ່ແລ້ວ'
            );
            return;
          }
        }
      }
      callbacks.onStatusChange?.('connected', 'Real-time: ພ້ອມຊິ້ງຫຼາຍເຄື່ອງ (PC & ມືຖື)');
    } catch (err) {
      console.warn('Initial /api/sync note:', err);
      callbacks.onStatusChange?.('offline', 'ໂໝດອອບລາຍ (ກຳລັງໃຊ້ຂໍ້ມູນໃນເຄື່ອງຊົ່ວຄາວ)');
    } finally {
      isFetchingState = false;
    }
  };

  fetchFullState(true);

  // 2. Setup Server-Sent Events (SSE) for Real-Time Instant Push
  let consecutiveSseErrors = 0;
  const setupSse = () => {
    if (typeof EventSource === 'undefined') return;

    try {
      if (eventSource) {
        eventSource.close();
      }

      eventSource = new EventSource('/api/sync/events');

      eventSource.onopen = () => {
        consecutiveSseErrors = 0;
        callbacks.onStatusChange?.('connected', 'ຊິ້ງຫຼາຍເຄື່ອງ Real-time (SSE + 3.5s) ອອນໄລນ໌');
      };

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'handshake') {
            if (typeof payload.version === 'number' && payload.version > currentServerVersion) {
              fetchFullState(false);
            }
            return;
          }
          if (payload.type === 'update') {
            if (typeof payload.version === 'number') {
              currentServerVersion = payload.version;
            }

            // Apply updates pushed by other devices immediately
            if (payload.senderDeviceId !== deviceId && payload.data) {
              callbacks.onDataReceived(payload.data, payload.action, {
                isInitialSync: false,
                isFullSnapshot: true,
                version: payload.version,
              });
              callbacks.onStatusChange?.('connected', '⚡ ອັບເດດຂໍ້ມູນຈາກເຄື່ອງອື່ນແລ້ວ');
            }
          }
        } catch (e) {
          console.error('Error parsing SSE event:', e);
        }
      };

      eventSource.onerror = () => {
        consecutiveSseErrors++;
        if (consecutiveSseErrors <= 2) {
          callbacks.onStatusChange?.('syncing', 'ກຳລັງເຊື່ອມຕໍ່ Real-time ໃໝ່...');
        } else {
          callbacks.onStatusChange?.('connected', 'Real-time Polling 3.5s ກຳລັງທຳງານ');
        }
      };
    } catch (err) {
      console.warn('SSE initialization note:', err);
    }
  };

  setupSse();

  // 3. Listen on local BroadcastChannel (Same-browser multi-tab instant updates)
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

  // 4. Smart Version Polling every 3.5s (Reliable cross-device fallback for Mobile/PC)
  const checkVersion = async () => {
    if (isBroadcasting || isFetchingState) return;
    try {
      const res = await fetch(`/api/sync/version?_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          if (typeof json?.version === 'number' && json.version !== currentServerVersion) {
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

  // 5. Immediate sync check when switching tabs, unlocking mobile phone, or reconnecting network
  const handleWakeUp = () => {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) {
      checkVersion();
      if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
        setupSse();
      }
    }
  };

  window.addEventListener('focus', handleWakeUp);
  document.addEventListener('visibilitychange', handleWakeUp);
  window.addEventListener('online', handleWakeUp);

  // Return cleanup function
  return () => {
    if (pollTimer) clearInterval(pollTimer);
    if (eventSource) eventSource.close();
    if (broadcastChannel) {
      broadcastChannel.removeEventListener('message', handleBroadcastMessage);
    }
    window.removeEventListener('focus', handleWakeUp);
    document.removeEventListener('visibilitychange', handleWakeUp);
    window.removeEventListener('online', handleWakeUp);
    activeCallbacks = null;
  };
}
