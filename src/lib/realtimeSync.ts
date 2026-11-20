/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 689 KTV - Real-Time Multi-Device Sync Engine (Neon Postgres + Vercel Serverless)
 * Implements:
 * 1. Device Identity & Last Updated Timestamp (Mobile / Tablet / PC) on every write
 * 2. Cloud File Update Confirmation (Microsoft / WPS Style): prompts user before overwriting active screen when another device updates Cloud
 * 3. Preview Safety: When DATABASE_URL is absent (mode === 'local_preview'), stays strictly in localStorage
 * 4. Strict Zero-Overwrite Guard: Never pushes empty payloads or auto-pushes localStorage on load
 * 5. Smart 3.5s Version Polling (GET /api/sync/version) + Tab Focus / Visibility / Online Wakeup
 */

import { Product, Room, RoomPackage, StaffMember, AppSettings, DebtRecord, BillRecord, StockRestockRecord } from '../types';
import { getLastSyncedMeta, saveLastSyncedMeta, hasAnyLocalStoredData } from './storage';

export type DeviceType = 'Mobile' | 'Tablet' | 'PC';

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
  stockHistory?: StockRestockRecord[];
  changedStockHistory?: StockRestockRecord[];
  deletedStockHistoryIds?: string[];
  lastUpdated?: string;
  lastSenderId?: string;
  lastUpdatedByDevice?: string;
  lastUpdatedDeviceType?: DeviceType;
  lastAction?: string;
}

export type SyncAction =
  | 'saveRooms'
  | 'saveProducts'
  | 'saveStockHistory'
  | 'savePackages'
  | 'saveStaff'
  | 'saveDebts'
  | 'saveSettings'
  | 'saveBill'
  | 'saveBills'
  | 'deleteBill'
  | 'deleteBills'
  | 'clearAllBills'
  | 'uploadLocalToCloud'
  | 'syncAll';

export interface CloudUpdateNotice {
  version: number;
  lastUpdated: string;
  lastUpdatedByDevice: string;
  lastUpdatedDeviceType: DeviceType;
  lastSenderId?: string;
  lastAction?: string;
  data: SyncPayload;
}

export interface SyncReceiveMeta {
  isInitialSync?: boolean;
  isFullSnapshot?: boolean;
  version?: number;
  lastUpdated?: string;
  lastUpdatedByDevice?: string;
  lastUpdatedDeviceType?: DeviceType;
  lastAction?: string;
  mode?: 'neon_postgres' | 'local_preview';
  hasDatabase?: boolean;
}

export interface SyncPushResult {
  success: boolean;
  mode?: 'neon_postgres' | 'local_preview';
  hasDatabase?: boolean;
  skippedRemoteWrite?: boolean;
  version?: number;
  lastUpdated?: string;
  lastUpdatedByDevice?: string;
  lastUpdatedDeviceType?: DeviceType;
  rejectedStale?: boolean;
  data?: SyncPayload;
}

export interface SyncCallbacks {
  onDataReceived: (payload: SyncPayload, action?: SyncAction, meta?: SyncReceiveMeta) => void;
  onCloudUpdateAvailable?: (notice: CloudUpdateNotice) => void;
  hasLocalData?: () => boolean;
  onLocalPreviewDetected?: () => void;
  onStatusChange?: (status: 'connected' | 'syncing' | 'offline' | 'error' | 'preview', message?: string) => void;
}

export function getDeviceType(): DeviceType {
  try {
    const ua = navigator.userAgent || '';
    const isIpad =
      /iPad/i.test(ua) ||
      (/Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
    if (isIpad || /Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
      return 'Tablet';
    }
    if (/iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|Mobile/i.test(ua)) {
      return 'Mobile';
    }
    return 'PC';
  } catch {
    return 'PC';
  }
}

export function getDeviceLabel(): string {
  try {
    const ua = navigator.userAgent || '';
    const type = getDeviceType();
    const os = /iPhone|iPod/i.test(ua)
      ? 'iPhone'
      : /iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
      ? 'iPad'
      : /Android/i.test(ua)
      ? 'Android'
      : /Windows/i.test(ua)
      ? 'Windows'
      : /Macintosh/i.test(ua)
      ? 'Mac'
      : /Linux/i.test(ua)
      ? 'Linux'
      : 'Browser';
    return `${type} (${os})`;
  } catch {
    return 'PC';
  }
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

function isCloudPayloadNonEmpty(data: SyncPayload | null | undefined): boolean {
  if (!data || typeof data !== 'object') return false;
  return Boolean(
    (Array.isArray(data.products) && data.products.length > 0) ||
      (Array.isArray(data.rooms) && data.rooms.length > 0) ||
      (Array.isArray(data.packages) && data.packages.length > 0) ||
      (Array.isArray(data.staff) && data.staff.length > 0) ||
      (Array.isArray(data.bills) && data.bills.length > 0) ||
      (Array.isArray(data.debts) && data.debts.length > 0)
  );
}

let broadcastChannel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    broadcastChannel = new BroadcastChannel('689ktv_realtime_channel');
  }
} catch (e) {
  console.warn('BroadcastChannel not supported', e);
}

const initialLocalMeta = getLastSyncedMeta();
let currentServerVersion = initialLocalMeta?.version || 0;
let currentServerLastUpdated = initialLocalMeta?.lastUpdated || '';
let lastNotifiedVersion = currentServerVersion;
let lastNotifiedLastUpdated = currentServerLastUpdated;
let isLocalPreviewMode = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let isBroadcasting = false;
let isFetchingState = false;
let activeCallbacks: SyncCallbacks | null = null;

export function getCurrentServerVersion(): number {
  return currentServerVersion;
}

export function getIsLocalPreviewMode(): boolean {
  return isLocalPreviewMode;
}

export function markCloudSnapshotApplied(meta: {
  version?: number;
  lastUpdated?: string;
  lastUpdatedByDevice?: string;
  lastUpdatedDeviceType?: DeviceType;
  lastAction?: string;
}) {
  if (typeof meta.version === 'number' && meta.version >= 0) {
    currentServerVersion = meta.version;
    lastNotifiedVersion = Math.max(lastNotifiedVersion, meta.version);
  }
  if (typeof meta.lastUpdated === 'string' && meta.lastUpdated) {
    currentServerLastUpdated = meta.lastUpdated;
    lastNotifiedLastUpdated = meta.lastUpdated;
  }
  saveLastSyncedMeta({
    version: currentServerVersion,
    lastUpdated: currentServerLastUpdated,
    lastUpdatedByDevice: meta.lastUpdatedByDevice,
    lastUpdatedDeviceType: meta.lastUpdatedDeviceType,
    lastAction: meta.lastAction,
  });
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Push a granular delta update to Neon Postgres (/api/sync).
 * Never called automatically on page load — only on explicit user actions.
 */
export async function pushMultiDeviceUpdate(
  action: SyncAction,
  data: SyncPayload
): Promise<SyncPushResult> {
  // Zero-Overwrite Guard: Reject completely empty payload objects
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    return { success: false, skippedRemoteWrite: true };
  }

  isBroadcasting = true;
  const deviceId = getDeviceId();
  const deviceType = getDeviceType();
  const deviceLabel = getDeviceLabel();

  // 1. Local BroadcastChannel for instant same-browser multi-tab sync
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({
        action,
        data,
        senderDeviceId: deviceId,
        deviceType,
        deviceLabel,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.warn('BroadcastChannel error', e);
    }
  }

  // Preview Mode Guard: Never attempt remote writes when DATABASE_URL is absent
  if (isLocalPreviewMode) {
    setTimeout(() => {
      isBroadcasting = false;
    }, 300);
    return {
      success: true,
      mode: 'local_preview',
      hasDatabase: false,
      skippedRemoteWrite: true,
      version: 0,
      lastUpdated: new Date().toISOString(),
      lastUpdatedByDevice: deviceLabel,
      lastUpdatedDeviceType: deviceType,
    };
  }

  // 2. Push to Vercel Serverless /api/sync (Neon Postgres)
  try {
    const res = await fetchWithTimeout(
      '/api/sync',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          data,
          senderDeviceId: deviceId,
          deviceType,
          deviceLabel,
          baseVersion: currentServerVersion,
        }),
      },
      15000
    );

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (json?.mode === 'local_preview' || json?.hasDatabase === false) {
          isLocalPreviewMode = true;
          return {
            success: true,
            mode: 'local_preview',
            hasDatabase: false,
            skippedRemoteWrite: true,
            version: 0,
            lastUpdated: json?.lastUpdated,
            lastUpdatedByDevice: deviceLabel,
            lastUpdatedDeviceType: deviceType,
          };
        }

        isLocalPreviewMode = false;
        if (json?.success) {
          markCloudSnapshotApplied({
            version: typeof json.version === 'number' ? json.version : currentServerVersion,
            lastUpdated: typeof json.lastUpdated === 'string' ? json.lastUpdated : new Date().toISOString(),
            lastUpdatedByDevice: json.lastUpdatedByDevice || deviceLabel,
            lastUpdatedDeviceType: json.lastUpdatedDeviceType || deviceType,
            lastAction: action,
          });
        }
        return {
          success: !!json?.success,
          mode: 'neon_postgres',
          hasDatabase: true,
          version: json?.version,
          lastUpdated: json?.lastUpdated,
          lastUpdatedByDevice: json?.lastUpdatedByDevice || deviceLabel,
          lastUpdatedDeviceType: json?.lastUpdatedDeviceType || deviceType,
          rejectedStale: !!json?.rejectedStale,
          data: json?.data || undefined,
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
 * Fetch latest authoritative snapshot from Neon Postgres (Read-Only GET /api/sync)
 * Called explicitly when the user clicks "ดึงข้อมูลล่าสุดจาก Cloud".
 */
export async function fetchLatestServerSnapshot(isManual = false): Promise<{
  ok: boolean;
  mode: 'neon_postgres' | 'local_preview' | 'offline';
  version?: number;
  lastUpdated?: string;
  lastUpdatedByDevice?: string;
  lastUpdatedDeviceType?: DeviceType;
}> {
  if (!activeCallbacks) return { ok: false, mode: 'offline' };
  if (isFetchingState) return { ok: false, mode: isLocalPreviewMode ? 'local_preview' : 'neon_postgres' };
  isFetchingState = true;

  try {
    if (isManual) {
      activeCallbacks.onStatusChange?.('syncing', 'ກຳລັງດຶງຂໍ້ມູນລ່າສຸດຈາກ Neon Postgres...');
    }
    const res = await fetchWithTimeout(`/api/sync?_t=${Date.now()}`, { cache: 'no-store' }, 12000);
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (json?.mode === 'local_preview' || json?.hasDatabase === false) {
          isLocalPreviewMode = true;
          activeCallbacks.onLocalPreviewDetected?.();
          activeCallbacks.onStatusChange?.(
            'preview',
            'ໂໝດ Preview (LocalStorage ເທົ່ານັ້ນ • ບໍ່ແຕະຖານຂໍ້ມູນຈິງ)'
          );
          return { ok: true, mode: 'local_preview' };
        }

        if (json?.data) {
          isLocalPreviewMode = false;
          markCloudSnapshotApplied({
            version: typeof json.version === 'number' ? json.version : 0,
            lastUpdated: typeof json.lastUpdated === 'string' ? json.lastUpdated : '',
            lastUpdatedByDevice: json.lastUpdatedByDevice,
            lastUpdatedDeviceType: json.lastUpdatedDeviceType,
            lastAction: json.lastAction,
          });
          activeCallbacks.onDataReceived(json.data, 'syncAll', {
            isInitialSync: isManual,
            isFullSnapshot: true,
            version: json.version,
            lastUpdated: json.lastUpdated,
            lastUpdatedByDevice: json.lastUpdatedByDevice,
            lastUpdatedDeviceType: json.lastUpdatedDeviceType,
            lastAction: json.lastAction,
            mode: 'neon_postgres',
            hasDatabase: true,
          });
          activeCallbacks.onStatusChange?.(
            'connected',
            'ເຊື່ອມຕໍ່ Neon Postgres Cloud ແລ້ວ (ແຈ້ງເຕືອນອັດເດດອັດຕະໂນມັດ)'
          );
          return {
            ok: true,
            mode: 'neon_postgres',
            version: json.version,
            lastUpdated: json.lastUpdated,
            lastUpdatedByDevice: json.lastUpdatedByDevice,
            lastUpdatedDeviceType: json.lastUpdatedDeviceType,
          };
        }
      }
    }
    return { ok: false, mode: 'offline' };
  } catch (err) {
    console.warn('Manual /api/sync fetch note:', err);
    activeCallbacks.onStatusChange?.('offline', 'ໂໝດອອບລາຍ (ບໍ່ສາມາດເຊື່ອມຕໍ່ Server ຊົ່ວຄາວ)');
    return { ok: false, mode: 'offline' };
  } finally {
    isFetchingState = false;
  }
}

/**
 * Initialize Multi-Device Real-Time Listener:
 * - Read-First GET /api/sync on load
 * - Microsoft/WPS Cloud Update Confirmation whenever another device saved newer data while this device has existing data
 * - 3.5s Version Polling (GET /api/sync/version) + Focus/Visibility/Online Wakeup
 */
export function initMultiDeviceSync(callbacks: SyncCallbacks): () => void {
  const deviceId = getDeviceId();
  activeCallbacks = callbacks;

  const checkHasLocalData = (): boolean => {
    try {
      if (callbacks.hasLocalData) return callbacks.hasLocalData();
      return hasAnyLocalStoredData();
    } catch {
      return hasAnyLocalStoredData();
    }
  };

  const fetchFullState = async (isInitialSync: boolean, retryAttempt = 0): Promise<void> => {
    if (isFetchingState && retryAttempt === 0) return;
    isFetchingState = true;
    try {
      if (isInitialSync && retryAttempt === 0) {
        callbacks.onStatusChange?.('syncing', 'ກຳລັງກວດສອບຂໍ້ມູນລ່າສຸດຈາກ Neon Postgres...');
      }
      const res = await fetchWithTimeout(`/api/sync?_t=${Date.now()}`, { cache: 'no-store' }, 12000);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          if (json?.mode === 'local_preview' || json?.hasDatabase === false) {
            isLocalPreviewMode = true;
            callbacks.onLocalPreviewDetected?.();
            callbacks.onStatusChange?.(
              'preview',
              'ໂໝດ Preview (LocalStorage ເທົ່ານັ້ນ • ບໍ່ແຕະຖານຂໍ້ມູນຈິງ)'
            );
            return;
          }

          if (json?.data) {
            isLocalPreviewMode = false;
            const cloudVersion = typeof json.version === 'number' ? json.version : 0;
            const cloudLastUpdated = typeof json.lastUpdated === 'string' ? json.lastUpdated : '';
            const cloudSenderId = typeof json.lastSenderId === 'string' ? json.lastSenderId : '';
            const cloudDeviceLabel =
              typeof json.lastUpdatedByDevice === 'string' && json.lastUpdatedByDevice
                ? json.lastUpdatedByDevice
                : 'ອີກເຄື່ອງໜຶ່ງ (Another Device)';
            const cloudDeviceType: DeviceType =
              json.lastUpdatedDeviceType === 'Mobile' ||
              json.lastUpdatedDeviceType === 'Tablet' ||
              json.lastUpdatedDeviceType === 'PC'
                ? json.lastUpdatedDeviceType
                : 'PC';
            const cloudAction = typeof json.lastAction === 'string' ? json.lastAction : undefined;

            const localMeta = getLastSyncedMeta();
            const localVersion = Math.max(currentServerVersion, localMeta?.version || 0);
            const localLastUpdated = currentServerLastUpdated || localMeta?.lastUpdated || '';
            const cloudTs = cloudLastUpdated ? new Date(cloudLastUpdated).getTime() : 0;
            const localTs = localLastUpdated ? new Date(localLastUpdated).getTime() : 0;

            const isCloudNewer =
              cloudVersion > localVersion || (cloudTs > 0 && (localTs === 0 || cloudTs > localTs));
            const isFromAnotherDevice = !cloudSenderId || cloudSenderId !== deviceId;
            const deviceHasLocalData = checkHasLocalData();
            const cloudHasData = isCloudPayloadNonEmpty(json.data);

            // Cloud File Confirmation Mode (Microsoft / WPS style):
            // If this device ALREADY has local data AND Cloud has newer data from another device,
            // do NOT silently overwrite the screen — prompt the user to confirm updating!
            if (
              deviceHasLocalData &&
              cloudHasData &&
              isCloudNewer &&
              isFromAnotherDevice &&
              callbacks.onCloudUpdateAvailable
            ) {
              lastNotifiedVersion = Math.max(lastNotifiedVersion, cloudVersion);
              if (cloudLastUpdated) lastNotifiedLastUpdated = cloudLastUpdated;
              callbacks.onCloudUpdateAvailable({
                version: cloudVersion,
                lastUpdated: cloudLastUpdated,
                lastUpdatedByDevice: cloudDeviceLabel,
                lastUpdatedDeviceType: cloudDeviceType,
                lastSenderId: cloudSenderId,
                lastAction: cloudAction,
                data: json.data,
              });
              callbacks.onStatusChange?.(
                'connected',
                'ພົບຂໍ້ມູນອັບເດດລ່າສຸດຈາກອີກເຄື່ອງ • ລໍຖ້າຢືນຢັນ'
              );
              return;
            }

            // Otherwise (empty device on first open, or same device, or same version): apply safely
            markCloudSnapshotApplied({
              version: cloudVersion,
              lastUpdated: cloudLastUpdated,
              lastUpdatedByDevice: cloudDeviceLabel,
              lastUpdatedDeviceType: cloudDeviceType,
              lastAction: cloudAction,
            });
            callbacks.onDataReceived(json.data, 'syncAll', {
              isInitialSync,
              isFullSnapshot: true,
              version: cloudVersion,
              lastUpdated: cloudLastUpdated,
              lastUpdatedByDevice: cloudDeviceLabel,
              lastUpdatedDeviceType: cloudDeviceType,
              lastAction: cloudAction,
              mode: 'neon_postgres',
              hasDatabase: true,
            });
            callbacks.onStatusChange?.(
              'connected',
              'ເຊື່ອມຕໍ່ Neon Postgres Cloud ແລ້ວ (ແຈ້ງເຕືອນອັດເດດອັດຕະໂນມັດ)'
            );
            return;
          }
        }
      }
      // Retry once on initial Neon serverless cold-start 5xx before reporting offline
      if (isInitialSync && retryAttempt < 1) {
        await new Promise((r) => setTimeout(r, 1200));
        return await fetchFullState(true, retryAttempt + 1);
      }
      callbacks.onStatusChange?.('offline', 'ບໍ່ສາມາດດຶງ /api/sync ໄດ້ຊົ່ວຄາວ');
    } catch (err) {
      if (isInitialSync && retryAttempt < 1) {
        await new Promise((r) => setTimeout(r, 1200));
        return await fetchFullState(true, retryAttempt + 1);
      }
      console.warn('Initial /api/sync note:', err);
      callbacks.onStatusChange?.('offline', 'ໂໝດອອບລາຍ (ກຳລັງໃຊ້ຂໍ້ມູນໃນເຄື່ອງຊົ່ວຄາວ)');
    } finally {
      if (retryAttempt === 0) {
        isFetchingState = false;
      }
    }
  };

  fetchFullState(true);

  // Listen on local BroadcastChannel (Same-browser multi-tab instant updates)
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

  // Smart Version Polling every 3.5s via /api/sync/version
  const checkVersion = async () => {
    if (isBroadcasting || isFetchingState || isLocalPreviewMode) return;
    try {
      const res = await fetchWithTimeout(`/api/sync/version?_t=${Date.now()}`, { cache: 'no-store' }, 8000);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          if (json?.mode === 'local_preview' || json?.hasDatabase === false) {
            isLocalPreviewMode = true;
            return;
          }

          const remoteVersion = typeof json?.version === 'number' ? json.version : 0;
          const remoteTs = typeof json?.lastUpdated === 'string' ? json.lastUpdated : '';
          const remoteSenderId = typeof json?.lastSenderId === 'string' ? json.lastSenderId : '';

          const knownVersion = Math.max(currentServerVersion, lastNotifiedVersion);
          const knownTs = lastNotifiedLastUpdated || currentServerLastUpdated;

          const versionNewer = remoteVersion > knownVersion;
          const tsNewer =
            !!remoteTs &&
            remoteTs !== knownTs &&
            (!knownTs || new Date(remoteTs).getTime() > new Date(knownTs).getTime());

          if (versionNewer || tsNewer) {
            // If this very device was the last sender, sync metadata quietly
            if (remoteSenderId && remoteSenderId === deviceId) {
              markCloudSnapshotApplied({
                version: remoteVersion,
                lastUpdated: remoteTs,
                lastUpdatedByDevice: json.lastUpdatedByDevice,
                lastUpdatedDeviceType: json.lastUpdatedDeviceType,
                lastAction: json.lastAction,
              });
              return;
            }
            await fetchFullState(false);
          }
        }
      }
    } catch {
      // Ignore transient network errors during background poll
    }
  };

  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) {
      checkVersion();
    }
  }, 3500);

  const handleWakeUp = () => {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) {
      checkVersion();
    }
  };

  window.addEventListener('focus', handleWakeUp);
  document.addEventListener('visibilitychange', handleWakeUp);
  window.addEventListener('online', handleWakeUp);

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
