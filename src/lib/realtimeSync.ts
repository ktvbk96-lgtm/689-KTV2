/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * 689 KTV - Real-Time Multi-Device Sync Engine
 * Supports seamless, instant synchronization across iOS, Android, and Windows PC.
 * Combines Server-Sent Events (SSE), Local BroadcastChannel, and Smart Polling Fallback.
 */

import { Product, Room, RoomPackage, StaffMember, AppSettings, DebtRecord, BillRecord } from '../types';

export interface SyncPayload {
  products?: Product[];
  rooms?: Room[];
  packages?: RoomPackage[];
  staff?: StaffMember[];
  settings?: Partial<AppSettings>;
  debts?: DebtRecord[];
  bills?: BillRecord[];
  bill?: BillRecord;
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
  | 'clearAll'
  | 'resetAll'
  | 'syncAll';

export interface SyncCallbacks {
  onDataReceived: (payload: SyncPayload, action?: SyncAction) => void;
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
let pollTimer: any = null;
let isBroadcasting = false;

/**
 * Push an update to all other devices (iOS, Android, Windows)
 */
export async function pushMultiDeviceUpdate(action: SyncAction, data: SyncPayload) {
  isBroadcasting = true;
  const deviceId = getDeviceId();

  // 1. Send via local BroadcastChannel for zero-latency multi-tab updates
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

  // 2. Send to Backend Server
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
      }),
    });

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (json?.version) {
          currentServerVersion = json.version;
        }
      }
    }
  } catch (err) {
    console.warn('Backend sync note (offline or static mode):', err);
  } finally {
    setTimeout(() => {
      isBroadcasting = false;
    }, 1000);
  }
}

/**
 * Initialize Multi-Device Real-Time Listener
 */
export function initMultiDeviceSync(callbacks: SyncCallbacks): () => void {
  const deviceId = getDeviceId();

  // 1. Initial State Fetch from Server
  const fetchFullState = async () => {
    try {
      callbacks.onStatusChange?.('syncing', 'ກຳລັງກວດສອບສະຖານະ Real-time...');
      const res = await fetch(`/api/sync?_t=${Date.now()}`);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          if (json?.data) {
            currentServerVersion = json.version || 1;
            callbacks.onDataReceived(json.data, 'syncAll');
            callbacks.onStatusChange?.('connected', 'ເຊື່ອມຕໍ່ Real-time ສຳເລັດແລ້ວ');
            return;
          }
        }
      }
      callbacks.onStatusChange?.('connected', 'Real-time: ພ້ອມຊິ້ງຫຼາຍເຄື່ອງ (iOS, Android, Windows)');
    } catch (err) {
      console.warn('Initial /api/sync note:', err);
      callbacks.onStatusChange?.('offline', 'ໂໝດອອບລາຍ (ລະບົບກຳລັງໃຊ້ຂໍ້ມູນໃນເຄື່ອງ)');
    }
  };

  fetchFullState();

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
        callbacks.onStatusChange?.('connected', 'Real-time ອອນໄລນ໌ພ້ອມໃຊ້ງານ');
      };

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'update') {
            // Update version
            if (payload.version) {
              currentServerVersion = payload.version;
            }

            // Only apply if message was NOT sent by this exact device
            if (payload.senderDeviceId !== deviceId && payload.data) {
              callbacks.onDataReceived(payload.data, payload.action);
              callbacks.onStatusChange?.('connected', 'ອັບເດດຂໍ້ມູນຈາກເຄື່ອງອື່ນແລ້ວ');
            }
          }
        } catch (e) {
          console.error('Error parsing SSE event:', e);
        }
      };

      eventSource.onerror = () => {
        consecutiveSseErrors++;
        // If SSE temporarily drops, notify gently without persistent red error
        if (consecutiveSseErrors <= 2) {
          callbacks.onStatusChange?.('syncing', 'ກຳລັງເຊື່ອມຕໍ່ Real-time ໃໝ່...');
        } else {
          callbacks.onStatusChange?.('offline', 'Real-time: ໂໝດປົກກະຕິ (Local Sync Active)');
        }
      };
    } catch (err) {
      console.warn('SSE initialization note:', err);
    }
  };

  setupSse();

  // 3. Listen on local BroadcastChannel
  const handleBroadcastMessage = (event: MessageEvent) => {
    const { action, data, senderDeviceId } = event.data || {};
    if (senderDeviceId !== deviceId && data) {
      callbacks.onDataReceived(data, action);
    }
  };

  if (broadcastChannel) {
    broadcastChannel.addEventListener('message', handleBroadcastMessage);
  }

  // 4. Lightweight Version Polling Fallback (every 2.5s)
  // Ensures mobile devices (iOS Safari & Android) update even when waking from lock screen
  const checkVersion = async () => {
    if (isBroadcasting) return;
    try {
      const res = await fetch(`/api/sync/version?_t=${Date.now()}`);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          if (json?.version && json.version > currentServerVersion) {
            await fetchFullState();
          }
        }
      }
    } catch {
      // Ignore network errors in background version check
    }
  };

  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) {
      checkVersion();
    }
  }, 2500);

  // Re-check version immediately on window focus, device unlock, or network reconnect
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
  };
}
