import React, { useState, useEffect } from 'react';
import {
  DoorOpen,
  Clock,
  Plus,
  Receipt,
  Sparkles,
  Users,
  Timer,
  Package,
  Layers,
  UtensilsCrossed,
  Beer,
  AlertCircle,
  CheckCircle2,
  X,
  User,
  Coffee,
  Hourglass,
  CalendarCheck,
  DollarSign,
  UserCheck,
  Trash2,
  Pencil,
  RotateCcw,
  RefreshCw,
  ArrowRightLeft,
  MoveRight,
  CheckSquare,
  Square,
  Split,
} from 'lucide-react';
import {
  Room,
  RoomPackage,
  RoomOrder,
  Product,
  ProductCategory,
  StaffMember,
  AppSettings,
  CartItem,
  Role,
  RoomPricingType,
} from '../types';
import { formatCurrency } from '../lib/storage';
import { formatWithSeparators, parseCleanNumber, FormattedNumberInput } from './FormattedNumberInput';
import { normalizeImageUrl } from '../lib/imageUtils';
import { calculatePackageBasedRoomCharge, calculateRoomSessionFee } from '../lib/roomPricing';

interface RoomManagementProps {
  rooms: Room[];
  packages: RoomPackage[];
  products: Product[];
  staffList: StaffMember[];
  settings: AppSettings;
  currentRole?: Role;
  currentStaff?: StaffMember;
  onUpdateRooms: (updatedRooms: Room[]) => Promise<any> | void;
  onCheckoutRoom: (
    room: Room,
    roomCharge: number,
    durationMinutes: number,
    startTimeStr?: string,
    endTimeStr?: string,
    timeRangeStr?: string
  ) => void;
  onSplitCheckoutRoom?: (room: Room, selectedOrders: RoomOrder[]) => void;
}

export const RoomManagement: React.FC<RoomManagementProps> = ({
  rooms,
  packages,
  products,
  staffList,
  settings,
  currentRole,
  currentStaff,
  onUpdateRooms,
  onCheckoutRoom,
  onSplitCheckoutRoom,
}) => {
  // Live ticker for time
  const [now, setNow] = useState<Date>(new Date());

  // Helper to extract effective duration hours from package
  const parsePackageDurationHours = (pkg?: RoomPackage): number => {
    if (!pkg) return 2;
    const text = `${pkg.name || ''} ${pkg.description || ''}`;
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:ຊົ່ວໂມງ|ชั่วโมง|ຊມ|ชม|ช\.ມ\.|ช\.ม\.|hrs?|hours?)/i);
    if (match) {
      const parsed = parseFloat(match[1]);
      if (parsed > 0) {
        // If durationMinutes was default 120 or mismatch with name, prioritize hours from name!
        if (!pkg.durationMinutes || pkg.durationMinutes === 120 || Math.abs(pkg.durationMinutes - parsed * 60) > 1) {
          return parsed;
        }
      }
    }
    if (pkg.durationMinutes && pkg.durationMinutes > 0) {
      return Number((pkg.durationMinutes / 60).toFixed(1));
    }
    return 2;
  };

  // Helper to convert Date to HH:mm string for HTML time input
  const toHHMM = (d: Date): string => {
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  // Adjust HH:mm string by +/- minutes
  const adjustHHMM = (hhmm: string, deltaMinutes: number): string => {
    const [h, m] = (hhmm || toHHMM(new Date())).split(':').map(Number);
    const date = new Date();
    date.setHours(isNaN(h) ? 0 : h, isNaN(m) ? 0 : m, 0, 0);
    const adjusted = new Date(date.getTime() + deltaMinutes * 60 * 1000);
    return toHHMM(adjusted);
  };

  // Compute difference in hours between two HH:mm strings (handles overnight rollover)
  const computeDiffHours = (startHHMM: string, endHHMM: string): number => {
    const [sH, sM] = (startHHMM || '00:00').split(':').map(Number);
    const [eH, eM] = (endHHMM || '00:00').split(':').map(Number);
    const startM = (isNaN(sH) ? 0 : sH) * 60 + (isNaN(sM) ? 0 : sM);
    let endM = (isNaN(eH) ? 0 : eH) * 60 + (isNaN(eM) ? 0 : eM);
    if (endM <= startM) {
      endM += 24 * 60; // Next day
    }
    const diff = endM - startM;
    return Number((diff / 60).toFixed(1));
  };

  // Create Date object from HH:mm string with overnight detection
  const createDateFromHHMM = (hhmm: string, baseDate: Date = new Date(), isAfter?: Date): Date => {
    const [h, m] = (hhmm || '00:00').split(':').map(Number);
    const res = new Date(baseDate.getTime());
    res.setHours(isNaN(h) ? 0 : h, isNaN(m) ? 0 : m, 0, 0);
    if (isAfter && res.getTime() <= isAfter.getTime()) {
      res.setDate(res.getDate() + 1);
    }
    return res;
  };

  // Modal states: Open Room
  const [openingRoom, setOpeningRoom] = useState<Room | null>(null);
  const [pricingChoice, setPricingChoice] = useState<RoomPricingType>('open_time');
  const [selectedPackageId, setSelectedPackageId] = useState<string>(packages[0]?.id || '');
  const [packageHours, setPackageHours] = useState<number>(() => parsePackageDurationHours(packages[0]));
  const [customHourlyRate, setCustomHourlyRate] = useState<number>(settings.defaultHourlyRate);
  const [bookedHours, setBookedHours] = useState<number>(4); // Default 4 hours as requested!
  const [openedByStaffId, setOpenedByStaffId] = useState<string>(currentStaff?.id || staffList[0]?.id || '');
  const [isOpenRoomPaid, setIsOpenRoomPaid] = useState<boolean>(false);
  const [clearingRoomId, setClearingRoomId] = useState<string | null>(null);
  const [isClearingAll, setIsClearingAll] = useState<boolean>(false);

  // Time selection & editing states for opening a room
  const [openStartTimeInput, setOpenStartTimeInput] = useState<string>(() => toHHMM(new Date()));
  const [openEndTimeInput, setOpenEndTimeInput] = useState<string>('');
  const [isManualEndTime, setIsManualEndTime] = useState<boolean>(false);

  // Modal state: Edit time of an existing in-use room
  const [editingTimeRoom, setEditingTimeRoom] = useState<Room | null>(null);
  const [editStartTimeInput, setEditStartTimeInput] = useState<string>('');
  const [editEndTimeInput, setEditEndTimeInput] = useState<string>('');
  const [editBookedHours, setEditBookedHours] = useState<number>(2);

  // Room details / Add order modal
  const [selectedRoomForDetails, setSelectedRoomForDetails] = useState<Room | null>(null);
  const [orderSearch, setOrderSearch] = useState<string>('');
  const [orderStaffId, setOrderStaffId] = useState<string>(currentStaff?.id || staffList[0]?.id || '');
  const [isSplitPayMode, setIsSplitPayMode] = useState<boolean>(false);
  const [selectedSplitOrderIds, setSelectedSplitOrderIds] = useState<string[]>([]);

  // Dedicated Price & Seller input modal for Room Orders (Mandatory when price needs input or seller is required)
  const [pendingOrderItem, setPendingOrderItem] = useState<Product | null>(null);
  const [pendingOrderPrice, setPendingOrderPrice] = useState<string>('');
  const [pendingOrderQty, setPendingOrderQty] = useState<number>(1);
  const [pendingOrderSellerId, setPendingOrderSellerId] = useState<string>(''); // Starts empty as strictly requested!
  const [pendingOrderError, setPendingOrderError] = useState<string>('');

  // Room transfer states (ຍ້າຍຫ້ອງ KTV)
  const [transferSourceRoom, setTransferSourceRoom] = useState<Room | null>(null);
  const [transferTargetRoomId, setTransferTargetRoomId] = useState<string>('');
  const [transferRateOption, setTransferRateOption] = useState<'keep_target' | 'keep_source'>('keep_target');
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [transferSuccessToast, setTransferSuccessToast] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Keep Room Details modal synced with external room updates (e.g. split payment confirmation / room clear)
  useEffect(() => {
    if (!selectedRoomForDetails) {
      setIsSplitPayMode(false);
      setSelectedSplitOrderIds([]);
      return;
    }
    const fresh = rooms.find((r) => r.id === selectedRoomForDetails.id);
    if (!fresh || fresh.status !== 'in_use') {
      setSelectedRoomForDetails(null);
      setIsSplitPayMode(false);
      setSelectedSplitOrderIds([]);
      return;
    }
    setSelectedRoomForDetails(fresh);
    const validIds = new Set((fresh.orders || []).map((o) => o.id));
    setSelectedSplitOrderIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [rooms]);

  // Automatically sync openEndTimeInput when start time or hours change, unless manual override is set
  useEffect(() => {
    if (!isManualEndTime && openStartTimeInput) {
      const effHours = pricingChoice === 'package' ? packageHours : bookedHours;
      const startD = createDateFromHHMM(openStartTimeInput, new Date());
      const targetD = new Date(startD.getTime() + effHours * 60 * 60 * 1000);
      setOpenEndTimeInput(toHHMM(targetD));
    }
  }, [openStartTimeInput, bookedHours, packageHours, pricingChoice, isManualEndTime]);

  const calculateDurationMinutes = (openedAtStr?: string): number => {
    if (!openedAtStr) return 0;
    const start = new Date(openedAtStr).getTime();
    const diffMs = Math.max(0, now.getTime() - start);
    return Math.floor(diffMs / (1000 * 60));
  };

  const formatElapsedTimer = (openedAtStr?: string): string => {
    if (!openedAtStr) return '00:00:00';
    const start = new Date(openedAtStr).getTime();
    const diffSec = Math.max(0, Math.floor((now.getTime() - start) / 1000));
    const hours = Math.floor(diffSec / 3600);
    const minutes = Math.floor((diffSec % 3600) / 60);
    const seconds = diffSec % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Remaining or overtime timer
  const formatRemainingTimer = (
    openedAtStr?: string,
    targetEndTimeStr?: string
  ): { text: string; isOvertime: boolean; percent: number } => {
    if (!openedAtStr || !targetEndTimeStr) {
      return { text: '00:00:00', isOvertime: false, percent: 0 };
    }

    const start = new Date(openedAtStr).getTime();
    const target = new Date(targetEndTimeStr).getTime();
    const current = now.getTime();
    const totalDuration = target - start;

    if (current >= target) {
      const overtimeSec = Math.floor((current - target) / 1000);
      const h = Math.floor(overtimeSec / 3600);
      const m = Math.floor((overtimeSec % 3600) / 60);
      const s = overtimeSec % 60;
      return {
        text: `+${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`,
        isOvertime: true,
        percent: 100,
      };
    } else {
      const remainingSec = Math.floor((target - current) / 1000);
      const h = Math.floor(remainingSec / 3600);
      const m = Math.floor((remainingSec % 3600) / 60);
      const s = remainingSec % 60;
      const elapsed = current - start;
      const percent = Math.min(100, Math.max(0, Math.floor((elapsed / totalDuration) * 100)));
      return {
        text: `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`,
        isOvertime: false,
        percent,
      };
    }
  };

  const formatTimeHHMM = (dateObj: Date): string => {
    return dateObj.toLocaleTimeString('lo-LA', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  const calculateTargetEndTime = (
    startDate: Date,
    hoursOrPackage: { type: RoomPricingType; hours?: number; packageId?: string }
  ): { targetDate: Date; hoursLabel: string; effectiveHours: number; isOpenEnded?: boolean } => {
    let target = new Date(startDate.getTime());
    let hoursLabel = '';
    let effectiveHours = 4;

    if (hoursOrPackage.type === 'open_time') {
      return {
        targetDate: startDate,
        hoursLabel: 'ນັບຕາມເວລາຈິງ (ບໍ່ມີກຳນົດເວລາ)',
        effectiveHours: 0,
        isOpenEnded: true,
      };
    }

    if (hoursOrPackage.type === 'package') {
      const pkg = packages.find((p) => p.id === hoursOrPackage.packageId);
      effectiveHours = hoursOrPackage.hours !== undefined ? hoursOrPackage.hours : parsePackageDurationHours(pkg);
      const durationMins = Math.round(effectiveHours * 60);
      target = new Date(startDate.getTime() + durationMins * 60 * 1000);
      const pkgPrice = Number(pkg?.price) || 0;
      hoursLabel = `${effectiveHours} ຊົ່ວໂມງ ${pkgPrice > 0 ? formatCurrency(pkgPrice, settings.currencySymbol) : `(${pkg?.name || 'ແພັກເກັດ'})`}`;
    } else {
      effectiveHours = hoursOrPackage.hours || 4;
      target = new Date(startDate.getTime() + effectiveHours * 60 * 60 * 1000);
      hoursLabel = `${effectiveHours} ຊົ່ວໂມງ`;
    }

    return { targetDate: target, hoursLabel, effectiveHours, isOpenEnded: false };
  };

  // Calculate true room fee according to pricing mode (package returns full package price 100%)
  const calculateActualRoomFee = (room: Room): number => {
    if (room.status !== 'in_use' || !room.openedAt) return 0;
    const minutes = Math.max(1, calculateDurationMinutes(room.openedAt));
    return calculateRoomSessionFee(
      room,
      packages,
      settings.defaultHourlyRate || 100000,
      minutes
    );
  };

  // Unpaid room fee balance still due at checkout
  const calculateRoomFee = (room: Room): number => {
    if (room.status !== 'in_use' || !room.openedAt) return 0;
    if (room.isPaid) return 0;
    return calculateActualRoomFee(room);
  };

  // Trigger open room modal and pre-initialize times
  const handleOpenRoomClick = (room: Room) => {
    setOpeningRoom(room);
    setIsOpenRoomPaid(false); // Reset paid status
    setCustomHourlyRate(room.hourlyRate || settings.defaultHourlyRate);
    setPricingChoice('open_time'); // Default to Open-Ended (ນັບຕາມເວລາຈິງ ບໍ່ມີກຳນົດເວລາ) as requested!
    const firstPkg = packages[0];
    setSelectedPackageId(firstPkg?.id || '');
    const hrs = parsePackageDurationHours(firstPkg);
    setPackageHours(hrs);
    setBookedHours(hrs || 4);

    const nowStr = toHHMM(new Date());
    setOpenStartTimeInput(nowStr);
    const initialTarget = new Date(Date.now() + (hrs || 4) * 60 * 60 * 1000);
    setOpenEndTimeInput(toHHMM(initialTarget));
    setIsManualEndTime(false);
  };

  // Open Room action with customizable start & end time
  const handleOpenRoomSubmit = () => {
    if (!openingRoom) return;

    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const staff = staffList.find((s) => s.id === openedByStaffId) || currentStaff;
    const pkg = packages.find((p) => p.id === selectedPackageId);
    let effectiveHours = pricingChoice === 'package' ? packageHours : bookedHours;

    // Use customized start time from input
    const startD = openStartTimeInput ? createDateFromHHMM(openStartTimeInput, new Date()) : new Date();
    let targetD: Date | undefined;

    if (pricingChoice === 'open_time') {
      targetD = undefined;
      effectiveHours = 0;
    } else if (isManualEndTime && openEndTimeInput) {
      targetD = createDateFromHHMM(openEndTimeInput, startD, startD);
      const diffH = computeDiffHours(openStartTimeInput, openEndTimeInput);
      if (diffH > 0) {
        effectiveHours = diffH;
      }
    } else {
      targetD = new Date(startD.getTime() + effectiveHours * 60 * 60 * 1000);
    }

    const updatedRooms = rooms.map((r) => {
      if (r.id === openingRoom.id) {
        return {
          ...r,
          status: 'in_use' as const,
          pricingType: pricingChoice,
          packageId: pricingChoice === 'package' ? selectedPackageId : undefined,
          packageName: pricingChoice === 'package' ? pkg?.name : undefined,
          packagePrice: pricingChoice === 'package' ? (Number(pkg?.price) || 0) : undefined,
          hourlyRate: (pricingChoice === 'fixed_hourly' || pricingChoice === 'open_time')
            ? customHourlyRate
            : (r.hourlyRate || settings.defaultHourlyRate || 100000),
          bookedHours: pricingChoice === 'open_time' ? 0 : effectiveHours,
          openedAt: startD.toISOString(),
          targetEndTime: targetD ? targetD.toISOString() : undefined,
          openedByStaffId: staff?.id,
          openedByStaffName: staff?.name,
          isPaid: isOpenRoomPaid,
          orders: [],
          updatedAt: new Date().toISOString(),
        };
      }
      return r;
    });

    onUpdateRooms(updatedRooms);
    setOpeningRoom(null);
  };

  // Toggle Room Paid Status (ຈ່າຍແລ້ວ / ຍັງບໍ່ຈ່າຍ)
  const handleToggleRoomPaid = (room: Room) => {
    const newPaid = !room.isPaid;
    const updatedRoom: Room = {
      ...room,
      isPaid: newPaid,
      updatedAt: new Date().toISOString(),
    };
    const updatedRooms = rooms.map((r) => (r.id === room.id ? updatedRoom : r));
    onUpdateRooms(updatedRooms);
    if (selectedRoomForDetails?.id === room.id) {
      setSelectedRoomForDetails(updatedRoom);
    }
  };

  // Open Edit Time modal for any in-use room
  const openEditTimeModal = (room: Room) => {
    setEditingTimeRoom(room);
    const startD = room.openedAt ? new Date(room.openedAt) : new Date();
    const targetD = room.targetEndTime
      ? new Date(room.targetEndTime)
      : new Date(startD.getTime() + (room.bookedHours || 2) * 60 * 60 * 1000);

    const sStr = toHHMM(startD);
    const tStr = toHHMM(targetD);
    setEditStartTimeInput(sStr);
    setEditEndTimeInput(tStr);
    const diffH = computeDiffHours(sStr, tStr);
    setEditBookedHours(room.bookedHours && room.bookedHours > 0 ? room.bookedHours : (diffH || 2));
  };

  // Save edited time on active in-use room
  const handleSaveEditTime = () => {
    if (!editingTimeRoom) return;

    const baseStart = editingTimeRoom.openedAt ? new Date(editingTimeRoom.openedAt) : new Date();
    const newStart = createDateFromHHMM(editStartTimeInput, baseStart);

    const isOpenEnded = editingTimeRoom.pricingType === 'open_time' && !editingTimeRoom.targetEndTime;

    let newTarget: Date | undefined;
    let finalHours = 0;

    if (!isOpenEnded) {
      newTarget = createDateFromHHMM(editEndTimeInput, newStart, newStart);
      const diffH = computeDiffHours(editStartTimeInput, editEndTimeInput);
      finalHours = editBookedHours > 0 ? editBookedHours : (diffH || 1);
    }

    const updatedRoom: Room = {
      ...editingTimeRoom,
      openedAt: newStart.toISOString(),
      targetEndTime: newTarget ? newTarget.toISOString() : undefined,
      bookedHours: finalHours,
      updatedAt: new Date().toISOString(),
    };

    const updatedRooms = rooms.map((r) => (r.id === editingTimeRoom.id ? updatedRoom : r));
    onUpdateRooms(updatedRooms);

    if (selectedRoomForDetails?.id === editingTimeRoom.id) {
      setSelectedRoomForDetails(updatedRoom);
    }
    setEditingTimeRoom(null);
  };

  // Extend room time by 1 hour
  const handleExtendRoomTime = (room: Room, extraHours: number = 1) => {
    const currentTarget = room.targetEndTime ? new Date(room.targetEndTime) : new Date();
    const newTarget = new Date(currentTarget.getTime() + extraHours * 60 * 60 * 1000);
    const newBookedHours = (room.bookedHours || 0) + extraHours;

    const updatedRoom: Room = {
      ...room,
      targetEndTime: newTarget.toISOString(),
      bookedHours: newBookedHours,
      updatedAt: new Date().toISOString(),
    };

    const updatedRooms = rooms.map((r) => (r.id === room.id ? updatedRoom : r));
    onUpdateRooms(updatedRooms);
    setSelectedRoomForDetails(updatedRoom);
  };

  // Check if an item requires custom price or seller selection
  const requiresCustomPriceOrSeller = (product: Product): boolean => {
    return product.requireSeller === true || product.category === 'service' || product.salePrice <= 0;
  };

  // Open dedicated modal to specify price & seller before adding to room
  const openOrderPriceSellerModal = (product: Product) => {
    setPendingOrderItem(product);
    setPendingOrderQty(1);
    setPendingOrderPrice(product.salePrice > 0 ? formatWithSeparators(product.salePrice) : '');
    setPendingOrderSellerId(''); // MUST start completely blank as requested!
    setPendingOrderError('');
  };

  // Confirm adding item to room with validated price (>0) and seller selected
  const handleConfirmOrderWithPriceAndSeller = () => {
    if (!selectedRoomForDetails || !pendingOrderItem) return;

    const numericPrice = parseCleanNumber(pendingOrderPrice);
    if (numericPrice <= 0) {
      setPendingOrderError('⚠️ ທ່ານລືມປ້ອນລາຄາສິນຄ້າ! ລາຄາຕ້ອງຫຼາຍກວ່າ 0 ₭ (ບໍ່ສາມາດເປັນ 0 ₭ ໄດ້)');
      return;
    }

    if (!pendingOrderSellerId.trim()) {
      setPendingOrderError('⚠️ ທ່ານລືມເລືອກຊື່ຜູ້ຂາຍ! ກະລຸນາກົດເລືອກພະນັກງານຂາຍ/ເສີບກ່ອນສັ່ງ');
      return;
    }

    if (pendingOrderItem.category !== 'service' && pendingOrderItem.stock < pendingOrderQty) {
      alert(`ສະຕັອກບໍ່ພຽງພໍ! ສິນຄ້າ "${pendingOrderItem.name}" ເຫຼືອພຽງ ${pendingOrderItem.stock} ${pendingOrderItem.unit}`);
      return;
    }

    const seller = staffList.find((s) => s.id === pendingOrderSellerId);

    const newOrder = {
      id: 'order-' + Date.now(),
      product: pendingOrderItem,
      quantity: pendingOrderQty,
      price: numericPrice,
      customPrice: numericPrice !== pendingOrderItem.salePrice ? numericPrice : undefined,
      orderedAt: new Date().toISOString(),
      sellerId: seller?.id,
      sellerName: seller?.name,
      isStockDeducted: false,
    };

    const updatedRoom: Room = {
      ...selectedRoomForDetails,
      orders: [...selectedRoomForDetails.orders, newOrder],
      updatedAt: new Date().toISOString(),
    };

    const updatedRooms = rooms.map((r) => (r.id === selectedRoomForDetails.id ? updatedRoom : r));
    onUpdateRooms(updatedRooms);
    setSelectedRoomForDetails(updatedRoom);

    // Reset and close
    setPendingOrderItem(null);
    setPendingOrderError('');
  };

  // Add Item to Room
  const handleAddItemToRoom = (product: Product) => {
    if (!selectedRoomForDetails) return;

    if (product.stock <= 0 && product.category !== 'service') {
      alert(`ສິນຄ້າ "${product.name}" ໝົດສະຕັອກແລ້ວ! ບໍ່ສາມາດເພີ່ມໄດ້`);
      return;
    }

    // CRITICAL: If item requires seller or custom price or is a service, FORCE the price & seller modal
    if (requiresCustomPriceOrSeller(product)) {
      openOrderPriceSellerModal(product);
      return;
    }

    // Standard items with valid price
    const server = staffList.find((s) => s.id === orderStaffId) || currentStaff;

    const newOrder = {
      id: 'order-' + Date.now(),
      product,
      quantity: 1,
      price: product.salePrice,
      orderedAt: new Date().toISOString(),
      sellerId: server?.id,
      sellerName: server?.name,
      isStockDeducted: false,
    };

    const updatedRoom: Room = {
      ...selectedRoomForDetails,
      orders: [...selectedRoomForDetails.orders, newOrder],
      updatedAt: new Date().toISOString(),
    };

    const updatedRooms = rooms.map((r) => (r.id === selectedRoomForDetails.id ? updatedRoom : r));
    onUpdateRooms(updatedRooms);
    setSelectedRoomForDetails(updatedRoom);
  };

  // Remove or change item quantity in room
  const handleUpdateOrderItem = (orderId: string, delta: number) => {
    if (!selectedRoomForDetails) return;

    if (delta < 0 && currentRole !== 'admin') {
      const targetOrder = selectedRoomForDetails.orders.find((ord) => ord.id === orderId);
      if (targetOrder && targetOrder.quantity <= 1) {
        alert('ຂໍອະໄພ! ພະນັກງານບໍ່ມີສິດລຶບລາຍການສິນຄ້າອອກຈາກຫ້ອງ! ສະເພາະ Admin ເທົ່ານັ້ນ.');
        return;
      }
    }

    const updatedOrders = selectedRoomForDetails.orders
      .map((ord) => {
        if (ord.id === orderId) {
          const newQty = ord.quantity + delta;
          return newQty > 0 ? { ...ord, quantity: newQty } : null;
        }
        return ord;
      })
      .filter(Boolean) as any[];

    const updatedRoom: Room = {
      ...selectedRoomForDetails,
      orders: updatedOrders,
      updatedAt: new Date().toISOString(),
    };

    const updatedRooms = rooms.map((r) => (r.id === selectedRoomForDetails.id ? updatedRoom : r));
    onUpdateRooms(updatedRooms);
    setSelectedRoomForDetails(updatedRoom);
  };

  const handleCheckoutClick = (room: Room) => {
    if (room.status !== 'in_use') return;
    const duration = Math.max(1, calculateDurationMinutes(room.openedAt));
    const roomFee = calculateActualRoomFee(room);

    const startStr = room.openedAt
      ? new Date(room.openedAt).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false })
      : undefined;
    const endStr = new Date().toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false });
    const targetStr = room.targetEndTime
      ? new Date(room.targetEndTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false })
      : undefined;

    const timeRangeStr = startStr
      ? (room.pricingType === 'open_time' || !targetStr
          ? `${startStr} - ${endStr} (${Math.floor(duration / 60)} ຊມ ${duration % 60} ນາທີ - ນັບຕາມຈິງ)`
          : `${startStr} - ${endStr} (ກຳນົດ: ${startStr} - ${targetStr || endStr})`)
      : undefined;

    // Open BillingModal in Draft mode without clearing the room yet
    // Room is cleared ONLY when payment is confirmed (so Cancel Bill leaves room intact & excludes from Sales Summary)
    setSelectedRoomForDetails(null);
    setOpeningRoom(null);
    onCheckoutRoom(room, roomFee, duration, startStr, endStr, timeRangeStr);
  };

  // Force Clear Room back to available (ເຄຼຍຫ້ອງວ່າງ & ລ້າງຂໍ້ມູນທຸກຢ່າງ - ສະເພາະ Admin ເທົ່ານັ້ນ)
  const handleForceClearRoom = async (room: Room) => {
    if (currentRole !== 'admin') {
      alert('ຂໍອະໄພ! ພະນັກງານບໍ່ມີສິດເຄຼຍ ຫຼື ລຶບຂໍ້ມູນຫ້ອງ! ສະເພາະ Admin ເທົ່ານັ້ນ.');
      return;
    }
    const confirmed = window.confirm(
      `ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການເຄຼຍ "${room.name}" ໃຫ້ເປັນຫ້ອງວ່າງຄືເກົ່າ? \n\n* ລາຍການສັ່ງ ແລະ ເວລາທັງໝົດຈະຖືກລ້າງອອກ!`
    );
    if (!confirmed) return;

    setClearingRoomId(room.id);
    try {
      const nowIso = new Date().toISOString();
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
            packagePrice: undefined,
            isPaid: undefined,
            orders: [],
            updatedAt: nowIso,
          };
        }
        return r;
      });

      try {
        await onUpdateRooms(updatedRooms);
      } catch (err) {
        console.warn('Realtime clear room note:', err);
      }
      setSelectedRoomForDetails(null);
      setOpeningRoom(null);
    } finally {
      setClearingRoomId(null);
    }
  };

  // Clear all rooms back to available (00:00)
  const handleClearAllRooms = async () => {
    if (currentRole !== 'admin') {
      alert('ສະເພາະ Admin ເທົ່ານັ້ນທີ່ສາມາດເຄຼຍທຸກຫ້ອງພ້ອມກັນໄດ້!');
      return;
    }
    const pin = window.prompt('⚠️ ຢືນຢັນເຄຼຍທຸກຫ້ອງໃຫ້ເປັນຫ້ອງວ່າງ (Reset to 00:00)\nກະລຸນາປ້ອນລະຫັດ Admin PIN:');
    if (!pin) return;
    if (pin !== settings.adminPin && pin !== '8888') {
      alert('ລະຫັດ Admin PIN ບໍ່ຖືກຕ້ອງ!');
      return;
    }
    if (window.confirm('ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການເຄຼຍທຸກຫ້ອງໃຫ້ເປັນຫ້ອງວ່າງຄືເກົ່າ?\n* ທຸກຫ້ອງຈະກັບມາເປັນສະຖານະພ້ອມໃຊ້ງານ ແລະ ເວລາ 00:00!')) {
      setIsClearingAll(true);
      try {
        const nowIso = new Date().toISOString();
        const updated = rooms.map((r) => ({
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
          packagePrice: undefined,
          isPaid: undefined,
          orders: [],
          updatedAt: nowIso,
        }));
        try {
          await onUpdateRooms(updated);
        } catch (err) {
          console.warn('Realtime clear all rooms note:', err);
        }
      } finally {
        setIsClearingAll(false);
      }
    }
  };

  // Start Transfer Room (ຍ້າຍຫ້ອງ)
  const handleStartTransferRoom = (room: Room) => {
    setTransferSourceRoom(room);
    const available = rooms.filter((r) => r.status === 'available' && r.id !== room.id);
    setTransferTargetRoomId(available[0]?.id || '');
    setTransferRateOption('keep_target');
  };

  // Execute Transfer Room (ຢືນຢັນຍ້າຍຫ້ອງ)
  const handleExecuteTransferRoom = async () => {
    if (!transferSourceRoom || !transferTargetRoomId) return;
    const targetRoom = rooms.find((r) => r.id === transferTargetRoomId);
    if (!targetRoom || targetRoom.status !== 'available') {
      alert('⚠️ ຫ້ອງປາຍທາງບໍ່ພ້ອມໃຊ້ງານ ຫຼື ບໍ່ແມ່ນຫ້ອງວ່າງ!');
      return;
    }

    setIsTransferring(true);
    try {
      const nowIso = new Date().toISOString();
      const sourceName = transferSourceRoom.name;
      const targetName = targetRoom.name;

      // Determine hourly rate for target room
      const effectiveHourlyRate =
        transferSourceRoom.pricingType === 'package'
          ? transferSourceRoom.hourlyRate
          : transferRateOption === 'keep_source'
          ? transferSourceRoom.hourlyRate
          : targetRoom.hourlyRate;

      const updatedRooms: Room[] = rooms.map((r) => {
        // Target Room: Receives all active session data
        if (r.id === targetRoom.id) {
          return {
            ...r,
            status: 'in_use' as const,
            pricingType: transferSourceRoom.pricingType,
            openedAt: transferSourceRoom.openedAt,
            targetEndTime: transferSourceRoom.targetEndTime,
            bookedHours: transferSourceRoom.bookedHours,
            openedByStaffId: transferSourceRoom.openedByStaffId,
            openedByStaffName: transferSourceRoom.openedByStaffName,
            packageId: transferSourceRoom.packageId,
            packageName: transferSourceRoom.packageName,
            packagePrice: transferSourceRoom.packagePrice,
            isPaid: transferSourceRoom.isPaid,
            orders: [...transferSourceRoom.orders],
            hourlyRate: effectiveHourlyRate,
            updatedAt: nowIso,
          };
        }
        // Source Room: Reset to clean available (00:00)
        if (r.id === transferSourceRoom.id) {
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
            packagePrice: undefined,
            isPaid: undefined,
            orders: [],
            updatedAt: nowIso,
          };
        }
        return r;
      });

      await onUpdateRooms(updatedRooms);

      // If detail modal was open for source room, update it to target room
      if (selectedRoomForDetails?.id === transferSourceRoom.id) {
        const newTarget = updatedRooms.find((r) => r.id === targetRoom.id) || null;
        setSelectedRoomForDetails(newTarget);
      }

      setTransferSourceRoom(null);
      setTransferTargetRoomId('');
      setTransferSuccessToast(`ຍ້າຍຈາກ "${sourceName}" ໄປ "${targetName}" ສຳເລັດແລ້ວ!`);
      setTimeout(() => {
        setTransferSuccessToast(null);
      }, 4000);
    } catch (err: any) {
      console.error('Transfer room failed:', err);
      alert('ຍ້າຍຫ້ອງບໍ່ສຳເລັດ: ' + (err?.message || 'ເກີດຂໍ້ຜິດພາດ'));
    } finally {
      setIsTransferring(false);
    }
  };

  // Preview target time in modal based on chosen start time
  const previewStartDate = openStartTimeInput ? createDateFromHHMM(openStartTimeInput, now) : now;
  const previewEffectiveHours = pricingChoice === 'package' ? packageHours : bookedHours;
  const previewEndTime = calculateTargetEndTime(previewStartDate, {
    type: pricingChoice,
    hours: previewEffectiveHours,
    packageId: selectedPackageId,
  });

  const inUseCount = rooms.filter((r) => r.status === 'in_use').length;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Transfer Room Success Toast */}
      {transferSuccessToast && (
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2.5 text-sm font-bold">
            <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
            <span>{transferSuccessToast}</span>
          </div>
          <button
            onClick={() => setTransferSuccessToast(null)}
            className="p-1 hover:bg-white/20 rounded-lg text-white/80 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header and Quick Stats */}
      <div className="bg-slate-900 border border-indigo-950/80 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative overflow-hidden">
        {/* Violet ambient glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400">
              <DoorOpen className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-black text-slate-100">
              ລະບົບຈັດການຫ້ອງຄາຣາໂອເກະ 689 KTV
            </h1>
          </div>
          <p className="text-xs text-slate-400">
            ຄຳນວນເວລາເລີ່ມ-ສິ້ນສຸດ (ເຊັ່ນ 08:00 - 12:00 ສໍາລັບ 4 ຊົ່ວໂມງ), ນັບເວລາ Real-time ແລະ ພິມລົງໃບບິນ
          </p>
        </div>

        {/* Room status counters & Admin clear button */}
        <div className="flex items-center gap-2 text-xs font-semibold relative flex-wrap">
          <div className="px-3 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700 text-emerald-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>ຫ້ອງວ່າງ: {rooms.filter((r) => r.status === 'available').length}</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-indigo-950/80 border border-indigo-500/50 text-indigo-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
            <span>ກຳລັງໃຊ້ງານ: {inUseCount}</span>
          </div>

          {currentRole === 'admin' && inUseCount > 0 && (
            <button
              type="button"
              disabled={isClearingAll}
              onClick={handleClearAllRooms}
              className="px-3 py-1.5 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 hover:text-white flex items-center gap-1.5 transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title="Admin ເຄຼຍທຸກຫ້ອງທີ່ກຳລັງໃຊ້ງານໃຫ້ເປັນຫ້ອງວ່າງ 00:00"
            >
              {isClearingAll ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-rose-400 animate-spin" />
                  <span>ກຳລັງເຄຼຍທຸກຫ້ອງ...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>ເຄຼຍທຸກຫ້ອງ (00:00)</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Rooms Grid with Neon Indigo / Violet Ambiance */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {rooms.map((room) => {
          const isInUse = room.status === 'in_use';
          const actualRoomFee = isInUse ? calculateActualRoomFee(room) : 0;
          const roomCharge = isInUse ? calculateRoomFee(room) : 0;
          const itemsTotal = room.orders.reduce(
            (acc, curr) => acc + curr.price * curr.quantity,
            0
          );
          const grandTotal = roomCharge + itemsTotal;

          const startFormatted = room.openedAt
            ? new Date(room.openedAt).toLocaleTimeString('lo-LA', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })
            : null;

          const targetFormatted = room.targetEndTime
            ? new Date(room.targetEndTime).toLocaleTimeString('lo-LA', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })
            : null;

          const remainingInfo = isInUse
            ? formatRemainingTimer(room.openedAt, room.targetEndTime)
            : null;

          return (
            <div
              key={room.id}
              className={`rounded-3xl border transition-all duration-300 p-5 flex flex-col justify-between relative overflow-hidden shadow-lg ${
                isInUse
                  ? remainingInfo?.isOvertime
                    ? 'bg-slate-900/95 border-amber-500/80 shadow-amber-950/30'
                    : 'bg-slate-900/95 border-indigo-500/80 shadow-2xl shadow-indigo-950/40 ring-1 ring-indigo-500/30'
                  : 'bg-slate-900/60 border-slate-800 hover:border-indigo-900/60 hover:bg-slate-900/80'
              }`}
            >
              {/* Neon accent top bar for in-use room */}
              {isInUse && (
                <div
                  className={`absolute top-0 left-0 right-0 h-1.5 ${
                    remainingInfo?.isOvertime
                      ? 'bg-gradient-to-r from-amber-500 via-rose-500 to-amber-500'
                      : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-400'
                  }`}
                />
              )}

              {/* Top Row: Room Name & Status Badge */}
              <div className="pt-1">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        isInUse
                          ? remainingInfo?.isOvertime
                            ? 'bg-amber-400 animate-ping'
                            : 'bg-indigo-400 animate-ping'
                          : 'bg-emerald-500'
                      }`}
                    />
                    <h3 className="font-black text-base text-slate-100">{room.name}</h3>
                  </div>

                  <span
                    className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                      isInUse
                        ? remainingInfo?.isOvertime
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                          : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                        : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    }`}
                  >
                    {isInUse
                      ? remainingInfo?.isOvertime
                        ? 'ກາຍເວລາແລ້ວ'
                        : 'ກຳລັງໃຊ້ງານ (In-Use)'
                      : 'ຫ້ອງວ່າງ (Available)'}
                  </span>
                </div>

                {/* Capacity & Pricing Info */}
                <div className="flex items-center gap-3 text-xs text-slate-400 mb-4">
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    <span>{room.capacity} ຄົນ</span>
                  </span>
                  <span>•</span>
                  <span>
                    ອັດຕາ: {formatCurrency(room.hourlyRate, settings.currencySymbol)}/ຊມ
                  </span>
                </div>

                {/* Active Session Details */}
                {isInUse ? (
                  <div className="space-y-3 bg-slate-950/70 border border-slate-800 p-3.5 rounded-2xl mb-4">
                    {/* Time Window Banner */}
                    {startFormatted && (
                      <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-700/80 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-rose-400" />
                            <span>ຊ່ວງເວລາ:</span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-100 font-mono">
                              {targetFormatted
                                ? `${startFormatted} ຫາ ${targetFormatted}`
                                : `ເລີ່ມ: ${startFormatted} (ບໍ່ມີກຳນົດເວລາ)`}
                            </span>
                            <button
                              type="button"
                              onClick={() => openEditTimeModal(room)}
                              className="px-2 py-0.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all active:scale-95"
                              title="ແກ້ໄຂເວລາເລີ່ມ/ສິ້ນສຸດຂອງຫ້ອງນີ້"
                            >
                              <Pencil className="w-2.5 h-2.5" />
                              <span>ແກ້ໄຂເວລາ</span>
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>ຮູບແບບຄິດໄລ່:</span>
                          <span className="text-emerald-400 font-semibold font-mono">
                            {room.pricingType === 'open_time'
                              ? `ນັບຕາມເວລາຈິງ (${formatCurrency(room.hourlyRate, settings.currencySymbol)}/ຊມ)`
                              : room.bookedHours ? `${room.bookedHours} ຊົ່ວໂມງ` : 'ຕາມຊົ່ວໂມງ'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Live Timer & Real-time Room Charge */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {/* Elapsed */}
                      <div className="bg-slate-900/60 p-2 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-400 block mb-0.5">ໃຊ້ງານມາແລ້ວ:</span>
                        <span className="font-mono font-bold text-slate-200">
                          {formatElapsedTimer(room.openedAt)}
                        </span>
                      </div>

                      {/* Right box: If room.isPaid show 0 ₭ paid, else if open_time show current room charge, else remaining/overtime */}
                      {room.isPaid ? (
                        <div className="p-2 rounded-xl border bg-emerald-950/60 border-emerald-500/60 text-emerald-300 flex flex-col justify-between">
                          <span className="text-[10px] block mb-0.5 opacity-90 flex items-center gap-1 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>ຈ່າຍຄ່າຫ້ອງແລ້ວ:</span>
                          </span>
                          <span className="font-mono font-black text-emerald-300">
                            {formatCurrency(actualRoomFee, settings.currencySymbol)}
                          </span>
                        </div>
                      ) : room.pricingType === 'open_time' || !targetFormatted ? (
                        <div className="p-2 rounded-xl border bg-emerald-950/40 border-emerald-600/40 text-emerald-300 flex flex-col justify-between">
                          <span className="text-[10px] block mb-0.5 opacity-80 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span>ຄ່າຫ້ອງປະຈຸບັນ:</span>
                          </span>
                          <span className="font-mono font-bold text-emerald-300">
                            {formatCurrency(roomCharge, settings.currencySymbol)}
                          </span>
                        </div>
                      ) : (
                        <div
                          className={`p-2 rounded-xl border ${
                            remainingInfo?.isOvertime
                              ? 'bg-amber-950/60 border-amber-600/60 text-amber-300'
                              : 'bg-emerald-950/40 border-emerald-600/40 text-emerald-300'
                          }`}
                        >
                          <span className="text-[10px] block mb-0.5 opacity-80">
                            {remainingInfo?.isOvertime ? 'ກາຍເວລາແລ້ວ:' : 'ເຫຼືອເວລາ:'}
                          </span>
                          <span className="font-mono font-bold">
                            {remainingInfo?.text}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Progress bar */}
                    {targetFormatted && remainingInfo ? (
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            remainingInfo.isOvertime ? 'bg-amber-500' : 'bg-rose-500'
                          }`}
                          style={{ width: `${remainingInfo.percent}%` }}
                        />
                      </div>
                    ) : (
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 w-full animate-pulse opacity-80" />
                      </div>
                    )}

                    {/* Quick Paid Toggle Button */}
                    <button
                      type="button"
                      onClick={() => handleToggleRoomPaid(room)}
                      className={`w-full py-1.5 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-between cursor-pointer ${
                        room.isPaid
                          ? 'bg-emerald-950/70 border-emerald-500/70 text-emerald-300 shadow-sm shadow-emerald-950/50 hover:bg-emerald-900/60'
                          : 'bg-slate-900/80 border-slate-700/80 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                      }`}
                      title="ກົດເພື່ອປ່ຽນສະຖານະ: ຈ່າຍຄ່າຫ້ອງແລ້ວ ຫຼື ຍັງບໍ່ຈ່າຍ"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!room.isPaid}
                          onChange={() => {}}
                          className="w-4 h-4 rounded border-slate-600 text-emerald-500 pointer-events-none"
                        />
                        <span>{room.isPaid ? 'ລູກຄ້າຈ່າຍຄ່າຫ້ອງແລ້ວ (ຄິດໄລ່ແຕ່ເວລາ)' : 'ຕິກຖ້າລູກຄ້າຈ່າຍຄ່າຫ້ອງແລ້ວ'}</span>
                      </span>
                      <span className="font-mono font-black text-[11px]">
                        {room.isPaid ? formatCurrency(actualRoomFee, settings.currencySymbol) : 'ຍັງບໍ່ຈ່າຍ'}
                      </span>
                    </button>

                    {/* Pricing Type Badge */}
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
                      <span className="text-slate-400">ປະເພດລາຄາ:</span>
                      <span className="font-semibold text-rose-300 text-right">
                        {room.isPaid
                          ? `ຈ່າຍແລ້ວ (${formatCurrency(actualRoomFee, settings.currencySymbol)})`
                          : room.pricingType === 'package'
                          ? `ແພັກເກັດ: ${room.packageName || ''} (${formatCurrency(actualRoomFee, settings.currencySymbol)})`
                          : room.pricingType === 'open_time'
                          ? `ນັບຕາມເວລາຈິງ (ບໍ່ມີກຳນົດເວລາ)`
                          : `ລາຄາຕາຍຕົວ (${formatCurrency(room.hourlyRate, settings.currencySymbol)}/ຊມ)`}
                      </span>
                    </div>

                    {/* Explicit Room Fee Line */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">ຄ່າຫ້ອງ:</span>
                      <span className={`font-mono font-bold ${room.isPaid ? 'text-emerald-400' : 'text-amber-300'}`}>
                        {room.isPaid
                          ? `0 ${settings.currencySymbol} (ຈ່າຍແລ້ວ)`
                          : formatCurrency(roomCharge, settings.currencySymbol)}
                      </span>
                    </div>

                    {/* Orders count */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">ລາຍການສັ່ງເພີ່ມ:</span>
                      <span className="font-bold text-slate-200">
                        {room.orders.reduce((sum, o) => sum + o.quantity, 0)} ລາຍການ ({formatCurrency(itemsTotal, settings.currencySymbol)})
                      </span>
                    </div>

                    {/* Estimated Total */}
                    <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800 font-bold">
                      <span className="text-slate-300">ຍອດປະມານ:</span>
                      <span className="font-mono text-base font-extrabold text-rose-400">
                        {formatCurrency(grandTotal, settings.currencySymbol)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 bg-slate-950/40 border border-slate-800/80 p-3.5 rounded-2xl mb-4">
                    {/* Status badge */}
                    <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800/70">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                        <span>ສະຖານະຫ້ອງ:</span>
                      </span>
                      <span className="font-bold text-emerald-400 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span>ຫ້ອງວ່າງ (ພ້ອມໃຊ້ງານ)</span>
                      </span>
                    </div>

                    {/* Time Window Banner showing 00:00 ຫາ 00:00 as requested */}
                    <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          <span>ຊ່ວງເວລາ (ໂມງ):</span>
                        </span>
                        <span className="font-bold text-slate-200 font-mono">
                          00:00 ຫາ 00:00
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>ໄລຍະເວລາ:</span>
                        <span className="text-emerald-400 font-semibold font-mono">
                          00:00 (0 ຊົ່ວໂມງ)
                        </span>
                      </div>
                    </div>

                    {/* Cleared Timer & Hours (00:00:00 & 00:00:00) */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-800/70">
                        <span className="text-[10px] text-slate-500 block mb-0.5">ເວລາໃຊ້ງານ:</span>
                        <span className="font-mono font-bold text-slate-400">
                          00:00:00
                        </span>
                      </div>
                      <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-800/70">
                        <span className="text-[10px] text-slate-500 block mb-0.5">ເຫຼືອເວລາ:</span>
                        <span className="font-mono font-bold text-slate-400">
                          00:00:00
                        </span>
                      </div>
                    </div>

                    {/* Cleared Orders & Hourly Fee (0 ລາຍການ & 0 ₭) */}
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-slate-500">ລາຍການສັ່ງເພີ່ມ:</span>
                      <span className="font-mono font-semibold text-slate-400">
                        0 ລາຍການ
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-800/60 font-bold">
                      <span className="text-slate-400">ຄ່າຊົ່ວໂມງ / ຍອດ:</span>
                      <span className="font-mono text-sm font-extrabold text-emerald-400">
                        0 {settings.currencySymbol}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-2">
                {isInUse ? (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setSelectedRoomForDetails(room)}
                        className="py-2.5 px-3 rounded-2xl bg-indigo-950/40 hover:bg-indigo-900/40 text-indigo-200 text-xs font-bold border border-indigo-500/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <Plus className="w-3.5 h-3.5 text-indigo-400" />
                        <span>ສັ່ງເພີ່ມ / ເບິ່ງບິນ</span>
                      </button>
                      <button
                        onClick={() => handleCheckoutClick(room)}
                        className="py-2.5 px-3 rounded-2xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white text-xs font-extrabold shadow-md shadow-rose-600/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        <span>ເຊັກບິນ (Bill)</span>
                      </button>
                    </div>

                    <div className={currentRole === 'admin' ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 gap-2"}>
                      <button
                        type="button"
                        onClick={() => handleStartTransferRoom(room)}
                        className="py-2 px-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 hover:text-amber-200 text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                        title="ຍ້າຍຫ້ອງນີ້ໄປຫ້ອງວ່າງອື່ນ (Transfer to another room)"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>ຍ້າຍຫ້ອງ (Transfer)</span>
                      </button>

                      {currentRole === 'admin' && (
                        <button
                          type="button"
                          disabled={clearingRoomId === room.id}
                          onClick={() => handleForceClearRoom(room)}
                          className="py-2 px-2 rounded-xl bg-slate-900/80 hover:bg-rose-950/70 border border-slate-800 hover:border-rose-800 text-slate-400 hover:text-rose-300 text-[11px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Admin ເຄຼຍຫ້ອງໃຫ້ເປັນຫ້ອງວ່າງ (ລ້າງເວລາເປັນ 00:00 & ລ້າງລາຍການ)"
                        >
                          {clearingRoomId === room.id ? (
                            <>
                              <RefreshCw className="w-3 h-3 text-rose-400 animate-spin shrink-0" />
                              <span>ເຄຼຍ...</span>
                            </>
                          ) : (
                            <>
                              <Trash2 className="w-3 h-3 text-rose-400 shrink-0" />
                              <span>ເຄຼຍຫ້ອງ (00:00)</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => handleOpenRoomClick(room)}
                    className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-black shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                  >
                    <DoorOpen className="w-4 h-4" />
                    <span>ເປີດຫ້ອງນີ້ (Open Room)</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal: Open Room with Choice 1 (Package) or Choice 2 (Fixed Hourly) and Hour Selector */}
      {openingRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg shadow-2xl text-white">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <DoorOpen className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-100">
                    ເປີດຫ້ອງ: {openingRoom.name}
                  </h3>
                  <p className="text-xs text-slate-400">
                    ເລືອກຮູບແບບລາຄາ ແລະ ກຳນົດໄລຍະເວລາ (ເລີ່ມຈົນຮອດກີ່ໂມງ)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpeningRoom(null)}
                className="p-1 rounded-xl hover:bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Interactive Time Selector & Editor Banner */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-rose-950/70 via-slate-850 to-amber-950/70 border border-rose-500/40 mb-4 shadow-md space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-rose-300 font-bold">
                  <CalendarCheck className="w-4 h-4 text-amber-400" />
                  <span>ເລືອກ & ແກ້ໄຂເວລາເປີດຫ້ອງ:</span>
                </div>
                <span className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded-full font-semibold font-mono">
                  {pricingChoice === 'open_time'
                    ? 'ນັບຕາມເວລາຈິງ (ບໍ່ມີກຳນົດເວລາ)'
                    : `${previewEffectiveHours} ຊົ່ວໂມງ`}
                </span>
              </div>

              {/* Time inputs */}
              {pricingChoice === 'open_time' ? (
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center bg-slate-900/90 p-3 rounded-xl border border-slate-700/80">
                  {/* Start Time Box (6 cols) */}
                  <div className="sm:col-span-6 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-emerald-400" />
                        <span>ເວລາເລີ່ມນັບ:</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenStartTimeInput(toHHMM(new Date()));
                          setIsManualEndTime(false);
                        }}
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 underline font-semibold cursor-pointer"
                      >
                        ຕັ້ງເປັນຕອນນີ້
                      </button>
                    </div>
                    <input
                      type="time"
                      value={openStartTimeInput}
                      onChange={(e) => {
                        setOpenStartTimeInput(e.target.value);
                        setIsManualEndTime(false);
                      }}
                      className="w-full bg-slate-950 border border-emerald-500/50 rounded-xl px-3 py-1.5 text-base font-black text-emerald-300 font-mono text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    {/* Quick Adjust Start Time Buttons */}
                    <div className="flex items-center justify-center gap-1 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenStartTimeInput((prev) => adjustHHMM(prev, -30));
                          setIsManualEndTime(false);
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        -30ນ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenStartTimeInput((prev) => adjustHHMM(prev, -15));
                          setIsManualEndTime(false);
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        -15ນ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenStartTimeInput((prev) => adjustHHMM(prev, 15));
                          setIsManualEndTime(false);
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        +15ນ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenStartTimeInput((prev) => adjustHHMM(prev, 30));
                          setIsManualEndTime(false);
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        +30ນ
                      </button>
                    </div>
                  </div>

                  {/* Open-Ended Banner (6 cols) */}
                  <div className="sm:col-span-6 bg-slate-950/80 border border-emerald-500/30 rounded-xl p-3 flex flex-col justify-center">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs mb-1">
                      <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
                      <span>ບໍ່ມີກຳນົດເວລາສິ້ນສຸດ (Open-Ended)</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-snug">
                      ເລີ່ມນັບຕັ້ງແຕ່ຕອນເປີດ ຈົນຮອດຕອນເຊັກບິນ • ລະບົບຈະຄິດໄລ່ຄ່າຫ້ອງຕາມເວລາຕົວຈິງອັດຕະໂນມັດ
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-11 gap-2 items-center bg-slate-900/90 p-3 rounded-xl border border-slate-700/80">
                  {/* Start Time Box (5 cols) */}
                  <div className="sm:col-span-5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-emerald-400" />
                        <span>ເວລາເລີ່ມ:</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenStartTimeInput(toHHMM(new Date()));
                          setIsManualEndTime(false);
                        }}
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 underline font-semibold cursor-pointer"
                      >
                        ຕັ້ງເປັນຕອນນີ້
                      </button>
                    </div>
                    <input
                      type="time"
                      value={openStartTimeInput}
                      onChange={(e) => {
                        setOpenStartTimeInput(e.target.value);
                        setIsManualEndTime(false);
                      }}
                      className="w-full bg-slate-950 border border-emerald-500/50 rounded-xl px-3 py-1.5 text-base font-black text-emerald-300 font-mono text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    {/* Quick Adjust Start Time Buttons */}
                    <div className="flex items-center justify-center gap-1 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenStartTimeInput((prev) => adjustHHMM(prev, -30));
                          setIsManualEndTime(false);
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        -30ນ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenStartTimeInput((prev) => adjustHHMM(prev, -15));
                          setIsManualEndTime(false);
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        -15ນ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenStartTimeInput((prev) => adjustHHMM(prev, 15));
                          setIsManualEndTime(false);
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        +15ນ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenStartTimeInput((prev) => adjustHHMM(prev, 30));
                          setIsManualEndTime(false);
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        +30ນ
                      </button>
                    </div>
                  </div>

                  {/* Arrow / Middle Indicator (1 col) */}
                  <div className="sm:col-span-1 flex justify-center py-1">
                    <span className="text-amber-400 font-bold text-xs sm:rotate-0">➔</span>
                  </div>

                  {/* End Time Box (5 cols) */}
                  <div className="sm:col-span-5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium flex items-center gap-1">
                        <Hourglass className="w-3.5 h-3.5 text-rose-400" />
                        <span>ເວລາສິ້ນສຸດ:</span>
                      </span>
                      {isManualEndTime ? (
                        <span className="text-[10px] text-amber-300 font-bold">ກຳນົດເອງ</span>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-medium">ອັດຕະໂນມັດ</span>
                      )}
                    </div>
                    <input
                      type="time"
                      value={openEndTimeInput}
                      onChange={(e) => {
                        setOpenEndTimeInput(e.target.value);
                        setIsManualEndTime(true);
                        const diffH = computeDiffHours(openStartTimeInput, e.target.value);
                        if (diffH > 0) {
                          if (pricingChoice === 'package') {
                            setPackageHours(diffH);
                          } else {
                            setBookedHours(diffH);
                          }
                        }
                      }}
                      className="w-full bg-slate-950 border border-rose-500/50 rounded-xl px-3 py-1.5 text-base font-black text-rose-300 font-mono text-center focus:outline-none focus:ring-2 focus:ring-rose-500"
                    />
                    {/* Quick Adjust End Time Buttons */}
                    <div className="flex items-center justify-center gap-1 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          const newEnd = adjustHHMM(openEndTimeInput, -30);
                          setOpenEndTimeInput(newEnd);
                          setIsManualEndTime(true);
                          const diffH = computeDiffHours(openStartTimeInput, newEnd);
                          if (diffH > 0) {
                            if (pricingChoice === 'package') setPackageHours(diffH);
                            else setBookedHours(diffH);
                          }
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        -30ນ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const newEnd = adjustHHMM(openEndTimeInput, 30);
                          setOpenEndTimeInput(newEnd);
                          setIsManualEndTime(true);
                          const diffH = computeDiffHours(openStartTimeInput, newEnd);
                          if (diffH > 0) {
                            if (pricingChoice === 'package') setPackageHours(diffH);
                            else setBookedHours(diffH);
                          }
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        +30ນ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const newEnd = adjustHHMM(openEndTimeInput, 60);
                          setOpenEndTimeInput(newEnd);
                          setIsManualEndTime(true);
                          const diffH = computeDiffHours(openStartTimeInput, newEnd);
                          if (diffH > 0) {
                            if (pricingChoice === 'package') setPackageHours(diffH);
                            else setBookedHours(diffH);
                          }
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        +1ຊມ
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsManualEndTime(false)}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px] font-bold border border-slate-700 cursor-pointer"
                        title="ຣີເຊັດໃຫ້ຄຳນວນຕາມຊົ່ວໂມງອັດຕະໂນມັດ"
                      >
                        ຣີເຊັດ
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Pricing Choices Tab */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-300 mb-2">
                ເລືອກຮູບແບບລາຄາ:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* Choice 1: Open Time (ນັບຕາມເວລາຈິງ ບໍ່ມີກຳນົດເວລາ) */}
                <button
                  type="button"
                  onClick={() => setPricingChoice('open_time')}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    pricingChoice === 'open_time'
                      ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200 shadow-md shadow-emerald-950/40 ring-1 ring-emerald-500/50'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-xs text-white">Choice 1: ນັບຕາມຈິງ</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    ບໍ່ມີກຳນົດເວລາ • ຄຳນວນເອງຕອນເຊັກບິນ
                  </p>
                </button>

                {/* Choice 2: Fixed Hourly */}
                <button
                  type="button"
                  onClick={() => setPricingChoice('fixed_hourly')}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    pricingChoice === 'fixed_hourly'
                      ? 'bg-amber-950/50 border-amber-500 text-amber-200 shadow-md shadow-amber-950/40 ring-1 ring-amber-500/50'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Timer className="w-4 h-4 text-amber-400" />
                    <span className="font-bold text-xs text-white">Choice 2: ລາຄາຕາຍຕົວ</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    ກຳນົດຊົ່ວໂມງ (ເຊັ່ນ 2, 4 ຊມ)
                  </p>
                </button>

                {/* Choice 3: Package */}
                <button
                  type="button"
                  onClick={() => setPricingChoice('package')}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    pricingChoice === 'package'
                      ? 'bg-rose-950/50 border-rose-500 text-rose-200 shadow-md shadow-rose-950/40 ring-1 ring-rose-500/50'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Package className="w-4 h-4 text-rose-400" />
                    <span className="font-bold text-xs text-white">Choice 3: ແພັກເກັດ</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    ລາຄາເໝົາ ພ້ອມເຄື່ອງດື່ມແຖມ
                  </p>
                </button>
              </div>
            </div>

            {/* If Choice 1: Open-Time Rate Selection */}
            {pricingChoice === 'open_time' && (
              <div className="space-y-3 mb-4 p-3.5 rounded-2xl bg-slate-850/80 border border-slate-750">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-emerald-400" />
                    <span>ເລືອກລາຄາຕໍ່ຊົ່ວໂມງ ({settings.currencySymbol}/ຊມ):</span>
                  </span>
                  <span className="font-mono font-black text-emerald-400 text-sm">
                    {formatCurrency(customHourlyRate, settings.currencySymbol)}/ຊມ
                  </span>
                </div>

                {/* Preset Rate Chips */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                  {[40000, 50000, 60000, 70000, 80000, 100000].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setCustomHourlyRate(rate)}
                      className={`py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer font-mono ${
                        customHourlyRate === rate
                          ? 'bg-emerald-500 border-emerald-400 text-slate-950 font-black shadow-md shadow-emerald-500/30'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {rate >= 1000 ? `${rate / 1000}k` : rate}
                    </button>
                  ))}
                </div>

                {/* Custom Rate Input */}
                <div className="pt-1">
                  <label className="block text-[11px] text-slate-400 mb-1">
                    ຫຼື ປ້ອນລາຄາຄ່າຫ້ອງເອງ ({settings.currencySymbol}/ຊມ):
                  </label>
                  <input
                    type="number"
                    step="5000"
                    min="0"
                    value={customHourlyRate}
                    onChange={(e) => setCustomHourlyRate(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-emerald-500/40 rounded-xl px-3 py-2 text-xs font-mono text-emerald-300 font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="ປ້ອນລາຄາຕໍ່ຊົ່ວໂມງ..."
                  />
                </div>

                <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    ເລີ່ມຕົ້ນ 1 ຊົ່ວໂມງທຳອິດ = <strong>{formatCurrency(customHourlyRate, settings.currencySymbol)}</strong> (ບໍ່ນັບເສດ 1,000-2,000 ₭) • ຄົບຮອບ 1.5 ຊມ = <strong>{formatCurrency(Math.round(customHourlyRate * 1.5), settings.currencySymbol)}</strong> • ຄົບ 2 ຊມ = <strong>{formatCurrency(customHourlyRate * 2, settings.currencySymbol)}</strong>
                  </span>
                </div>
              </div>
            )}

            {/* If Choice 2: Select Hours */}
            {pricingChoice === 'fixed_hourly' && (
              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-xs text-slate-300 font-semibold mb-1.5">
                    ເລືອກໄລຍະເວລາ (ຈຳນວນຊົ່ວໂມງ):
                  </label>
                  <div className="grid grid-cols-4 gap-2 mb-2">
                    {[1, 2, 3, 4, 5, 6, 8].map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => {
                          setBookedHours(h);
                          setIsManualEndTime(false);
                        }}
                        className={`py-2 px-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                          bookedHours === h
                            ? 'bg-amber-500 border-amber-400 text-slate-950 font-black shadow-md shadow-amber-500/30'
                            : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {h} ຊົ່ວໂມງ
                      </button>
                    ))}
                    <div className="flex items-center">
                      <input
                        type="number"
                        min="1"
                        max="24"
                        value={bookedHours}
                        onChange={(e) => setBookedHours(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2 py-1.5 text-xs text-center font-bold text-amber-400 font-mono"
                        placeholder="ກຳນົດເອງ"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    ອັດຕາຄ່າຫ້ອງ ({settings.currencySymbol}/ຊມ):
                  </label>
                  <input
                    type="number"
                    step="10000"
                    value={customHourlyRate}
                    onChange={(e) => setCustomHourlyRate(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-amber-400 font-bold focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>
            )}

            {/* If Choice 3: Package List */}
            {pricingChoice === 'package' && (
              <div className="mb-4 space-y-3">
                <label className="block text-xs text-slate-300 font-bold">
                  ເລືອກແພັກເກັດຮ້ານ (Choice 3):
                </label>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1 scrollbar-thin">
                  {packages.map((pkg) => {
                    const pkgHours = parsePackageDurationHours(pkg);
                    const isSelected = selectedPackageId === pkg.id;
                    return (
                      <div
                        key={pkg.id}
                        onClick={() => {
                          setSelectedPackageId(pkg.id);
                          setPackageHours(pkgHours);
                          setIsManualEndTime(false);
                        }}
                        className={`p-3 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                          isSelected
                            ? 'bg-rose-950/60 border-rose-500 text-white shadow-md shadow-rose-950/50 ring-1 ring-rose-500/50'
                            : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h4 className="font-black text-xs text-slate-100 truncate">
                              {pkg.name}
                            </h4>
                            <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold whitespace-nowrap">
                              ⏱ {pkgHours} ຊົ່ວໂມງ
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 truncate">{pkg.description}</p>
                        </div>
                        <span className="font-mono font-black text-xs text-amber-400 shrink-0">
                          {formatCurrency(pkg.price, settings.currencySymbol)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Duration fine-tune for package */}
                <div className="p-3 rounded-2xl bg-slate-850 border border-slate-750 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-bold flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span>ໄລຍະເວລາແພັກເກັດທີ່ເລືອກ:</span>
                    </span>
                    <span className="font-mono font-black text-amber-400 text-sm">
                      {packageHours} ຊົ່ວໂມງ
                    </span>
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7].map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => {
                          setPackageHours(h);
                          setIsManualEndTime(false);
                        }}
                        className={`py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          packageHours === h
                            ? 'bg-rose-500 border-rose-400 text-white font-black shadow-sm'
                            : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {h} ຊມ
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Staff who opened room */}
            <div className="mb-5">
              <label className="block text-xs text-slate-400 mb-1.5">
                ພະນັກງານທີ່ເປີດຫ້ອງ:
              </label>
              <select
                value={openedByStaffId}
                onChange={(e) => setOpenedByStaffId(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.role === 'admin' ? 'Admin' : 'ພະນັກງານ'})
                  </option>
                ))}
              </select>
            </div>

            {/* Checkbox: Customer Already Paid (ຈ່າຍຄ່າຫ້ອງແລ້ວ ບໍ່ຕ້ອງຄິດໄລ່ເງິນ ຄິດໄລ່ແຕ່ເວລາ) */}
            <div className={`mb-5 p-3.5 rounded-2xl border transition-all cursor-pointer ${
              isOpenRoomPaid
                ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200 ring-1 ring-emerald-500/50'
                : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-800'
            }`}>
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isOpenRoomPaid}
                  onChange={(e) => setIsOpenRoomPaid(e.target.checked)}
                  className="w-5 h-5 rounded border-emerald-500 text-emerald-600 focus:ring-emerald-500 bg-slate-900 cursor-pointer mt-0.5"
                />
                <div className="flex-1 text-xs">
                  <div className="font-bold text-slate-100 flex items-center gap-1.5">
                    <CheckCircle2 className={`w-4 h-4 ${isOpenRoomPaid ? 'text-emerald-400' : 'text-slate-400'}`} />
                    <span className={isOpenRoomPaid ? 'text-emerald-300 font-extrabold' : ''}>
                      ລູກຄ້າຈ່າຍເງິນແລ້ວ / ຊຳລະຄ່າຫ້ອງແລ້ວ (ບໍ່ຄິດໄລ່ເງິນ)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    ຖ້າຕິກເລືອກ: ລະບົບຈະ<strong>ບໍ່ຄິດໄລ່ເງິນຄ່າຫ້ອງ (0 {settings.currencySymbol})</strong> ແຕ່ຈະ<strong>ຄຳນວນແຕ່ເວລາໃຊ້ງານເທົ່ານັ້ນ</strong>.
                  </p>
                </div>
              </label>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpeningRoom(null)}
                className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-slate-300 text-xs sm:text-sm font-semibold cursor-pointer touch-manipulation flex items-center justify-center"
              >
                ຍົກເລີກ
              </button>
              <button
                type="button"
                onClick={handleOpenRoomSubmit}
                className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-600/30 cursor-pointer touch-manipulation flex items-center justify-center text-center"
              >
                {(() => {
                  const selectedPkg = packages.find((p) => p.id === selectedPackageId);
                  const selectedPkgPrice = Number(selectedPkg?.price) || 0;
                  if (isOpenRoomPaid) {
                    return pricingChoice === 'package'
                      ? `ຢືນຢັນເປີດຫ້ອງ (ຈ່າຍແລ້ວ • ${previewEffectiveHours} ຊົ່ວໂມງ ${formatCurrency(selectedPkgPrice, settings.currencySymbol)})`
                      : 'ຢືນຢັນເປີດຫ້ອງ (ຈ່າຍແລ້ວ • ຄິດໄລ່ແຕ່ເວລາ)';
                  }
                  if (pricingChoice === 'open_time') {
                    return `ຢືນຢັນເປີດຫ້ອງ (ນັບຕາມຈິງ ${formatCurrency(customHourlyRate, settings.currencySymbol)}/ຊມ)`;
                  }
                  if (pricingChoice === 'package') {
                    return `ຢືນຢັນເປີດຫ້ອງ (${previewEffectiveHours} ຊົ່ວໂມງ ${formatCurrency(selectedPkgPrice, settings.currencySymbol)})`;
                  }
                  return `ຢືນຢັນເປີດຫ້ອງ (${previewEffectiveHours} ຊົ່ວໂມງ ${formatCurrency(previewEffectiveHours * customHourlyRate, settings.currencySymbol)})`;
                })()}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Room Order Details & Add Items & Extend Time */}
      {selectedRoomForDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-4xl shadow-2xl text-white max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                  <DoorOpen className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-lg text-slate-100">
                    {selectedRoomForDetails.name}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-mono text-amber-400 font-bold">
                      ⏱ {formatElapsedTimer(selectedRoomForDetails.openedAt)}
                    </span>
                    <span>•</span>
                    <button
                      type="button"
                      onClick={() => openEditTimeModal(selectedRoomForDetails)}
                      className="text-slate-300 hover:text-amber-300 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                      title="ກົດເພື່ອແກ້ໄຂເວລາເລີ່ມ ຫຼື ເວລາສິ້ນສຸດ"
                    >
                      <span>
                        {selectedRoomForDetails.pricingType === 'open_time' || !selectedRoomForDetails.targetEndTime
                          ? `ເລີ່ມ: ${selectedRoomForDetails.openedAt ? new Date(selectedRoomForDetails.openedAt).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''} (ນັບຕາມເວລາຈິງ - ບໍ່ມີກຳນົດເວລາ)`
                          : `ເລີ່ມ: ${selectedRoomForDetails.openedAt ? new Date(selectedRoomForDetails.openedAt).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''} - ໝົດ: ${new Date(selectedRoomForDetails.targetEndTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false })}`}
                      </span>
                      <Pencil className="w-3 h-3 text-amber-400" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Time management buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEditTimeModal(selectedRoomForDetails)}
                  className="px-3 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>ແກ້ໄຂເວລາ</span>
                </button>
                <button
                  onClick={() => handleExtendRoomTime(selectedRoomForDetails, 1)}
                  className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1 cursor-pointer transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>ຕໍ່ເວລາ +1 ຊົ່ວໂມງ</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleStartTransferRoom(selectedRoomForDetails)}
                  className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                  title="ຍ້າຍຫ້ອງນີ້ໄປຫ້ອງວ່າງອື່ນ (Transfer Room)"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-amber-400" />
                  <span>ຍ້າຍຫ້ອງ</span>
                </button>
                <button
                  onClick={() => setSelectedRoomForDetails(null)}
                  className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Modal Body: Left side = Current Orders, Right side = Quick Add Catalog */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 py-4 flex-1 overflow-hidden">
              {/* Left Column: Current Orders & Split Pay by Category (5 cols) */}
              <div className="md:col-span-5 flex flex-col border border-slate-800 rounded-2xl p-4 bg-slate-950/60 overflow-hidden">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2 gap-2 flex-wrap">
                  <h4 className="font-bold text-xs text-slate-200">
                    ລາຍການທີ່ສັ່ງແລ້ວ ({selectedRoomForDetails.orders.length})
                  </h4>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {selectedRoomForDetails.orders.length > 0 && onSplitCheckoutRoom && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = !isSplitPayMode;
                          setIsSplitPayMode(next);
                          setSelectedSplitOrderIds([]);
                        }}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                          isSplitPayMode
                            ? 'bg-amber-500 border-amber-400 text-slate-950 font-black shadow'
                            : 'bg-indigo-950/60 border-indigo-500/40 text-indigo-300 hover:bg-indigo-900/50'
                        }`}
                        title="ເລືອກແຍກຈ່າຍສະເພາະປະເພດສິນຄ້າ ຫຼື ບາງລາຍການ (ຫ້ອງຍັງເປີດຢູ່)"
                      >
                        <Split className="w-3 h-3" />
                        <span>{isSplitPayMode ? 'ປິດໂໝດແຍກຈ່າຍ' : 'ແຍກຈ່າຍຕາມປະເພດ'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleToggleRoomPaid(selectedRoomForDetails)}
                      className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                        selectedRoomForDetails.isPaid
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-sm'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                      }`}
                      title="ກົດເພື່ອຕິກວ່າລູກຄ້າຈ່າຍຄ່າຫ້ອງແລ້ວ ຫຼື ຍັງບໍ່ທັນຈ່າຍ"
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedRoomForDetails.isPaid}
                        onChange={() => {}}
                        className="w-3.5 h-3.5 rounded text-emerald-500 pointer-events-none"
                      />
                      <span>{selectedRoomForDetails.isPaid ? 'ຈ່າຍແລ້ວ' : 'ຕິກຖ້າຈ່າຍແລ້ວ'}</span>
                    </button>
                    <span className="text-xs font-mono font-bold text-amber-400">
                      ຄ່າຫ້ອງ: {formatCurrency(calculateActualRoomFee(selectedRoomForDetails), settings.currencySymbol)}
                      {selectedRoomForDetails.isPaid ? ' (ຈ່າຍກ່ອນແລ້ວ)' : ''}
                    </span>
                  </div>
                </div>

                {/* Split Payment Category Filter Chips */}
                {isSplitPayMode && selectedRoomForDetails.orders.length > 0 && (() => {
                  const catLabels: Record<ProductCategory, string> = {
                    beer: '🍺 ເບຍ/ເຫຼົ້າ',
                    drink: '🥤 ເຄື່ອງດື່ມ',
                    food: '🍗 ອາຫານ',
                    snack: '🍟 ຂອງກິນຫຼິ້ນ',
                    service: '👑 ບໍລິການ PR',
                    other: '📦 ອື່ນໆ',
                  };
                  const presentCats = Array.from(
                    new Set(selectedRoomForDetails.orders.map((o) => o.product.category))
                  ) as ProductCategory[];

                  const allSelected =
                    selectedSplitOrderIds.length === selectedRoomForDetails.orders.length &&
                    selectedRoomForDetails.orders.length > 0;

                  return (
                    <div className="mb-2.5 p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-amber-300">
                          ເລືອກປະເພດສິນຄ້າທີ່ຕ້ອງການແຍກຈ່າຍ:
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (allSelected) {
                              setSelectedSplitOrderIds([]);
                            } else {
                              setSelectedSplitOrderIds(
                                selectedRoomForDetails.orders.map((o) => o.id)
                              );
                            }
                          }}
                          className="text-[10px] font-bold text-amber-300 hover:text-amber-200 underline cursor-pointer"
                        >
                          {allSelected ? 'ລ້າງການເລືອກ' : 'ເລືອກທັງໝົດ'}
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {presentCats.map((cat) => {
                          const catOrders = selectedRoomForDetails.orders.filter(
                            (o) => o.product.category === cat
                          );
                          const catIds = catOrders.map((o) => o.id);
                          const isCatAllSelected =
                            catIds.length > 0 &&
                            catIds.every((id) => selectedSplitOrderIds.includes(id));
                          const catSum = catOrders.reduce(
                            (s, o) => s + o.price * o.quantity,
                            0
                          );
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => {
                                setSelectedSplitOrderIds((prev) => {
                                  if (isCatAllSelected) {
                                    return prev.filter((id) => !catIds.includes(id));
                                  }
                                  const merged = new Set([...prev, ...catIds]);
                                  return Array.from(merged);
                                });
                              }}
                              className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                                isCatAllSelected
                                  ? 'bg-amber-500 border-amber-400 text-slate-950 font-black shadow'
                                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-amber-500/50'
                              }`}
                            >
                              <span>{catLabels[cat] || cat}</span>
                              <span className="opacity-80 font-mono">
                                ({catOrders.length} • {formatCurrency(catSum, settings.currencySymbol)})
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                  {selectedRoomForDetails.orders.length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs">
                      ຍັງບໍ່ທັນມີລາຍການສັ່ງເພີ່ມ<br />
                      ເລືອກສິນຄ້າຈາກເມນູດ້ານຂວາເພື່ອສັ່ງເຂົ້າຫ້ອງ
                    </div>
                  ) : (
                    selectedRoomForDetails.orders.map((ord) => {
                      const isChecked = selectedSplitOrderIds.includes(ord.id);
                      return (
                        <div
                          key={ord.id}
                          onClick={() => {
                            if (!isSplitPayMode) return;
                            setSelectedSplitOrderIds((prev) =>
                              prev.includes(ord.id)
                                ? prev.filter((id) => id !== ord.id)
                                : [...prev, ord.id]
                            );
                          }}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 transition-all ${
                            isSplitPayMode ? 'cursor-pointer ' : ''
                          }${
                            isSplitPayMode && isChecked
                              ? 'bg-amber-950/40 border-amber-500/70'
                              : 'bg-slate-800/80 border-slate-700/60'
                          }`}
                        >
                          {isSplitPayMode && (
                            <span className="shrink-0 text-amber-400">
                              {isChecked ? (
                                <CheckSquare className="w-4 h-4 text-amber-400" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-500" />
                              )}
                            </span>
                          )}

                          <div className="flex-1 min-w-0">
                            <h5 className="font-bold text-xs text-slate-100 truncate">
                              {ord.product.name}
                            </h5>
                            <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 flex-wrap">
                              <span className="font-mono text-amber-400">
                                {formatCurrency(ord.price * ord.quantity, settings.currencySymbol)}
                              </span>
                              <span className="text-slate-500">
                                ({ord.quantity} x {formatCurrency(ord.price, '')})
                              </span>
                              {ord.sellerName && (
                                <span className="bg-purple-900/50 text-purple-300 px-1 rounded">
                                  {ord.sellerName}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Quantity modifier (hidden or stops propagation in split mode) */}
                          <div
                            className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-700"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handleUpdateOrderItem(ord.id, -1)}
                              disabled={ord.quantity <= 1 && currentRole !== 'admin'}
                              className={`w-5 h-5 rounded text-xs flex items-center justify-center transition-all ${
                                ord.quantity <= 1 && currentRole !== 'admin'
                                  ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer'
                              }`}
                              title={ord.quantity <= 1 && currentRole !== 'admin' ? 'ພະນັກງານບໍ່ມີສິດລຶບລາຍການສິນຄ້າ (ສະເພາະ Admin)' : 'ຫຼຸດຈຳນວນ'}
                            >
                              -
                            </button>
                            <span className="w-5 text-center text-xs font-mono font-bold">
                              {ord.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdateOrderItem(ord.id, 1)}
                              className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-xs flex items-center justify-center cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Split Pay Action Box (When Split Mode is active) */}
                {isSplitPayMode && selectedRoomForDetails.orders.length > 0 && (() => {
                  const selectedOrders = selectedRoomForDetails.orders.filter((o) =>
                    selectedSplitOrderIds.includes(o.id)
                  );
                  const splitTotal = selectedOrders.reduce(
                    (sum, o) => sum + o.price * o.quantity,
                    0
                  );
                  return (
                    <div className="mt-2 p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-emerald-300 font-bold">
                          ຍອດແຍກຈ່າຍ ({selectedOrders.length} ລາຍການ):
                        </span>
                        <span className="font-mono font-black text-amber-400">
                          {formatCurrency(splitTotal, settings.currencySymbol)}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={selectedOrders.length === 0}
                        onClick={() => {
                          if (selectedOrders.length === 0 || !onSplitCheckoutRoom) return;
                          onSplitCheckoutRoom(selectedRoomForDetails, selectedOrders);
                        }}
                        className={`w-full py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
                          selectedOrders.length > 0
                            ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg cursor-pointer active:scale-95'
                            : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                        }`}
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        <span>
                          ຊຳລະສະເພາະທີ່ເລືອກ ({formatCurrency(splitTotal, settings.currencySymbol)})
                        </span>
                      </button>
                    </div>
                  );
                })()}

                {/* Subtotal of Room */}
                <div className="pt-3 border-t border-slate-800 mt-2 space-y-1">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>ຄ່າອາຫານ/ເຄື່ອງດື່ມ:</span>
                    <span className="font-mono text-slate-200">
                      {formatCurrency(
                        selectedRoomForDetails.orders.reduce(
                          (acc, o) => acc + o.price * o.quantity,
                          0
                        ),
                        settings.currencySymbol
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-100 pt-1 border-t border-slate-800/60">
                    <span>ຍອດລວມທັງໝົດ:</span>
                    <span className="font-mono text-rose-400 font-black">
                      {formatCurrency(
                        calculateRoomFee(selectedRoomForDetails) +
                          selectedRoomForDetails.orders.reduce(
                            (acc, o) => acc + o.price * o.quantity,
                            0
                          ),
                        settings.currencySymbol
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: Menu to Add into Room (7 cols) */}
              <div className="md:col-span-7 flex flex-col overflow-hidden">
                <div className="space-y-2 mb-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="ຄົ້ນຫາເຄື່ອງດື່ມ, ອາຫານເພື່ອເພີ່ມເຂົ້າຫ້ອງ..."
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                    />
                    <select
                      value={orderStaffId}
                      onChange={(e) => setOrderStaffId(e.target.value)}
                      className="bg-slate-800 border border-slate-700 rounded-xl px-2 py-1.5 text-xs text-purple-300"
                    >
                      {staffList.map((s) => (
                        <option key={s.id} value={s.id}>
                          ເສີບ: {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Products list for room order */}
                <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-2 pr-1 scrollbar-thin">
                  {products
                    .filter((p) => {
                      const matchesSearch = p.name.toLowerCase().includes(orderSearch.toLowerCase());
                      return matchesSearch;
                    })
                    .map((prod) => {
                      const isOutOfStock = prod.stock <= 0 && prod.category !== 'service';
                      const needsCustom = requiresCustomPriceOrSeller(prod);
                      const badgeInfo =
                        prod.category === 'beer'
                          ? { label: 'ເບຍ', badge: 'bg-amber-950/80 text-amber-300 border-amber-500/40', text: 'text-amber-400', border: 'hover:border-amber-400' }
                          : prod.category === 'drink'
                          ? { label: 'ນ້ຳ', badge: 'bg-sky-950/80 text-sky-300 border-sky-500/40', text: 'text-sky-400', border: 'hover:border-sky-400' }
                          : prod.category === 'food'
                          ? { label: 'ອາຫານ', badge: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40', text: 'text-emerald-400', border: 'hover:border-emerald-400' }
                          : prod.category === 'snack'
                          ? { label: 'ຂອງຫຼິ້ນ', badge: 'bg-orange-950/80 text-orange-300 border-orange-500/40', text: 'text-orange-400', border: 'hover:border-orange-400' }
                          : prod.category === 'service'
                          ? { label: 'PR', badge: 'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-500/40', text: 'text-fuchsia-400', border: 'hover:border-fuchsia-400' }
                          : { label: 'ອື່ນໆ', badge: 'bg-slate-800 text-slate-300 border-slate-700', text: 'text-slate-300', border: 'hover:border-slate-500' };

                      return (
                        <div
                          key={prod.id}
                          onClick={() => {
                            if (isOutOfStock) return;
                            handleAddItemToRoom(prod);
                          }}
                          className={`p-2 rounded-2xl border text-left flex gap-2.5 transition-all cursor-pointer relative ${
                            isOutOfStock
                              ? 'bg-rose-950/20 border-rose-900/50 opacity-60 cursor-not-allowed'
                              : needsCustom
                              ? `bg-slate-800/90 border-amber-500/50 hover:border-amber-400 hover:bg-slate-750 shadow-sm`
                              : `bg-slate-800/80 border-slate-700/80 ${badgeInfo.border} hover:bg-slate-750`
                          }`}
                        >
                          {/* Image thumbnail */}
                          <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-900 shrink-0 border border-slate-700 flex items-center justify-center">
                            {prod.imageUrl ? (
                              <img
                                src={normalizeImageUrl(prod.imageUrl)}
                                alt={prod.name}
                                className={`w-full h-full object-cover ${isOutOfStock ? 'grayscale opacity-40' : ''}`}
                                onError={(e) => {
                                  (e.target as any).style.display = 'none';
                                }}
                              />
                            ) : (
                              <span className="text-base">
                                {prod.category === 'beer'
                                  ? '🍺'
                                  : prod.category === 'drink'
                                  ? '🥤'
                                  : prod.category === 'food'
                                  ? '🍗'
                                  : prod.category === 'snack'
                                  ? '🍟'
                                  : '📦'}
                              </span>
                            )}
                          </div>

                          <div className="flex-1 flex flex-col justify-between min-w-0">
                            <div>
                              <div className="flex items-center justify-between gap-1 mb-0.5">
                                <span className={`text-[9px] px-1.5 py-0.2 rounded border font-semibold ${badgeInfo.badge}`}>
                                  {badgeInfo.label}
                                </span>
                                {needsCustom ? (
                                  <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                                    ປ້ອນລາຄາ
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    {prod.unit}
                                  </span>
                                )}
                              </div>
                              <h5 className="font-bold text-xs text-slate-200 truncate">
                                {prod.name}
                              </h5>
                            </div>

                            <div className="flex items-center justify-between text-xs mt-1 pt-0.5 border-t border-slate-700/50">
                              <span className={`font-mono font-bold ${badgeInfo.text}`}>
                                {prod.salePrice > 0
                                  ? formatCurrency(prod.salePrice, settings.currencySymbol)
                                  : 'ກຳນົດເອງ'}
                              </span>
                              {isOutOfStock ? (
                                <span className="text-[9px] font-bold text-rose-400 bg-rose-950 px-1 py-0.2 rounded">
                                  ໝົດ
                                </span>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openOrderPriceSellerModal(prod);
                                    }}
                                    title="ປ້ອນລາຄາ & ເລືອກຜູ້ຂາຍ"
                                    className="p-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[10px] border border-amber-500/40 cursor-pointer"
                                  >
                                    ✏️
                                  </button>
                                  <span className="p-0.5 rounded-lg bg-slate-700 hover:bg-white/20 text-slate-200 transition-colors">
                                    <Plus className="w-3 h-3" />
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedRoomForDetails(null)}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  ປິດໜ້າຕ່າງ
                </button>
                {currentRole === 'admin' && (
                  <button
                    type="button"
                    disabled={clearingRoomId === selectedRoomForDetails.id}
                    onClick={() => handleForceClearRoom(selectedRoomForDetails)}
                    className="py-2.5 px-3 rounded-xl bg-slate-800/80 hover:bg-rose-950 border border-slate-700 hover:border-rose-700 text-slate-400 hover:text-rose-300 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Admin ເຄຼຍຫ້ອງໃຫ້ເປັນຫ້ອງວ່າງຄືເກົ່າ (ລ້າງລາຍການທັງໝົດ)"
                  >
                    {clearingRoomId === selectedRoomForDetails.id ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 text-rose-400 animate-spin" />
                        <span className="hidden sm:inline">ກຳລັງເຄຼຍ...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                        <span className="hidden sm:inline">ເຄຼຍຫ້ອງວ່າງ</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleStartTransferRoom(selectedRoomForDetails)}
                  className="py-2.5 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
                  title="ຍ້າຍຫ້ອງນີ້ໄປຫ້ອງວ່າງອື່ນ (Transfer Room)"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-amber-400" />
                  <span>ຍ້າຍຫ້ອງ</span>
                </button>
              </div>

              <button
                onClick={() => {
                  const room = selectedRoomForDetails;
                  setSelectedRoomForDetails(null);
                  handleCheckoutClick(room);
                }}
                className="py-2.5 px-5 rounded-2xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white text-xs font-black shadow-lg shadow-rose-600/30 flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <Receipt className="w-4 h-4" />
                <span>ໄປໜ້າເຊັກບິນ ແລະ ພິມໃບບິນ</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Mandatory Price and Seller input before adding order to Room */}
      {pendingOrderItem && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-amber-500/50 rounded-3xl p-6 w-full max-w-md shadow-2xl text-white space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-slate-100">
                    ກຳນົດລາຄາ & ເລືອກຜູ້ຂາຍ
                  </h3>
                  <p className="text-[11px] text-amber-300">
                    {pendingOrderItem.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingOrderItem(null);
                  setPendingOrderError('');
                }}
                className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Warning requirement notice */}
            <div className="p-3 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>ເງື່ອນໄຂການສັ່ງເພີ່ມ (ຈຳເປັນ):</span>
              </div>
              <p className="text-[11px] text-slate-300 pl-5 leading-relaxed">
                1. ຕ້ອງປ້ອນລາຄາສິນຄ້າ (ລາຄາຕ້ອງຫຼາຍກວ່າ 0 ₭)<br />
                2. ຕ້ອງເລືອກຊື່ຜູ້ຂາຍ/ເສີບກ່ອນ ຈຶ່ງຈະສາມາດກົດສັ່ງໄດ້
              </p>
            </div>

            {/* Quantity Selector */}
            <div className="flex items-center justify-between bg-slate-950/70 p-3 rounded-2xl border border-slate-800">
              <span className="text-xs text-slate-300 font-semibold">ຈຳນວນ ({pendingOrderItem.unit}):</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPendingOrderQty((prev) => Math.max(1, prev - 1))}
                  className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold flex items-center justify-center cursor-pointer border border-slate-700"
                >
                  -
                </button>
                <span className="w-8 text-center font-mono font-black text-base text-white">
                  {pendingOrderQty}
                </span>
                <button
                  type="button"
                  onClick={() => setPendingOrderQty((prev) => prev + 1)}
                  className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold flex items-center justify-center cursor-pointer border border-slate-700"
                >
                  +
                </button>
              </div>
            </div>

            {/* Price Input (Mandatory > 0) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-200">
                  ລາຄາຕໍ່ໜ່ວຍ ({settings.currencySymbol}) <span className="text-rose-400">*</span>:
                </label>
                {parseCleanNumber(pendingOrderPrice) > 0 && (
                  <span className="text-[11px] font-mono font-bold text-emerald-400">
                    ລວມ: {formatCurrency(parseCleanNumber(pendingOrderPrice) * pendingOrderQty, settings.currencySymbol)}
                  </span>
                )}
              </div>
              <input
                type="text"
                value={pendingOrderPrice}
                onChange={(e) => {
                  setPendingOrderPrice(formatWithSeparators(e.target.value));
                  setPendingOrderError('');
                }}
                placeholder="ປ້ອນລາຄາ ເຊັ່ນ: 150,000"
                className={`w-full bg-slate-950 border px-3 py-2.5 rounded-2xl text-base font-mono font-black text-amber-400 placeholder-slate-600 focus:outline-none ${
                  parseCleanNumber(pendingOrderPrice) <= 0
                    ? 'border-rose-500/80 focus:ring-2 focus:ring-rose-500'
                    : 'border-slate-700 focus:ring-2 focus:ring-emerald-500'
                }`}
              />

              {/* Quick Price Buttons */}
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                {[10000, 20000, 30000, 50000, 80000, 100000, 150000, 200000, 300000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => {
                      setPendingOrderPrice(formatWithSeparators(amt));
                      setPendingOrderError('');
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-mono text-slate-300 cursor-pointer"
                  >
                    +{amt.toLocaleString()}
                  </button>
                ))}
              </div>

              {parseCleanNumber(pendingOrderPrice) <= 0 && (
                <p className="text-[11px] text-rose-400 font-bold flex items-center gap-1 pt-0.5">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>ກະລຸນາປ້ອນລາຄາ (ຕ້ອງຫຼາຍກວ່າ 0 ₭ ບໍ່ສາມາດຂາຍ 0 ₭ ໄດ້)</span>
                </p>
              )}
            </div>

            {/* Seller Dropdown (Mandatory Selection) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-200">
                ພະນັກງານຂາຍ / ເສີບ (Server) <span className="text-rose-400">*</span>:
              </label>
              <select
                value={pendingOrderSellerId}
                onChange={(e) => {
                  setPendingOrderSellerId(e.target.value);
                  setPendingOrderError('');
                }}
                className={`w-full bg-slate-950 border px-3 py-2.5 rounded-2xl text-xs font-semibold focus:outline-none ${
                  !pendingOrderSellerId
                    ? 'border-rose-500/80 text-rose-300 focus:ring-2 focus:ring-rose-500'
                    : 'border-slate-700 text-emerald-300 focus:ring-2 focus:ring-emerald-500'
                }`}
              >
                <option value="">-- ກະລຸນາເລືອກຊື່ຜູ້ຂາຍ/ເສີບ (ຈຳເປັນ) --</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.role === 'admin' ? 'Admin' : 'ພະນັກງານ'})
                  </option>
                ))}
              </select>

              {!pendingOrderSellerId && (
                <p className="text-[11px] text-rose-400 font-bold flex items-center gap-1 pt-0.5">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>ທ່ານລືມເລືອກຊື່ຜູ້ຂາຍ! ກະລຸນາກົດເລືອກຊື່ພະນັກງານຂາຍກ່ອນ</span>
                </p>
              )}
            </div>

            {/* Error Message banner */}
            {pendingOrderError && (
              <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-500 text-rose-200 text-xs font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{pendingOrderError}</span>
              </div>
            )}

            {/* Action Buttons */}
            {(() => {
              const numericPrice = parseCleanNumber(pendingOrderPrice);
              const isPriceValid = numericPrice > 0;
              const isSellerValid = !!pendingOrderSellerId.trim();
              const canSubmit = isPriceValid && isSellerValid;

              return (
                <div className="flex gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingOrderItem(null);
                      setPendingOrderError('');
                    }}
                    className="flex-1 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer transition-colors"
                  >
                    ຍົກເລີກ
                  </button>

                  <button
                    type="button"
                    disabled={!canSubmit}
                    onClick={handleConfirmOrderWithPriceAndSeller}
                    className={`flex-2 py-3 px-4 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                      canSubmit
                        ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-600/30 cursor-pointer active:scale-95'
                        : 'bg-slate-800 text-slate-500 border border-slate-700/80 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    {!isPriceValid && !isSellerValid ? (
                      <span>❌ ປ້ອນລາຄາ & ເລືອກຜູ້ຂາຍກ່ອນ</span>
                    ) : !isPriceValid ? (
                      <span>{'❌ ປ້ອນລາຄາ (>0 ₭) ກ່ອນ'}</span>
                    ) : !isSellerValid ? (
                      <span>❌ ເລືອກຊື່ຜູ້ຂາຍ/ເສີບກ່ອນ</span>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          ຢືນຢັນສັ່ງເພີ່ມ ({formatCurrency(numericPrice * pendingOrderQty, settings.currencySymbol)})
                        </span>
                      </>
                    )}
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modal: Edit Room Time (ແກ້ໄຂເວລາເລີ່ມ, ສິ້ນສຸດ ແລະ ຊົ່ວໂມງຂອງຫ້ອງ) */}
      {editingTimeRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl text-white">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                    <span>ແກ້ໄຂເວລາ:</span>
                    <span className="text-amber-400 font-black">{editingTimeRoom.name}</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    ປັບເວລາເລີ່ມຕົ້ນ, ເວລາສິ້ນສຸດ ຫຼື ຈຳນວນຊົ່ວໂມງ
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingTimeRoom(null)}
                className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 mb-5">
              {editingTimeRoom.pricingType === 'open_time' && (
                <div className="p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5 animate-pulse" />
                  <div>
                    <div className="font-bold">ຮູບແບບ: ນັບຕາມເວລາຈິງ (ບໍ່ມີກຳນົດເວລາສິ້ນສຸດ)</div>
                    <div className="text-[11px] text-emerald-400/80 mt-0.5">
                      ທ່ານສາມາດປັບເວລາເລີ່ມຕົ້ນໄດ້ຕາມຕ້ອງການ ລະບົບຈະຄຳນວນຄ່າຫ້ອງຕາມເວລາຕົວຈິງເລີ່ມຈາກເວລານີ້.
                    </div>
                  </div>
                </div>
              )}

              {/* Start Time Field */}
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-bold flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-emerald-400" />
                    <span>ເວລາເລີ່ມຕົ້ນ (Start Time):</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const nowStr = toHHMM(new Date());
                      setEditStartTimeInput(nowStr);
                      const diff = computeDiffHours(nowStr, editEndTimeInput);
                      if (diff > 0) setEditBookedHours(diff);
                    }}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 underline font-semibold cursor-pointer"
                  >
                    ຕັ້ງເປັນຕອນນີ້
                  </button>
                </div>
                <input
                  type="time"
                  value={editStartTimeInput}
                  onChange={(e) => {
                    setEditStartTimeInput(e.target.value);
                    const diff = computeDiffHours(e.target.value, editEndTimeInput);
                    if (diff > 0) setEditBookedHours(diff);
                  }}
                  className="w-full bg-slate-900 border border-emerald-500/50 rounded-xl px-4 py-2 text-lg font-black text-emerald-300 font-mono text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <div className="flex items-center justify-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      const newStart = adjustHHMM(editStartTimeInput, -30);
                      setEditStartTimeInput(newStart);
                      const diff = computeDiffHours(newStart, editEndTimeInput);
                      if (diff > 0) setEditBookedHours(diff);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                  >
                    -30ນ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const newStart = adjustHHMM(editStartTimeInput, -15);
                      setEditStartTimeInput(newStart);
                      const diff = computeDiffHours(newStart, editEndTimeInput);
                      if (diff > 0) setEditBookedHours(diff);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                  >
                    -15ນ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const newStart = adjustHHMM(editStartTimeInput, 15);
                      setEditStartTimeInput(newStart);
                      const diff = computeDiffHours(newStart, editEndTimeInput);
                      if (diff > 0) setEditBookedHours(diff);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                  >
                    +15ນ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const newStart = adjustHHMM(editStartTimeInput, 30);
                      setEditStartTimeInput(newStart);
                      const diff = computeDiffHours(newStart, editEndTimeInput);
                      if (diff > 0) setEditBookedHours(diff);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                  >
                    +30ນ
                  </button>
                </div>
              </div>

              {/* End Time Field */}
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-bold flex items-center gap-1.5">
                    <Hourglass className="w-4 h-4 text-rose-400" />
                    <span>ເວລາສິ້ນສຸດ (Target End Time):</span>
                  </span>
                  <span className="text-[11px] font-mono text-amber-400 font-bold">
                    {computeDiffHours(editStartTimeInput, editEndTimeInput)} ຊົ່ວໂມງ
                  </span>
                </div>
                <input
                  type="time"
                  value={editEndTimeInput}
                  onChange={(e) => {
                    setEditEndTimeInput(e.target.value);
                    const diff = computeDiffHours(editStartTimeInput, e.target.value);
                    if (diff > 0) setEditBookedHours(diff);
                  }}
                  className="w-full bg-slate-900 border border-rose-500/50 rounded-xl px-4 py-2 text-lg font-black text-rose-300 font-mono text-center focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
                <div className="flex items-center justify-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      const newEnd = adjustHHMM(editEndTimeInput, -30);
                      setEditEndTimeInput(newEnd);
                      const diff = computeDiffHours(editStartTimeInput, newEnd);
                      if (diff > 0) setEditBookedHours(diff);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                  >
                    -30ນ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const newEnd = adjustHHMM(editEndTimeInput, 30);
                      setEditEndTimeInput(newEnd);
                      const diff = computeDiffHours(editStartTimeInput, newEnd);
                      if (diff > 0) setEditBookedHours(diff);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                  >
                    +30ນ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const newEnd = adjustHHMM(editEndTimeInput, 60);
                      setEditEndTimeInput(newEnd);
                      const diff = computeDiffHours(editStartTimeInput, newEnd);
                      if (diff > 0) setEditBookedHours(diff);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                  >
                    +1ຊມ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const newEnd = adjustHHMM(editEndTimeInput, 120);
                      setEditEndTimeInput(newEnd);
                      const diff = computeDiffHours(editStartTimeInput, newEnd);
                      if (diff > 0) setEditBookedHours(diff);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                  >
                    +2ຊມ
                  </button>
                </div>
              </div>

              {/* Booked Hours Shortcut Chips */}
              <div className="p-3 rounded-2xl bg-slate-850 border border-slate-750 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-bold">ກຳນົດໄລຍະເວລາໂດຍກົງ:</span>
                  <span className="text-amber-400 font-mono font-bold">{editBookedHours} ຊົ່ວໂມງ</span>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => {
                        setEditBookedHours(h);
                        const startD = createDateFromHHMM(editStartTimeInput, new Date());
                        const targetD = new Date(startD.getTime() + h * 60 * 60 * 1000);
                        setEditEndTimeInput(toHHMM(targetD));
                      }}
                      className={`py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        editBookedHours === h
                          ? 'bg-amber-500 border-amber-400 text-slate-950 font-black shadow-md'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {h} ຊມ
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditingTimeRoom(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                ຍົກເລີກ
              </button>
              <button
                type="button"
                onClick={handleSaveEditTime}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 via-rose-600 to-amber-600 hover:from-amber-500 hover:to-rose-500 text-white text-xs font-bold shadow-lg shadow-amber-600/30 cursor-pointer"
              >
                ບັນທຶກການແກ້ໄຂເວລາ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Transfer Room (ຍ້າຍຫ້ອງ KTV) */}
      {transferSourceRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg shadow-2xl text-white space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <ArrowRightLeft className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                    <span>ຍ້າຍຫ້ອງ KTV (Transfer Room)</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    ໂອນຍ້າຍເວລາໃຊ້ງານ, ລາຍການສັ່ງ, ແລະ ຍອດເງິນ ໄປຫ້ອງວ່າງໃໝ່
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isTransferring}
                onClick={() => setTransferSourceRoom(null)}
                className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Source Room Details Card */}
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">ຫ້ອງຕົ້ນທາງ (ປັດຈຸບັນ):</span>
                <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] font-bold">
                  ກຳລັງໃຊ້ງານ
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-lg font-black text-white">{transferSourceRoom.name}</span>
                <span className="text-xs font-mono font-bold text-amber-400">
                  ⏱ {formatElapsedTimer(transferSourceRoom.openedAt)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-slate-800/80">
                <span>ລາຍການສັ່ງ: {transferSourceRoom.orders.length} ລາຍການ</span>
                <span>
                  ລາຄາຊົ່ວໂມງ: {formatCurrency(transferSourceRoom.hourlyRate, settings.currencySymbol)}/ຊມ
                </span>
              </div>
            </div>

            {/* Transfer Direction Indicator */}
            <div className="flex items-center justify-center -my-2">
              <div className="p-2 rounded-full bg-slate-800 border border-slate-700 text-amber-400 shadow-md">
                <ArrowRightLeft className="w-4 h-4 rotate-90 sm:rotate-0" />
              </div>
            </div>

            {/* Destination Room Selection */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300">
                  ເລືອກຫ້ອງວ່າງປາຍທາງທີ່ຕ້ອງການຍ້າຍໄປ:
                </label>
                <span className="text-[11px] text-emerald-400 font-semibold">
                  ວ່າງ {rooms.filter((r) => r.status === 'available' && r.id !== transferSourceRoom.id).length} ຫ້ອງ
                </span>
              </div>

              {rooms.filter((r) => r.status === 'available' && r.id !== transferSourceRoom.id).length === 0 ? (
                <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs text-center space-y-1">
                  <AlertCircle className="w-6 h-6 mx-auto text-rose-400 mb-1" />
                  <p className="font-bold">ບໍ່ມີຫ້ອງວ່າງໃນຂະນະນີ້!</p>
                  <p className="text-[11px] text-slate-400">ທຸກຫ້ອງກຳລັງຖືກໃຊ້ງານຢູ່ ກະລຸນາເຊັກບິນ ຫຼື ເຄຼຍຫ້ອງວ່າງກ່ອນຍ້າຍ</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 max-h-48 overflow-y-auto pr-1">
                  {rooms
                    .filter((r) => r.status === 'available' && r.id !== transferSourceRoom.id)
                    .map((availRoom) => {
                      const isSelected = transferTargetRoomId === availRoom.id;
                      return (
                        <button
                          key={availRoom.id}
                          type="button"
                          onClick={() => setTransferTargetRoomId(availRoom.id)}
                          className={`p-3 rounded-2xl border text-left transition-all cursor-pointer relative ${
                            isSelected
                              ? 'bg-amber-500/15 border-amber-500 text-white shadow-md shadow-amber-500/20 ring-1 ring-amber-500'
                              : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300 hover:bg-slate-800/50'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-sm text-slate-100">{availRoom.name}</span>
                            {isSelected && (
                              <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center justify-between">
                            <span>{availRoom.capacity} ຄົນ</span>
                            <span className="font-mono text-emerald-400">
                              {formatCurrency(availRoom.hourlyRate, settings.currencySymbol)}/ຊມ
                            </span>
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Rate Choice if applicable and rates differ */}
            {(() => {
              const target = rooms.find((r) => r.id === transferTargetRoomId);
              if (
                target &&
                transferSourceRoom.pricingType !== 'package' &&
                target.hourlyRate !== transferSourceRoom.hourlyRate
              ) {
                return (
                  <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                    <span className="text-xs font-bold text-slate-300 block">
                      ລາຄາຊົ່ວໂມງຫ້ອງບໍ່ເທົ່າກັນ (ເລືອກລາຄາທີ່ຕ້ອງການໃຊ້):
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setTransferRateOption('keep_target')}
                        className={`p-2 rounded-xl border text-xs text-left transition-all cursor-pointer ${
                          transferRateOption === 'keep_target'
                            ? 'bg-amber-500/20 border-amber-500 text-amber-200 font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-400'
                        }`}
                      >
                        <div className="text-[10px] text-slate-400">ໃຊ້ລາຄາຫ້ອງໃໝ່:</div>
                        <div className="font-mono text-white">
                          {formatCurrency(target.hourlyRate, settings.currencySymbol)}/ຊມ
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTransferRateOption('keep_source')}
                        className={`p-2 rounded-xl border text-xs text-left transition-all cursor-pointer ${
                          transferRateOption === 'keep_source'
                            ? 'bg-amber-500/20 border-amber-500 text-amber-200 font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-400'
                        }`}
                      >
                        <div className="text-[10px] text-slate-400">ຮັກສາລາຄາຫ້ອງເດີມ:</div>
                        <div className="font-mono text-white">
                          {formatCurrency(transferSourceRoom.hourlyRate, settings.currencySymbol)}/ຊມ
                        </div>
                      </button>
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {/* Notice */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
              💡 <span className="font-semibold text-slate-300">ໝາຍເຫດ:</span> ເມື່ອຢືນຢັນແລ້ວ ຫ້ອງຕົ້ນທາງ ({transferSourceRoom.name}) ຈະຖືກເຄຼຍເປັນຫ້ອງວ່າງ (00:00:00) ແລະ ຫ້ອງປາຍທາງຈະເປີດໃຊ້ງານຕໍ່ເນື່ອງພ້ອມລາຍການອາຫານ/ເຄື່ອງດື່ມທັງໝົດທັນທີ.
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                disabled={isTransferring}
                onClick={() => setTransferSourceRoom(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                ຍົກເລີກ
              </button>
              <button
                type="button"
                disabled={
                  isTransferring ||
                  !transferTargetRoomId ||
                  rooms.filter((r) => r.status === 'available' && r.id !== transferSourceRoom.id).length === 0
                }
                onClick={handleExecuteTransferRoom}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 via-rose-600 to-amber-600 hover:from-amber-500 hover:to-rose-500 text-white text-xs font-bold shadow-lg shadow-amber-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
              >
                {isTransferring ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>ກຳລັງຍ້າຍຫ້ອງ...</span>
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    <span>ຢືນຢັນການຍ້າຍຫ້ອງ</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
