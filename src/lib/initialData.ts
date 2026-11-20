import { Product, Room, RoomPackage, StaffMember, AppSettings, DebtRecord, BillRecord } from '../types';

/**
 * STRICT ZERO MOCK DATA POLICY:
 * All entity collections MUST initialize strictly empty ([]).
 * Real data comes exclusively from Neon Postgres (/api/sync) or user entry.
 */
export const INITIAL_STAFF: StaffMember[] = [];
export const INITIAL_PACKAGES: RoomPackage[] = [];
export const INITIAL_ROOMS: Room[] = [];
export const INITIAL_PRODUCTS: Product[] = [];
export const INITIAL_DEBTS: DebtRecord[] = [];
export const INITIAL_BILLS: BillRecord[] = [];

export const INITIAL_SETTINGS: AppSettings = {
  shopName: '689 KTV',
  shopBranch: '',
  shopAddress: '',
  shopPhone: '',
  receiptHeader: '689 KTV',
  receiptFooter: 'ຂໍຂອບໃຈລູກຄ້າທີ່ມາອຸດໜູນ!',
  wifiPassword: '',
  adminPin: '8888',
  staffPin: '1234',
  currencySymbol: '₭',
  defaultHourlyRate: 80000,
  bluetoothPrinterName: '',
  autoSyncGoogleSheets: true,
  showPinHintsOnLogin: false,
  receiptLogoUrl: '',
  loginLogoUrl: '',
  appFontSize: 'large',
  staffCanEditDebt: false,
  staffCanDeleteDebt: false,
  receiptFontSize: 'large',
  receiptPaperWidth: '58mm',
  receiptBoldText: true,
  receiptHideTotalText: true,
  receiptCustomFontSize: 16,
  receiptFontFamily: 'phetsarath',
  gasWebAppUrl: '',
  realtimeSyncEnabled: true,
};

export const DEFAULT_GAS_WEBAPP_URL = '';
