import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  Calendar,
  Layers,
  PieChart,
  FileSpreadsheet,
  Download,
  Filter,
  Beer,
  Coffee,
  UtensilsCrossed,
  DoorOpen,
  ArrowUpRight,
  Receipt,
  User,
  Users,
  UserCheck,
  Award,
  CheckCircle,
  Eye,
  EyeOff,
  Search,
  X,
  TrendingUp,
  Percent,
  Coins,
  PackageCheck,
  ChevronDown,
  Sparkles,
  ArrowRight,
  Trash2,
  ShieldAlert,
  AlertTriangle,
  Lock,
  KeyRound,
  CheckSquare,
  Square,
  RotateCcw,
  Printer,
  Clock,
  CheckCircle2,
  ExternalLink,
  Timer,
  Radio,
  PlayCircle,
  Mic2,
  ChevronUp,
  ShoppingBag,
  CalendarDays,
  CalendarRange,
  ListOrdered,
} from 'lucide-react';
import { BillRecord, Product, AppSettings, ProductCategory, Role, Room, RoomPackage } from '../types';
import { formatCurrency } from '../lib/storage';
import { normalizeImageUrl } from '../lib/imageUtils';
import {
  printReceiptAsImageViaBluetooth,
  getBluetoothStatus,
  isBluetoothBlockedError,
} from '../lib/bluetoothPrinter';
import {
  deduplicateBills,
  getLocalDateKey,
  getLocalMonthKey,
  calculatePackageBasedRoomCharge,
  calculateRoomSessionFee,
  isKtvRoomBill,
  resolveBillDurationMinutes,
  resolveBillRoomCharge,
  resolveBillEffectiveTotal,
} from '../lib/roomPricing';

interface SalesSummaryProps {
  bills: BillRecord[];
  products: Product[];
  settings: AppSettings;
  rooms?: Room[];
  packages?: RoomPackage[];
  onSyncAllToSheets?: () => void;
  isSyncingSheets?: boolean;
  currentRole?: Role;
  onDeleteBill?: (billId: string) => void;
  onDeleteBills?: (billIds: string[]) => void;
  onClearAllBills?: () => void;
  onReprintBill?: (bill: BillRecord) => void;
  bluetoothConnected?: boolean;
  onOpenBluetoothSetup?: () => void;
}

export const SalesSummary: React.FC<SalesSummaryProps> = ({
  bills,
  products,
  settings,
  rooms = [],
  packages = [],
  onSyncAllToSheets,
  isSyncingSheets,
  currentRole,
  onDeleteBill,
  onDeleteBills,
  onClearAllBills,
  onReprintBill,
  bluetoothConnected,
  onOpenBluetoothSetup,
}) => {
  // Choice 1: Overall Summary vs Choice 2: Itemized & Profit Breakdown vs Choice 3: Bills & Delete vs Choice 4: KTV Rooms & Time
  const [activeChoice, setActiveChoice] = useState<'overall' | 'itemized' | 'ktv_rooms' | 'bills'>('ktv_rooms');

  // Timeframe filter: daily, monthly, yearly, custom (using local calendar dates)
  const [timeframe, setTimeframe] = useState<'daily' | 'monthly' | 'yearly' | 'custom'>('daily');
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateKey());
  const [selectedMonth, setSelectedMonth] = useState<string>(getLocalMonthKey());
  const [selectedYear, setSelectedYear] = useState<string>(
    new Date().getFullYear().toString()
  );
  const [customStartDate, setCustomStartDate] = useState<string>(
    getLocalDateKey(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
  );
  const [customEndDate, setCustomEndDate] = useState<string>(getLocalDateKey());

  // Deduplicate bills in-memory by Bill Number / ID without ever mutating stored records
  const uniqueBills = useMemo(() => deduplicateBills(bills), [bills]);

  const fallbackRate = settings.defaultHourlyRate || 100000;
  const getResolvedRoomCharge = (bill: BillRecord) =>
    resolveBillRoomCharge(bill, packages, fallbackRate);
  const getResolvedBillTotal = (bill: BillRecord) =>
    resolveBillEffectiveTotal(bill, packages, fallbackRate);

  // Filters for Itemized view & Seller details
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedProductId, setSelectedProductId] = useState<string>('all');
  const [selectedSeller, setSelectedSeller] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'profit_desc' | 'revenue_desc' | 'qty_desc'>(
    'profit_desc'
  );

  // Bills Management & Bulk Actions
  const [billsSearchQuery, setBillsSearchQuery] = useState<string>('');
  const [billsTypeFilter, setBillsTypeFilter] = useState<'all' | 'ktv_room' | 'pos'>('all');
  const [billsTimeScope, setBillsTimeScope] = useState<'filtered' | 'all'>('filtered');
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(new Set());

  // Expandable bill rows for instant product inspection directly in tables
  const [expandedBillIds, setExpandedBillIds] = useState<Set<string>>(new Set());
  const toggleExpandBill = (billId: string) => {
    setExpandedBillIds((prev) => {
      const next = new Set(prev);
      if (next.has(billId)) next.delete(billId);
      else next.add(billId);
      return next;
    });
  };

  // KTV Room sub-tab: 'today_summary' | 'day_by_day' | 'rooms_ranking' | 'room_bills_log'
  const [ktvSubTab, setKtvSubTab] = useState<'today_summary' | 'day_by_day' | 'rooms_ranking' | 'room_bills_log'>('today_summary');

  // Expanded dates in Day-by-Day room summary table
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const toggleExpandDate = (dateStr: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  };

  // Bill inspect & receipt modal
  const [inspectedBill, setInspectedBill] = useState<BillRecord | null>(null);
  const [inspectedBillMode, setInspectedBillMode] = useState<'receipt' | 'financial' | 'items'>('items');
  const [inspectedItemSearchQuery, setInspectedItemSearchQuery] = useState<string>('');
  const [isPrintingBt, setIsPrintingBt] = useState<boolean>(false);
  const [printSuccess, setPrintSuccess] = useState<boolean>(false);
  const [printError, setPrintError] = useState<string>('');

  const handlePrintBillBluetooth = async (bill: BillRecord) => {
    setIsPrintingBt(true);
    setPrintError('');
    setPrintSuccess(false);
    try {
      const ok = await printReceiptAsImageViaBluetooth(bill, settings);
      if (ok) {
        setPrintSuccess(true);
        setTimeout(() => setPrintSuccess(false), 3000);
      } else {
        setPrintError('ບໍ່ສາມາດພິມຜ່ານ Bluetooth ໄດ້ ກະລຸນາກວດສອບເຄື່ອງພິມ');
      }
    } catch (err: any) {
      if (isBluetoothBlockedError(err)) {
        if (onOpenBluetoothSetup) onOpenBluetoothSetup();
      } else {
        setPrintError(err.message || 'ເກີດຂໍ້ຜິດພາດໃນການພິມ Bluetooth');
      }
    } finally {
      setIsPrintingBt(false);
    }
  };

  // In-App Admin Delete Confirmation Modal
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    mode: 'single' | 'filtered' | 'all' | 'selected';
    targetBill?: BillRecord;
    targetIds?: string[];
    count: number;
    totalAmount: number;
    title: string;
    description: string;
  }>({
    isOpen: false,
    mode: 'single',
    count: 0,
    totalAmount: 0,
    title: '',
    description: '',
  });

  const [adminPinInput, setAdminPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [showPinInput, setShowPinInput] = useState<boolean>(false);

  // Fast product lookup map by ID and normalized Name
  const productLookup = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => {
      map.set(p.id, p);
      if (p.name) {
        map.set(p.name.trim().toLowerCase(), p);
      }
    });
    return map;
  }, [products]);

  // Set quick date helpers (local calendar)
  const handleSetToday = () => {
    setTimeframe('daily');
    setSelectedDate(getLocalDateKey());
  };

  const handleSetYesterday = () => {
    setTimeframe('daily');
    setSelectedDate(getLocalDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  };

  const openDeleteSingleBill = (bill: BillRecord) => {
    if (currentRole !== 'admin') {
      alert('ຂໍອະໄພ! ພະນັກງານບໍ່ມີສິດລຶບໃບບິນ! ສະເພາະ Admin ເທົ່ານັ້ນ.');
      return;
    }
    const resolvedBillTotal = getResolvedBillTotal(bill);
    setAdminPinInput('');
    setPinError('');
    setShowPinInput(false);
    setDeleteModal({
      isOpen: true,
      mode: 'single',
      targetBill: bill,
      targetIds: [bill.id],
      count: 1,
      totalAmount: resolvedBillTotal,
      title: `ລຶບໃບບິນ "${bill.billNumber}"`,
      description: `ທ່ານກຳລັງຈະລຶບໃບບິນເລກທີ ${bill.billNumber} (${bill.roomName || 'POS'}) ຈຳນວນເງິນ ${formatCurrency(resolvedBillTotal, settings.currencySymbol)} ອອກຈາກລະບົບ`,
    });
  };

  const openDeleteFilteredBills = () => {
    if (currentRole !== 'admin') {
      alert('ຂໍອະໄພ! ພະນັກງານບໍ່ມີສິດລຶບໃບບິນ! ສະເພາະ Admin ເທົ່ານັ້ນ.');
      return;
    }
    const ids = filteredBills.map((b) => b.id);
    const sum = filteredBills.reduce((acc, b) => acc + getResolvedBillTotal(b), 0);
    setAdminPinInput('');
    setPinError('');
    setShowPinInput(false);
    setDeleteModal({
      isOpen: true,
      mode: 'filtered',
      targetIds: ids,
      count: ids.length,
      totalAmount: sum,
      title: `ລຶບຍອດຂາຍຕາມຊ່ວງເວລາ (${timeframeLabel})`,
      description: `ທ່ານກຳລັງຈະລຶບໃບບິນທັງໝົດ ${ids.length} ບິນ ໃນຊ່ວງເວລາ "${timeframeLabel}" ລວມຍອດຂາຍ ${formatCurrency(sum, settings.currencySymbol)} ອອກຈາກລະບົບ`,
    });
  };

  const openDeleteAllBills = () => {
    if (currentRole !== 'admin') {
      alert('ຂໍອະໄພ! ພະນັກງານບໍ່ມີສິດລຶບໃບບິນ! ສະເພາະ Admin ເທົ່ານັ້ນ.');
      return;
    }
    const ids = uniqueBills.map((b) => b.id);
    const sum = uniqueBills.reduce((acc, b) => acc + getResolvedBillTotal(b), 0);
    setAdminPinInput('');
    setPinError('');
    setShowPinInput(false);
    setDeleteModal({
      isOpen: true,
      mode: 'all',
      targetIds: ids,
      count: ids.length,
      totalAmount: sum,
      title: `⚠️ ລ້າງປະຫວັດບິນທັງໝົດໃນລະບົບ (${uniqueBills.length} ບິນ)`,
      description: `ເຕືອນ: ການກະທຳນີ້ຈະລຶບປະຫວັດໃບບິນ ແລະ ຍອດຂາຍທັງໝົດ ${uniqueBills.length} ບິນ ລວມຍອດເງິນ ${formatCurrency(sum, settings.currencySymbol)} ອອກຈາກລະບົບແບບຖາວອນ!`,
    });
  };

  const openDeleteSelectedBills = () => {
    if (currentRole !== 'admin') {
      alert('ຂໍອະໄພ! ພະນັກງານບໍ່ມີສິດລຶບໃບບິນ! ສະເພາະ Admin ເທົ່ານັ້ນ.');
      return;
    }
    const ids = Array.from(selectedBillIds);
    const selectedObjs = uniqueBills.filter((b) => selectedBillIds.has(b.id));
    const sum = selectedObjs.reduce((acc, b) => acc + getResolvedBillTotal(b), 0);
    setAdminPinInput('');
    setPinError('');
    setShowPinInput(false);
    setDeleteModal({
      isOpen: true,
      mode: 'selected',
      targetIds: ids,
      count: ids.length,
      totalAmount: sum,
      title: `ລຶບ ${ids.length} ໃບບິນທີ່ເລືອກ`,
      description: `ທ່ານກຳລັງຈະລຶບ ${ids.length} ໃບບິນທີ່ໄດ້ຕິກເລືອກ ລວມຍອດຂາຍ ${formatCurrency(sum, settings.currencySymbol)} ອອກຈາກລະບົບ`,
    });
  };

  const handleConfirmDelete = () => {
    if (currentRole !== 'admin') {
      alert('ຂໍອະໄພ! ພະນັກງານບໍ່ມີສິດລຶບຂໍ້ມູນ! ສະເພາະ Admin ເທົ່ານັ້ນ.');
      setDeleteModal((prev) => ({ ...prev, isOpen: false }));
      return;
    }
    const validPin = settings.adminPin || '8888';
    if (adminPinInput.trim() !== validPin && adminPinInput.trim() !== '8888') {
      setPinError('ລະຫັດ Admin PIN ບໍ່ຖືກຕ້ອງ! (ເລີ່ມຕົ້ນ: 8888)');
      return;
    }

    if (deleteModal.mode === 'single' && deleteModal.targetBill) {
      onDeleteBill?.(deleteModal.targetBill.id);
      if (inspectedBill?.id === deleteModal.targetBill.id) {
        setInspectedBill(null);
      }
    } else if (deleteModal.mode === 'filtered') {
      if (onDeleteBills) {
        onDeleteBills(deleteModal.targetIds || []);
      } else if (deleteModal.targetIds) {
        deleteModal.targetIds.forEach((id) => onDeleteBill?.(id));
      }
      setInspectedBill(null);
    } else if (deleteModal.mode === 'all') {
      onClearAllBills?.();
      setInspectedBill(null);
    } else if (deleteModal.mode === 'selected') {
      if (onDeleteBills) {
        onDeleteBills(deleteModal.targetIds || []);
      } else if (deleteModal.targetIds) {
        deleteModal.targetIds.forEach((id) => onDeleteBill?.(id));
      }
      setSelectedBillIds(new Set());
      setInspectedBill(null);
    }

    setDeleteModal((prev) => ({ ...prev, isOpen: false }));
  };

  const handleDeleteBill = (bill: BillRecord) => {
    if (currentRole !== 'admin') {
      alert('ຂໍອະໄພ! ພະນັກງານບໍ່ມີສິດລຶບໃບບິນ! ສະເພາະ Admin ເທົ່ານັ້ນ.');
      return;
    }
    openDeleteSingleBill(bill);
  };

  const handleClearAllBills = () => {
    if (currentRole !== 'admin') {
      alert('ຂໍອະໄພ! ພະນັກງານບໍ່ມີສິດລຶບໃບບິນ! ສະເພາະ Admin ເທົ່ານັ້ນ.');
      return;
    }
    openDeleteAllBills();
  };

  // Filter deduplicated bills strictly by chosen timeframe (using local calendar dates)
  const filteredBills = useMemo(() => {
    return uniqueBills.filter((b) => {
      const billDate = new Date(b.endTime);
      if (timeframe === 'daily') {
        return getLocalDateKey(billDate) === selectedDate;
      } else if (timeframe === 'monthly') {
        return getLocalMonthKey(billDate) === selectedMonth;
      } else if (timeframe === 'yearly') {
        return billDate.getFullYear().toString() === selectedYear;
      } else if (timeframe === 'custom') {
        const dateStr = getLocalDateKey(billDate);
        return dateStr >= customStartDate && dateStr <= customEndDate;
      }
      return true;
    });
  }, [uniqueBills, timeframe, selectedDate, selectedMonth, selectedYear, customStartDate, customEndDate]);

  // Collect all unique sellers across all bills
  const availableSellers = useMemo(() => {
    const sellersSet = new Set<string>();
    filteredBills.forEach((b) => {
      if (b.staffName && b.staffName.trim()) sellersSet.add(b.staffName.trim());
      b.items.forEach((it) => {
        if (it.sellerName && it.sellerName.trim()) sellersSet.add(it.sellerName.trim());
      });
    });
    return Array.from(sellersSet).sort();
  }, [filteredBills]);

  // Real-time Room & Usage Time Analytics (Checked-out bills + Live active rooms)
  const roomAnalytics = useMemo(() => {
    const todayLocalStr = getLocalDateKey();
    const todayLocalMonth = getLocalMonthKey();
    const isToday =
      timeframe === 'daily'
        ? selectedDate === todayLocalStr
        : timeframe === 'monthly'
        ? selectedMonth === todayLocalMonth
        : timeframe === 'yearly'
        ? selectedYear === new Date().getFullYear().toString()
        : timeframe === 'custom'
        ? todayLocalStr >= customStartDate && todayLocalStr <= customEndDate
        : true;

    // 1. Process Completed KTV Bills in filtered timeframe
    const completedRoomBills = filteredBills.filter(isKtvRoomBill);

    let checkedOutRoomRevenue = 0;
    let checkedOutPrepaidRevenue = 0;
    let checkedOutPostpaidRevenue = 0;
    let checkedOutDurationMinutes = 0;
    let checkedOutFoodDrinkTotal = 0;

    // Map to aggregate stats by room name
    const roomStatsMap = new Map<
      string,
      {
        roomId?: string;
        roomName: string;
        sessionsCount: number;
        totalMinutes: number;
        roomRevenue: number;
        prepaidRevenue: number;
        postpaidRevenue: number;
        foodDrinkRevenue: number;
        grandTotalRevenue: number;
        activeNow?: boolean;
        activeRoomData?: any;
      }
    >();

    // Helper to get or init room stats
    const getOrInitRoomStats = (name: string, id?: string) => {
      const trimmed = name.trim();
      let stat = roomStatsMap.get(trimmed);
      if (!stat) {
        stat = {
          roomId: id,
          roomName: trimmed,
          sessionsCount: 0,
          totalMinutes: 0,
          roomRevenue: 0,
          prepaidRevenue: 0,
          postpaidRevenue: 0,
          foodDrinkRevenue: 0,
          grandTotalRevenue: 0,
        };
        roomStatsMap.set(trimmed, stat);
      }
      return stat;
    };

    // Initialize all existing configured rooms so they all appear in the report
    rooms.forEach((r) => {
      getOrInitRoomStats(r.name, r.id);
    });

    completedRoomBills.forEach((b) => {
      const roomName = b.roomName || 'ຫ້ອງ KTV';
      const stat = getOrInitRoomStats(roomName, b.roomId);

      const durationMins = resolveBillDurationMinutes(b);
      const billRoomCharge = resolveBillRoomCharge(
        b,
        packages,
        settings.defaultHourlyRate || 100000
      );
      const isPrepaid = !!b.isRoomChargePaid;

      const foodDrink = b.items.reduce((s, it) => s + it.total, 0);

      checkedOutRoomRevenue += billRoomCharge;
      if (isPrepaid) {
        checkedOutPrepaidRevenue += billRoomCharge;
      } else {
        checkedOutPostpaidRevenue += billRoomCharge;
      }
      checkedOutDurationMinutes += durationMins;
      checkedOutFoodDrinkTotal += foodDrink;

      stat.sessionsCount += 1;
      stat.totalMinutes += durationMins;
      stat.roomRevenue += billRoomCharge;
      if (isPrepaid) {
        stat.prepaidRevenue += billRoomCharge;
      } else {
        stat.postpaidRevenue += billRoomCharge;
      }
      stat.foodDrinkRevenue += foodDrink;
      stat.grandTotalRevenue += billRoomCharge + foodDrink;
    });

    // 2. Process Currently Active / In-Use Rooms (if timeframe includes today)
    const activeRoomsList: {
      room: Room;
      elapsedMinutes: number;
      estimatedRoomFee: number;
      isPrepaid: boolean;
      ordersTotal: number;
      grandTotal: number;
      timerFormatted: string;
    }[] = [];

    let activeRoomsTotalFee = 0;
    let activeRoomsPrepaidFee = 0;
    let activeRoomsPostpaidFee = 0;
    let activeRoomsTotalMinutes = 0;
    let activeRoomsFoodDrinkTotal = 0;

    const now = Date.now();

    rooms.forEach((room) => {
      if (room.status === 'in_use' && room.openedAt) {
        const startMs = new Date(room.openedAt).getTime();
        const elapsedMins = Math.max(1, Math.floor((now - startMs) / 60000));

        // Calculate active room fee according to room pricing mode (package uses full package price)
        const isPrepaid = !!room.isPaid;
        const roomFee = calculateRoomSessionFee(
          room,
          packages,
          settings.defaultHourlyRate || 100000,
          elapsedMins
        );

        const ordersTotal = (room.orders || []).reduce((s, o) => s + o.price * o.quantity, 0);
        const grandTotal = roomFee + ordersTotal;

        const h = Math.floor(elapsedMins / 60);
        const m = elapsedMins % 60;
        const timerFormatted = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

        const activeItem = {
          room,
          elapsedMinutes: elapsedMins,
          estimatedRoomFee: roomFee,
          isPrepaid,
          ordersTotal,
          grandTotal,
          timerFormatted,
        };

        activeRoomsList.push(activeItem);

        activeRoomsTotalFee += roomFee;
        if (isPrepaid) {
          activeRoomsPrepaidFee += roomFee;
        } else {
          activeRoomsPostpaidFee += roomFee;
        }
        activeRoomsTotalMinutes += elapsedMins;
        activeRoomsFoodDrinkTotal += ordersTotal;

        // If current timeframe includes today, merge active room into roomStatsMap
        if (isToday) {
          const stat = getOrInitRoomStats(room.name, room.id);
          stat.activeNow = true;
          stat.activeRoomData = activeItem;
          stat.sessionsCount += 1;
          stat.totalMinutes += elapsedMins;
          stat.roomRevenue += roomFee;
          if (isPrepaid) {
            stat.prepaidRevenue += roomFee;
          } else {
            stat.postpaidRevenue += roomFee;
          }
          stat.foodDrinkRevenue += ordersTotal;
          stat.grandTotalRevenue += grandTotal;
        }
      }
    });

    // 3. Grand Totals (Checked-out + Active if today included)
    const grandRoomRevenue = checkedOutRoomRevenue + (isToday ? activeRoomsTotalFee : 0);
    const grandRoomPrepaidRevenue = checkedOutPrepaidRevenue + (isToday ? activeRoomsPrepaidFee : 0);
    const grandRoomPostpaidRevenue = checkedOutPostpaidRevenue + (isToday ? activeRoomsPostpaidFee : 0);
    const grandRoomTotalMinutes = checkedOutDurationMinutes + (isToday ? activeRoomsTotalMinutes : 0);
    const grandTotalSessions = completedRoomBills.length + (isToday ? activeRoomsList.length : 0);
    const grandFoodDrinkRevenue = checkedOutFoodDrinkTotal + (isToday ? activeRoomsFoodDrinkTotal : 0);
    const grandOverallRevenue = grandRoomRevenue + grandFoodDrinkRevenue;

    // Helper format minutes to "X ຊົ່ວໂມງ Y ນາທີ"
    const formatHoursMinutes = (
      totalMins: number
    ): { text: string; hours: number; minutes: number } => {
      const hours = Math.floor(totalMins / 60);
      const minutes = totalMins % 60;
      if (hours === 0 && minutes === 0) return { text: '00:00 (0 ນາທີ)', hours: 0, minutes: 0 };
      if (hours === 0) return { text: `${minutes} ນາທີ`, hours: 0, minutes };
      if (minutes === 0) return { text: `${hours} ຊົ່ວໂມງ`, hours, minutes: 0 };
      return { text: `${hours} ຊົ່ວໂມງ ${minutes} ນາທີ`, hours, minutes };
    };

    const perRoomRanking = Array.from(roomStatsMap.values()).sort(
      (a, b) => b.grandTotalRevenue - a.grandTotalRevenue
    );

    return {
      isToday,
      completedRoomBills,
      checkedOutRoomRevenue,
      checkedOutPrepaidRevenue,
      checkedOutPostpaidRevenue,
      checkedOutDurationMinutes,
      checkedOutFoodDrinkTotal,
      activeRoomsList,
      activeRoomsTotalFee,
      activeRoomsPrepaidFee,
      activeRoomsPostpaidFee,
      activeRoomsTotalMinutes,
      activeRoomsFoodDrinkTotal,
      grandRoomRevenue,
      grandRoomPrepaidRevenue,
      grandRoomPostpaidRevenue,
      grandRoomTotalMinutes,
      grandTotalSessions,
      grandFoodDrinkRevenue,
      grandOverallRevenue,
      formatHoursMinutes,
      perRoomRanking,
    };
  }, [
    filteredBills,
    rooms,
    packages,
    settings,
    timeframe,
    selectedDate,
    selectedMonth,
    selectedYear,
    customStartDate,
    customEndDate,
  ]);

  // Day-by-Day Room Opening Analytics (ວັນຕໍ່ວັນ: ເປີດກີ່ຫ້ອງ, ກີ່ຊົ່ວໂມງ, ໄດ້ເງິນເທົ່າໃດ)
  const dayByDayRoomAnalytics = useMemo(() => {
    const todayStr = getLocalDateKey();

    const dateMap = new Map<
      string,
      {
        dateStr: string;
        dateFormatted: string;
        dayOfWeek: string;
        isToday: boolean;
        roomSessionsCount: number;
        uniqueRoomsSet: Set<string>;
        totalMinutes: number;
        roomRevenue: number;
        prepaidRevenue: number;
        postpaidRevenue: number;
        foodDrinkRevenue: number;
        grandTotalRevenue: number;
        completedBills: BillRecord[];
        activeRooms: any[];
      }
    >();

    const getOrInitDay = (dateStr: string) => {
      let stat = dateMap.get(dateStr);
      if (!stat) {
        let dateFormatted = dateStr;
        let dayOfWeek = '';
        try {
          const parts = dateStr.split('-');
          if (parts.length === 3) {
            const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
            dateFormatted = d.toLocaleDateString('lo-LA', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            });
            dayOfWeek = d.toLocaleDateString('lo-LA', { weekday: 'short' });
          }
        } catch {
          dateFormatted = dateStr;
        }

        const isToday = dateStr === todayStr;

        stat = {
          dateStr,
          dateFormatted,
          dayOfWeek,
          isToday,
          roomSessionsCount: 0,
          uniqueRoomsSet: new Set<string>(),
          totalMinutes: 0,
          roomRevenue: 0,
          prepaidRevenue: 0,
          postpaidRevenue: 0,
          foodDrinkRevenue: 0,
          grandTotalRevenue: 0,
          completedBills: [],
          activeRooms: [],
        };
        dateMap.set(dateStr, stat);
      }
      return stat;
    };

    // Ensure today entry always exists
    getOrInitDay(todayStr);

    // Process all deduplicated completed room bills
    const allRoomBills = uniqueBills.filter(isKtvRoomBill);

    allRoomBills.forEach((b) => {
      const dateStr = getLocalDateKey(b.endTime);
      const day = getOrInitDay(dateStr);

      const durMins = resolveBillDurationMinutes(b);
      const billRoomCharge = resolveBillRoomCharge(
        b,
        packages,
        settings.defaultHourlyRate || 100000
      );
      const isPrepaid = !!b.isRoomChargePaid;
      const foodDrink = b.items.reduce((s, it) => s + it.total, 0);

      day.roomSessionsCount += 1;
      if (b.roomName) day.uniqueRoomsSet.add(b.roomName.trim());
      day.totalMinutes += durMins;
      day.roomRevenue += billRoomCharge;
      if (isPrepaid) {
        day.prepaidRevenue += billRoomCharge;
      } else {
        day.postpaidRevenue += billRoomCharge;
      }
      day.foodDrinkRevenue += foodDrink;
      day.grandTotalRevenue += billRoomCharge + foodDrink;
      day.completedBills.push(b);
    });

    // Merge currently active rooms into today's record
    const todayStat = getOrInitDay(todayStr);
    if (roomAnalytics.activeRoomsList && roomAnalytics.activeRoomsList.length > 0) {
      roomAnalytics.activeRoomsList.forEach((activeItem) => {
        todayStat.roomSessionsCount += 1;
        todayStat.uniqueRoomsSet.add(activeItem.room.name.trim());
        todayStat.totalMinutes += activeItem.elapsedMinutes;
        todayStat.roomRevenue += activeItem.estimatedRoomFee;
        if (activeItem.isPrepaid) {
          todayStat.prepaidRevenue += activeItem.estimatedRoomFee;
        } else {
          todayStat.postpaidRevenue += activeItem.estimatedRoomFee;
        }
        todayStat.foodDrinkRevenue += activeItem.ordersTotal;
        todayStat.grandTotalRevenue += activeItem.grandTotal;
        todayStat.activeRooms.push(activeItem);
      });
    }

    // Format daily list and sort descending
    const dailyList = Array.from(dateMap.values())
      .map((d) => {
        const uniqueRoomsList = Array.from(d.uniqueRoomsSet).sort();
        const hoursDecimal = Number((d.totalMinutes / 60).toFixed(1));
        const hoursFormatted = roomAnalytics.formatHoursMinutes(d.totalMinutes).text;
        return {
          ...d,
          uniqueRoomsCount: uniqueRoomsList.length,
          uniqueRoomsList,
          hoursDecimal,
          hoursFormatted,
        };
      })
      .sort((a, b) => b.dateStr.localeCompare(a.dateStr));

    const todayData = dailyList.find((d) => d.isToday) || {
      dateStr: todayStr,
      dateFormatted: 'ມື້ນີ້ (Today)',
      dayOfWeek: '',
      isToday: true,
      roomSessionsCount: 0,
      uniqueRoomsCount: 0,
      uniqueRoomsList: [],
      totalMinutes: 0,
      hoursDecimal: 0,
      hoursFormatted: '00:00 (0 ນາທີ)',
      roomRevenue: 0,
      prepaidRevenue: 0,
      postpaidRevenue: 0,
      foodDrinkRevenue: 0,
      grandTotalRevenue: 0,
      completedBills: [],
      activeRooms: [],
    };

    const totalAllDaysSessions = dailyList.reduce((acc, d) => acc + d.roomSessionsCount, 0);
    const totalAllDaysMinutes = dailyList.reduce((acc, d) => acc + d.totalMinutes, 0);
    const totalAllDaysRoomRevenue = dailyList.reduce((acc, d) => acc + d.roomRevenue, 0);
    const totalAllDaysFoodDrink = dailyList.reduce((acc, d) => acc + d.foodDrinkRevenue, 0);
    const totalAllDaysGrandRevenue = dailyList.reduce((acc, d) => acc + d.grandTotalRevenue, 0);

    return {
      dailyList,
      todayData,
      totalAllDaysSessions,
      totalAllDaysMinutes,
      totalAllDaysHoursFormatted: roomAnalytics.formatHoursMinutes(totalAllDaysMinutes).text,
      totalAllDaysRoomRevenue,
      totalAllDaysFoodDrink,
      totalAllDaysGrandRevenue,
    };
  }, [uniqueBills, packages, settings, roomAnalytics]);

  // Comprehensive Seller Performance Map (Sales, Cost, Gross Profit per seller + Room Time Fees Added!)
  const sellerPerformanceList = useMemo(() => {
    const sellerMap = new Map<
      string,
      {
        sellerName: string;
        totalUnits: number;
        itemsRevenue: number;
        roomRevenue: number;
        totalRevenue: number;
        totalCost: number;
        itemsProfit: number;
        grossProfit: number; // ກຳໄລທັງໝົດ = ກຳໄລສິນຄ້າ + ຄ່າເວລາເປີດຫ້ອງ
        profitMargin: number;
        billsHandled: number;
        roomSessions: number;
        topItems: Map<string, number>;
      }
    >();

    const getOrInitSeller = (name: string) => {
      const trimmed = (name && name.trim()) || 'ບໍ່ລະບຸຜູ້ຂາຍ';
      let entry = sellerMap.get(trimmed);
      if (!entry) {
        entry = {
          sellerName: trimmed,
          totalUnits: 0,
          itemsRevenue: 0,
          roomRevenue: 0,
          totalRevenue: 0,
          totalCost: 0,
          itemsProfit: 0,
          grossProfit: 0,
          profitMargin: 0,
          billsHandled: 0,
          roomSessions: 0,
          topItems: new Map<string, number>(),
        };
        sellerMap.set(trimmed, entry);
      }
      return entry;
    };

    // 1. Process Completed Bills
    filteredBills.forEach((b) => {
      const billStaffName = (b.staffName && b.staffName.trim()) || 'ບໍ່ລະບຸຜູ້ຂາຍ';
      const billStaff = getOrInitSeller(billStaffName);
      billStaff.billsHandled += 1;

      // Attribute Room Time Fee to the staff handling this bill
      if (isKtvRoomBill(b) || (b.roomCharge && b.roomCharge > 0) || b.isRoomChargePaid) {
        const billRoomCharge = resolveBillRoomCharge(
          b,
          packages,
          settings.defaultHourlyRate || 100000
        );

        if (billRoomCharge > 0) {
          billStaff.roomRevenue += billRoomCharge;
          billStaff.roomSessions += 1;
          billStaff.totalRevenue += billRoomCharge;
          // ADD ROOM TIME FEE DIRECTLY TO PROFIT!
          billStaff.grossProfit += billRoomCharge;
        }
      }

      // Attribute each item to item.sellerName, fallback to billStaffName
      b.items.forEach((item) => {
        const itemSellerName = (item.sellerName && item.sellerName.trim()) || billStaffName;
        const current = getOrInitSeller(itemSellerName);

        const matchedProduct =
          productLookup.get(item.productId) ||
          productLookup.get(item.productName.trim().toLowerCase());
        const costPerUnit =
          item.costPrice !== undefined
            ? item.costPrice
            : matchedProduct?.costPrice ?? 0;
        const itemCost = item.quantity * costPerUnit;
        const itemProfit = item.total - itemCost;

        current.totalUnits += item.quantity;
        current.itemsRevenue += item.total;
        current.totalRevenue += item.total;
        current.totalCost += itemCost;
        current.itemsProfit += itemProfit;
        // Add item profit to gross profit
        current.grossProfit += itemProfit;

        const curItemQty = current.topItems.get(item.productName) || 0;
        current.topItems.set(item.productName, curItemQty + item.quantity);
      });
    });

    // 2. Attribute Active Open Rooms if viewing today
    if (roomAnalytics.isToday && roomAnalytics.activeRoomsList.length > 0) {
      roomAnalytics.activeRoomsList.forEach((activeItem) => {
        const staffName =
          (activeItem.room.openedByStaffName && activeItem.room.openedByStaffName.trim()) ||
          'ບໍ່ລະບຸຜູ້ຂາຍ';
        const staff = getOrInitSeller(staffName);
        if (activeItem.estimatedRoomFee > 0) {
          staff.roomRevenue += activeItem.estimatedRoomFee;
          staff.roomSessions += 1;
          staff.totalRevenue += activeItem.estimatedRoomFee;
          staff.grossProfit += activeItem.estimatedRoomFee;
        }
      });
    }

    return Array.from(sellerMap.values())
      .map((s) => ({
        ...s,
        profitMargin: s.totalRevenue > 0 ? (s.grossProfit / s.totalRevenue) * 100 : 0,
      }))
      .sort((a, b) => b.grossProfit - a.grossProfit);
  }, [filteredBills, productLookup, packages, settings, roomAnalytics]);

  // Calculate Overall Store Totals (strictly within filteredBills using resolved room fees)
  const totalRevenue = filteredBills.reduce((acc, b) => acc + getResolvedBillTotal(b), 0);
  const totalRoomCharge = filteredBills.reduce((acc, b) => acc + getResolvedRoomCharge(b), 0);
  const totalItemsCharge = filteredBills.reduce(
    (acc, b) => acc + b.items.reduce((sum, item) => sum + item.total, 0),
    0
  );
  const totalDiscount = filteredBills.reduce((acc, b) => acc + b.discount, 0);
  const totalCash = filteredBills
    .filter((b) => b.payment.method === 'cash')
    .reduce((acc, b) => acc + getResolvedBillTotal(b), 0);
  const totalTransfer = filteredBills
    .filter((b) => b.payment.method === 'transfer')
    .reduce((acc, b) => acc + getResolvedBillTotal(b), 0);

  // Helper to compute cost and profit for a single bill
  const getBillCostAndProfit = (b: BillRecord) => {
    let billItemsCost = 0;
    let billItemsRevenue = 0;
    b.items.forEach((item) => {
      const matched =
        productLookup.get(item.productId) ||
        productLookup.get(item.productName.trim().toLowerCase());
      const cost =
        item.costPrice !== undefined ? item.costPrice : matched?.costPrice ?? 0;
      billItemsCost += item.quantity * cost;
      billItemsRevenue += item.total;
    });
    const resolvedTotal = getResolvedBillTotal(b);
    // Bill profit = Net bill total (including room & minus discounts) - items cost
    const billProfit = resolvedTotal - billItemsCost;
    const margin = resolvedTotal > 0 ? (billProfit / resolvedTotal) * 100 : 0;
    return { billItemsCost, billItemsRevenue, billProfit, margin };
  };

  // Calculate product-level stats, cost of goods sold, profit, and seller details
  const {
    itemizedList,
    filteredItemizedList,
    summaryStats,
  } = useMemo(() => {
    const itemMap = new Map<
      string,
      {
        productId: string;
        productName: string;
        category: ProductCategory;
        unit: string;
        costPrice: number;
        salePriceAvg: number;
        totalQty: number;
        totalCost: number;
        totalRevenue: number;
        grossProfit: number;
        profitMargin: number;
        sellers: Map<
          string,
          { qty: number; revenue: number; cost: number; profit: number }
        >;
        imageUrl?: string;
      }
    >();

    filteredBills.forEach((b) => {
      b.items.forEach((item) => {
        const matchedProduct =
          productLookup.get(item.productId) ||
          productLookup.get(item.productName.trim().toLowerCase());

        const costPerUnit =
          item.costPrice !== undefined
            ? item.costPrice
            : matchedProduct?.costPrice ?? 0;

        const category = matchedProduct?.category || 'drink';
        const imageUrl = matchedProduct?.imageUrl;

        const existing = itemMap.get(item.productId) || {
          productId: item.productId,
          productName: item.productName,
          category,
          unit: item.unit,
          costPrice: costPerUnit,
          salePriceAvg: item.price,
          totalQty: 0,
          totalCost: 0,
          totalRevenue: 0,
          grossProfit: 0,
          profitMargin: 0,
          sellers: new Map<
            string,
            { qty: number; revenue: number; cost: number; profit: number }
          >(),
          imageUrl,
        };

        const itemTotalCost = item.quantity * costPerUnit;
        const itemGrossProfit = item.total - itemTotalCost;

        existing.totalQty += item.quantity;
        existing.totalCost += itemTotalCost;
        existing.totalRevenue += item.total;
        existing.costPrice = costPerUnit;

        const sellerName =
          (item.sellerName && item.sellerName.trim()) ||
          (b.staffName && b.staffName.trim()) ||
          'ບໍ່ລະບຸຜູ້ຂາຍ';

        const curSellerData = existing.sellers.get(sellerName) || {
          qty: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
        };

        curSellerData.qty += item.quantity;
        curSellerData.revenue += item.total;
        curSellerData.cost += itemTotalCost;
        curSellerData.profit += itemGrossProfit;

        existing.sellers.set(sellerName, curSellerData);
        itemMap.set(item.productId, existing);
      });
    });

    // Compute gross profit & margin for each item
    const fullList = Array.from(itemMap.values()).map((item) => {
      const grossProfit = item.totalRevenue - item.totalCost;
      const profitMargin =
        item.totalRevenue > 0 ? (grossProfit / item.totalRevenue) * 100 : 0;
      const salePriceAvg =
        item.totalQty > 0 ? Math.round(item.totalRevenue / item.totalQty) : item.salePriceAvg;

      return {
        ...item,
        salePriceAvg,
        grossProfit,
        profitMargin,
      };
    });

    // Filter by specific product, category, search query, and SELLER
    const filtered = fullList
      .map((item) => {
        // If a specific seller is selected, scope this item's quantities & profits to that seller
        if (selectedSeller !== 'all') {
          const sellerData = item.sellers.get(selectedSeller);
          if (!sellerData || sellerData.qty <= 0) {
            return null;
          }
          return {
            ...item,
            totalQty: sellerData.qty,
            totalRevenue: sellerData.revenue,
            totalCost: sellerData.cost,
            grossProfit: sellerData.profit,
            profitMargin:
              sellerData.revenue > 0 ? (sellerData.profit / sellerData.revenue) * 100 : 0,
          };
        }
        return item;
      })
      .filter((item): item is NonNullable<typeof item> => {
        if (!item) return false;
        // Product selector filter
        if (selectedProductId !== 'all' && item.productId !== selectedProductId) {
          return false;
        }
        // Category filter
        if (selectedCategory !== 'all' && item.category !== selectedCategory) {
          return false;
        }
        // Search query filter
        if (searchQuery.trim()) {
          const query = searchQuery.trim().toLowerCase();
          return item.productName.toLowerCase().includes(query);
        }
        return true;
      });

    // Sort list
    filtered.sort((a, b) => {
      if (sortBy === 'profit_desc') return b.grossProfit - a.grossProfit;
      if (sortBy === 'revenue_desc') return b.totalRevenue - a.totalRevenue;
      if (sortBy === 'qty_desc') return b.totalQty - a.totalQty;
      if (sortBy === 'margin_desc') return b.profitMargin - a.profitMargin;
      return 0;
    });

    // Overall Cost & Profit calculation across the filtered selection
    const selTotalQty = filtered.reduce((sum, i) => sum + i.totalQty, 0);
    const selTotalRevenue = filtered.reduce((sum, i) => sum + i.totalRevenue, 0);
    const selTotalCost = filtered.reduce((sum, i) => sum + i.totalCost, 0);
    const selGrossProfit = selTotalRevenue - selTotalCost;
    const selProfitMargin =
      selTotalRevenue > 0 ? (selGrossProfit / selTotalRevenue) * 100 : 0;

    // Overall Cost & Profit across ALL items sold in this timeframe
    const allItemsCost = fullList.reduce((sum, i) => sum + i.totalCost, 0);
    const allItemsRevenue = fullList.reduce((sum, i) => sum + i.totalRevenue, 0);
    const allItemsProfit = allItemsRevenue - allItemsCost;
    const allStoreGrossProfit = totalRevenue - allItemsCost; // Room + items - discounts - product cost

    return {
      itemizedList: fullList,
      filteredItemizedList: filtered,
      summaryStats: {
        selTotalQty,
        selTotalRevenue,
        selTotalCost,
        selGrossProfit,
        selProfitMargin,
        allItemsCost,
        allItemsRevenue,
        allItemsProfit,
        allStoreGrossProfit,
      },
    };
  }, [
    filteredBills,
    productLookup,
    selectedProductId,
    selectedCategory,
    selectedSeller,
    searchQuery,
    sortBy,
    totalRevenue,
  ]);

  // Timeframe label for display (parsed safely in local calendar time)
  const timeframeLabel = useMemo(() => {
    if (timeframe === 'daily') {
      const parts = selectedDate.split('-');
      const d =
        parts.length === 3
          ? new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0)
          : new Date(selectedDate);
      return `ວັນທີ ${d.toLocaleDateString('lo-LA', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`;
    } else if (timeframe === 'monthly') {
      const [year, month] = selectedMonth.split('-');
      const d = new Date(parseInt(year), parseInt(month) - 1, 1);
      return `ເດືອນ ${d.toLocaleDateString('lo-LA', { month: 'long', year: 'numeric' })}`;
    } else if (timeframe === 'yearly') {
      return `ປະຈຳປີ ${selectedYear}`;
    } else {
      return `ຊ່ວງວັນທີ ${customStartDate} ຫາ ${customEndDate}`;
    }
  }, [timeframe, selectedDate, selectedMonth, selectedYear, customStartDate, customEndDate]);

  // Period Spotlight for Choice 4 View 1 (strictly follows active timeframe / selectedDate filter)
  const selectedPeriodRoomSpotlight = useMemo(() => {
    const activeRooms = roomAnalytics.isToday ? roomAnalytics.activeRoomsList : [];
    const uniqueRoomsSet = new Set<string>();
    roomAnalytics.completedRoomBills.forEach((b) => {
      if (b.roomName && b.roomName.trim()) uniqueRoomsSet.add(b.roomName.trim());
    });
    activeRooms.forEach((a) => {
      if (a.room?.name && a.room.name.trim()) uniqueRoomsSet.add(a.room.name.trim());
    });
    const uniqueRoomsList = Array.from(uniqueRoomsSet).sort();
    return {
      roomSessionsCount: roomAnalytics.grandTotalSessions,
      uniqueRoomsCount: uniqueRoomsList.length,
      uniqueRoomsList,
      completedBills: roomAnalytics.completedRoomBills,
      activeRooms,
      hoursFormatted: roomAnalytics.formatHoursMinutes(roomAnalytics.grandRoomTotalMinutes).text,
      hoursDecimal: Number((roomAnalytics.grandRoomTotalMinutes / 60).toFixed(1)),
      roomRevenue: roomAnalytics.grandRoomRevenue,
      prepaidRevenue: roomAnalytics.grandRoomPrepaidRevenue,
      postpaidRevenue: roomAnalytics.grandRoomPostpaidRevenue,
      foodDrinkRevenue: roomAnalytics.grandFoodDrinkRevenue,
      grandTotalRevenue: roomAnalytics.grandOverallRevenue,
    };
  }, [roomAnalytics]);

  const totalAllStoreRevenue = useMemo(
    () => uniqueBills.reduce((acc, b) => acc + resolveBillEffectiveTotal(b, packages, fallbackRate), 0),
    [uniqueBills, packages, fallbackRate]
  );

  // Filtered bills for the dedicated Bills Management View
  const managedBills = useMemo(() => {
    const sourceBills = billsTimeScope === 'filtered' ? filteredBills : uniqueBills;
    return sourceBills.filter((b) => {
      // Type filter
      if (billsTypeFilter === 'ktv_room' && !isKtvRoomBill(b)) return false;
      if (billsTypeFilter === 'pos' && isKtvRoomBill(b)) return false;
      // Search query
      if (billsSearchQuery.trim()) {
        const q = billsSearchQuery.trim().toLowerCase();
        const numMatch = b.billNumber.toLowerCase().includes(q);
        const roomMatch = (b.roomName || '').toLowerCase().includes(q);
        const staffMatch = (b.staffName || '').toLowerCase().includes(q);
        const itemMatch = b.items.some((it) => it.productName.toLowerCase().includes(q));
        if (!numMatch && !roomMatch && !staffMatch && !itemMatch) return false;
      }
      return true;
    });
  }, [uniqueBills, filteredBills, billsTimeScope, billsTypeFilter, billsSearchQuery]);

  // Export CSV of product sales, profit & sellers
  const handleExportCsv = () => {
    try {
      const headers = [
        'ລຳດັບ',
        'ລະຫັດສິນຄ້າ',
        'ຊື່ສິນຄ້າ',
        'ໝວດໝູ່',
        'ຫົວໜ່ວຍ',
        'ລາຄາຕົ້ນທຶນ',
        'ລາຄາຂາຍສະເລ່ຍ',
        'ຈຳນວນທີ່ຂາຍ',
        'ຕົ້ນທຶນລວມ',
        'ຍອດຂາຍລວມ',
        'ຍອດກຳໄລ (ຍອດຂາຍ - ຕົ້ນທຶນ)',
        'ລາຍລະອຽດຜູ້ຂາຍ',
      ];

      const rows = filteredItemizedList.map((item, idx) => {
        const sellersStr = Array.from(item.sellers.entries())
          .map(([seller, data]) => `${seller}: ${data.qty}${item.unit} (ກຳໄລ: ${data.profit})`)
          .join('; ');

        return [
          idx + 1,
          `"${item.productId}"`,
          `"${item.productName}"`,
          item.category,
          item.unit,
          item.costPrice,
          item.salePriceAvg,
          item.totalQty,
          item.totalCost,
          item.totalRevenue,
          item.grossProfit,
          `"${sellersStr}"`,
        ];
      });

      const csvContent =
        '\uFEFF' +
        [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `689KTV_Profit_Report_${timeframe}_${Date.now()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('ດາວໂຫຼດ CSV ບໍ່ສຳເລັດ: ' + e.message);
    }
  };

  // Helper for category badge
  const renderCategoryBadge = (category: ProductCategory) => {
    switch (category) {
      case 'beer':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
            <Beer className="w-2.5 h-2.5" /> ເບຍ
          </span>
        );
      case 'drink':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30 flex items-center gap-1">
            <Coffee className="w-2.5 h-2.5" /> ເຄື່ອງດື່ມ
          </span>
        );
      case 'food':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
            <UtensilsCrossed className="w-2.5 h-2.5" /> ອາຫານ
          </span>
        );
      case 'snack':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            ຂອງກິນຫຼິ້ນ
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-700 text-slate-300">
            ທົ່ວໄປ
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Top Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center shadow-lg shadow-rose-500/20">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-100 flex items-center gap-2">
                <span>ສະຫຼຸບຍອດຂາຍ & ຕົ້ນທຶນ-ກຳໄລ 689 KTV</span>
              </h1>
              <p className="text-xs text-slate-400">
                ຄຳນວນຍອດຂາຍສິນຄ້າ, ຕົ້ນທຶນນຳເຂົ້າ, ກຳໄລສຸດທິ (ຍອດຂາຍ - ຕົ້ນທຶນ) ແລະ ລາຍລະອຽດຜູ້ຂາຍແຕ່ລະຄົນ
              </p>
            </div>
          </div>
        </div>

        {/* Choice 4 (KTV Rooms), Choice 1 (Overall), Choice 2 (Itemized), Choice 3 (Bills) Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-800/90 p-1.5 rounded-2xl border border-slate-700/80 w-full sm:w-auto">
          <button
            onClick={() => setActiveChoice('ktv_rooms')}
            className={`flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeChoice === 'ktv_rooms'
                ? 'bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600 text-white shadow-md shadow-purple-500/30 font-black'
                : 'text-purple-300 hover:text-white bg-purple-950/40 border border-purple-800/50'
            }`}
          >
            <Mic2 className="w-3.5 h-3.5 text-purple-300" />
            <span>Choice 4: 🎤 ຫ້ອງ KTV & ເວລາ</span>
            {roomAnalytics.activeRoomsList.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-0.5" title="ມີຫ້ອງກຳລັງເປີດຢູ່ຕອນນີ້" />
            )}
          </button>
          <button
            onClick={() => setActiveChoice('overall')}
            className={`flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeChoice === 'overall'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Choice 1: ສະຫຼຸບລວມ & ຜູ້ຂາຍ</span>
          </button>
          <button
            onClick={() => setActiveChoice('itemized')}
            className={`flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeChoice === 'itemized'
                ? 'bg-gradient-to-r from-amber-500 to-emerald-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Choice 2: ສິນຄ້າ & ກຳໄລ</span>
          </button>
          <button
            onClick={() => setActiveChoice('bills')}
            className={`flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeChoice === 'bills'
                ? 'bg-gradient-to-r from-purple-600 to-rose-600 text-white shadow-md shadow-rose-600/30 font-black'
                : 'text-rose-300 hover:text-white bg-rose-950/40 border border-rose-900/50'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Choice 3: ປະຫວັດບິນ & ລຶບ ({uniqueBills.length})</span>
          </button>
        </div>
      </div>

      {/* Timeframe Filter Bar (Day, Month, Year, Custom) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg space-y-3">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          {/* Timeframe Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 w-full lg:w-auto">
            <span className="text-xs font-bold text-slate-400 mr-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              <span>ຊ່ວງເວລາ:</span>
            </span>
            <button
              onClick={() => setTimeframe('daily')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                timeframe === 'daily'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              ລາຍວັນ (Daily)
            </button>
            <button
              onClick={() => setTimeframe('monthly')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                timeframe === 'monthly'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              ລາຍເດືອນ (Monthly)
            </button>
            <button
              onClick={() => setTimeframe('yearly')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                timeframe === 'yearly'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              ລາຍປີ (Yearly)
            </button>
            <button
              onClick={() => setTimeframe('custom')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                timeframe === 'custom'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              ກຳນົດເອງ (Custom)
            </button>

            {/* Quick shortcuts for Daily */}
            {timeframe === 'daily' && (
              <div className="flex items-center gap-1 ml-1 border-l border-slate-700 pl-2">
                <button
                  onClick={handleSetToday}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 cursor-pointer"
                >
                  ມື້ນີ້
                </button>
                <button
                  onClick={handleSetYesterday}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  ມື້ວານນີ້
                </button>
              </div>
            )}
          </div>

          {/* Date Selector input depending on timeframe */}
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            {timeframe === 'daily' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">ເລືອກວັນທີ:</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
            )}

            {timeframe === 'monthly' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">ເລືອກເດືອນ:</span>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
            )}

            {timeframe === 'yearly' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">ເລືອກປີ:</span>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500 cursor-pointer"
                >
                  {[2024, 2025, 2026, 2027, 2028, 2029].map((y) => (
                    <option key={y} value={y.toString()}>
                      ປີ {y}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {timeframe === 'custom' && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>ແຕ່:</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
                <span>ຫາ:</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
            )}

            {/* Google Sheets Sync Button */}
            {onSyncAllToSheets && (
              <button
                onClick={onSyncAllToSheets}
                disabled={isSyncingSheets}
                className="px-3 py-1.5 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>{isSyncingSheets ? 'ກຳລັງຊິ້ງ...' : 'ຊິ້ງລົງ Google Sheets'}</span>
              </button>
            )}

            {/* Export CSV Button */}
            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all border border-slate-700 cursor-pointer"
              title="ດາວໂຫຼດໄຟລ໌ Excel/CSV"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>ດາວໂຫຼດ CSV</span>
            </button>
          </div>
        </div>

        {/* Selected Period Badge */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
          <div className="text-slate-400 flex items-center gap-2">
            <span>ກຳລັງສະແດງ:</span>
            <span className="px-2.5 py-0.5 rounded-lg bg-rose-500/10 text-rose-300 font-bold border border-rose-500/20">
              {timeframeLabel}
            </span>
            {selectedSeller !== 'all' && (
              <span className="px-2.5 py-0.5 rounded-lg bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30 flex items-center gap-1">
                <User className="w-3 h-3" />
                <span>ຜູ້ຂາຍ: {selectedSeller}</span>
              </span>
            )}
          </div>
          <div className="text-slate-400 text-[11px]">
            ພົບທັງໝົດ <span className="font-mono font-bold text-amber-300">{filteredBills.length}</span> ໃບບິນ
          </div>
        </div>
      </div>

      {/* Admin Sales Deletion Control Bar (Accessible strictly to Admin) */}
      {currentRole === 'admin' && (
        <div className="bg-gradient-to-r from-slate-900 via-rose-950/25 to-slate-900 border border-rose-900/40 rounded-3xl p-4 sm:p-5 shadow-xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-950/90 border border-rose-700/60 flex items-center justify-center text-rose-400 shadow-md shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-black text-slate-100 flex items-center gap-1.5">
                  <span>ສູນຈັດການລຶບຂໍ້ມູນຍອດຂາຍ (Admin Sales Deletion)</span>
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  🔒 Admin PIN
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                ທຸກບິນໃນລະບົບ: <span className="font-bold text-amber-300 font-mono">{uniqueBills.length} ບິນ</span> ({formatCurrency(totalAllStoreRevenue, settings.currencySymbol)}) | ຊ່ວງເວລານີ້: <span className="font-bold text-rose-300 font-mono">{filteredBills.length} ບິນ</span> ({formatCurrency(totalRevenue, settings.currencySymbol)})
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <button
              type="button"
              onClick={openDeleteFilteredBills}
              disabled={filteredBills.length === 0}
              className="flex-1 sm:flex-none px-3.5 py-2.5 rounded-2xl bg-rose-950/70 hover:bg-rose-900 border border-rose-800 text-rose-200 hover:text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              title={`ລຶບ ${filteredBills.length} ໃບບິນໃນຊ່ວງເວລານີ້`}
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>ລຶບຍອດຂາຍຊ່ວງເວລານີ້ ({filteredBills.length} ບິນ)</span>
            </button>

            <button
              type="button"
              onClick={openDeleteAllBills}
              disabled={uniqueBills.length === 0}
              className="flex-1 sm:flex-none px-3.5 py-2.5 rounded-2xl bg-red-600 hover:bg-red-500 text-white text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-red-600/25 disabled:opacity-40 disabled:cursor-not-allowed"
              title="ລຶບປະຫວັດບິນທັງໝົດໃນລະບົບ"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
              <span>ລ້າງປະຫວັດບິນທັງໝົດ</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveChoice('bills')}
              className={`flex-1 sm:flex-none px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border ${
                activeChoice === 'bills'
                  ? 'bg-amber-500 text-slate-950 border-amber-400 font-black shadow-md'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>ຈັດການລາຍບິນ ({uniqueBills.length})</span>
            </button>
          </div>
        </div>
      )}

      {/* CHOICE 2: ITEMIZED PRODUCT SALES & PROFIT + SELLER DETAILS */}
      {activeChoice === 'itemized' && (
        <div className="space-y-6">
          {/* PRODUCT & SELLER FILTER BAR */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <Filter className="w-4 h-4 text-amber-500" />
                  <span>ເລືອກສິນຄ້າ ຫຼື ເລືອກຜູ້ຂາຍສະເພາະ (Filter Products & Sellers)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  ເລືອກສິນຄ້າ ຫຼື ພະນັກງານຂາຍເພື່ອຄຳນວນຍອດຂາຍ, ຕົ້ນທຶນ ແລະ ກຳໄລ (ຍອດຂາຍ - ຕົ້ນທຶນ = ກຳໄລ)
                </p>
              </div>

              {/* Reset filter button */}
              {(selectedProductId !== 'all' || selectedCategory !== 'all' || selectedSeller !== 'all' || searchQuery) && (
                <button
                  onClick={() => {
                    setSelectedProductId('all');
                    setSelectedCategory('all');
                    setSelectedSeller('all');
                    setSearchQuery('');
                  }}
                  className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-400 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all border border-slate-700"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>ລ້າງຕົວກອງ (Reset)</span>
                </button>
              )}
            </div>

            {/* Filter Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {/* Filter 1: Specific Product Combobox */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 block">
                  ເລືອກສິນຄ້າສະເພາະ:
                </label>
                <div className="relative">
                  <select
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 appearance-none cursor-pointer"
                  >
                    <option value="all">⭐ ທຸກລາຍການສິນຄ້າ (All Items)</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.unit})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-2.5 pointer-events-none" />
                </div>
              </div>

              {/* Filter 2: Seller / Staff Selector (REQUESTED FEATURE) */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-purple-300 block flex items-center gap-1">
                  <UserCheck className="w-3 h-3 text-purple-400" />
                  <span>ເລືອກຜູ້ຂາຍ/ພະນັກງານ:</span>
                </label>
                <div className="relative">
                  <select
                    value={selectedSeller}
                    onChange={(e) => setSelectedSeller(e.target.value)}
                    className="w-full bg-slate-800 border border-purple-500/40 rounded-xl px-3 py-2 text-xs text-purple-200 font-semibold focus:outline-none focus:ring-1 focus:ring-purple-500 appearance-none cursor-pointer"
                  >
                    <option value="all">👥 ຜູ້ຂາຍທັງໝົດ (All Sellers)</option>
                    {availableSellers.map((seller) => (
                      <option key={seller} value={seller}>
                        👤 {seller}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-purple-400 absolute right-3 top-2.5 pointer-events-none" />
                </div>
              </div>

              {/* Filter 3: Category Filter */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 block">
                  ໝວດໝູ່ສິນຄ້າ:
                </label>
                <div className="relative">
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 appearance-none cursor-pointer"
                  >
                    <option value="all">ທຸກໝວດໝູ່ (All Categories)</option>
                    <option value="beer">🍺 ເບຍ / ເຄື່ອງດື່ມມຶນເມົາ</option>
                    <option value="drink">🥤 ເຄື່ອງດື່ມ / ນ້ຳອັດລົມ / ນ້ຳດື່ມ</option>
                    <option value="food">🍲 ອາຫານ / ກັບແກ້ມ</option>
                    <option value="snack">🍿 ຂອງກິນຫຼິ້ນ</option>
                    <option value="service">🛎️ ບໍລິການ / ອື່ນໆ</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-2.5 pointer-events-none" />
                </div>
              </div>

              {/* Filter 4: Search Box */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 block">
                  ຄົ້ນຫາຊື່ສິນຄ້າ:
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ພິມຊື່ສິນຄ້າ..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Filter 5: Sort Option */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 block">
                  ຮຽງລຳດັບຕາມ:
                </label>
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 appearance-none cursor-pointer"
                  >
                    <option value="profit_desc">💰 ກຳໄລຫຼາຍສຸດ (Top Profit)</option>
                    <option value="revenue_desc">📈 ຍອດຂາຍສູງສຸດ (Top Revenue)</option>
                    <option value="qty_desc">📦 ຈຳນວນຂາຍດີສຸດ (Top Units Sold)</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-2.5 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          {/* FINANCIAL KPI CARDS: PROFIT, COST, REVENUE FOR SELECTED PRODUCT(S) & SELLER */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Revenue */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="font-semibold">
                  {selectedSeller !== 'all' ? `ຍອດຂາຍຂອງ (${selectedSeller})` : 'ຍອດຂາຍສິນຄ້າລວມ'}
                </span>
                <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <Coins className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-amber-400 tracking-tight">
                {formatCurrency(summaryStats.selTotalRevenue, settings.currencySymbol)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                <span>ຂາຍໄດ້ທັງໝົດ</span>
                <span className="font-bold text-slate-300 font-mono">
                  {summaryStats.selTotalQty.toLocaleString()}
                </span>
                <span>ໜ່ວຍ</span>
              </p>
            </div>

            {/* Card 2: Total Import Cost */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="font-semibold">
                  {selectedSeller !== 'all' ? `ຕົ້ນທຶນສິນຄ້າ (${selectedSeller})` : 'ຕົ້ນທຶນນຳເຂົ້າລວມ'}
                </span>
                <span className="p-2 rounded-xl bg-rose-500/10 text-rose-400">
                  <PackageCheck className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-rose-400 tracking-tight">
                {formatCurrency(summaryStats.selTotalCost, settings.currencySymbol)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                ຄຳນວນຈາກ: ລາຄານຳເຂົ້າ × ຈຳນວນຂາຍ
              </p>
            </div>

            {/* Card 3: Gross Profit (Revenue - Cost) */}
            <div className="bg-gradient-to-br from-emerald-950/60 to-slate-900 border-2 border-emerald-500/40 rounded-3xl p-5 shadow-xl relative overflow-hidden">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>ຍອດກຳໄລ (ຍອດຂາຍ - ຕົ້ນທຶນ)</span>
                </span>
                <span className="p-1.5 rounded-xl bg-emerald-500/20 text-emerald-300">
                  <TrendingUp className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-emerald-400 tracking-tight">
                {formatCurrency(summaryStats.selGrossProfit, settings.currencySymbol)}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-emerald-300/80">
                <span>ຄິດໄລ່: ຍອດຂາຍລວມ - ຕົ້ນທຶນສິນຄ້າ</span>
                <span className="font-bold text-emerald-300">
                  {summaryStats.selGrossProfit >= 0 ? 'ກຳໄລ' : 'ຂາດທຶນ'}
                </span>
              </div>
            </div>

            {/* Card 4: Quantity & Store Overview */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="font-semibold">ຈຳນວນລາຍການທີ່ສະແດງ</span>
                <span className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
                  <Layers className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-purple-400 tracking-tight">
                {filteredItemizedList.length} <span className="text-sm font-sans font-bold">ລາຍການ</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-800 pt-1">
                <span>ກຳໄລສະເລ່ຍ/ໜ່ວຍ:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {summaryStats.selTotalQty > 0
                    ? formatCurrency(
                        Math.round(summaryStats.selGrossProfit / summaryStats.selTotalQty),
                        settings.currencySymbol
                      )
                    : '0 ' + settings.currencySymbol}
                </span>
              </div>
            </div>
          </div>

          {/* TABLE: DETAILED PRODUCT COST & PROFIT BREAKDOWN WITH SELLERS */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-emerald-400" />
                  <span>
                    ຕາຕະລາງລາຍລະອຽດຕົ້ນທຶນ, ກຳໄລ ແລະ ຜູ້ຂາຍ ({filteredItemizedList.length} ລາຍການ)
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  ສູດຄຳນວນ: ຍອດກຳໄລ = ຍອດຂາຍລວມ - (ລາຄາຕົ້ນທຶນນຳເຂົ້າ × ຈຳນວນທີ່ຂາຍໄດ້)
                </p>
              </div>

              <div className="text-xs text-slate-400">
                ສະແດງຕາມ {timeframeLabel}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-3 text-center w-12">#</th>
                    <th className="py-3 px-4 min-w-[200px]">ລາຍການສິນຄ້າ (Product)</th>
                    <th className="py-3 px-3 text-right">ຕົ້ນທຶນ/ໜ່ວຍ</th>
                    <th className="py-3 px-3 text-right">ລາຄາຂາຍ/ໜ່ວຍ</th>
                    <th className="py-3 px-3 text-center">ຈຳນວນທີ່ຂາຍ</th>
                    <th className="py-3 px-3 text-right">ຕົ້ນທຶນລວມ</th>
                    <th className="py-3 px-4 text-right">ຍອດຂາຍລວມ</th>
                    <th className="py-3 px-4 text-right">ຍອດກຳໄລ (Profit)</th>
                    <th className="py-3 px-4 min-w-[220px]">ລາຍລະອຽດຜູ້ຂາຍ & ກຳໄລທີ່ສ້າງໄດ້</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredItemizedList.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center text-slate-500">
                        <div className="max-w-xs mx-auto space-y-2">
                          <PackageCheck className="w-8 h-8 mx-auto text-slate-600" />
                          <p className="font-semibold text-slate-400">
                            ບໍ່ພົບລາຍການຂາຍສິນຄ້າໃນຊ່ວງເວລານີ້
                          </p>
                          <p className="text-[11px] text-slate-500">
                            ລອງປ່ຽນວັນທີ, ເດືອນ, ປີ ຫຼື ປັບຕົວກອງສິນຄ້າ/ຜູ້ຂາຍໃໝ່
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredItemizedList.map((item, idx) => {
                      const sellersArr = Array.from(item.sellers.entries());
                      const isProfitable = item.grossProfit > 0;

                      return (
                        <tr
                          key={item.productId}
                          className="hover:bg-slate-800/40 transition-colors group"
                        >
                          {/* Col 1: Index */}
                          <td className="py-3 px-3 text-center text-slate-500 font-mono font-bold">
                            #{idx + 1}
                          </td>

                          {/* Col 2: Product info */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              {item.imageUrl ? (
                                <img
                                  src={normalizeImageUrl(item.imageUrl)}
                                  alt={item.productName}
                                  className="w-8 h-8 rounded-lg object-cover border border-slate-700 shrink-0"
                                  onError={(e) => {
                                    (e.target as any).style.display = 'none';
                                  }}
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-slate-400">
                                  {item.category === 'beer' ? (
                                    <Beer className="w-4 h-4 text-amber-400" />
                                  ) : item.category === 'food' ? (
                                    <UtensilsCrossed className="w-4 h-4 text-rose-400" />
                                  ) : (
                                    <Coffee className="w-4 h-4 text-blue-400" />
                                  )}
                                </div>
                              )}
                              <div>
                                <div className="font-bold text-slate-100 flex items-center gap-1.5">
                                  <span>{item.productName}</span>
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {renderCategoryBadge(item.category)}
                                  <span className="text-[10px] text-slate-400">
                                    ຫົວໜ່ວຍ: {item.unit}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Col 3: Cost Price / Unit */}
                          <td className="py-3 px-3 text-right font-mono text-slate-400">
                            {formatCurrency(item.costPrice, settings.currencySymbol)}
                          </td>

                          {/* Col 4: Average Sale Price / Unit */}
                          <td className="py-3 px-3 text-right font-mono text-slate-300">
                            {formatCurrency(item.salePriceAvg, settings.currencySymbol)}
                          </td>

                          {/* Col 5: Total Qty Sold */}
                          <td className="py-3 px-3 text-center">
                            <span className="font-mono text-sm font-black text-amber-400">
                              {item.totalQty.toLocaleString()}
                            </span>{' '}
                            <span className="text-[11px] text-slate-400">{item.unit}</span>
                          </td>

                          {/* Col 6: Total Cost */}
                          <td className="py-3 px-3 text-right font-mono font-semibold text-rose-400">
                            {formatCurrency(item.totalCost, settings.currencySymbol)}
                          </td>

                          {/* Col 7: Total Revenue */}
                          <td className="py-3 px-4 text-right font-mono font-bold text-amber-300 text-sm">
                            {formatCurrency(item.totalRevenue, settings.currencySymbol)}
                          </td>

                          {/* Col 8: Gross Profit (Highlight) */}
                          <td className="py-3 px-4 text-right">
                            <span
                              className={`font-mono font-black text-sm px-2 py-0.5 rounded-lg inline-block ${
                                isProfitable
                                  ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/60'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {formatCurrency(item.grossProfit, settings.currencySymbol)}
                            </span>
                          </td>

                          {/* Sellers Breakdown with Qty & Profit */}
                          <td className="py-3 px-4">
                            {sellersArr.length > 0 ? (
                              <div className="flex flex-col gap-1 max-w-[240px]">
                                {sellersArr.map(([sellerName, data]) => (
                                  <div
                                    key={sellerName}
                                    className="bg-slate-800/80 border border-purple-500/30 rounded-lg p-1.5 text-[11px] flex items-center justify-between gap-1"
                                  >
                                    <div className="flex items-center gap-1 font-semibold text-purple-300 truncate">
                                      <User className="w-3 h-3 shrink-0 text-purple-400" />
                                      <span className="truncate">{sellerName}:</span>
                                      <span className="text-amber-300 font-mono">
                                        {data.qty} {item.unit}
                                      </span>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/50 px-1 py-0.5 rounded">
                                        ກຳໄລ: +{formatCurrency(data.profit, '')}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-500 text-[11px]">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {/* Table Footer Totals */}
                {filteredItemizedList.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-950 border-t-2 border-slate-700 font-bold text-xs">
                      <td colSpan={4} className="py-3.5 px-4 text-slate-300">
                        ລວມຍອດສິນຄ້າທີ່ເລືອກ ({filteredItemizedList.length} ລາຍການ):
                      </td>
                      <td className="py-3.5 px-3 text-center font-mono font-black text-amber-400">
                        {summaryStats.selTotalQty.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono font-black text-rose-400">
                        {formatCurrency(summaryStats.selTotalCost, settings.currencySymbol)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-black text-amber-300 text-sm">
                        {formatCurrency(summaryStats.selTotalRevenue, settings.currencySymbol)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-black text-emerald-400 text-sm">
                        {formatCurrency(summaryStats.selGrossProfit, settings.currencySymbol)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CHOICE 1: OVERALL SUMMARY & STORE FINANCIAL SNAPSHOT + SELLER PERFORMANCE */}
      {activeChoice === 'overall' && (
        <div className="space-y-6">
          {/* Active Rooms Real-time Alert Banner if any rooms in use (only when selected timeframe includes today) */}
          {roomAnalytics.isToday && roomAnalytics.activeRoomsList.length > 0 && (
            <div className="bg-gradient-to-r from-purple-950/70 via-slate-900 to-rose-950/60 border border-purple-500/40 rounded-3xl p-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shrink-0">
                  <Mic2 className="w-5 h-5 animate-pulse text-purple-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                    <h4 className="font-bold text-sm text-white">
                      ກຳລັງເປີດໃຊ້ງານຢູ່ຕອນນີ້ {roomAnalytics.activeRoomsList.length} ຫ້ອງ (Real-time Live)
                    </h4>
                  </div>
                  <p className="text-xs text-purple-200/80">
                    ຄ່າຫ້ອງສະສົມຕອນນີ້: {formatCurrency(roomAnalytics.activeRoomsTotalFee, settings.currencySymbol)} • ເວລາສະສົມ: {roomAnalytics.formatHoursMinutes(roomAnalytics.activeRoomsTotalMinutes).text}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveChoice('ktv_rooms')}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md shadow-purple-600/30 flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <span>ເບິ່ງລາຍລະອຽດຫ້ອງ KTV</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* 5 Cards Stat Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Card 1: Total Revenue */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>ຍອດຂາຍລວມທັງໝົດ</span>
                <span className="p-1.5 rounded-xl bg-rose-500/10 text-rose-400">
                  <ArrowUpRight className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-rose-400">
                {formatCurrency(totalRevenue, settings.currencySymbol)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                ຈຳນວນ {filteredBills.length} ໃບບິນ
              </p>
            </div>

            {/* Card 2: Room Revenue & Total Hours (Enhanced Real-time) */}
            <div
              onClick={() => setActiveChoice('ktv_rooms')}
              className="bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-purple-500/50 rounded-3xl p-5 shadow-lg relative overflow-hidden transition-all cursor-pointer group"
              title="ກົດເພື່ອເບິ່ງລາຍລະອຽດຫ້ອງ KTV & ເວລາ"
            >
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="font-bold text-purple-300 flex items-center gap-1.5">
                  <Mic2 className="w-3.5 h-3.5 text-purple-400" />
                  <span>ຄ່າເປີດຫ້ອງ KTV & ເວລາ</span>
                </span>
                <span className="p-1.5 rounded-xl bg-purple-500/10 text-purple-400 group-hover:scale-110 transition-transform">
                  <DoorOpen className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-purple-400">
                {formatCurrency(roomAnalytics.grandRoomRevenue, settings.currencySymbol)}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-amber-300 font-bold mt-1">
                <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>ເວລາລວມ: {roomAnalytics.formatHoursMinutes(roomAnalytics.grandRoomTotalMinutes).text}</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1.5 flex flex-wrap gap-1">
                <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
                  ເຊັກບິນ: {formatCurrency(roomAnalytics.checkedOutRoomRevenue, '')}
                </span>
                {roomAnalytics.activeRoomsList.length > 0 && (
                  <span className="bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 px-1.5 py-0.5 rounded flex items-center gap-1 font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    ເປີດຢູ່: {formatCurrency(roomAnalytics.activeRoomsTotalFee, '')} ({roomAnalytics.activeRoomsList.length} ຫ້ອງ)
                  </span>
                )}
              </div>
            </div>

            {/* Card 3: Food & Drinks Revenue */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>ຄ່າເຄື່ອງດື່ມ & ອາຫານ</span>
                <span className="p-1.5 rounded-xl bg-amber-500/10 text-amber-400">
                  <Beer className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-amber-400">
                {formatCurrency(totalItemsCharge, settings.currencySymbol)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {((totalItemsCharge / (totalRevenue || 1)) * 100).toFixed(1)}% ຂອງຍອດຂາຍ
              </p>
            </div>

            {/* Card 4: Total Import Cost of Goods */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>ຕົ້ນທຶນສິນຄ້ານຳເຂົ້າ</span>
                <span className="p-1.5 rounded-xl bg-rose-500/10 text-rose-400">
                  <PackageCheck className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-rose-400">
                {formatCurrency(summaryStats.allItemsCost, settings.currencySymbol)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                ຕົ້ນທຶນເຄື່ອງດື່ມ-ອາຫານ
              </p>
            </div>

            {/* Card 5: Store Gross Profit (Enhanced with Room Time Fee) */}
            <div className="bg-gradient-to-br from-emerald-950/60 to-slate-900 border-2 border-emerald-500/40 rounded-3xl p-5 shadow-xl relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-emerald-400 mb-2">
                <span className="font-bold">ກຳໄລລວມທັງໝົດ (+ຄ່າເວລາເປີດຫ້ອງ)</span>
                <span className="p-1.5 rounded-xl bg-emerald-500/20 text-emerald-300">
                  <TrendingUp className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-emerald-400">
                {formatCurrency(
                  summaryStats.allItemsProfit + roomAnalytics.grandRoomRevenue,
                  settings.currencySymbol
                )}
              </div>
              <p className="text-[11px] text-emerald-300/80 mt-1">
                ກຳໄລສິນຄ້າ ({formatCurrency(summaryStats.allItemsProfit, '')}) + ຄ່າເວລາເປີດຫ້ອງ ({formatCurrency(roomAnalytics.grandRoomRevenue, '')})
              </p>
            </div>
          </div>

          {/* DEDICATED SELLER PERFORMANCE & PROFIT TABLE (WITH ROOM TIME FEES ADDED TO PROFIT) */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-400" />
                  <span>ສະຫຼຸບລາຍລະອຽດຜູ້ຂາຍ / ພະນັກງານ (ລວມຄ່າເວລາເປີດຫ້ອງເຂົ້າໃນກຳໄລ)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  ສະແດງຍອດຂາຍສິນຄ້າ, ຄ່າເວລາເປີດຫ້ອງ, ຕົ້ນທຶນ ແລະ <strong className="text-emerald-300">ກຳໄລລວມທັງໝົດ (ກຳໄລສິນຄ້າ + ຄ່າເວລາເປີດຫ້ອງ)</strong>
                </p>
              </div>
              <div className="text-xs text-slate-400">
                ມີຜູ້ຂາຍທັງໝົດ <span className="font-bold text-purple-300 font-mono">{sellerPerformanceList.length}</span> ຄົນ
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 uppercase font-black">
                    <th className="py-3 px-3 text-center w-12">ອັນດັບ</th>
                    <th className="py-3 px-4">ຊື່ຜູ້ຂາຍ / ພະນັກງານ</th>
                    <th className="py-3 px-3 text-center">ຈຳນວນສິນຄ້າ</th>
                    <th className="py-3 px-4 text-right">ຍອດຂາຍສິນຄ້າ</th>
                    <th className="py-3 px-4 text-right text-purple-300">ຄ່າເວລາເປີດຫ້ອງ</th>
                    <th className="py-3 px-4 text-right">ຍອດຂາຍລວມ</th>
                    <th className="py-3 px-4 text-right">ຕົ້ນທຶນສິນຄ້າ</th>
                    <th className="py-3 px-4 text-right text-emerald-400">ກຳໄລລວມ (+ຄ່າຫ້ອງ)</th>
                    <th className="py-3 px-4 text-center">ການດຳເນີນການ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sellerPerformanceList.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-slate-500">
                        ຍັງບໍ່ມີຂໍ້ມູນການຂາຍຂອງພະນັກງານໃນຊ່ວງເວລານີ້
                      </td>
                    </tr>
                  ) : (
                    sellerPerformanceList.map((seller, idx) => (
                      <tr key={seller.sellerName} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-3 text-center font-mono font-bold">
                          {idx === 0 ? (
                            <span className="p-1 rounded bg-amber-500/20 text-amber-300 inline-flex items-center justify-center">
                              🥇
                            </span>
                          ) : idx === 1 ? (
                            <span className="p-1 rounded bg-slate-700 text-slate-200 inline-flex items-center justify-center">
                              🥈
                            </span>
                          ) : idx === 2 ? (
                            <span className="p-1 rounded bg-amber-800/20 text-amber-400 inline-flex items-center justify-center">
                              🥉
                            </span>
                          ) : (
                            <span className="text-slate-500">#{idx + 1}</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-100 flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-purple-950/80 border border-purple-800 flex items-center justify-center text-purple-300 text-xs font-bold shrink-0">
                              {seller.sellerName.slice(0, 1)}
                            </div>
                            <div>
                              <span>{seller.sellerName}</span>
                              {seller.roomSessions > 0 && (
                                <div className="text-[10px] text-purple-400/80 font-normal">
                                  ດູແລ {seller.roomSessions} ຮອບຫ້ອງ
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-bold text-amber-400">
                          {seller.totalUnits.toLocaleString()} ໜ່ວຍ
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-slate-300">
                          {formatCurrency(seller.itemsRevenue, settings.currencySymbol)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-purple-300">
                          {formatCurrency(seller.roomRevenue, settings.currencySymbol)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-amber-300">
                          {formatCurrency(seller.totalRevenue, settings.currencySymbol)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-rose-400">
                          {formatCurrency(seller.totalCost, settings.currencySymbol)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="font-mono font-black text-emerald-400 text-sm">
                            <span className="bg-emerald-950/70 border border-emerald-800/60 px-2 py-0.5 rounded-lg inline-block">
                              +{formatCurrency(seller.grossProfit, settings.currencySymbol)}
                            </span>
                          </div>
                          {(seller.roomRevenue > 0 || seller.itemsProfit > 0) && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              ສິນຄ້າ: +{formatCurrency(seller.itemsProfit, '')}
                              {seller.roomRevenue > 0 && ` • ຫ້ອງ: +${formatCurrency(seller.roomRevenue, '')}`}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => {
                              setSelectedSeller(seller.sellerName);
                              setActiveChoice('itemized');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-purple-600/80 hover:bg-purple-500 text-white text-[11px] font-semibold flex items-center gap-1 mx-auto transition-all cursor-pointer shadow-sm"
                          >
                            <span>ເບິ່ງສິນຄ້າທີ່ຂາຍ</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {sellerPerformanceList.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-950 border-t-2 border-slate-700 font-bold text-xs">
                      <td colSpan={2} className="py-3.5 px-4 text-slate-300">
                        ລວມຜູ້ຂາຍທັງໝົດ ({sellerPerformanceList.length} ຄົນ):
                      </td>
                      <td className="py-3.5 px-3 text-center font-mono font-black text-amber-400">
                        {sellerPerformanceList.reduce((sum, s) => sum + s.totalUnits, 0).toLocaleString()} ໜ່ວຍ
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-black text-slate-300">
                        {formatCurrency(
                          sellerPerformanceList.reduce((sum, s) => sum + s.itemsRevenue, 0),
                          settings.currencySymbol
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-black text-purple-300">
                        {formatCurrency(
                          sellerPerformanceList.reduce((sum, s) => sum + s.roomRevenue, 0),
                          settings.currencySymbol
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-black text-amber-300">
                        {formatCurrency(
                          sellerPerformanceList.reduce((sum, s) => sum + s.totalRevenue, 0),
                          settings.currencySymbol
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-black text-rose-400">
                        {formatCurrency(
                          sellerPerformanceList.reduce((sum, s) => sum + s.totalCost, 0),
                          settings.currencySymbol
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-black text-emerald-400 text-base">
                        +{formatCurrency(
                          sellerPerformanceList.reduce((sum, s) => sum + s.grossProfit, 0),
                          settings.currencySymbol
                        )}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Payment Split & Additional Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
              <h4 className="text-xs font-bold text-slate-300 mb-3 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-emerald-400" />
                <span>ຊ່ອງທາງຊຳລະເງິນ (Payment Split)</span>
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-800">
                  <span className="text-slate-400">💵 ເງິນສົດ (Cash):</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {formatCurrency(totalCash, settings.currencySymbol)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-400">📱 ໂອນ / QR Transfer:</span>
                  <span className="font-mono font-bold text-blue-400">
                    {formatCurrency(totalTransfer, settings.currencySymbol)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
              <h4 className="text-xs font-bold text-slate-300 mb-3 flex items-center gap-2">
                <Percent className="w-4 h-4 text-amber-400" />
                <span>ສ່ວນຫຼຸດທີ່ມອບໃຫ້ (Discounts Given)</span>
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-800">
                  <span className="text-slate-400">ສ່ວນຫຼຸດລວມ:</span>
                  <span className="font-mono font-bold text-rose-400">
                    -{formatCurrency(totalDiscount, settings.currencySymbol)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-400">ສະເລ່ຍຕໍ່ບິນ:</span>
                  <span className="font-mono font-bold text-slate-300">
                    {filteredBills.length > 0
                      ? formatCurrency(
                          Math.round(totalDiscount / filteredBills.length),
                          settings.currencySymbol
                        )
                      : '0 ' + settings.currencySymbol}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
              <h4 className="text-xs font-bold text-slate-300 mb-3 flex items-center gap-2">
                <PackageCheck className="w-4 h-4 text-purple-400" />
                <span>ກຳໄລສະເພາະສິນຄ້າ (Food & Drinks Profit)</span>
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-800">
                  <span className="text-slate-400">ກຳໄລສິນຄ້າ (ບໍ່ລວມຄ່າຫ້ອງ):</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {formatCurrency(summaryStats.allItemsProfit, settings.currencySymbol)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-400">ຍອດຂາຍສິນຄ້າລວມ:</span>
                  <span className="font-mono font-bold text-amber-300">
                    {formatCurrency(summaryStats.allItemsRevenue, settings.currencySymbol)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Bills History Table with Cost & Profit per Bill */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-rose-500" />
                <span>ປະຫວັດໃບບິນໃນຊ່ວງເວລານີ້ ({filteredBills.length} ບິນ)</span>
              </h3>

              {currentRole === 'admin' && (
                <div className="flex items-center gap-2">
                  {filteredBills.length > 0 && (
                    <button
                      type="button"
                      onClick={openDeleteFilteredBills}
                      className="px-3 py-1.5 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 hover:text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                      title={`Admin ລຶບ ${filteredBills.length} ບິນໃນຊ່ວງເວລານີ້`}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>ລຶບຊ່ວງເວລານີ້ ({filteredBills.length})</span>
                    </button>
                  )}
                  {onClearAllBills && uniqueBills.length > 0 && (
                    <button
                      type="button"
                      onClick={openDeleteAllBills}
                      className="px-3 py-1.5 rounded-xl bg-red-950/80 hover:bg-red-900 border border-red-800 text-red-300 hover:text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                      title="Admin ລ້າງປະຫວັດບິນທັງໝົດ"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span>ລ້າງທັງໝົດ</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 uppercase">
                    <th className="py-3 px-4">ເລກທີບິນ</th>
                    <th className="py-3 px-4">ເວລາ</th>
                    <th className="py-3 px-4">ປະເພດ / ຫ້ອງ</th>
                    <th className="py-3 px-4">ລາຍການສິນຄ້າທີ່ສັ່ງ (Items)</th>
                    <th className="py-3 px-4">ພະນັກງານ/ຜູ້ຂາຍ</th>
                    <th className="py-3 px-4 text-right">ຄ່າຫ້ອງ</th>
                    <th className="py-3 px-4 text-right">ຕົ້ນທຶນສິນຄ້າ</th>
                    <th className="py-3 px-4 text-right">ຍອດສຸດທິ</th>
                    <th className="py-3 px-4 text-right">ກຳໄລບິນ (Profit)</th>
                    <th className="py-3 px-4 text-center">ເບິ່ງ / ລຶບ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredBills.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-500">
                        ບໍ່ພົບໃບບິນໃນຊ່ວງເວລານີ້
                      </td>
                    </tr>
                  ) : (
                    filteredBills.map((b) => {
                      const { billItemsCost, billProfit } = getBillCostAndProfit(b);
                      const resolvedRoomCharge = getResolvedRoomCharge(b);
                      const resolvedBillTotal = getResolvedBillTotal(b);
                      const isExpanded = expandedBillIds.has(b.id);
                      return (
                        <React.Fragment key={b.id}>
                          <tr className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-4 font-mono font-bold text-amber-400">
                              {b.billNumber}
                            </td>
                            <td className="py-3 px-4 text-slate-400">
                              {new Date(b.endTime).toLocaleTimeString('lo-LA')}
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  b.type === 'ktv_room'
                                     ? 'bg-purple-950/80 text-purple-300 border border-purple-800'
                                     : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {b.roomName || 'ຂາຍໜ້າຮ້ານ (POS)'}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="space-y-1">
                                {b.items.length === 0 ? (
                                  <span className="text-slate-500 text-[11px] italic">
                                    (ບໍ່ມີສິນຄ້າ / ຄ່າຫ້ອງລ້ວນ)
                                  </span>
                                ) : (
                                  <>
                                    <div className="flex flex-wrap items-center gap-1 max-w-[260px]">
                                      {b.items.slice(0, 3).map((it, idx) => (
                                        <span
                                          key={idx}
                                          className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-200 inline-flex items-center gap-1"
                                          title={`${it.productName} ${it.quantity} ${it.unit} (${formatCurrency(it.total, settings.currencySymbol)})`}
                                        >
                                          <span className="truncate max-w-[110px]">{it.productName}</span>
                                          <span className="font-black text-amber-400">×{it.quantity}</span>
                                        </span>
                                      ))}
                                      {b.items.length > 3 && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800/80 border border-slate-700 text-slate-400 font-bold">
                                          +{b.items.length - 3}
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => toggleExpandBill(b.id)}
                                      className="text-[10px] text-sky-400 hover:text-sky-300 font-bold flex items-center gap-0.5 cursor-pointer touch-manipulation transition-colors"
                                    >
                                      {isExpanded ? (
                                        <>
                                          <ChevronUp className="w-3 h-3" />
                                          <span>ເຊື່ອງ ({b.items.length} ລາຍການ)</span>
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown className="w-3 h-3" />
                                          <span>ກວດສອບສິນຄ້າ ({b.items.length} ລາຍການ)</span>
                                        </>
                                      )}
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-slate-300 font-semibold">{b.staffName}</td>
                            <td className="py-3 px-4 text-right font-mono text-slate-400">
                              {formatCurrency(resolvedRoomCharge, settings.currencySymbol)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-rose-400">
                              {formatCurrency(billItemsCost, settings.currencySymbol)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-amber-300">
                              {formatCurrency(resolvedBillTotal, settings.currencySymbol)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-black text-emerald-400">
                              +{formatCurrency(billProfit, settings.currencySymbol)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInspectedBill(b);
                                    setInspectedBillMode('items');
                                  }}
                                  className="p-1.5 rounded-lg bg-sky-950/70 hover:bg-sky-900 border border-sky-700/80 text-sky-300 hover:text-white cursor-pointer touch-manipulation flex items-center gap-1 text-[11px] font-bold"
                                  title="ກວດສອບລາຍລະອຽດໃບເສັດ ແລະ ລາຍການສິນຄ້າ"
                                >
                                  <Receipt className="w-3.5 h-3.5 text-sky-400" />
                                  <span className="hidden sm:inline">ໃບເສັດ</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => (onReprintBill ? onReprintBill(b) : handlePrintBillBluetooth(b))}
                                  className="p-1.5 rounded-lg bg-amber-950/70 hover:bg-amber-900 border border-amber-700/80 text-amber-300 hover:text-white cursor-pointer touch-manipulation flex items-center gap-1 text-[11px] font-bold"
                                  title="ພິມໃບເສັດຄືນ (Reprint)"
                                >
                                  <Printer className="w-3.5 h-3.5 text-amber-400" />
                                  <span className="hidden sm:inline">ພິມຄືນ</span>
                                </button>
                                {currentRole === 'admin' && onDeleteBill && (
                                  <button
                                    type="button"
                                    onClick={() => openDeleteSingleBill(b)}
                                    className="p-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 hover:text-white cursor-pointer transition-all touch-manipulation"
                                    title="Admin ລຶບໃບບິນນີ້"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Items Sub-row */}
                          {isExpanded && (
                            <tr className="bg-slate-950/80 border-b border-slate-800">
                              <td colSpan={10} className="p-3 pl-6 sm:pl-10">
                                <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-4 shadow-xl space-y-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                                    <div className="flex items-center gap-2">
                                      <ShoppingBag className="w-4 h-4 text-amber-400" />
                                      <h5 className="font-bold text-xs text-white">
                                        ລາຍການສິນຄ້າໃນບິນ #{b.billNumber} ({b.roomName || 'POS'}) — {b.items.length} ລາຍການ
                                      </h5>
                                    </div>
                                    <div className="text-[11px] text-slate-400">
                                      ເວລາ: {new Date(b.endTime).toLocaleTimeString('lo-LA')} • ຜູ້ດຳເນີນການ: {b.staffName}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                    {b.items.map((it, idx) => (
                                      <div
                                        key={idx}
                                        className="bg-slate-950/90 rounded-xl p-2.5 border border-slate-800 flex items-center justify-between gap-2 shadow-sm"
                                      >
                                        <div className="min-w-0">
                                          <div className="font-bold text-xs text-slate-100 truncate" title={it.productName}>
                                            {it.productName}
                                          </div>
                                          <div className="text-[10px] text-slate-400 mt-0.5">
                                            <span className="font-semibold text-amber-300 font-mono">
                                              {it.quantity} {it.unit}
                                            </span>
                                            {' × '}
                                            <span className="font-mono">{formatCurrency(it.price, '')}</span>
                                            {it.sellerName && (
                                              <span className="text-purple-300 ml-1">
                                                (ຜູ້ຂາຍ: {it.sellerName})
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="text-right font-mono font-black text-amber-400 text-xs shrink-0">
                                          {formatCurrency(it.total, settings.currencySymbol)}
                                        </div>
                                      </div>
                                    ))}
                                  </div>

                                  <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                                    <div className="text-slate-400 text-[11px]">
                                      {resolvedRoomCharge > 0 && (
                                        <span>ຄ່າຫ້ອງ: <b className="font-mono text-purple-300">{formatCurrency(resolvedRoomCharge, settings.currencySymbol)}</b> • </span>
                                      )}
                                      <span>ລວມສິນຄ້າ: <b className="font-mono text-amber-300">{formatCurrency(b.items.reduce((s, it) => s + it.total, 0), settings.currencySymbol)}</b></span>
                                    </div>
                                    <div className="font-mono font-black text-white text-sm">
                                      ຍອດສຸດທິ: <span className="text-emerald-400">{formatCurrency(resolvedBillTotal, settings.currencySymbol)}</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CHOICE 4: KTV ROOMS & USAGE TIME REAL-TIME ANALYTICS (REQUESTED FEATURE) */}
      {activeChoice === 'ktv_rooms' && (
        <div className="space-y-6">
          {/* Header & Quick Information */}
          <div className="bg-gradient-to-r from-purple-950/80 via-slate-900 to-rose-950/70 border border-purple-500/40 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-rose-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/30 shrink-0">
                <Mic2 className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white flex items-center gap-2">
                  <span>ສະຫຼຸບຍອດເປີດຫ້ອງ KTV & ເວລາ (Real-time Analytics)</span>
                  {roomAnalytics.activeRoomsList.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      ເປີດຢູ່ {roomAnalytics.activeRoomsList.length} ຫ້ອງ
                    </span>
                  )}
                </h2>
                <p className="text-xs text-purple-200/80 mt-0.5">
                  ຄຳນວນຍອດເງິນຄ່າເປີດຫ້ອງ ແລະ ເວລາທີ່ເປີດຫ້ອງທັງໝົດແບບ Real-time: ລວມທັງຫ້ອງທີ່ຈ່າຍກ່ອນ (Prepaid) ແລະ ຈ່າຍຕາມຫຼັງ (Post-paid) ທັງທີ່ເຊັກບິນແລ້ວ ແລະ ກຳລັງເປີດຢູ່
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="px-3 py-1.5 rounded-xl bg-slate-800/90 text-purple-300 border border-purple-800/40 font-mono font-bold">
                {timeframe === 'daily'
                  ? `ວັນທີ: ${selectedDate}`
                  : timeframe === 'monthly'
                  ? `ເດືອນ: ${selectedMonth}`
                  : timeframe === 'yearly'
                  ? `ປີ: ${selectedYear}`
                  : `ຊ່ວງ: ${customStartDate} ຫາ ${customEndDate}`}
              </span>
            </div>
          </div>

          {/* Choice 4 Sub-Navigation: Today's Spotlight vs Day-by-Day Summary vs Room Rankings vs Bills Log */}
          <div className="flex flex-wrap items-center gap-2 bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800">
            <button
              type="button"
              onClick={() => setKtvSubTab('today_summary')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                ktvSubTab === 'today_summary'
                  ? 'bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600 text-white shadow-md shadow-purple-600/30 font-black'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>1. 📊 {roomAnalytics.isToday ? 'ສະຫຼຸບມື້ນີ້ (Today Summary)' : 'ສະຫຼຸບຕາມວັນທີທີ່ເລືອກ'}</span>
              {selectedPeriodRoomSpotlight.roomSessionsCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-purple-900/80 text-purple-200 border border-purple-700">
                  {selectedPeriodRoomSpotlight.roomSessionsCount} ຫ້ອງ
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setKtvSubTab('day_by_day')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                ktvSubTab === 'day_by_day'
                  ? 'bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600 text-white shadow-md shadow-purple-600/30 font-black'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <CalendarDays className="w-4 h-4 text-sky-400" />
              <span>2. 📅 ສະຫຼຸບລວມວັນຕໍ່ວັນ (Day-by-Day)</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-300">
                {dayByDayRoomAnalytics.dailyList.length} ວັນ
              </span>
            </button>
            <button
              type="button"
              onClick={() => setKtvSubTab('rooms_ranking')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                ktvSubTab === 'rooms_ranking'
                  ? 'bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600 text-white shadow-md shadow-purple-600/30 font-black'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <DoorOpen className="w-4 h-4 text-emerald-400" />
              <span>3. 🏆 ຈັດອັນດັບແຕ່ລະຫ້ອງ</span>
            </button>
            <button
              type="button"
              onClick={() => setKtvSubTab('room_bills_log')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                ktvSubTab === 'room_bills_log'
                  ? 'bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600 text-white shadow-md shadow-purple-600/30 font-black'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Receipt className="w-4 h-4 text-rose-400" />
              <span>4. 🧾 ປະຫວັດໃບບິນຫ້ອງ & ສິນຄ້າ ({roomAnalytics.completedRoomBills.length})</span>
            </button>
          </div>

          {/* VIEW 1: TODAY'S ROOM SUMMARY SPOTLIGHT (DIRECT ANSWERS TO USER PROMPT) */}
          {ktvSubTab === 'today_summary' && (
            <div className="space-y-6">
              {/* Spotlight Hero Banner answering: วันนี้เปิดกี่ห้อง กี่ชั่วโมง ได้เงินเท่าไหร่ */}
              <div className="bg-gradient-to-br from-purple-950 via-slate-900 to-indigo-950 border-2 border-purple-500/60 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-purple-800/50">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/40">
                      <Sparkles className="w-6 h-6 text-yellow-300" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs uppercase tracking-wider font-black text-purple-300 bg-purple-900/60 px-2.5 py-0.5 rounded-full border border-purple-700/60">
                          {roomAnalytics.isToday ? "ສະຫຼຸບປະຈຳວັນ (Today's Summary)" : 'ສະຫຼຸບຕາມຊ່ວງເວລາທີ່ເລືອກ'}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          {timeframeLabel}
                        </span>
                      </div>
                      <h3 className="text-xl sm:text-2xl font-black text-white mt-1">
                        ສະຫຼຸບການເປີດຫ້ອງ KTV — {timeframeLabel}
                      </h3>
                    </div>
                  </div>

                  {roomAnalytics.isToday && (
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        {roomAnalytics.activeRoomsList.length > 0 ? `ກຳລັງຫຼິ້ນຢູ່ ${roomAnalytics.activeRoomsList.length} ຫ້ອງ` : 'ບໍ່ມີຫ້ອງເປີດຄ້າງ'}
                      </span>
                    </div>
                  )}
                </div>

                {/* 4 Golden Direct Answers: เปิดกี่ห้อง, กี่ชั่วโมง, ได้เงินเท่าไหร่, รวมทั้งหมดเท่าไหร่ (strictly filtered by timeframe/selectedDate) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
                  {/* Answer 1 */}
                  <div className="bg-slate-900/90 rounded-2xl p-4 border border-purple-500/40 shadow-lg">
                    <div className="text-xs text-purple-300 font-bold mb-1 flex items-center justify-between">
                      <span>🚪 ເປີດໄປທັງໝົດ</span>
                      <span className="text-[10px] text-slate-400">Total Rooms</span>
                    </div>
                    <div className="text-3xl font-black text-white flex items-baseline gap-1.5">
                      <span className="text-purple-400">{selectedPeriodRoomSpotlight.roomSessionsCount}</span>
                      <span className="text-sm font-semibold text-slate-300">ຮອບ</span>
                      {selectedPeriodRoomSpotlight.uniqueRoomsCount > 0 && (
                        <span className="text-xs text-slate-400 font-normal">
                          ({selectedPeriodRoomSpotlight.uniqueRoomsCount} ຫ້ອງ)
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-[11px] text-slate-400 flex justify-between border-t border-slate-800 pt-1.5">
                      <span>ເຊັກບິນແລ້ວ: {selectedPeriodRoomSpotlight.completedBills.length}</span>
                      <span className="text-emerald-400 font-semibold">ເປີດຢູ່ຕອນນີ້: {selectedPeriodRoomSpotlight.activeRooms.length}</span>
                    </div>
                  </div>

                  {/* Answer 2 */}
                  <div className="bg-slate-900/90 rounded-2xl p-4 border border-amber-500/40 shadow-lg">
                    <div className="text-xs text-amber-300 font-bold mb-1 flex items-center justify-between">
                      <span>⏱️ ເວລາເປີດຫ້ອງລວມ</span>
                      <span className="text-[10px] text-slate-400">Total Hours</span>
                    </div>
                    <div className="text-2xl sm:text-3xl font-black text-amber-300">
                      {selectedPeriodRoomSpotlight.hoursFormatted}
                    </div>
                    <div className="mt-2 text-[11px] text-slate-400 flex justify-between border-t border-slate-800 pt-1.5">
                      <span>ລວມເປັນຊົ່ວໂມງ:</span>
                      <span className="font-mono text-amber-400 font-bold">~{selectedPeriodRoomSpotlight.hoursDecimal} ຊົ່ວໂມງ</span>
                    </div>
                  </div>

                  {/* Answer 3 */}
                  <div className="bg-slate-900/90 rounded-2xl p-4 border border-emerald-500/40 shadow-lg">
                    <div className="text-xs text-emerald-300 font-bold mb-1 flex items-center justify-between">
                      <span>💰 ໄດ້ເງິນຄ່າຫ້ອງ</span>
                      <span className="text-[10px] text-slate-400">Room Fee Income</span>
                    </div>
                    <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
                      {formatCurrency(selectedPeriodRoomSpotlight.roomRevenue, settings.currencySymbol)}
                    </div>
                    <div className="mt-2 text-[11px] text-slate-400 flex justify-between border-t border-slate-800 pt-1.5">
                      <span>ຈ່າຍກ່ອນ: {formatCurrency(selectedPeriodRoomSpotlight.prepaidRevenue, '')}</span>
                      <span>ຈ່າຍຫຼັງ: {formatCurrency(selectedPeriodRoomSpotlight.postpaidRevenue, '')}</span>
                    </div>
                  </div>

                  {/* Answer 4 */}
                  <div className="bg-slate-900/90 rounded-2xl p-4 border border-rose-500/40 shadow-lg">
                    <div className="text-xs text-rose-300 font-bold mb-1 flex items-center justify-between">
                      <span>💵 ລວມຍອດເງິນທັງໝົດ</span>
                      <span className="text-[10px] text-slate-400">Grand Total</span>
                    </div>
                    <div className="text-2xl sm:text-3xl font-black text-rose-400 font-mono">
                      {formatCurrency(selectedPeriodRoomSpotlight.grandTotalRevenue, settings.currencySymbol)}
                    </div>
                    <div className="mt-2 text-[11px] text-slate-400 flex justify-between border-t border-slate-800 pt-1.5">
                      <span>ສິນຄ້າ/ອາຫານ:</span>
                      <span className="font-mono text-amber-300 font-bold">
                        {formatCurrency(selectedPeriodRoomSpotlight.foodDrinkRevenue, settings.currencySymbol)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* List of Unique Room Names opened in this selected period */}
                {selectedPeriodRoomSpotlight.uniqueRoomsList.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-purple-850/60 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-400 font-bold">ຫ້ອງທີ່ເປີດໃຊ້ງານ ({timeframeLabel}):</span>
                    {selectedPeriodRoomSpotlight.uniqueRoomsList.map((rm) => (
                      <span
                        key={rm}
                        className="px-2.5 py-1 rounded-xl bg-purple-900/50 border border-purple-700/60 text-purple-200 font-black flex items-center gap-1.5"
                      >
                        <DoorOpen className="w-3.5 h-3.5 text-purple-400" />
                        <span>{rm}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* LIVE ACTIVE ROOMS (ONLY SHOWN WHEN SELECTED PERIOD INCLUDES TODAY) */}
              {roomAnalytics.isToday && (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
                    <h3 className="font-black text-sm text-white flex items-center gap-2">
                      <span>ຫ້ອງທີ່ກຳລັງເປີດໃຊ້ງານຕອນນີ້ (Live Active Rooms)</span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] bg-slate-800 text-purple-300 border border-purple-800/40">
                        {roomAnalytics.activeRoomsList.length} ຫ້ອງ
                      </span>
                    </h3>
                  </div>
                  <span className="text-xs text-slate-400">
                    ອັບເດດ Real-time ທຸກອຸປະກອນ
                  </span>
                </div>

                {roomAnalytics.activeRoomsList.length === 0 ? (
                  <div className="py-8 text-center bg-slate-950/60 rounded-2xl border border-slate-800/60">
                    <DoorOpen className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                    <p className="text-slate-300 font-bold text-sm">
                      ບໍ່ມີຫ້ອງທີ່ກຳລັງເປີດໃຊ້ງານໃນຂະນະນີ້
                    </p>
                    <p className="text-slate-500 text-xs mt-1">
                      ທຸກຫ້ອງວ່າງ ພ້ອມໃຫ້ບໍລິການ
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {roomAnalytics.activeRoomsList.map((item) => (
                      <div
                        key={item.room.id}
                        className="bg-slate-950/90 border-2 border-purple-500/40 hover:border-purple-400 rounded-2xl p-4 shadow-lg space-y-3 transition-all"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-black text-base text-white flex items-center gap-1.5">
                              <span>{item.room.name}</span>
                              <span className="text-[10px] text-slate-400 font-normal">
                                ({item.room.capacity} ຄົນ)
                              </span>
                            </h4>
                            <p className="text-[11px] text-purple-300/80">
                              {item.room.pricingType === 'package'
                                ? `ແພັກເກັດ: ${item.room.packageName || 'KTV'}`
                                : item.room.pricingType === 'open_time'
                                ? `ນັບຕາມເວລາຈິງ (${formatCurrency(item.room.hourlyRate, settings.currencySymbol)}/ຊມ)`
                                : `ລາຍຊົ່ວໂມງ (${item.room.bookedHours || 1} ຊມ)`}
                            </p>
                          </div>

                          <div className="text-right">
                            {item.isPrepaid ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-950 text-emerald-300 border border-emerald-700/70 inline-block">
                                ✅ ຈ່າຍກ່ອນແລ້ວ
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-950 text-amber-300 border border-amber-700/70 inline-block">
                                ⏳ ຈ່າຍຕາມຫຼັງ
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="bg-slate-900/90 rounded-xl p-3 border border-slate-800 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                            <div>
                              <div className="text-[10px] text-slate-400">ເວລາຫຼິ້ນສະສົມ</div>
                              <div className="font-mono text-base font-black text-amber-300">
                                {item.timerFormatted}
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-[10px] text-slate-400">ຄ່າຫ້ອງສະສົມ</div>
                            <div className="font-mono text-base font-black text-purple-400">
                              {formatCurrency(item.estimatedRoomFee, settings.currencySymbol)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-900">
                          <div className="text-slate-400 text-[11px]">
                            ສິນຄ້າ: <span className="font-mono text-amber-300 font-bold">{formatCurrency(item.ordersTotal, settings.currencySymbol)}</span> ({item.room.orders?.length || 0} ລາຍການ)
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-500">ລວມຕອນນີ້: </span>
                            <span className="font-mono font-black text-white text-xs">
                              {formatCurrency(item.grandTotal, settings.currencySymbol)}
                            </span>
                          </div>
                        </div>

                        {item.room.openedByStaffName && (
                          <div className="text-[10px] text-slate-500 flex items-center gap-1">
                            <User className="w-3 h-3 text-slate-400" />
                            <span>ເປີດຫ້ອງໂດຍ: {item.room.openedByStaffName}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* COMPLETED ROOM BILLS IN SELECTED TIMEFRAME */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
                <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <h3 className="font-black text-sm text-slate-100 flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-rose-500" />
                      <span>ປະຫວັດຫ້ອງ KTV ທີ່ເຊັກບິນແລ້ວ ({timeframeLabel} — {selectedPeriodRoomSpotlight.completedBills.length} ບິນ)</span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      ລາຍລະອຽດການເປີດຫ້ອງ, ເວລາ, ແລະ ລາຍການສິນຄ້າທີ່ລູກຄ້າສັ່ງ
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase text-[10px] font-black">
                        <th className="py-3 px-3">ເລກບິນ</th>
                        <th className="py-3 px-3">ຫ້ອງ</th>
                        <th className="py-3 px-3">ຊ່ວງເວລາ</th>
                        <th className="py-3 px-3 text-center">ໄລຍະເວລາ</th>
                        <th className="py-3 px-4">ລາຍການສິນຄ້າທີ່ສັ່ງ (Items)</th>
                        <th className="py-3 px-3 text-right">ຄ່າຫ້ອງ</th>
                        <th className="py-3 px-3 text-right">ສິນຄ້າໃນຫ້ອງ</th>
                        <th className="py-3 px-4 text-right">ຍອດລວມບິນ</th>
                        <th className="py-3 px-3 text-center">ໃບເສັດ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {selectedPeriodRoomSpotlight.completedBills.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-slate-500">
                            ຍັງບໍ່ມີໃບບິນຫ້ອງ KTV ທີ່ເຊັກບິນໃນຊ່ວງເວລານີ້
                          </td>
                        </tr>
                      ) : (
                        selectedPeriodRoomSpotlight.completedBills.map((b) => {
                          const durMins = resolveBillDurationMinutes(b);
                          const durFormatted = roomAnalytics.formatHoursMinutes(durMins).text;
                          const itemsSum = b.items.reduce((s, it) => s + it.total, 0);
                          const resolvedRoomCharge = getResolvedRoomCharge(b);
                          const resolvedBillTotal = getResolvedBillTotal(b);
                          const isExpanded = expandedBillIds.has(b.id);

                          return (
                            <React.Fragment key={b.id}>
                              <tr className="hover:bg-slate-850/60 transition-colors">
                                <td className="py-3 px-3 font-mono font-bold text-slate-200">
                                  {b.billNumber}
                                </td>
                                <td className="py-3 px-3 font-black text-white">
                                  {b.roomName || 'ຫ້ອງ KTV'}
                                </td>
                                <td className="py-3 px-3 font-mono text-slate-300">
                                  {b.timeRangeFormatted ||
                                    (b.startTime && b.endTime
                                      ? `${new Date(b.startTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit' })} - ${new Date(b.endTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit' })}`
                                      : new Date(b.endTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit' }))}
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-bold text-amber-300">
                                  {durFormatted}
                                </td>
                                <td className="py-3 px-4">
                                  <div className="space-y-1">
                                    {b.items.length === 0 ? (
                                      <span className="text-slate-500 text-[11px] italic">
                                        (ບໍ່ມີສິນຄ້າ / ຄ່າຫ້ອງລ້ວນ)
                                      </span>
                                    ) : (
                                      <>
                                        <div className="flex flex-wrap items-center gap-1 max-w-[240px]">
                                          {b.items.slice(0, 3).map((it, idx) => (
                                            <span
                                              key={idx}
                                              className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-200 inline-flex items-center gap-1"
                                            >
                                              <span className="truncate max-w-[100px]">{it.productName}</span>
                                              <span className="font-black text-amber-400">×{it.quantity}</span>
                                            </span>
                                          ))}
                                          {b.items.length > 3 && (
                                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 font-bold border border-slate-700">
                                              +{b.items.length - 3}
                                            </span>
                                          )}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => toggleExpandBill(b.id)}
                                          className="text-[10px] text-sky-400 hover:text-sky-300 font-bold flex items-center gap-0.5 cursor-pointer touch-manipulation"
                                        >
                                          {isExpanded ? (
                                            <>
                                              <ChevronUp className="w-3 h-3" />
                                              <span>ເຊື່ອງ ({b.items.length} ລາຍການ)</span>
                                            </>
                                          ) : (
                                            <>
                                              <ChevronDown className="w-3 h-3" />
                                              <span>ກວດສອບສິນຄ້າ ({b.items.length} ລາຍການ)</span>
                                            </>
                                          )}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-3 text-right font-mono font-bold text-purple-400">
                                  {formatCurrency(resolvedRoomCharge, settings.currencySymbol)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono font-bold text-amber-400">
                                  {formatCurrency(itemsSum, settings.currencySymbol)}
                                </td>
                                <td className="py-3 px-4 text-right font-mono font-black text-emerald-400 text-sm">
                                  {formatCurrency(resolvedBillTotal, settings.currencySymbol)}
                                </td>
                                <td className="py-3 px-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setInspectedBill(b);
                                      setInspectedBillMode('items');
                                    }}
                                    className="p-1.5 rounded-lg bg-sky-950/70 hover:bg-sky-900 border border-sky-700/80 text-sky-300 hover:text-white cursor-pointer touch-manipulation flex items-center gap-1 text-[11px] font-bold mx-auto"
                                    title="ກວດສອບໃບເສັດ ແລະ ສິນຄ້າ"
                                  >
                                    <Receipt className="w-3.5 h-3.5 text-sky-400" />
                                    <span>ໃບເສັດ</span>
                                  </button>
                                </td>
                              </tr>

                              {/* Inline Expanded Items Sub-row */}
                              {isExpanded && (
                                <tr className="bg-slate-950/80 border-b border-slate-800">
                                  <td colSpan={9} className="p-3 pl-6 sm:pl-10">
                                    <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-4 shadow-xl space-y-3">
                                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                                        <div className="flex items-center gap-2">
                                          <ShoppingBag className="w-4 h-4 text-amber-400" />
                                          <h5 className="font-bold text-xs text-white">
                                            ລາຍການສິນຄ້າໃນບິນ #{b.billNumber} ({b.roomName || 'ຫ້ອງ KTV'}) — {b.items.length} ລາຍການ
                                          </h5>
                                        </div>
                                        <div className="text-[11px] text-slate-400">
                                          ເວລາ: {new Date(b.endTime).toLocaleTimeString('lo-LA')} • ຜູ້ດຳເນີນການ: {b.staffName}
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                        {b.items.map((it, idx) => (
                                          <div
                                            key={idx}
                                            className="bg-slate-950/90 rounded-xl p-2.5 border border-slate-800 flex items-center justify-between gap-2 shadow-sm"
                                          >
                                            <div className="min-w-0">
                                              <div className="font-bold text-xs text-slate-100 truncate" title={it.productName}>
                                                {it.productName}
                                              </div>
                                              <div className="text-[10px] text-slate-400 mt-0.5">
                                                <span className="font-semibold text-amber-300 font-mono">
                                                  {it.quantity} {it.unit}
                                                </span>
                                                {' × '}
                                                <span className="font-mono">{formatCurrency(it.price, '')}</span>
                                                {it.sellerName && (
                                                  <span className="text-purple-300 ml-1">
                                                    (ຜູ້ຂາຍ: {it.sellerName})
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                            <div className="text-right font-mono font-black text-amber-400 text-xs shrink-0">
                                              {formatCurrency(it.total, settings.currencySymbol)}
                                            </div>
                                          </div>
                                        ))}
                                      </div>

                                      <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                                        <div className="text-slate-400 text-[11px]">
                                          {resolvedRoomCharge > 0 && (
                                            <span>ຄ່າຫ້ອງ: <b className="font-mono text-purple-300">{formatCurrency(resolvedRoomCharge, settings.currencySymbol)}</b> • </span>
                                          )}
                                          <span>ລວມສິນຄ້າ: <b className="font-mono text-amber-300">{formatCurrency(itemsSum, settings.currencySymbol)}</b></span>
                                        </div>
                                        <div className="font-mono font-black text-white text-sm">
                                          ຍອດສຸດທິ: <span className="text-emerald-400">{formatCurrency(resolvedBillTotal, settings.currencySymbol)}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 2: DAY-BY-DAY ROOM OPENING SUMMARY (ສະຫຼຸບການເປີດຫ້ອງ ວັນຕໍ່ວັນ) */}
          {ktvSubTab === 'day_by_day' && (
            <div className="space-y-6">
              {/* Day-by-Day Header Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-900 border border-purple-500/30 rounded-3xl p-5 shadow-lg">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span className="font-bold text-purple-300">ຈຳນວນວັນທີ່ບັນທຶກ</span>
                    <span className="p-1.5 rounded-xl bg-purple-500/10 text-purple-400">
                      <CalendarDays className="w-4 h-4" />
                    </span>
                  </div>
                  <div className="text-3xl font-black font-mono text-white">
                    {dayByDayRoomAnalytics.dailyList.length}{' '}
                    <span className="text-sm font-normal text-slate-400">ວັນ</span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400">
                    ບັນທຶກສະສົມວັນຕໍ່ວັນທັງໝົດ
                  </div>
                </div>

                <div className="bg-slate-900 border border-purple-500/30 rounded-3xl p-5 shadow-lg">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span className="font-bold text-purple-300">ຮອບເປີດຫ້ອງສະສົມທຸກວັນ</span>
                    <span className="p-1.5 rounded-xl bg-purple-500/10 text-purple-400">
                      <DoorOpen className="w-4 h-4" />
                    </span>
                  </div>
                  <div className="text-3xl font-black font-mono text-purple-400">
                    {dayByDayRoomAnalytics.totalAllDaysSessions}{' '}
                    <span className="text-sm font-normal text-slate-400">ຮອບ</span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400">
                    ລວມທຸກຫ້ອງທີ່ເປີດໃຊ້ງານ
                  </div>
                </div>

                <div className="bg-slate-900 border border-amber-500/30 rounded-3xl p-5 shadow-lg">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span className="font-bold text-amber-300">ເວລາເປີດຫ້ອງລວມທຸກວັນ</span>
                    <span className="p-1.5 rounded-xl bg-amber-500/10 text-amber-400">
                      <Clock className="w-4 h-4" />
                    </span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-amber-400">
                    {dayByDayRoomAnalytics.totalAllDaysHoursFormatted}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400">
                    ລວມ {(dayByDayRoomAnalytics.totalAllDaysMinutes / 60).toFixed(1)} ຊົ່ວໂມງ
                  </div>
                </div>

                <div className="bg-slate-900 border border-emerald-500/30 rounded-3xl p-5 shadow-lg">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span className="font-bold text-emerald-300">ລວມເງິນຄ່າຫ້ອງທຸກວັນ</span>
                    <span className="p-1.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                      <Coins className="w-4 h-4" />
                    </span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-black font-mono text-emerald-400">
                    {formatCurrency(dayByDayRoomAnalytics.totalAllDaysRoomRevenue, settings.currencySymbol)}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400 flex justify-between">
                    <span>ຍອດລວມທັງໝົດ:</span>
                    <span className="font-mono font-bold text-rose-400">
                      {formatCurrency(dayByDayRoomAnalytics.totalAllDaysGrandRevenue, settings.currencySymbol)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Day-by-Day Detailed Breakdown Table */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
                <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-black text-sm text-slate-100 flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 text-purple-400" />
                      <span>ຕາຕະລາງສະຫຼຸບການເປີດຫ້ອງ ແຍກເປັນວັນຕໍ່ວັນ (Day-by-Day Room Summary)</span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      ສະຫຼຸບວ່າໃນແຕ່ລະວັນເປີດກີ່ຫ້ອງ, ກີ່ຊົ່ວໂມງ, ໄດ້ເງິນຄ່າຫ້ອງເທົ່າໃດ ແລະ ລວມເງິນທັງໝົດ
                    </p>
                  </div>
                  <div className="text-xs text-purple-300 font-bold">
                    ຄລິກທີ່ປຸ່ມ "ລາຍລະອຽດ" ເພື່ອກວດສອບບິນ ແລະ ສິນຄ້າໃນວັນນັ້ນ
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase text-[10px] font-black">
                        <th className="py-3 px-4">ວັນທີ & ມື້</th>
                        <th className="py-3 px-3 text-center">ເປີດທັງໝົດ (ຫ້ອງ/ຮອບ)</th>
                        <th className="py-3 px-3">ຫ້ອງທີ່ເປີດໃຊ້ງານ</th>
                        <th className="py-3 px-3 text-right">ເວລາເປີດລວມ</th>
                        <th className="py-3 px-4 text-right">ໄດ້ເງິນຄ່າຫ້ອງ</th>
                        <th className="py-3 px-4 text-right">ຍອດສິນຄ້າໃນຫ້ອງ</th>
                        <th className="py-3 px-4 text-right">ລວມໄດ້ເງິນທັງໝົດ</th>
                        <th className="py-3 px-3 text-center">ລາຍລະອຽດບິນ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {dayByDayRoomAnalytics.dailyList.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500">
                            ບໍ່ພົບຂໍ້ມູນການເປີດຫ້ອງ
                          </td>
                        </tr>
                      ) : (
                        dayByDayRoomAnalytics.dailyList.map((day) => {
                          const isExpanded = expandedDates.has(day.dateStr);

                          return (
                            <React.Fragment key={day.dateStr}>
                              <tr
                                className={`hover:bg-slate-850/60 transition-colors ${
                                  day.isToday ? 'bg-purple-950/20' : ''
                                }`}
                              >
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2">
                                    {day.isToday && (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                                        ມື້ນີ້ (Today)
                                      </span>
                                    )}
                                    <span className="font-bold text-white text-xs">
                                      {day.dateFormatted}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                    {day.dateStr}
                                  </div>
                                </td>

                                <td className="py-3 px-3 text-center font-mono font-bold text-purple-300 text-sm">
                                  {day.roomSessionsCount} ຮອບ
                                  {day.uniqueRoomsCount > 0 && (
                                    <div className="text-[10px] text-slate-400 font-normal">
                                      ({day.uniqueRoomsCount} ຫ້ອງ)
                                    </div>
                                  )}
                                </td>

                                <td className="py-3 px-3">
                                  <div className="flex flex-wrap gap-1 max-w-[200px]">
                                    {day.uniqueRoomsList.map((rm) => (
                                      <span
                                        key={rm}
                                        className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-200 border border-slate-700"
                                      >
                                        {rm}
                                      </span>
                                    ))}
                                    {day.uniqueRoomsList.length === 0 && (
                                      <span className="text-slate-500 text-[10px]">-</span>
                                    )}
                                  </div>
                                </td>

                                <td className="py-3 px-3 text-right font-mono font-bold text-amber-300">
                                  <div>{day.hoursFormatted}</div>
                                  <div className="text-[10px] text-slate-400 font-normal">
                                    ~{day.hoursDecimal} ຊົ່ວໂມງ
                                  </div>
                                </td>

                                <td className="py-3 px-4 text-right">
                                  <div className="font-mono font-black text-purple-400 text-sm">
                                    {formatCurrency(day.roomRevenue, settings.currencySymbol)}
                                  </div>
                                  {(day.prepaidRevenue > 0 || day.postpaidRevenue > 0) && (
                                    <div className="text-[10px] text-slate-500 flex justify-end gap-1.5 mt-0.5">
                                      {day.prepaidRevenue > 0 && (
                                        <span className="text-emerald-400">
                                          ກ່ອນ: {formatCurrency(day.prepaidRevenue, '')}
                                        </span>
                                      )}
                                      {day.postpaidRevenue > 0 && (
                                        <span className="text-amber-400">
                                          ຫຼັງ: {formatCurrency(day.postpaidRevenue, '')}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </td>

                                <td className="py-3 px-4 text-right font-mono font-bold text-amber-400">
                                  {formatCurrency(day.foodDrinkRevenue, settings.currencySymbol)}
                                </td>

                                <td className="py-3 px-4 text-right font-mono font-black text-emerald-400 text-base">
                                  {formatCurrency(day.grandTotalRevenue, settings.currencySymbol)}
                                </td>

                                <td className="py-3 px-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => toggleExpandDate(day.dateStr)}
                                    className="p-1.5 rounded-lg bg-purple-950/70 hover:bg-purple-900 border border-purple-700/80 text-purple-300 hover:text-white cursor-pointer touch-manipulation flex items-center gap-1 text-[11px] font-bold mx-auto transition-colors"
                                  >
                                    {isExpanded ? (
                                      <>
                                        <ChevronUp className="w-3.5 h-3.5 text-purple-400" />
                                        <span>ເຊື່ອງ</span>
                                      </>
                                    ) : (
                                      <>
                                        <ChevronDown className="w-3.5 h-3.5 text-purple-400" />
                                        <span>ເບິ່ງບິນ ({day.completedBills.length})</span>
                                      </>
                                    )}
                                  </button>
                                </td>
                              </tr>

                              {/* Expanded Day Bills Breakdown */}
                              {isExpanded && (
                                <tr className="bg-slate-950 border-b border-slate-800">
                                  <td colSpan={8} className="p-4 pl-6 sm:pl-10">
                                    <div className="bg-slate-900/90 border border-purple-900/60 rounded-2xl p-4 shadow-2xl space-y-3">
                                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                                        <div className="flex items-center gap-2">
                                          <CalendarDays className="w-4 h-4 text-purple-400" />
                                          <h5 className="font-bold text-sm text-white">
                                            ລາຍລະອຽດການເປີດຫ້ອງ ປະຈຳວັນທີ {day.dateFormatted} (ທັງໝົດ {day.completedBills.length} ບິນ)
                                          </h5>
                                        </div>
                                        <div className="text-xs text-purple-300 font-mono font-bold">
                                          ໄດ້ເງິນຄ່າຫ້ອງ: {formatCurrency(day.roomRevenue, settings.currencySymbol)} • ລວມທັງໝົດ: {formatCurrency(day.grandTotalRevenue, settings.currencySymbol)}
                                        </div>
                                      </div>

                                      {day.completedBills.length === 0 ? (
                                        <div className="py-4 text-center text-slate-500 text-xs">
                                          ບໍ່ມີບິນທີ່ເຊັກບິນສຳເລັດໃນວັນນີ້
                                        </div>
                                      ) : (
                                        <div className="space-y-3">
                                          {day.completedBills.map((b) => {
                                            const durMins = resolveBillDurationMinutes(b);
                                            const durFormatted = roomAnalytics.formatHoursMinutes(durMins).text;
                                            const resolvedRoomCharge = getResolvedRoomCharge(b);
                                            const resolvedBillTotal = getResolvedBillTotal(b);

                                            return (
                                              <div
                                                key={b.id}
                                                className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2.5"
                                              >
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                  <div className="flex items-center gap-2">
                                                    <span className="font-mono font-bold text-amber-400 text-xs">
                                                      #{b.billNumber}
                                                    </span>
                                                    <span className="font-black text-white text-xs bg-purple-950 px-2 py-0.5 rounded border border-purple-800">
                                                      {b.roomName || 'ຫ້ອງ KTV'}
                                                    </span>
                                                    <span className="text-[11px] text-slate-400 font-mono">
                                                      {b.timeRangeFormatted ||
                                                        (b.startTime && b.endTime
                                                          ? `${new Date(b.startTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit' })} - ${new Date(b.endTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit' })}`
                                                          : new Date(b.endTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit' }))}
                                                    </span>
                                                    <span className="text-[11px] text-amber-300 font-bold font-mono">
                                                      ({durFormatted})
                                                    </span>
                                                  </div>

                                                  <div className="flex items-center gap-2">
                                                    <span className="text-xs text-slate-400">
                                                      ຄ່າຫ້ອງ: <b className="font-mono text-purple-300">{formatCurrency(resolvedRoomCharge, settings.currencySymbol)}</b>
                                                    </span>
                                                    <span className="text-xs text-slate-400">•</span>
                                                    <span className="text-xs font-black text-emerald-400 font-mono">
                                                      ລວມບິນ: {formatCurrency(resolvedBillTotal, settings.currencySymbol)}
                                                    </span>
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        setInspectedBill(b);
                                                        setInspectedBillMode('items');
                                                      }}
                                                      className="p-1 px-2 rounded-lg bg-sky-950 hover:bg-sky-900 border border-sky-700 text-sky-300 text-[10px] font-bold cursor-pointer"
                                                    >
                                                      ໃບເສັດ
                                                    </button>
                                                  </div>
                                                </div>

                                                {/* Products ordered in this session */}
                                                <div className="pt-1.5 border-t border-slate-900">
                                                  <div className="text-[11px] text-slate-400 font-semibold mb-1 flex items-center gap-1.5">
                                                    <ShoppingBag className="w-3 h-3 text-amber-400" />
                                                    <span>ສິນຄ້າທີ່ສັ່ງໃນຫ້ອງນີ້ ({b.items.length} ລາຍການ):</span>
                                                  </div>
                                                  {b.items.length === 0 ? (
                                                    <div className="text-slate-500 text-[10px] italic">
                                                      (ບໍ່ມີສິນຄ້າ / ມີແຕ່ຄ່າຫ້ອງ)
                                                    </div>
                                                  ) : (
                                                    <div className="flex flex-wrap gap-1.5">
                                                      {b.items.map((it, idx) => (
                                                        <span
                                                          key={idx}
                                                          className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-200 inline-flex items-center gap-1.5"
                                                        >
                                                          <span className="font-semibold">{it.productName}</span>
                                                          <span className="font-black text-amber-400">×{it.quantity} {it.unit}</span>
                                                          <span className="font-mono text-slate-400 text-[10px]">({formatCurrency(it.total, '')})</span>
                                                        </span>
                                                      ))}
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                    {dayByDayRoomAnalytics.dailyList.length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-950 border-t-2 border-slate-700 font-bold text-xs">
                          <td className="py-3.5 px-4 text-slate-300">
                            ລວມທຸກວັນ ({dayByDayRoomAnalytics.dailyList.length} ວັນ):
                          </td>
                          <td className="py-3.5 px-3 text-center font-mono font-black text-purple-400">
                            {dayByDayRoomAnalytics.totalAllDaysSessions} ຮອບ
                          </td>
                          <td className="py-3.5 px-3 text-slate-400 text-center">-</td>
                          <td className="py-3.5 px-3 text-right font-mono font-black text-amber-300">
                            {dayByDayRoomAnalytics.totalAllDaysHoursFormatted}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-black text-purple-400 text-sm">
                            {formatCurrency(dayByDayRoomAnalytics.totalAllDaysRoomRevenue, settings.currencySymbol)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-black text-amber-400 text-sm">
                            {formatCurrency(dayByDayRoomAnalytics.totalAllDaysFoodDrink, settings.currencySymbol)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-black text-emerald-400 text-base">
                            {formatCurrency(dayByDayRoomAnalytics.totalAllDaysGrandRevenue, settings.currencySymbol)}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 3: PER-ROOM RANKING & STATS TABLE */}
          {ktvSubTab === 'rooms_ranking' && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
              <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-black text-sm text-slate-100 flex items-center gap-2">
                    <Mic2 className="w-4 h-4 text-purple-400" />
                    <span>ສະຖິຕິແຍກແຕ່ລະຫ້ອງ KTV (Room Performance & Ranking)</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    ຈັດອັນດັບຫ້ອງ KTV ຕາມຍອດລວມ, ຈຳນວນຮອບ, ເວລາທີ່ໃຊ້ງານ ແລະ ຍອດຄ່າຫ້ອງ
                  </p>
                </div>
                <div className="text-xs text-purple-300 font-bold">
                  ທັງໝົດ {roomAnalytics.perRoomRanking.length} ຫ້ອງ
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase text-[10px] font-black">
                      <th className="py-3 px-3 text-center">ອັນດັບ</th>
                      <th className="py-3 px-4">ຊື່ຫ້ອງ</th>
                      <th className="py-3 px-3 text-center">ສະຖານະຕອນນີ້</th>
                      <th className="py-3 px-3 text-center">ຮອບເປີດ</th>
                      <th className="py-3 px-3 text-right">ເວລາເປີດລວມ</th>
                      <th className="py-3 px-4 text-right">ຍອດຄ່າຫ້ອງ</th>
                      <th className="py-3 px-4 text-right">ຍອດສິນຄ້າໃນຫ້ອງ</th>
                      <th className="py-3 px-4 text-right">ຍອດລວມທັງໝົດ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {roomAnalytics.perRoomRanking.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-500">
                          ບໍ່ພົບຂໍ້ມູນການເປີດຫ້ອງໃນຊ່ວງເວລານີ້
                        </td>
                      </tr>
                    ) : (
                      roomAnalytics.perRoomRanking.map((rm, idx) => {
                        const timeStr = roomAnalytics.formatHoursMinutes(rm.totalMinutes).text;
                        return (
                          <tr
                            key={rm.roomName}
                            className="hover:bg-slate-850/60 transition-colors"
                          >
                            <td className="py-3 px-3 text-center font-mono font-bold text-slate-400">
                              #{idx + 1}
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-black text-sm text-white flex items-center gap-1.5">
                                <DoorOpen className="w-3.5 h-3.5 text-purple-400" />
                                <span>{rm.roomName}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-center">
                              {rm.activeNow ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  ກຳລັງເປີດຢູ່
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400">
                                  ວ່າງ
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center font-mono font-bold text-slate-200">
                              {rm.sessionsCount} ຮອບ
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-amber-300">
                              {timeStr}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="font-mono font-black text-purple-300 text-sm">
                                {formatCurrency(rm.roomRevenue, settings.currencySymbol)}
                              </div>
                              {(rm.prepaidRevenue > 0 || rm.postpaidRevenue > 0) && (
                                <div className="text-[10px] text-slate-400 flex justify-end gap-1.5 mt-0.5">
                                  {rm.prepaidRevenue > 0 && (
                                    <span className="text-emerald-400">
                                      ຈ່າຍກ່ອນ: {formatCurrency(rm.prepaidRevenue, '')}
                                    </span>
                                  )}
                                  {rm.postpaidRevenue > 0 && (
                                    <span className="text-amber-400">
                                      ຈ່າຍຕາມຫຼັງ: {formatCurrency(rm.postpaidRevenue, '')}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-amber-400">
                              {formatCurrency(rm.foodDrinkRevenue, settings.currencySymbol)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-black text-emerald-400 text-sm">
                              {formatCurrency(rm.grandTotalRevenue, settings.currencySymbol)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {roomAnalytics.perRoomRanking.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-950 border-t-2 border-slate-700 font-bold text-xs">
                        <td colSpan={3} className="py-3.5 px-4 text-slate-300">
                          ລວມຍອດທຸກຫ້ອງ ({roomAnalytics.perRoomRanking.length} ຫ້ອງ):
                        </td>
                        <td className="py-3.5 px-3 text-center font-mono font-black text-slate-200">
                          {roomAnalytics.grandTotalSessions} ຮອບ
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono font-black text-amber-300">
                          {roomAnalytics.formatHoursMinutes(roomAnalytics.grandRoomTotalMinutes).text}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-black text-purple-400 text-sm">
                          {formatCurrency(roomAnalytics.grandRoomRevenue, settings.currencySymbol)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-black text-amber-400 text-sm">
                          {formatCurrency(roomAnalytics.grandFoodDrinkRevenue, settings.currencySymbol)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-black text-emerald-400 text-base">
                          {formatCurrency(roomAnalytics.grandOverallRevenue, settings.currencySymbol)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* VIEW 4: DETAILED ROOM BILLS HISTORY LOG WITH ORDERED ITEMS */}
          {ktvSubTab === 'room_bills_log' && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
              <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="font-black text-sm text-slate-100 flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-rose-500" />
                    <span>ປະຫວັດໃບບິນຫ້ອງ KTV ທີ່ເຊັກບິນແລ້ວ ({roomAnalytics.completedRoomBills.length} ບິນ)</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    ລາຍລະອຽດເວລາເຂົ້າ-ອອກ, ແພັກເກັດ/ອັດຕາຄ່າຫ້ອງ ແລະ ລາຍການສິນຄ້າທີ່ສັ່ງທັງໝົດ
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase text-[10px] font-black">
                      <th className="py-3 px-3">ເລກບິນ</th>
                      <th className="py-3 px-3">ຫ້ອງ</th>
                      <th className="py-3 px-3">ຊ່ວງເວລາ (Start - End)</th>
                      <th className="py-3 px-3 text-center">ໄລຍະເວລາ</th>
                      <th className="py-3 px-4">ລາຍການສິນຄ້າທີ່ສັ່ງ (Items)</th>
                      <th className="py-3 px-3 text-center">ສະຖານະຄ່າຫ້ອງ</th>
                      <th className="py-3 px-3 text-right">ຄ່າຫ້ອງ</th>
                      <th className="py-3 px-3 text-right">ສິນຄ້າໃນຫ້ອງ</th>
                      <th className="py-3 px-4 text-right">ຍອດລວມບິນ</th>
                      <th className="py-3 px-3 text-center">ຜູ້ດຳເນີນການ</th>
                      <th className="py-3 px-3 text-center">ໃບເສັດ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {roomAnalytics.completedRoomBills.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-8 text-center text-slate-500">
                          ບໍ່ພົບປະຫວັດບິນຫ້ອງ KTV ໃນຊ່ວງເວລານີ້
                        </td>
                      </tr>
                    ) : (
                      roomAnalytics.completedRoomBills.map((b) => {
                        const durMins = resolveBillDurationMinutes(b);
                        const durFormatted = roomAnalytics.formatHoursMinutes(durMins).text;
                        const resolvedRoomCharge = getResolvedRoomCharge(b);
                        const resolvedBillTotal = getResolvedBillTotal(b);

                        const startFormatted = b.startTime
                          ? new Date(b.startTime).toLocaleTimeString('lo-LA', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })
                          : '-';
                        const endFormatted = b.endTime
                          ? new Date(b.endTime).toLocaleTimeString('lo-LA', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })
                          : '-';

                        const itemsSum = b.items.reduce((s, it) => s + it.total, 0);
                        const isExpanded = expandedBillIds.has(b.id);

                        return (
                          <React.Fragment key={b.id}>
                            <tr className="hover:bg-slate-850/60 transition-colors">
                              <td className="py-3 px-3 font-mono font-bold text-slate-200">
                                {b.billNumber}
                              </td>
                              <td className="py-3 px-3 font-black text-white">
                                {b.roomName || 'ຫ້ອງ KTV'}
                              </td>
                              <td className="py-3 px-3 font-mono text-slate-300">
                                {b.timeRangeFormatted || `${startFormatted} - ${endFormatted}`}
                              </td>
                              <td className="py-3 px-3 text-center font-mono font-bold text-amber-300">
                                {durFormatted}
                              </td>
                              <td className="py-3 px-4">
                                <div className="space-y-1">
                                  {b.items.length === 0 ? (
                                    <span className="text-slate-500 text-[11px] italic">
                                      (ບໍ່ມີສິນຄ້າ / ຄ່າຫ້ອງລ້ວນ)
                                    </span>
                                  ) : (
                                    <>
                                      <div className="flex flex-wrap items-center gap-1 max-w-[240px]">
                                        {b.items.slice(0, 3).map((it, idx) => (
                                          <span
                                            key={idx}
                                            className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-200 inline-flex items-center gap-1"
                                            title={`${it.productName} ${it.quantity} ${it.unit} (${formatCurrency(it.total, settings.currencySymbol)})`}
                                          >
                                            <span className="truncate max-w-[100px]">{it.productName}</span>
                                            <span className="font-black text-amber-400">×{it.quantity}</span>
                                          </span>
                                        ))}
                                        {b.items.length > 3 && (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 font-bold border border-slate-700">
                                            +{b.items.length - 3}
                                          </span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleExpandBill(b.id)}
                                        className="text-[10px] text-sky-400 hover:text-sky-300 font-bold flex items-center gap-0.5 cursor-pointer touch-manipulation"
                                      >
                                        {isExpanded ? (
                                          <>
                                            <ChevronUp className="w-3 h-3" />
                                            <span>ເຊື່ອງ ({b.items.length} ລາຍການ)</span>
                                          </>
                                        ) : (
                                          <>
                                            <ChevronDown className="w-3 h-3" />
                                            <span>ກວດສອບສິນຄ້າ ({b.items.length} ລາຍການ)</span>
                                          </>
                                        )}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-3 text-center">
                                {b.isRoomChargePaid ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/60">
                                    ✅ ຈ່າຍກ່ອນແລ້ວ
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700/60">
                                    ⏳ ຈ່າຍຕອນເຊັກບິນ
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3 text-right font-mono font-bold text-purple-400">
                                {formatCurrency(resolvedRoomCharge, settings.currencySymbol)}
                              </td>
                              <td className="py-3 px-3 text-right font-mono font-bold text-amber-400">
                                {formatCurrency(itemsSum, settings.currencySymbol)}
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-black text-emerald-400 text-sm">
                                {formatCurrency(resolvedBillTotal, settings.currencySymbol)}
                              </td>
                              <td className="py-3 px-3 text-center text-slate-400 text-[11px]">
                                {b.staffName || '-'}
                              </td>
                              <td className="py-3 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInspectedBill(b);
                                    setInspectedBillMode('items');
                                  }}
                                  className="p-1.5 rounded-lg bg-sky-950/70 hover:bg-sky-900 border border-sky-700/80 text-sky-300 hover:text-white cursor-pointer touch-manipulation flex items-center gap-1 text-[11px] font-bold mx-auto"
                                  title="ກວດສອບໃບເສັດ ແລະ ສິນຄ້າ"
                                >
                                  <Receipt className="w-3.5 h-3.5 text-sky-400" />
                                  <span>ໃບເສັດ</span>
                                </button>
                              </td>
                            </tr>

                            {/* Inline Expanded Items Sub-row */}
                            {isExpanded && (
                              <tr className="bg-slate-950/80 border-b border-slate-800">
                                <td colSpan={11} className="p-3 pl-6 sm:pl-10">
                                  <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-4 shadow-xl space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                                      <div className="flex items-center gap-2">
                                        <ShoppingBag className="w-4 h-4 text-amber-400" />
                                        <h5 className="font-bold text-xs text-white">
                                          ລາຍການສິນຄ້າໃນບິນ #{b.billNumber} ({b.roomName || 'ຫ້ອງ KTV'}) — {b.items.length} ລາຍການ
                                        </h5>
                                      </div>
                                      <div className="text-[11px] text-slate-400">
                                        ເວລາ: {new Date(b.endTime).toLocaleTimeString('lo-LA')} • ຜູ້ດຳເນີນການ: {b.staffName}
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                      {b.items.map((it, idx) => (
                                        <div
                                          key={idx}
                                          className="bg-slate-950/90 rounded-xl p-2.5 border border-slate-800 flex items-center justify-between gap-2 shadow-sm"
                                        >
                                          <div className="min-w-0">
                                            <div className="font-bold text-xs text-slate-100 truncate" title={it.productName}>
                                              {it.productName}
                                            </div>
                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                              <span className="font-semibold text-amber-300 font-mono">
                                                {it.quantity} {it.unit}
                                              </span>
                                              {' × '}
                                              <span className="font-mono">{formatCurrency(it.price, '')}</span>
                                              {it.sellerName && (
                                                <span className="text-purple-300 ml-1">
                                                  (ຜູ້ຂາຍ: {it.sellerName})
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                          <div className="text-right font-mono font-black text-amber-400 text-xs shrink-0">
                                            {formatCurrency(it.total, settings.currencySymbol)}
                                          </div>
                                        </div>
                                      ))}
                                    </div>

                                    <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                                      <div className="text-slate-400 text-[11px]">
                                        {resolvedRoomCharge > 0 && (
                                          <span>ຄ່າຫ້ອງ: <b className="font-mono text-purple-300">{formatCurrency(resolvedRoomCharge, settings.currencySymbol)}</b> • </span>
                                        )}
                                        <span>ລວມສິນຄ້າ: <b className="font-mono text-amber-300">{formatCurrency(itemsSum, settings.currencySymbol)}</b></span>
                                      </div>
                                      <div className="font-mono font-black text-white text-sm">
                                        ຍອດສຸດທິ: <span className="text-emerald-400">{formatCurrency(resolvedBillTotal, settings.currencySymbol)}</span>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CHOICE 3: DEDICATED BILLS HISTORY & ADMIN DELETION CENTER */}
      {activeChoice === 'bills' && (
        <div className="space-y-6">
          {/* Filters & Bulk Actions Toolbar */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
              {/* Search Box */}
              <div className="relative flex-1 w-full lg:max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="ຄົ້ນຫາເລກບິນ, ຊື່ຫ້ອງ, ຊື່ພະນັກງານ, ຊື່ສິນຄ້າ..."
                  value={billsSearchQuery}
                  onChange={(e) => setBillsSearchQuery(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl pl-10 pr-10 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
                {billsSearchQuery && (
                  <button
                    onClick={() => setBillsSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Scope & Type Filters */}
              <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                {/* Scope: Current Filtered vs All Bills */}
                <div className="flex items-center bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs">
                  <button
                    type="button"
                    onClick={() => setBillsTimeScope('filtered')}
                    className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                      billsTimeScope === 'filtered'
                        ? 'bg-rose-500 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ຊ່ວງເວລານີ້ ({filteredBills.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setBillsTimeScope('all')}
                    className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                      billsTimeScope === 'all'
                        ? 'bg-rose-500 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ທັງໝົດໃນຮ້ານ ({uniqueBills.length})
                  </button>
                </div>

                {/* Type Filter */}
                <select
                  value={billsTypeFilter}
                  onChange={(e) => setBillsTypeFilter(e.target.value as any)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500 cursor-pointer"
                >
                  <option value="all">ທຸກປະເພດບິນ</option>
                  <option value="ktv_room">ຫ້ອງ KTV</option>
                  <option value="pos">ຂາຍໜ້າຮ້ານ (POS)</option>
                </select>
              </div>
            </div>

            {/* Bulk Selection Bar if any checked (Admin only) */}
            {currentRole === 'admin' && selectedBillIds.size > 0 && (
              <div className="bg-rose-950/40 border border-rose-800/80 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-rose-200">
                  <CheckSquare className="w-4 h-4 text-rose-400" />
                  <span>ເລືອກແລ້ວ <strong>{selectedBillIds.size}</strong> ໃບບິນ</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedBillIds(new Set())}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    ຍົກເລີກການເລືອກ
                  </button>
                  <button
                    type="button"
                    onClick={openDeleteSelectedBills}
                    className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-black flex items-center gap-1.5 shadow-md shadow-red-600/30 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>ລຶບ {selectedBillIds.size} ບິນທີ່ເລືອກ (Admin)</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Managed Bills Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-sm text-slate-100">
                  ລາຍການໃບບິນ ({managedBills.length} ບິນ)
                </h3>
              </div>
              {currentRole === 'admin' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedBillIds.size === managedBills.length && managedBills.length > 0) {
                        setSelectedBillIds(new Set());
                      } else {
                        setSelectedBillIds(new Set(managedBills.map((b) => b.id)));
                      }
                    }}
                    className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    {selectedBillIds.size === managedBills.length && managedBills.length > 0 ? (
                      <>
                        <CheckSquare className="w-3.5 h-3.5 text-rose-400" />
                        <span>ຍົກເລີກເລືອກທັງໝົດ</span>
                      </>
                    ) : (
                      <>
                        <Square className="w-3.5 h-3.5 text-slate-400" />
                        <span>ເລືອກທັງໝົດ ({managedBills.length})</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 uppercase">
                    <th className="py-3 px-3 text-center w-10">
                      {currentRole === 'admin' ? (
                        <input
                          type="checkbox"
                          checked={selectedBillIds.size === managedBills.length && managedBills.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedBillIds(new Set(managedBills.map((b) => b.id)));
                            } else {
                              setSelectedBillIds(new Set());
                            }
                          }}
                          className="rounded accent-rose-500 cursor-pointer"
                        />
                      ) : (
                        <span className="text-slate-500 font-mono text-[10px]">#</span>
                      )}
                    </th>
                    <th className="py-3 px-4">ເລກທີບິນ</th>
                    <th className="py-3 px-4">ວັນທີ & ເວລາ</th>
                    <th className="py-3 px-4">ປະເພດ / ຫ້ອງ</th>
                    <th className="py-3 px-4">ລາຍການສິນຄ້າທີ່ສັ່ງ (Items)</th>
                    <th className="py-3 px-4">ຜູ້ຂາຍ / ພະນັກງານ</th>
                    <th className="py-3 px-4 text-right">ຄ່າຫ້ອງ</th>
                    <th className="py-3 px-4 text-right">ຕົ້ນທຶນສິນຄ້າ</th>
                    <th className="py-3 px-4 text-right">ຍອດສຸດທິ</th>
                    <th className="py-3 px-4 text-right">ກຳໄລບິນ</th>
                    <th className="py-3 px-4 text-center">ການດຳເນີນການ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {managedBills.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-500">
                        ບໍ່ພົບໃບບິນຕາມເງື່ອນໄຂທີ່ເລືອກ
                      </td>
                    </tr>
                  ) : (
                    managedBills.map((b) => {
                      const { billItemsCost, billProfit } = getBillCostAndProfit(b);
                      const resolvedRoomCharge = getResolvedRoomCharge(b);
                      const resolvedBillTotal = getResolvedBillTotal(b);
                      const isChecked = selectedBillIds.has(b.id);
                      const isExpanded = expandedBillIds.has(b.id);
                      return (
                        <React.Fragment key={b.id}>
                          <tr
                            className={`hover:bg-slate-800/40 transition-colors ${
                              isChecked ? 'bg-rose-950/20' : ''
                            }`}
                          >
                            <td className="py-3 px-3 text-center">
                              {currentRole === 'admin' ? (
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const next = new Set(selectedBillIds);
                                    if (e.target.checked) {
                                      next.add(b.id);
                                    } else {
                                      next.delete(b.id);
                                    }
                                    setSelectedBillIds(next);
                                  }}
                                  className="rounded accent-rose-500 cursor-pointer"
                                />
                              ) : (
                                <span className="text-slate-600 font-mono text-[10px]">•</span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-amber-400">
                              {b.billNumber}
                            </td>
                            <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                              <div>{new Date(b.endTime).toLocaleDateString('lo-LA')}</div>
                              <div className="text-[10px] text-slate-500">{new Date(b.endTime).toLocaleTimeString('lo-LA')}</div>
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  b.type === 'ktv_room'
                                    ? 'bg-purple-950/80 text-purple-300 border border-purple-800'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {b.roomName || 'POS ໜ້າຮ້ານ'}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="space-y-1">
                                {b.items.length === 0 ? (
                                  <span className="text-slate-500 text-[11px] italic">
                                    (ບໍ່ມີສິນຄ້າ / ຄ່າຫ້ອງລ້ວນ)
                                  </span>
                                ) : (
                                  <>
                                    <div className="flex flex-wrap items-center gap-1 max-w-[260px]">
                                      {b.items.slice(0, 3).map((it, idx) => (
                                        <span
                                          key={idx}
                                          className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-200 inline-flex items-center gap-1"
                                          title={`${it.productName} ${it.quantity} ${it.unit} (${formatCurrency(it.total, settings.currencySymbol)})`}
                                        >
                                          <span className="truncate max-w-[110px]">{it.productName}</span>
                                          <span className="font-black text-amber-400">×{it.quantity}</span>
                                        </span>
                                      ))}
                                      {b.items.length > 3 && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800/80 border border-slate-700 text-slate-400 font-bold">
                                          +{b.items.length - 3}
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => toggleExpandBill(b.id)}
                                      className="text-[10px] text-sky-400 hover:text-sky-300 font-bold flex items-center gap-0.5 cursor-pointer touch-manipulation transition-colors"
                                    >
                                      {isExpanded ? (
                                        <>
                                          <ChevronUp className="w-3 h-3" />
                                          <span>ເຊື່ອງ ({b.items.length} ລາຍການ)</span>
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown className="w-3 h-3" />
                                          <span>ກວດສອບສິນຄ້າ ({b.items.length} ລາຍການ)</span>
                                        </>
                                      )}
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-slate-300 font-semibold">{b.staffName}</td>
                            <td className="py-3 px-4 text-right font-mono text-slate-400">
                              {formatCurrency(resolvedRoomCharge, settings.currencySymbol)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-rose-400">
                              {formatCurrency(billItemsCost, settings.currencySymbol)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-amber-300">
                              {formatCurrency(resolvedBillTotal, settings.currencySymbol)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-black text-emerald-400">
                              +{formatCurrency(billProfit, settings.currencySymbol)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInspectedBill(b);
                                    setInspectedBillMode('items');
                                  }}
                                  className="p-1.5 rounded-lg bg-sky-950/70 hover:bg-sky-900 border border-sky-700/80 text-sky-300 hover:text-white cursor-pointer touch-manipulation flex items-center gap-1 text-[11px] font-bold"
                                  title="ກວດສອບລາຍລະອຽດໃບເສັດຫ້ອງນີ້"
                                >
                                  <Receipt className="w-3.5 h-3.5 text-sky-400" />
                                  <span className="hidden sm:inline">ໃບເສັດ</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => (onReprintBill ? onReprintBill(b) : handlePrintBillBluetooth(b))}
                                  className="p-1.5 rounded-lg bg-amber-950/70 hover:bg-amber-900 border border-amber-700/80 text-amber-300 hover:text-white cursor-pointer touch-manipulation flex items-center gap-1 text-[11px] font-bold"
                                  title="ພິມໃບເສັດຄືນ (Reprint)"
                                >
                                  <Printer className="w-3.5 h-3.5 text-amber-400" />
                                  <span className="hidden sm:inline">ພິມຄືນ</span>
                                </button>
                                {currentRole === 'admin' && onDeleteBill && (
                                  <button
                                    type="button"
                                    onClick={() => openDeleteSingleBill(b)}
                                    className="p-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 hover:text-white cursor-pointer transition-all touch-manipulation"
                                    title="Admin ລຶບໃບບິນນີ້"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Items Sub-row */}
                          {isExpanded && (
                            <tr className="bg-slate-950/80 border-b border-slate-800">
                              <td colSpan={11} className="p-3 pl-6 sm:pl-10">
                                <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-4 shadow-xl space-y-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                                    <div className="flex items-center gap-2">
                                      <ShoppingBag className="w-4 h-4 text-amber-400" />
                                      <h5 className="font-bold text-xs text-white">
                                        ລາຍການສິນຄ້າໃນບິນ #{b.billNumber} ({b.roomName || 'POS'}) — {b.items.length} ລາຍການ
                                      </h5>
                                    </div>
                                    <div className="text-[11px] text-slate-400">
                                      ເວລາ: {new Date(b.endTime).toLocaleTimeString('lo-LA')} • ຜູ້ດຳເນີນການ: {b.staffName}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                    {b.items.map((it, idx) => (
                                      <div
                                        key={idx}
                                        className="bg-slate-950/90 rounded-xl p-2.5 border border-slate-800 flex items-center justify-between gap-2 shadow-sm"
                                      >
                                        <div className="min-w-0">
                                          <div className="font-bold text-xs text-slate-100 truncate" title={it.productName}>
                                            {it.productName}
                                          </div>
                                          <div className="text-[10px] text-slate-400 mt-0.5">
                                            <span className="font-semibold text-amber-300 font-mono">
                                              {it.quantity} {it.unit}
                                            </span>
                                            {' × '}
                                            <span className="font-mono">{formatCurrency(it.price, '')}</span>
                                            {it.sellerName && (
                                              <span className="text-purple-300 ml-1">
                                                (ຜູ້ຂາຍ: {it.sellerName})
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="text-right font-mono font-black text-amber-400 text-xs shrink-0">
                                          {formatCurrency(it.total, settings.currencySymbol)}
                                        </div>
                                      </div>
                                    ))}
                                  </div>

                                  <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                                    <div className="text-slate-400 text-[11px]">
                                      {resolvedRoomCharge > 0 && (
                                        <span>ຄ່າຫ້ອງ: <b className="font-mono text-purple-300">{formatCurrency(resolvedRoomCharge, settings.currencySymbol)}</b> • </span>
                                      )}
                                      <span>ລວມສິນຄ້າ: <b className="font-mono text-amber-300">{formatCurrency(b.items.reduce((s, it) => s + it.total, 0), settings.currencySymbol)}</b></span>
                                    </div>
                                    <div className="font-mono font-black text-white text-sm">
                                      ຍອດສຸດທິ: <span className="text-emerald-400">{formatCurrency(resolvedBillTotal, settings.currencySymbol)}</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View Individual Bill Details with Authentic Thermal Receipt & Reprint */}
      {inspectedBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-5 sm:p-6 w-full max-w-lg shadow-2xl text-white my-auto max-h-[94dvh] overflow-y-auto space-y-3.5">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
                  <Receipt className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-black text-base text-slate-100 flex items-center gap-2">
                    <span>ໃບເສັດ: {inspectedBill.billNumber}</span>
                    <span className="text-[10px] bg-purple-900/60 text-purple-300 border border-purple-700/60 px-2 py-0.5 rounded-full">
                      {inspectedBill.roomName || 'POS ຂາຍໜ້າຮ້ານ'}
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    {new Date(inspectedBill.endTime).toLocaleString('lo-LA')} • ຜູ້ດຳເນີນການ: {inspectedBill.staffName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectedBill(null)}
                className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer touch-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* View Mode Toggle: 3 Modes: Items vs Receipt vs Financial */}
            <div className="grid grid-cols-3 gap-1.5 bg-slate-950 p-1.5 rounded-2xl border border-slate-800 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setInspectedBillMode('items')}
                className={`py-2 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer touch-manipulation ${
                  inspectedBillMode === 'items'
                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30 font-black'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>ລາຍການສິນຄ້າ ({inspectedBill.items.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setInspectedBillMode('receipt')}
                className={`py-2 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer touch-manipulation ${
                  inspectedBillMode === 'receipt'
                    ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30 font-black'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>ໃບເສັດ (Receipt)</span>
              </button>
              <button
                type="button"
                onClick={() => setInspectedBillMode('financial')}
                className={`py-2 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer touch-manipulation ${
                  inspectedBillMode === 'financial'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 font-black'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Coins className="w-3.5 h-3.5" />
                <span>ຕົ້ນທຶນ-ກຳໄລ</span>
              </button>
            </div>

            {/* Print feedback alerts */}
            {printSuccess && (
              <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-700 text-emerald-300 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>✓ ພິມໃບເສັດຜ່ານ Bluetooth ສຳເລັດຮຽບຮ້ອຍແລ້ວ!</span>
              </div>
            )}
            {printError && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{printError}</span>
              </div>
            )}

            {/* Content: Mode 1 - Detailed Product Items Inspection */}
            {inspectedBillMode === 'items' && (
              <div className="space-y-3 bg-slate-950 p-4 rounded-2xl border border-slate-800 text-xs">
                {/* Search Box if items count > 3 */}
                {inspectedBill.items.length > 3 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="ຄົ້ນຫາຊື່ສິນຄ້າໃນບິນນີ້..."
                      value={inspectedItemSearchQuery}
                      onChange={(e) => setInspectedItemSearchQuery(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                    {inspectedItemSearchQuery && (
                      <button
                        onClick={() => setInspectedItemSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Room Charge Card if this was a KTV bill */}
                {(getResolvedRoomCharge(inspectedBill) > 0 || isKtvRoomBill(inspectedBill)) && (() => {
                  const inspectedDurMins = resolveBillDurationMinutes(inspectedBill);
                  const inspectedRoomFee = getResolvedRoomCharge(inspectedBill);
                  return (
                  <div className="bg-gradient-to-r from-purple-950/80 to-slate-900 border border-purple-800/60 p-3 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-purple-900/60 text-purple-300">
                        <DoorOpen className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-white text-xs">
                          ຄ່າເປີດຫ້ອງ {inspectedBill.roomName || 'KTV'}
                        </div>
                        <div className="text-[10px] text-purple-300">
                          {inspectedDurMins > 0
                            ? `${Math.floor(inspectedDurMins / 60)} ຊມ ${inspectedDurMins % 60} ນາທີ`
                            : inspectedBill.timeRangeFormatted || 'ນັບຕາມເວລາ'}
                          {inspectedBill.isRoomChargePaid ? ' • (ຈ່າຍກ່ອນແລ້ວ)' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="font-mono font-black text-purple-300 text-sm">
                      {formatCurrency(inspectedRoomFee, settings.currencySymbol)}
                    </div>
                  </div>
                  );
                })()}

                {/* Items List */}
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {inspectedBill.items.length === 0 ? (
                    <div className="py-6 text-center text-slate-500 text-xs">
                      ບໍ່ມີລາຍການສິນຄ້າໃນບິນນີ້ (ມີແຕ່ຄ່າຫ້ອງ)
                    </div>
                  ) : (
                    inspectedBill.items
                      .filter((it) =>
                        inspectedItemSearchQuery.trim()
                          ? it.productName.toLowerCase().includes(inspectedItemSearchQuery.toLowerCase())
                          : true
                      )
                      .map((it, idx) => {
                        const matched =
                          productLookup.get(it.productId) ||
                          productLookup.get(it.productName.trim().toLowerCase());
                        const category = matched?.category || 'drink';

                        return (
                          <div
                            key={idx}
                            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/80 hover:border-slate-700 transition-colors space-y-1.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2">
                                <div className="mt-0.5">
                                  {renderCategoryBadge(category)}
                                </div>
                                <div>
                                  <div className="font-bold text-white text-xs">
                                    {it.productName}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {it.sellerName && (
                                      <span className="text-purple-300 font-semibold mr-1.5">
                                        ຜູ້ຂາຍ/ເສີບ: {it.sellerName}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="font-mono font-black text-amber-400 text-xs">
                                  {formatCurrency(it.total, settings.currencySymbol)}
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono">
                                  {it.quantity} {it.unit} × {formatCurrency(it.price, '')}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>

                {/* Summary footer */}
                <div className="space-y-1 pt-2 border-t border-slate-800 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>ລວມຍອດສິນຄ້າ ({inspectedBill.items.length} ລາຍການ):</span>
                    <span className="font-mono text-amber-300 font-bold">
                      {formatCurrency(
                        inspectedBill.items.reduce((s, it) => s + it.total, 0),
                        settings.currencySymbol
                      )}
                    </span>
                  </div>
                  {getResolvedRoomCharge(inspectedBill) > 0 && (
                    <div className="flex justify-between text-slate-400">
                      <span>ຄ່າຫ້ອງ{inspectedBill.isRoomChargePaid ? ' (ຈ່າຍກ່ອນແລ້ວ)' : ''}:</span>
                      <span className="font-mono text-purple-300 font-bold">
                        {formatCurrency(getResolvedRoomCharge(inspectedBill), settings.currencySymbol)}
                      </span>
                    </div>
                  )}
                  {inspectedBill.discount > 0 && (
                    <div className="flex justify-between text-rose-400">
                      <span>ສ່ວນຫຼຸດ:</span>
                      <span className="font-mono font-bold">-{formatCurrency(inspectedBill.discount, settings.currencySymbol)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-black text-white pt-1.5 border-t border-slate-800">
                    <span>ຍອດລວມສຸດທິ (Total):</span>
                    <span className="font-mono text-emerald-400 text-base">
                      {formatCurrency(getResolvedBillTotal(inspectedBill), settings.currencySymbol)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Content: Mode 2 - Authentic Thermal Receipt Preview */}
            {inspectedBillMode === 'receipt' && (
              <div className="bg-white text-slate-900 rounded-2xl p-4 sm:p-5 font-mono text-[12px] shadow-inner border border-slate-300 space-y-2 select-text">
                {/* Store Header */}
                <div className="text-center space-y-0.5 pb-2">
                  <div className="text-base font-black tracking-wide text-slate-900">
                    {settings.shopName || '689 KTV & RESTAURANT'}
                  </div>
                  {settings.shopPhone && (
                    <div className="text-[11px] text-slate-600">
                      ໂທ: {settings.shopPhone}
                    </div>
                  )}
                  {settings.shopAddress && (
                    <div className="text-[10px] text-slate-500">
                      {settings.shopAddress}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-500 pt-0.5">
                    *** ໃບເສັດຮັບເງິນ / RECEIPT ***
                  </div>
                </div>

                <div className="border-b border-dashed border-slate-400 pb-1.5 text-[11px] space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-slate-600">ເລກທີບິນ:</span>
                    <span className="font-bold">{inspectedBill.billNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">ວັນທີ-ເວລາ:</span>
                    <span>{new Date(inspectedBill.endTime).toLocaleString('lo-LA')}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span className="text-slate-600">ຫ້ອງ KTV / ຈຸດຂາຍ:</span>
                    <span className="text-purple-700">{inspectedBill.roomName || 'POS ຂາຍໜ້າຮ້ານ'}</span>
                  </div>
                  {inspectedBill.startTime && (
                    <div className="flex justify-between text-[10px] text-slate-600">
                      <span>ເວລາເປີດ-ປິດ:</span>
                      <span>
                        {new Date(inspectedBill.startTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit' })} - {new Date(inspectedBill.endTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit' })}
                        {inspectedBill.durationMinutes ? ` (${Math.floor(inspectedBill.durationMinutes / 60)} ຊມ ${inspectedBill.durationMinutes % 60} ນາທີ)` : ''}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-[10px] text-slate-600">
                    <span>ພະນັກງານ:</span>
                    <span>{inspectedBill.staffName}</span>
                  </div>
                </div>

                {/* Items Table */}
                <div className="py-1 space-y-1.5 border-b border-dashed border-slate-400">
                  <div className="flex justify-between font-bold text-[11px] text-slate-700 pb-0.5 border-b border-slate-300">
                    <span>ລາຍການ</span>
                    <span>ລວມ</span>
                  </div>

                  {/* KTV Room Charge Line */}
                  {getResolvedRoomCharge(inspectedBill) > 0 && (() => {
                    const inspectedDurMins = resolveBillDurationMinutes(inspectedBill);
                    const inspectedRoomFee = getResolvedRoomCharge(inspectedBill);
                    return (
                    <div className="flex justify-between text-slate-800">
                      <div>
                        <div className="font-bold">
                          ຄ່າຫ້ອງ ({inspectedBill.roomName || 'KTV'})
                          {inspectedBill.isRoomChargePaid ? ' (ຈ່າຍກ່ອນແລ້ວ)' : ''}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {inspectedDurMins > 0 ? `${Math.floor(inspectedDurMins / 60)} ຊມ ${inspectedDurMins % 60} ນາທີ` : 'ນັບຕາມເວລາ'}
                        </div>
                      </div>
                      <div className="font-bold">
                        {formatCurrency(inspectedRoomFee, settings.currencySymbol)}
                      </div>
                    </div>
                    );
                  })()}

                  {/* Products & Services List */}
                  {inspectedBill.items.map((it, idx) => (
                    <div key={idx} className="flex justify-between items-start text-slate-800">
                      <div className="pr-2">
                        <div className="font-semibold">{it.productName}</div>
                        <div className="text-[10px] text-slate-500">
                          {it.quantity} {it.unit} × {formatCurrency(it.price, '')}
                          {it.sellerName ? ` • ຜູ້ເສີບ: ${it.sellerName}` : ''}
                        </div>
                      </div>
                      <div className="font-bold text-right shrink-0">
                        {formatCurrency(it.total, settings.currencySymbol)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Bill Financial Totals */}
                <div className="space-y-1 pt-1 text-[11px]">
                  <div className="flex justify-between text-slate-600">
                    <span>ລວມເງິນ (Subtotal):</span>
                    <span>{formatCurrency(getResolvedBillTotal(inspectedBill) + (inspectedBill.discount || 0), settings.currencySymbol)}</span>
                  </div>
                  {inspectedBill.discount > 0 && (
                    <div className="flex justify-between text-rose-600 font-bold">
                      <span>ສ່ວນຫຼຸດ (Discount):</span>
                      <span>-{formatCurrency(inspectedBill.discount, settings.currencySymbol)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-black text-slate-900 pt-1 border-t border-slate-400">
                    <span>ຍອດລວມສຸດທິ (Total):</span>
                    <span>{formatCurrency(getResolvedBillTotal(inspectedBill), settings.currencySymbol)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>ການຊຳລະ:</span>
                    <span>{inspectedBill.payment?.method === 'transfer' ? 'ເງິນໂອນ (Transfer)' : 'ເງິນສົດ (Cash)'}</span>
                  </div>
                </div>

                {/* Receipt Footer */}
                <div className="text-center text-[10px] text-slate-500 pt-2 border-t border-dashed border-slate-400">
                  🙏 ຂອບໃຈລູກຄ້າທຸກທ່ານທີ່ມາອຸດໜູນ 689 KTV 🙏
                </div>
              </div>
            )}

            {/* Content: Mode 3 - Financial & Profit Breakdown for Business */}
            {inspectedBillMode === 'financial' && (
              <div className="space-y-3 bg-slate-950 p-4 rounded-2xl border border-slate-800 text-xs">
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {inspectedBill.items.map((it, idx) => {
                    const matched =
                      productLookup.get(it.productId) ||
                      productLookup.get(it.productName.trim().toLowerCase());
                    const cost =
                      it.costPrice !== undefined ? it.costPrice : matched?.costPrice ?? 0;
                    const itemTotalCost = it.quantity * cost;
                    const itemProfit = it.total - itemTotalCost;

                    return (
                      <div key={idx} className="py-1.5 border-b border-slate-800/60">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-semibold text-slate-200">{it.productName}</span>
                            <span className="text-[10px] text-slate-400 block">
                              {it.quantity} {it.unit} × {formatCurrency(it.price, '')}
                              {it.sellerName ? ` (ຜູ້ຂາຍ: ${it.sellerName})` : ''}
                            </span>
                          </div>
                          <span className="font-mono text-slate-200 font-bold">
                            {formatCurrency(it.total, settings.currencySymbol)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-slate-400 mt-0.5 pt-0.5 border-t border-slate-800/40">
                          <span>ຕົ້ນທຶນ: {formatCurrency(itemTotalCost, '')}</span>
                          <span className="text-emerald-400 font-bold font-mono">
                            ກຳໄລ: +{formatCurrency(itemProfit, settings.currencySymbol)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {(() => {
                  const { billItemsCost, billProfit } = getBillCostAndProfit(inspectedBill);
                  const resolvedBillTotal = getResolvedBillTotal(inspectedBill);
                  return (
                    <div className="space-y-1.5 pt-2 border-t border-slate-800 text-xs">
                      <div className="flex justify-between text-slate-400">
                        <span>ລວມເງິນ:</span>
                        <span>{formatCurrency(resolvedBillTotal + (inspectedBill.discount || 0), settings.currencySymbol)}</span>
                      </div>
                      {inspectedBill.discount > 0 && (
                        <div className="flex justify-between text-rose-400">
                          <span>ສ່ວນຫຼຸດ:</span>
                          <span>-{formatCurrency(inspectedBill.discount, settings.currencySymbol)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-slate-400">
                        <span>ຕົ້ນທຶນສິນຄ້ານຳເຂົ້າ:</span>
                        <span className="font-mono text-rose-400">
                          {formatCurrency(billItemsCost, settings.currencySymbol)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm font-bold text-amber-300 pt-1 border-t border-slate-800">
                        <span>ຍອດສຸດທິ:</span>
                        <span>{formatCurrency(resolvedBillTotal, settings.currencySymbol)}</span>
                      </div>
                      <div className="flex justify-between text-base font-black text-emerald-400 pt-1 border-t border-slate-700 bg-emerald-950/40 px-2.5 py-1.5 rounded-xl">
                        <span>ຍອດກຳໄລບິນນີ້:</span>
                        <span>+{formatCurrency(billProfit, settings.currencySymbol)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Reprint & Action Buttons */}
            <div className="space-y-2 pt-1 border-t border-slate-800">
              <div className="grid grid-cols-2 gap-2">
                {/* Print via Bluetooth */}
                <button
                  type="button"
                  onClick={() => handlePrintBillBluetooth(inspectedBill)}
                  disabled={isPrintingBt}
                  className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 active:scale-95 text-white text-xs font-bold shadow-md shadow-rose-500/20 flex items-center justify-center gap-1.5 cursor-pointer touch-manipulation disabled:opacity-50"
                  title="ພິມໃບເສັດຄືນຜ່ານ Bluetooth Thermal Printer"
                >
                  <Printer className="w-4 h-4" />
                  <span>{isPrintingBt ? 'ກຳລັງພິມ...' : '🖨️ ພິມຄືນ Bluetooth'}</span>
                </button>

                {/* Full Billing & Thermal Screen */}
                <button
                  type="button"
                  onClick={() => {
                    const toReprint = inspectedBill;
                    setInspectedBill(null);
                    if (onReprintBill) {
                      onReprintBill(toReprint);
                    }
                  }}
                  className="py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 active:scale-95 text-white text-xs font-bold shadow-md shadow-sky-600/20 flex items-center justify-center gap-1.5 cursor-pointer touch-manipulation"
                  title="ເປີດໜ້າຈໍພິມເຕັມຮູບແບບ (ປັບຂະໜາດເຈ້ຍ 58mm/80mm, ຟອນ ແລະ ເປີເຊັນ)"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>🔍 ເປີດໜ້າຈໍພິມເຕັມ</span>
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setInspectedBill(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 text-xs font-semibold cursor-pointer touch-manipulation"
                >
                  ປິດ
                </button>
                {currentRole === 'admin' && onDeleteBill && (
                  <button
                    type="button"
                    onClick={() => {
                      const toDelete = inspectedBill;
                      openDeleteSingleBill(toDelete);
                    }}
                    className="py-2.5 px-4 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-800 active:scale-95 text-rose-300 hover:text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all touch-manipulation"
                    title="Admin ລຶບໃບບິນນີ້ອອກຈາກລະບົບ"
                  >
                    <Trash2 className="w-4 h-4 text-rose-400" />
                    <span>ລຶບໃບບິນ (Admin)</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Delete Confirmation Modal (In-App PIN Guarded - Admin Only) */}
      {currentRole === 'admin' && deleteModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-rose-900/60 rounded-3xl p-6 w-full max-w-md shadow-2xl text-white relative animate-fadeIn">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-950/90 border border-rose-700/60 flex items-center justify-center text-rose-400">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-black text-sm text-slate-100">{deleteModal.title}</h4>
                  <p className="text-[11px] text-rose-400 font-semibold">ຢືນຢັນສິດ Admin ເພື່ອລຶບຂໍ້ມູນ</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteModal((prev) => ({ ...prev, isOpen: false }))}
                className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Warning Message & Details */}
            <div className="space-y-3 mb-5">
              <div className="bg-rose-950/30 border border-rose-800/40 rounded-2xl p-3 text-xs text-rose-200">
                <p className="leading-relaxed">{deleteModal.description}</p>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>ຈຳນວນໃບບິນທີ່ຈະຖືກລຶບ:</span>
                  <span className="font-mono font-bold text-amber-400">{deleteModal.count} ບິນ</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>ຍອດຂາຍລວມທີ່ຈະຖືກລຶບ:</span>
                  <span className="font-mono font-bold text-rose-400">
                    {formatCurrency(deleteModal.totalAmount, settings.currencySymbol)}
                  </span>
                </div>
              </div>

              {/* Admin PIN Input */}
              <div className="pt-2">
                <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  <span>ປ້ອນລະຫັດ Admin PIN ເພື່ອຢືນຢັນ:</span>
                </label>
                <div className="relative">
                  <input
                    type={showPinInput ? 'text' : 'password'}
                    autoFocus
                    maxLength={10}
                    placeholder="ປ້ອນລະຫັດ PIN (ເລີ່ມຕົ້ນ: 8888)"
                    value={adminPinInput}
                    onChange={(e) => {
                      setAdminPinInput(e.target.value);
                      if (pinError) setPinError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConfirmDelete();
                    }}
                    className="w-full bg-slate-950 border border-slate-700 focus:border-rose-500 rounded-2xl px-4 py-3 text-sm text-center font-mono tracking-widest text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPinInput(!showPinInput)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 cursor-pointer"
                  >
                    {showPinInput ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {pinError && (
                  <p className="text-rose-400 text-[11px] font-bold mt-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{pinError}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setDeleteModal((prev) => ({ ...prev, isOpen: false }))}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
              >
                ຍົກເລີກ (Cancel)
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-black shadow-lg shadow-rose-600/30 cursor-pointer transition-all flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>ຢືນຢັນລຶບ (Confirm)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
