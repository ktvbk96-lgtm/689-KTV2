import { Product, Room, RoomPackage, StaffMember, AppSettings, BillRecord, DebtRecord } from '../types';
import { INITIAL_SETTINGS } from './initialData';
import { normalizeImageUrl } from './imageUtils';

const STORAGE_KEYS = {
  PRODUCTS: '689ktv_products',
  ROOMS: '689ktv_rooms',
  PACKAGES: '689ktv_packages',
  STAFF: '689ktv_staff',
  SETTINGS: '689ktv_settings',
  BILLS: '689ktv_bills',
  DEBTS: '689ktv_debts',
  ACTIVE_USER: '689ktv_active_user',
  LAST_SYNCED_META: '689ktv_last_synced_meta',
};

export interface LastSyncedMeta {
  version: number;
  lastUpdated: string;
  lastUpdatedByDevice?: string;
  lastUpdatedDeviceType?: 'Mobile' | 'Tablet' | 'PC';
  lastAction?: string;
}

export const getLastSyncedMeta = (): LastSyncedMeta | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LAST_SYNCED_META);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        version: Number(parsed.version) || 0,
        lastUpdated: typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : '',
        lastUpdatedByDevice:
          typeof parsed.lastUpdatedByDevice === 'string' ? parsed.lastUpdatedByDevice : undefined,
        lastUpdatedDeviceType:
          parsed.lastUpdatedDeviceType === 'Mobile' ||
          parsed.lastUpdatedDeviceType === 'Tablet' ||
          parsed.lastUpdatedDeviceType === 'PC'
            ? parsed.lastUpdatedDeviceType
            : undefined,
        lastAction: typeof parsed.lastAction === 'string' ? parsed.lastAction : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
};

export const saveLastSyncedMeta = (meta: LastSyncedMeta) => {
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_SYNCED_META, JSON.stringify(meta));
  } catch {
    // ignore storage quota errors
  }
};

export const hasAnyLocalStoredData = (): boolean => {
  try {
    const keys = [
      STORAGE_KEYS.PRODUCTS,
      STORAGE_KEYS.ROOMS,
      STORAGE_KEYS.PACKAGES,
      STORAGE_KEYS.STAFF,
      STORAGE_KEYS.BILLS,
      STORAGE_KEYS.DEBTS,
    ];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
};

const isMockBill = (b: BillRecord) =>
  !b ||
  String(b.id || '').startsWith('bill-mock-') ||
  String(b.billNumber || '').startsWith('689-MOCK-');

const isMockDebt = (d: DebtRecord) =>
  !d || String(d.id || '').startsWith('debt-sample-');

/**
 * Safe no-op: NEVER automatically clear or mutate existing browser localStorage on startup.
 * Existing localStorage data is preserved intact as an emergency local backup.
 */
export const purgeMockLocalStorage = () => {
  // Intentionally does not delete or mutate browser localStorage
};

export const getStoredProducts = (): Product[] => {
  const data = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
  if (!data) return [];
  try {
    const list: Product[] = JSON.parse(data);
    if (!Array.isArray(list)) return [];
    let updated = false;
    const enriched = list.map((item) => {
      let itemChanged = false;
      const newItem = { ...item };

      if (newItem.imageUrl) {
        const normalized = normalizeImageUrl(newItem.imageUrl);
        if (normalized !== newItem.imageUrl) {
          newItem.imageUrl = normalized;
          itemChanged = true;
        }
      }

      if (newItem.hasMultiUnit) {
        const mult = newItem.packMultiplier || 24;
        newItem.packsInStock = Math.floor((Number(newItem.stock) || 0) / mult);
        newItem.looseBottles = (Number(newItem.stock) || 0) % mult;
      }

      if (itemChanged) updated = true;
      return newItem;
    });
    if (updated) {
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(enriched));
    }
    return enriched;
  } catch {
    return [];
  }
};

export const saveStoredProducts = (products: Product[]) => {
  const synced = products.map((p) => {
    if (p.hasMultiUnit) {
      const mult = p.packMultiplier || 24;
      return {
        ...p,
        packsInStock: Math.floor((Number(p.stock) || 0) / mult),
        looseBottles: (Number(p.stock) || 0) % mult,
      };
    }
    return p;
  });
  localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(synced));
  window.dispatchEvent(new Event('689ktv_products_updated'));
};

export const getStoredRooms = (): Room[] => {
  const data = localStorage.getItem(STORAGE_KEYS.ROOMS);
  if (!data) return [];
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveStoredRooms = (rooms: Room[]) => {
  localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(rooms));
  window.dispatchEvent(new Event('689ktv_rooms_updated'));
};

export const getStoredPackages = (): RoomPackage[] => {
  const data = localStorage.getItem(STORAGE_KEYS.PACKAGES);
  if (!data) return [];
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveStoredPackages = (pkgs: RoomPackage[]) => {
  localStorage.setItem(STORAGE_KEYS.PACKAGES, JSON.stringify(pkgs));
  window.dispatchEvent(new Event('689ktv_packages_updated'));
};

export const getStoredStaff = (): StaffMember[] => {
  const data = localStorage.getItem(STORAGE_KEYS.STAFF);
  if (!data) return [];
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveStoredStaff = (staff: StaffMember[]) => {
  localStorage.setItem(STORAGE_KEYS.STAFF, JSON.stringify(staff));
  window.dispatchEvent(new Event('689ktv_staff_updated'));
};

export const getStoredSettings = (): AppSettings => {
  const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  if (!data) return INITIAL_SETTINGS;
  try {
    const parsed = JSON.parse(data);
    if (parsed.gasWebAppUrl && parsed.gasWebAppUrl.includes('AKfycbwP7K5U-POS-689KTV-WEBAPP')) {
      parsed.gasWebAppUrl = '';
    }
    if (parsed.realtimeSyncEnabled === undefined) {
      parsed.realtimeSyncEnabled = true;
    }
    if (!parsed.receiptFontSize) {
      parsed.receiptFontSize = 'large';
    }
    return { ...INITIAL_SETTINGS, ...parsed };
  } catch {
    return INITIAL_SETTINGS;
  }
};

export const saveStoredSettings = (settings: AppSettings) => {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  window.dispatchEvent(new Event('689ktv_settings_updated'));
};

export const getStoredBills = (): BillRecord[] => {
  const data = localStorage.getItem(STORAGE_KEYS.BILLS);
  if (data === null) return [];
  try {
    const parsed: BillRecord[] = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b) => !isMockBill(b));
  } catch {
    return [];
  }
};

export const saveStoredBill = (bill: BillRecord) => {
  const existing = getStoredBills();
  const billNumTrimmed = (bill.billNumber || '').trim();
  const matchIdx = existing.findIndex(
    (b) => b.id === bill.id || (billNumTrimmed && (b.billNumber || '').trim() === billNumTrimmed)
  );
  let updated: BillRecord[];
  if (matchIdx >= 0) {
    let replaced = false;
    updated = [];
    for (const b of existing) {
      const isMatch =
        b.id === bill.id || (billNumTrimmed && (b.billNumber || '').trim() === billNumTrimmed);
      if (isMatch) {
        if (!replaced) {
          updated.push(bill);
          replaced = true;
        }
      } else {
        updated.push(b);
      }
    }
  } else {
    updated = [bill, ...existing];
  }
  localStorage.setItem(STORAGE_KEYS.BILLS, JSON.stringify(updated));
  window.dispatchEvent(new Event('689ktv_bills_updated'));
};

export const updateStoredBills = (bills: BillRecord[]) => {
  const cleaned = bills.filter((b) => !isMockBill(b));
  localStorage.setItem(STORAGE_KEYS.BILLS, JSON.stringify(cleaned));
  window.dispatchEvent(new Event('689ktv_bills_updated'));
};

export const getStoredDebts = (): DebtRecord[] => {
  const data = localStorage.getItem(STORAGE_KEYS.DEBTS);
  if (!data) return [];
  try {
    const parsed: DebtRecord[] = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d) => !isMockDebt(d));
  } catch {
    return [];
  }
};

export const saveStoredDebts = (debts: DebtRecord[]) => {
  const cleaned = debts.filter((d) => !isMockDebt(d));
  localStorage.setItem(STORAGE_KEYS.DEBTS, JSON.stringify(cleaned));
  window.dispatchEvent(new Event('689ktv_debts_updated'));
};

export const saveStoredDebt = (debt: DebtRecord) => {
  const existing = getStoredDebts();
  const updated = [debt, ...existing];
  saveStoredDebts(updated);
};

export const updateStoredDebt = (updatedDebt: DebtRecord) => {
  const existing = getStoredDebts();
  const updated = existing.map((d) => (d.id === updatedDebt.id ? updatedDebt : d));
  saveStoredDebts(updated);
};

export const deleteStoredDebt = (debtId: string) => {
  const existing = getStoredDebts();
  const updated = existing.filter((d) => d.id !== debtId);
  saveStoredDebts(updated);
};

export const formatCurrency = (amount: number, symbol: string = '₭'): string => {
  return `${amount.toLocaleString('lo-LA')} ${symbol}`;
};
