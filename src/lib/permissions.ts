import { AppSettings, Role, StaffMember, StaffPermissions } from '../types';

export const ADMIN_ALL_PERMISSIONS: StaffPermissions = {
  posSales: true,
  roomManagement: true,
  editActiveBill: true,
  voidBill: true,
  applyDiscount: true,
  manageStock: true,
  viewReports: true,
  manageStaff: true,
};

export const DEFAULT_STAFF_PERMISSIONS: StaffPermissions = {
  posSales: true,
  roomManagement: true,
  editActiveBill: false,
  voidBill: true,
  applyDiscount: false,
  manageStock: true,
  viewReports: true,
  manageStaff: false,
};

export interface PermissionDefinition {
  key: keyof StaffPermissions;
  label: string;
  description: string;
  adminRecommended?: boolean;
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    key: 'posSales',
    label: 'ສິດເຂົ້າໜ້າຂາຍສິນຄ້າ (POS / ເປີດບິນ / ຮັບອໍເດີ)',
    description: 'สิทธิ์เข้าหน้าขายสินค้า (POS / เปิดบิล / รับออเดอร์)',
  },
  {
    key: 'roomManagement',
    label: 'ສິດເປີດຫ້ອງ / ປິດຫ້ອງ / ຕໍ່ເວລາຫ້ອງ (Room Management)',
    description: 'สิทธิ์เปิดห้อง / ปิดห้อง / ต่อเวลาห้อง (Room Management)',
  },
  {
    key: 'editActiveBill',
    label: 'ສິດແກ້ໄຂບິນທີ່ເປີດຢູ່ (Edit Active Bill)',
    description: 'สิทธิ์แก้ไขบิลที่เปิดอยู่ (ลดจำนวนหรือแก้ไขรายการในบิล)',
  },
  {
    key: 'voidBill',
    label: 'ສິດຍົກເລີກບິນຮ່າງກ່ອນຊຳລະເງິນ (Cancel Draft Bill)',
    description: 'สิทธิ์ยกเลิกบิลร่างก่อนชำระเงิน (ไม่สามารถลบบิลที่บันทึกแล้ว — การลบสงวนสิทธิ์เฉพาะ Admin)',
  },
  {
    key: 'applyDiscount',
    label: 'ສິດໃຫ້ສ່ວນຫຼຸດ / ແກ້ໄຂລາຄາ (Apply Discount / Edit Price)',
    description: 'สิทธิ์ให้ส่วนลด / แก้ไขราคา (Apply Discount / Edit Price)',
    adminRecommended: true,
  },
  {
    key: 'manageStock',
    label: 'ສິດເຂົ້າເບິ່ງ ແລະ ເພີ່ມສະຕັອກສິນຄ້າ (View & Add Stock)',
    description: 'สิทธิ์ตรวจสอบสต็อกและเพิ่มสต็อกสินค้า (ไม่สามารถลบสินค้า — การลบสงวนสิทธิ์เฉพาะ Admin)',
  },
  {
    key: 'viewReports',
    label: 'ສິດເຂົ້າເບິ່ງລາຍງານຍອດຂາຍ / ສະຫຼຸບຍອດເງິນ (Sales Reports)',
    description: 'สิทธิ์กดดูยอดสรุปและประวัติบิล (ไม่สามารถลบบิล — การลบสงวนสิทธิ์เฉพาะ Admin)',
  },
  {
    key: 'manageStaff',
    label: 'ສິດຈັດການພະນັກງານ ແລະ ຕັ້ງຄ່າສິດ (Manage Staff & Permissions)',
    description: 'สิทธิ์จัดการพนักงานและตั้งค่าสิทธิ์ (เฉพาะ Admin / เจ้าของร้าน)',
    adminRecommended: true,
  },
];

/**
 * Resolve effective permissions for any logged-in account.
 * Rule: Admin / Owner accounts ALWAYS have all permissions enabled and can NEVER lock themselves out.
 */
export function getEffectivePermissions(
  role: Role,
  staff?: StaffMember
): StaffPermissions {
  if (role === 'admin' || staff?.role === 'admin') {
    return { ...ADMIN_ALL_PERMISSIONS };
  }
  return {
    ...DEFAULT_STAFF_PERMISSIONS,
    ...(staff?.permissions || {}),
  };
}

export function normalizeStaffPermissions(staff: StaffMember): StaffMember {
  if (staff.role === 'admin') {
    return {
      ...staff,
      permissions: { ...ADMIN_ALL_PERMISSIONS },
    };
  }
  return {
    ...staff,
    permissions: {
      ...DEFAULT_STAFF_PERMISSIONS,
      ...(staff.permissions || {}),
    },
  };
}

export function countEnabledPermissions(staff: StaffMember): number {
  const perms = getEffectivePermissions(staff.role, staff);
  return Object.values(perms).filter(Boolean).length;
}

/**
 * Verify Admin Override PIN against settings.adminPin or any active Admin staff member's PIN.
 */
export function verifyAdminOverridePin(
  inputPin: string,
  settings: AppSettings,
  staffList: StaffMember[]
): { valid: boolean; approvedBy?: string } {
  const trimmed = (inputPin || '').trim();
  if (!trimmed) return { valid: false };

  const masterPin = (settings.adminPin || '8888').trim();
  if (trimmed === masterPin) {
    const owner = staffList.find((s) => s.role === 'admin');
    return { valid: true, approvedBy: owner?.name || 'Admin (ເຈົ້າຂອງຮ້ານ)' };
  }

  const matchedAdmin = staffList.find(
    (s) =>
      s.active &&
      (s.role === 'admin' || s.permissions?.manageStaff) &&
      s.pin &&
      s.pin.trim() === trimmed
  );
  if (matchedAdmin) {
    return { valid: true, approvedBy: matchedAdmin.name };
  }

  return { valid: false };
}
