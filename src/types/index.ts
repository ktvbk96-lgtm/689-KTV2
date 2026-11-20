export type Role = 'admin' | 'staff';

export interface StaffPermissions {
  posSales: boolean;       // 1. สิทธิ์เข้าหน้าขายสินค้า (POS / เปิดบิล / รับออเดอร์)
  roomManagement: boolean; // 2. สิทธิ์เปิดห้อง / ปิดห้อง / ต่อเวลาห้อง (Room Management)
  editActiveBill: boolean; // 3. สิทธิ์แก้ไขบิลที่เปิดอยู่ (Edit Active Bill / ลดจำนวนหรือแก้รายการในบิล)
  voidBill: boolean;       // 4. สิทธิ์ยกเลิกบิล / ลบบิล (Void / Cancel Bill)
  applyDiscount: boolean;  // 5. สิทธิ์ให้ส่วนลด / แก้ไขราคา (Apply Discount / Edit Price)
  manageStock: boolean;    // 6. สิทธิ์เข้าดูและจัดการสต็อกสินค้า (View / Add / Edit Stock)
  viewReports: boolean;    // 7. สิทธิ์เข้าดูรายงานยอดขาย / สรุปยอดเงิน (Sales Reports / Revenue)
  manageStaff: boolean;    // 8. สิทธิ์จัดการพนักงานและตั้งค่าสิทธิ์ (Manage Staff & Permissions - เฉพาะ Admin/เจ้าของร้าน)
}

export interface StaffMember {
  id: string;
  name: string;
  role: Role;
  pin?: string;
  phone?: string;
  active: boolean;
  permissions?: StaffPermissions;
  updatedAt?: string;
}

export type ProductCategory = 'drink' | 'beer' | 'food' | 'snack' | 'service' | 'other';

export interface Product {
  id: string;
  name: string; // Lao name e.g. ເບຍລາວ (Beerlao), ນ້ຳດື່ມ
  category: ProductCategory;
  costPrice: number;
  salePrice: number;
  stock: number;
  minStockAlert: number;
  unit: string; // ແກ້ວ, ຕຸກ, ຈານ, ຊຸດ, ກະປ໋ອງ
  requireSeller: boolean; // ຕ້ອງເລືອກຜູ້ຂາຍ/ພະນັກງານເສີບ
  imageUrl?: string;
  // Multi-unit inventory fields (ຂາຍຫຼາຍໜ່ວຍ: ແກ້ວ/ຂວດ vs ແພັກ/ລັງ)
  hasMultiUnit?: boolean; // ເປີດໃຊ້ງານຫຼາຍໜ່ວຍ
  packUnit?: string; // ຊື່ໜ່ວຍແພັກ ເຊັ່ນ "ແພັກ", "ລັງ", "ກ່ອງ"
  packMultiplier?: number; // ຈຳນວນໜ່ວຍຍ່ອຍຕໍ່ແພັກ ເຊັ່ນ 24 (1 ແພັກ = 24 ແກ້ວ)
  packSalePrice?: number; // ລາຄາຂາຍແບບແພັກ
  packCostPrice?: number; // ຕົ້ນທຶນແບບແພັກ
  packsInStock?: number; // ຈຳນວນແພັກຄົງເຫຼືອໃນສະຕັອກ (Packs in stock)
  looseBottles?: number; // ຈຳນວນເສດຂວດ/ແກ້ວທີ່ເຫຼືອ (0-23)
  updatedAt?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedUnitType?: 'single' | 'pack'; // 'single' (ແກ້ວ/ຂວດ) ຫຼື 'pack' (ແພັກ/ລັງ)
  unitLabel?: string; // "ແກ້ວ" ຫຼື "ແພັກ"
  multiplier?: number; // 1 ສຳລັບ single, 24 ສຳລັບ pack
  sellerId?: string;
  sellerName?: string;
  customPrice?: number; // ປ້ອນລາຄາເອງ (Override Price)
  note?: string;
}

export type RoomPricingType = 'open_time' | 'fixed_hourly' | 'package';

export interface RoomPackage {
  id: string;
  name: string; // e.g. ແພັກເກັດ 2 ຊົ່ວໂມງ (2 Hrs Combo)
  durationMinutes: number;
  price: number;
  description: string;
  includesBeerCount?: number;
  updatedAt?: string;
}

export type RoomStatus = 'available' | 'in_use' | 'billing';

export interface RoomOrder {
  id: string;
  product: Product;
  quantity: number;
  selectedUnitType?: 'single' | 'pack'; // 'single' ຫຼື 'pack'
  unitLabel?: string; // "ແກ້ວ" ຫຼື "ແພັກ"
  multiplier?: number; // 1 ຫຼື 24
  price: number;
  orderedAt: string;
  sellerId?: string;
  sellerName?: string;
  customPrice?: number;
  isStockDeducted?: boolean;
}

export interface RoomTimeExtension {
  id: string;
  extendedAt: string; // ISO string
  pricingType: RoomPricingType;
  label: string;
  addedHours: number;
  hourlyRate?: number;
  packageId?: string;
  packageName?: string;
  charge: number;
  isPaid?: boolean;
  includedInOrders?: boolean;
  extendedByStaffName?: string;
}

export interface Room {
  id: string;
  name: string; // e.g. ຫ້ອງ VIP 689, ຫ້ອງ VIP 01
  capacity: number;
  status: RoomStatus;
  pricingType: RoomPricingType;
  packageId?: string;
  packageName?: string;
  packagePrice?: number;
  hourlyRate: number; // For fixed hourly price (e.g. 70,000 ₭/hr)
  openedAt?: string; // ISO string
  targetEndTime?: string; // ISO string (e.g. 08:00 + 4 hours -> 12:00)
  bookedHours?: number; // e.g. 4
  baseBookedHours?: number; // Original booked hours before extensions
  openedByStaffId?: string;
  openedByStaffName?: string;
  isPaid?: boolean; // ລູກຄ້າຈ່າຍແລ້ວ / ຊຳລະຄ່າຫ້ອງແລ້ວ (ຖ້າຕິກແລ້ວບໍ່ຕ້ອງຄິດໄລ່ເງິນ ຄິດໄລ່ແຕ່ເວລາ)
  orders: RoomOrder[];
  extensions?: RoomTimeExtension[];
  updatedAt?: string; // ISO string for mutation versioning & race condition protection
}

export interface DebtPaymentEntry {
  id: string;
  amount: number;
  paidAt: string; // ISO string
  paymentMethod: 'cash' | 'transfer';
  note?: string;
  staffName?: string;
}

export type DebtStatus = 'unpaid' | 'partially_paid' | 'paid';

export interface DebtRecord {
  id: string;
  customerName: string;
  customerPhone?: string;
  billId?: string;
  billNumber?: string;
  roomName?: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: DebtStatus;
  createdAt: string; // ISO string
  dueDate?: string;
  photoUrl?: string; // base64 or URL
  note?: string;
  staffName: string;
  payments: DebtPaymentEntry[];
  updatedAt?: string;
}

export interface BillPayment {
  method: 'cash' | 'transfer' | 'debt';
  cashReceived?: number;
  change?: number;
  debtInfo?: {
    customerName: string;
    customerPhone?: string;
    photoUrl?: string;
    note?: string;
    dueDate?: string;
  };
}

export interface BillRecord {
  id: string;
  billNumber: string; // e.g. 689-20261031-001
  type: 'pos_sale' | 'ktv_room';
  roomId?: string;
  roomName?: string;
  packageName?: string; // e.g. "4 ชั่วโมง 300,000 กีบ"
  bookedHours?: number; // e.g. 4
  startTime?: string;
  endTime: string;
  targetEndTime?: string;
  timeRangeFormatted?: string; // e.g. "08:00 - 12:00"
  durationMinutes?: number;
  pricingType?: RoomPricingType;
  roomCharge: number;
  isRoomChargePaid?: boolean; // ຈ່າຍຄ່າຫ້ອງແລ້ວບໍ່ຕ້ອງຄິດໄລ່ເງິນ ຄິດໄລ່ແຕ່ເວລາ
  isSplitItemBill?: boolean; // ບິນແຍກຈ່າຍສະເພາະສິນຄ້າໃນຫ້ອງ (ຫ້ອງຍັງເປີດຢູ່)
  items: {
    productId: string;
    productName: string;
    unit: string;
    quantity: number;
    multiplier?: number; // 1 ສຳລັບ single, 24 ສຳລັບ pack
    selectedUnitType?: 'single' | 'pack';
    price: number;
    total: number;
    sellerId?: string;
    sellerName?: string;
    costPrice?: number;
  }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment: BillPayment;
  staffName: string;
  syncedToSheets?: boolean;
  updatedAt?: string;
}

export type AppThemeId =
  | 'neon_ktv'
  | 'sapphire_blue'
  | 'royal_purple'
  | 'emerald_luxury'
  | 'amber_gold'
  | 'midnight_black';

export type ReceiptFontSize = 'small' | 'medium' | 'large' | 'xlarge';
export type ReceiptPaperWidth = '58mm' | '80mm';

export interface AppSettings {
  shopName: string; // "689 KTV"
  shopBranch: string;
  shopAddress: string;
  shopPhone: string;
  receiptHeader: string;
  receiptFooter: string;
  wifiPassword?: string;
  adminPin: string; // default 8888
  staffPin: string; // default 1234
  currencySymbol: string; // ₭
  defaultHourlyRate: number; // e.g. 80,000
  bluetoothPrinterName?: string;
  bluetoothPrinterServiceId?: string;
  googleSheetId?: string;
  googleSheetName?: string;
  autoSyncGoogleSheets: boolean;
  autoCloseAfterPrint?: boolean; // ປິດໜ້າໃບບິນອັດຕະໂນມັດຫຼັງຈາກພິມແລ້ວ
  appTheme?: AppThemeId; // ໂທນສີຂອງແອັບພລິເຄຊັນ
  showPinHintsOnLogin?: boolean; // ສະແດງລະຫັດ PIN ຕົວຢ່າງໃນໜ້າ Login (ກຳນົດເປີດ/ປິດໄດ້)
  receiptLogoUrl?: string; // ຮູບພາບ/ໂລໂກ້ຫົວໃບບິນ (Receipt Header Logo)
  loginLogoUrl?: string; // ຮູບພາບໜ້າ Login / ປ້ອນ PIN (Login Brand Logo / Cover Image)
  appFontSize?: 'normal' | 'medium' | 'large' | 'xlarge'; // ຂະໜາດ Font ຂອງລະບົບທັງໝົດ (App UI Font Scale)
  staffCanEditDebt?: boolean; // ອະນຸຍາດໃຫ້ພະນັກງານແກ້ໄຂຍອດຕິດໜີ້ໄດ້ຫຼືບໍ່ (Admin ເປັນຜູ້ກຳນົດ)
  staffCanDeleteDebt?: boolean; // ອະນຸຍາດໃຫ້ພະນັກງານລຶບຍອດຕິດໜີ້ໄດ້ຫຼືບໍ່ (Admin ເປັນຜູ້ກຳນົດ)
  receiptFontSize?: ReceiptFontSize; // ຂະໜາດຕົວໜັງສືໃບບິນ ('small' | 'medium' | 'large' | 'xlarge')
  receiptPaperWidth?: ReceiptPaperWidth; // ຂະໜາດເຈ້ຍໃບບິນ ('58mm' | '80mm')
  receiptBoldText?: boolean; // ເນັ້ນຕົວໜັງສືໜາເຂັ້ມພິເສດ (Extra Bold)
  receiptHideTotalText?: boolean; // ບໍ່ຕ້ອງໃສ່ຂໍ້ຄວາມໃນແຖວບັນທັດຍອດສຸດທິ (ສະແດງສະເພາະຍອດເງິນ)
  receiptCustomFontSize?: number; // ຂະໜາດ Font ໃບບິນແບບກຳນົດເອງ (Custom Font Size e.g. 12-36px)
  receiptFontFamily?: 'phetsarath' | 'noto_sans' | 'saysettha'; // ຟອນພາສາລາວ (ເລີ່ມຕົ້ນ 'phetsarath')
  gasWebAppUrl?: string; // Google Apps Script Web App URL ສໍາລັບ Real-time Sync ຫຼາຍເຄື່ອງພ້ອມກັນ
  realtimeSyncEnabled?: boolean; // ເປີດການຊິ້ງຂໍ້ມູນ Real-time ອັດຕະໂນມັດເມື່ອມີການປ່ຽນແປງ
  lastSyncedAt?: string; // ເວລາຊິ້ງຂໍ້ມູນຫຼ້າສຸດ
}

