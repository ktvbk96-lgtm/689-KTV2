import { Product, Room, RoomPackage, StaffMember, AppSettings, BillRecord, DebtRecord } from '../types';
import {
  INITIAL_PRODUCTS,
  INITIAL_ROOMS,
  INITIAL_PACKAGES,
  INITIAL_STAFF,
  INITIAL_SETTINGS,
  INITIAL_DEBTS,
} from './initialData';

const STORAGE_KEYS = {
  PRODUCTS: '689ktv_products',
  ROOMS: '689ktv_rooms',
  PACKAGES: '689ktv_packages',
  STAFF: '689ktv_staff',
  SETTINGS: '689ktv_settings',
  BILLS: '689ktv_bills',
  DEBTS: '689ktv_debts',
  ACTIVE_USER: '689ktv_active_user',
};

export const getStoredProducts = (): Product[] => {
  const data = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
  if (!data) {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(INITIAL_PRODUCTS));
    return INITIAL_PRODUCTS;
  }
  try {
    const list: Product[] = JSON.parse(data);
    let updated = false;
    const enriched = list.map((item) => {
      if (!item.imageUrl) {
        const init = INITIAL_PRODUCTS.find((p) => p.id === item.id);
        if (init?.imageUrl) {
          updated = true;
          return { ...item, imageUrl: init.imageUrl };
        }
      }
      return item;
    });
    if (updated) {
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(enriched));
    }
    return enriched;
  } catch {
    return INITIAL_PRODUCTS;
  }
};

export const saveStoredProducts = (products: Product[]) => {
  localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
  window.dispatchEvent(new Event('689ktv_products_updated'));
};

export const getStoredRooms = (): Room[] => {
  const data = localStorage.getItem(STORAGE_KEYS.ROOMS);
  if (!data) {
    localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(INITIAL_ROOMS));
    return INITIAL_ROOMS;
  }
  try {
    return JSON.parse(data);
  } catch {
    return INITIAL_ROOMS;
  }
};

export const saveStoredRooms = (rooms: Room[]) => {
  localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(rooms));
  window.dispatchEvent(new Event('689ktv_rooms_updated'));
};

export const getStoredPackages = (): RoomPackage[] => {
  const data = localStorage.getItem(STORAGE_KEYS.PACKAGES);
  if (!data) {
    localStorage.setItem(STORAGE_KEYS.PACKAGES, JSON.stringify(INITIAL_PACKAGES));
    return INITIAL_PACKAGES;
  }
  try {
    return JSON.parse(data);
  } catch {
    return INITIAL_PACKAGES;
  }
};

export const saveStoredPackages = (pkgs: RoomPackage[]) => {
  localStorage.setItem(STORAGE_KEYS.PACKAGES, JSON.stringify(pkgs));
  window.dispatchEvent(new Event('689ktv_packages_updated'));
};

export const getStoredStaff = (): StaffMember[] => {
  const data = localStorage.getItem(STORAGE_KEYS.STAFF);
  if (!data) {
    localStorage.setItem(STORAGE_KEYS.STAFF, JSON.stringify(INITIAL_STAFF));
    return INITIAL_STAFF;
  }
  try {
    return JSON.parse(data);
  } catch {
    return INITIAL_STAFF;
  }
};

export const saveStoredStaff = (staff: StaffMember[]) => {
  localStorage.setItem(STORAGE_KEYS.STAFF, JSON.stringify(staff));
  window.dispatchEvent(new Event('689ktv_staff_updated'));
};

export const getStoredSettings = (): AppSettings => {
  const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  if (!data) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(INITIAL_SETTINGS));
    return INITIAL_SETTINGS;
  }
  try {
    return { ...INITIAL_SETTINGS, ...JSON.parse(data) };
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
  if (!data) {
    return [];
  }
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
};

export const saveStoredBill = (bill: BillRecord) => {
  const existing = getStoredBills();
  const updated = [bill, ...existing];
  localStorage.setItem(STORAGE_KEYS.BILLS, JSON.stringify(updated));
  window.dispatchEvent(new Event('689ktv_bills_updated'));
};

export const updateStoredBills = (bills: BillRecord[]) => {
  localStorage.setItem(STORAGE_KEYS.BILLS, JSON.stringify(bills));
  window.dispatchEvent(new Event('689ktv_bills_updated'));
};

export const getStoredDebts = (): DebtRecord[] => {
  const data = localStorage.getItem(STORAGE_KEYS.DEBTS);
  if (!data) {
    localStorage.setItem(STORAGE_KEYS.DEBTS, JSON.stringify(INITIAL_DEBTS));
    return INITIAL_DEBTS;
  }
  try {
    return JSON.parse(data);
  } catch {
    return INITIAL_DEBTS;
  }
};

export const saveStoredDebts = (debts: DebtRecord[]) => {
  localStorage.setItem(STORAGE_KEYS.DEBTS, JSON.stringify(debts));
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
