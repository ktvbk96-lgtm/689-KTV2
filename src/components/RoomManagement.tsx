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
} from 'lucide-react';
import { Room, RoomPackage, Product, StaffMember, AppSettings, CartItem } from '../types';
import { formatCurrency } from '../lib/storage';

interface RoomManagementProps {
  rooms: Room[];
  packages: RoomPackage[];
  products: Product[];
  staffList: StaffMember[];
  settings: AppSettings;
  currentStaff?: StaffMember;
  onUpdateRooms: (updatedRooms: Room[]) => void;
  onCheckoutRoom: (
    room: Room,
    roomCharge: number,
    durationMinutes: number,
    startTimeStr?: string,
    endTimeStr?: string,
    timeRangeStr?: string
  ) => void;
}

export const RoomManagement: React.FC<RoomManagementProps> = ({
  rooms,
  packages,
  products,
  staffList,
  settings,
  currentStaff,
  onUpdateRooms,
  onCheckoutRoom,
}) => {
  // Live ticker for time
  const [now, setNow] = useState<Date>(new Date());

  // Modal states: Open Room
  const [openingRoom, setOpeningRoom] = useState<Room | null>(null);
  const [pricingChoice, setPricingChoice] = useState<'package' | 'fixed_hourly'>('fixed_hourly');
  const [selectedPackageId, setSelectedPackageId] = useState<string>(packages[0]?.id || '');
  const [customHourlyRate, setCustomHourlyRate] = useState<number>(settings.defaultHourlyRate);
  const [bookedHours, setBookedHours] = useState<number>(4); // Default 4 hours as requested!
  const [openedByStaffId, setOpenedByStaffId] = useState<string>(currentStaff?.id || staffList[0]?.id || '');

  // Room details / Add order modal
  const [selectedRoomForDetails, setSelectedRoomForDetails] = useState<Room | null>(null);
  const [orderSearch, setOrderSearch] = useState<string>('');
  const [orderStaffId, setOrderStaffId] = useState<string>(currentStaff?.id || staffList[0]?.id || '');

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
    hoursOrPackage: { type: 'package' | 'fixed_hourly'; hours?: number; packageId?: string }
  ): { targetDate: Date; hoursLabel: string } => {
    let target = new Date(startDate.getTime());
    let hoursLabel = '';

    if (hoursOrPackage.type === 'package') {
      const pkg = packages.find((p) => p.id === hoursOrPackage.packageId);
      const durationMins = pkg ? pkg.durationMinutes : 120;
      target = new Date(startDate.getTime() + durationMins * 60 * 1000);
      hoursLabel = `${(durationMins / 60).toFixed(0)} ຊົ່ວໂມງ (${pkg?.name || ''})`;
    } else {
      const h = hoursOrPackage.hours || 4;
      target = new Date(startDate.getTime() + h * 60 * 60 * 1000);
      hoursLabel = `${h} ຊົ່ວໂມງ`;
    }

    return { targetDate: target, hoursLabel };
  };

  const calculateRoomFee = (room: Room): number => {
    if (room.status !== 'in_use' || !room.openedAt) return 0;

    if (room.pricingType === 'package') {
      const pkg = packages.find((p) => p.id === room.packageId);
      return pkg ? pkg.price : 0;
    }

    // Fixed hourly rate (if booked specific hours, charge booked hours or actual duration, whichever is greater)
    const minutes = calculateDurationMinutes(room.openedAt);
    const actualHours = Math.max(0.5, Math.ceil(minutes / 30) * 0.5);
    const hoursToCharge = room.bookedHours ? Math.max(room.bookedHours, actualHours) : actualHours;
    return Math.round(hoursToCharge * room.hourlyRate);
  };

  // Open Room action
  const handleOpenRoomSubmit = () => {
    if (!openingRoom) return;

    const staff = staffList.find((s) => s.id === openedByStaffId) || currentStaff;
    const pkg = packages.find((p) => p.id === selectedPackageId);
    const openTime = new Date();

    const { targetDate } = calculateTargetEndTime(openTime, {
      type: pricingChoice,
      hours: bookedHours,
      packageId: selectedPackageId,
    });

    const updatedRooms = rooms.map((r) => {
      if (r.id === openingRoom.id) {
        return {
          ...r,
          status: 'in_use' as const,
          pricingType: pricingChoice,
          packageId: pricingChoice === 'package' ? selectedPackageId : undefined,
          packageName: pricingChoice === 'package' ? pkg?.name : undefined,
          hourlyRate: pricingChoice === 'fixed_hourly' ? customHourlyRate : r.hourlyRate,
          bookedHours: pricingChoice === 'fixed_hourly' ? bookedHours : (pkg ? pkg.durationMinutes / 60 : 2),
          openedAt: openTime.toISOString(),
          targetEndTime: targetDate.toISOString(),
          openedByStaffId: staff?.id,
          openedByStaffName: staff?.name,
          orders: [],
        };
      }
      return r;
    });

    onUpdateRooms(updatedRooms);
    setOpeningRoom(null);
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
    };

    const updatedRooms = rooms.map((r) => (r.id === room.id ? updatedRoom : r));
    onUpdateRooms(updatedRooms);
    setSelectedRoomForDetails(updatedRoom);
  };

  // Add Item to Room
  const handleAddItemToRoom = (product: Product) => {
    if (!selectedRoomForDetails) return;

    if (product.stock <= 0 && product.category !== 'service') {
      alert(`ສິນຄ້າ "${product.name}" ໝົດສະຕັອກແລ້ວ! ບໍ່ສາມາດເພີ່ມໄດ້`);
      return;
    }

    const server = staffList.find((s) => s.id === orderStaffId) || currentStaff;

    const newOrder = {
      id: 'order-' + Date.now(),
      product,
      quantity: 1,
      price: product.salePrice,
      orderedAt: new Date().toISOString(),
      sellerId: server?.id,
      sellerName: server?.name,
    };

    const updatedRoom: Room = {
      ...selectedRoomForDetails,
      orders: [...selectedRoomForDetails.orders, newOrder],
    };

    const updatedRooms = rooms.map((r) => (r.id === selectedRoomForDetails.id ? updatedRoom : r));
    onUpdateRooms(updatedRooms);
    setSelectedRoomForDetails(updatedRoom);
  };

  // Remove or change item quantity in room
  const handleUpdateOrderItem = (orderId: string, delta: number) => {
    if (!selectedRoomForDetails) return;

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
    };

    const updatedRooms = rooms.map((r) => (r.id === selectedRoomForDetails.id ? updatedRoom : r));
    onUpdateRooms(updatedRooms);
    setSelectedRoomForDetails(updatedRoom);
  };

  const handleCheckoutClick = (room: Room) => {
    const duration = calculateDurationMinutes(room.openedAt);
    const roomFee = calculateRoomFee(room);

    const startStr = room.openedAt
      ? new Date(room.openedAt).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false })
      : undefined;
    const endStr = new Date().toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false });
    const targetStr = room.targetEndTime
      ? new Date(room.targetEndTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false })
      : undefined;

    const timeRangeStr = startStr
      ? `${startStr} - ${endStr} (ກຳນົດ: ${startStr} - ${targetStr || endStr})`
      : undefined;

    onCheckoutRoom(room, roomFee, duration, startStr, endStr, timeRangeStr);
  };

  // Preview target time in modal
  const previewEndTime = calculateTargetEndTime(now, {
    type: pricingChoice,
    hours: bookedHours,
    packageId: selectedPackageId,
  });

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
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

        {/* Room status counters */}
        <div className="flex items-center gap-2 text-xs font-semibold relative">
          <div className="px-3 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700 text-emerald-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>ຫ້ອງວ່າງ: {rooms.filter((r) => r.status === 'available').length}</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-indigo-950/80 border border-indigo-500/50 text-indigo-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
            <span>ກຳລັງໃຊ້ງານ: {rooms.filter((r) => r.status === 'in_use').length}</span>
          </div>
        </div>
      </div>

      {/* Rooms Grid with Neon Indigo / Violet Ambiance */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {rooms.map((room) => {
          const isInUse = room.status === 'in_use';
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
                    {/* Time Window Banner: e.g. 08:00 -> 12:00 (4 hrs) */}
                    {startFormatted && targetFormatted && (
                      <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-700/80 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-rose-400" />
                            <span>ຊ່ວງເວລາ:</span>
                          </span>
                          <span className="font-bold text-slate-100 font-mono">
                            {startFormatted} ຫາ {targetFormatted}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>ໄລຍະເວລາ:</span>
                          <span className="text-amber-400 font-semibold">
                            {room.bookedHours ? `${room.bookedHours} ຊົ່ວໂມງ` : 'ຕາມຊົ່ວໂມງ'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Live Timer & Remaining Countdown */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {/* Elapsed */}
                      <div className="bg-slate-900/60 p-2 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-400 block mb-0.5">ໃຊ້ງານມາແລ້ວ:</span>
                        <span className="font-mono font-bold text-slate-200">
                          {formatElapsedTimer(room.openedAt)}
                        </span>
                      </div>

                      {/* Remaining / Overtime */}
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
                    </div>

                    {/* Progress bar */}
                    {remainingInfo && (
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            remainingInfo.isOvertime ? 'bg-amber-500' : 'bg-rose-500'
                          }`}
                          style={{ width: `${remainingInfo.percent}%` }}
                        />
                      </div>
                    )}

                    {/* Pricing Type Badge */}
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
                      <span className="text-slate-400">ປະເພດລາຄາ:</span>
                      <span className="font-semibold text-rose-300">
                        {room.pricingType === 'package'
                          ? `ແພັກເກັດ: ${room.packageName}`
                          : `ລາຄາຕາຍຕົວ (${formatCurrency(room.hourlyRate, settings.currencySymbol)}/ຊມ)`}
                      </span>
                    </div>

                    {/* Orders count */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">ລາຍການສັ່ງເພີ່ມ:</span>
                      <span className="font-bold text-slate-200">
                        {room.orders.reduce((sum, o) => sum + o.quantity, 0)} ລາຍການ
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
                  <div className="py-6 text-center text-slate-500 text-xs">
                    <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-30 text-rose-400" />
                    <span>ຫ້ອງພ້ອມໃຫ້ບໍລິການ</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-2">
                {isInUse ? (
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
                ) : (
                  <button
                    onClick={() => {
                      setOpeningRoom(room);
                      setCustomHourlyRate(room.hourlyRate);
                      setPricingChoice('fixed_hourly');
                      setBookedHours(4); // Default 4 hours as requested!
                      setSelectedPackageId(packages[0]?.id || '');
                    }}
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

            {/* Calculated Time Preview Banner */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-r from-rose-950/70 via-slate-850 to-amber-950/70 border border-rose-500/40 mb-4 shadow-md">
              <div className="flex items-center gap-2 text-xs text-rose-300 font-bold mb-1">
                <CalendarCheck className="w-4 h-4 text-amber-400" />
                <span>ຄຳນວນເວລາອັດຕະໂນມັດ:</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div>
                  <span className="text-slate-400 text-xs block">ເວລາເລີ່ມ:</span>
                  <span className="font-mono font-black text-white text-base">
                    {formatTimeHHMM(now)}
                  </span>
                </div>
                <div className="text-center px-3 py-1 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-amber-400 font-bold">
                  ➔ {previewEndTime.hoursLabel} ➔
                </div>
                <div className="text-right">
                  <span className="text-slate-400 text-xs block">ເວລາສິ້ນສຸດ:</span>
                  <span className="font-mono font-black text-rose-400 text-base">
                    {formatTimeHHMM(previewEndTime.targetDate)}
                  </span>
                </div>
              </div>
            </div>

            {/* Pricing Choices Tab */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-300 mb-2">
                ເລືອກຮູບແບບລາຄາ:
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPricingChoice('fixed_hourly')}
                  className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                    pricingChoice === 'fixed_hourly'
                      ? 'bg-amber-950/50 border-amber-500 text-amber-200 shadow-md shadow-amber-950/40'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Timer className="w-4 h-4 text-amber-400" />
                    <span className="font-bold text-xs text-white">Choice 2: ລາຄາຕາຍຕົວ</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    ເລືອກຈຳນວນຊົ່ວໂມງ (ເຊັ່ນ 4 ຊມ)
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setPricingChoice('package')}
                  className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                    pricingChoice === 'package'
                      ? 'bg-rose-950/50 border-rose-500 text-rose-200 shadow-md shadow-rose-950/40'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="w-4 h-4 text-rose-400" />
                    <span className="font-bold text-xs text-white">Choice 1: ແພັກເກັດຮ້ານ</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    ລາຄາເໝົາລວມ ພ້ອມເຄື່ອງດື່ມແຖມ
                  </p>
                </button>
              </div>
            </div>

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
                        onClick={() => setBookedHours(h)}
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

            {/* If Choice 1: Package List */}
            {pricingChoice === 'package' && (
              <div className="mb-4 space-y-2">
                <label className="block text-xs text-slate-400">ເລືອກແພັກເກັດ:</label>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {packages.map((pkg) => (
                    <div
                      key={pkg.id}
                      onClick={() => setSelectedPackageId(pkg.id)}
                      className={`p-3 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                        selectedPackageId === pkg.id
                          ? 'bg-rose-900/40 border-rose-500 text-white'
                          : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <div>
                        <h4 className="font-bold text-xs text-slate-100">{pkg.name}</h4>
                        <p className="text-[11px] text-slate-400">{pkg.description}</p>
                      </div>
                      <span className="font-mono font-bold text-xs text-amber-400">
                        {formatCurrency(pkg.price, settings.currencySymbol)}
                      </span>
                    </div>
                  ))}
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

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpeningRoom(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                ຍົກເລີກ
              </button>
              <button
                type="button"
                onClick={handleOpenRoomSubmit}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                ຢືນຢັນເປີດຫ້ອງ ({previewEndTime.hoursLabel})
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
                    <span className="text-slate-300 font-semibold">
                      ເລີ່ມ: {selectedRoomForDetails.openedAt ? new Date(selectedRoomForDetails.openedAt).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''} - ໝົດ: {selectedRoomForDetails.targetEndTime ? new Date(selectedRoomForDetails.targetEndTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick Extend button */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExtendRoomTime(selectedRoomForDetails, 1)}
                  className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1 cursor-pointer transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>ຕໍ່ເວລາ +1 ຊົ່ວໂມງ</span>
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
              {/* Left Column: Current Orders (5 cols) */}
              <div className="md:col-span-5 flex flex-col border border-slate-800 rounded-2xl p-4 bg-slate-950/60 overflow-hidden">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
                  <h4 className="font-bold text-xs text-slate-200">
                    ລາຍການທີ່ສັ່ງແລ້ວ ({selectedRoomForDetails.orders.length})
                  </h4>
                  <span className="text-xs font-mono font-bold text-amber-400">
                    ຄ່າຫ້ອງ: {formatCurrency(calculateRoomFee(selectedRoomForDetails), settings.currencySymbol)}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                  {selectedRoomForDetails.orders.length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs">
                      ຍັງບໍ່ທັນມີລາຍການສັ່ງເພີ່ມ<br />
                      ເລືອກສິນຄ້າຈາກເມນູດ້ານຂວາເພື່ອສັ່ງເຂົ້າຫ້ອງ
                    </div>
                  ) : (
                    selectedRoomForDetails.orders.map((ord) => (
                      <div
                        key={ord.id}
                        className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-between gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <h5 className="font-bold text-xs text-slate-100 truncate">
                            {ord.product.name}
                          </h5>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                            <span className="font-mono text-amber-400">
                              {formatCurrency(ord.price, settings.currencySymbol)}
                            </span>
                            {ord.sellerName && (
                              <span className="bg-purple-900/50 text-purple-300 px-1 rounded">
                                {ord.sellerName}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Quantity modifier */}
                        <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-700">
                          <button
                            onClick={() => handleUpdateOrderItem(ord.id, -1)}
                            className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-xs flex items-center justify-center cursor-pointer"
                          >
                            -
                          </button>
                          <span className="w-5 text-center text-xs font-mono font-bold">
                            {ord.quantity}
                          </span>
                          <button
                            onClick={() => handleUpdateOrderItem(ord.id, 1)}
                            className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-xs flex items-center justify-center cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

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
                        <button
                          key={prod.id}
                          disabled={isOutOfStock}
                          onClick={() => handleAddItemToRoom(prod)}
                          className={`p-2 rounded-2xl border text-left flex gap-2.5 transition-all cursor-pointer ${
                            isOutOfStock
                              ? 'bg-rose-950/20 border-rose-900/50 opacity-60 cursor-not-allowed'
                              : `bg-slate-800/80 border-slate-700/80 ${badgeInfo.border} hover:bg-slate-750`
                          }`}
                        >
                          {/* Image thumbnail */}
                          <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-900 shrink-0 border border-slate-700 flex items-center justify-center">
                            {prod.imageUrl ? (
                              <img
                                src={prod.imageUrl}
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
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {prod.unit}
                                </span>
                              </div>
                              <h5 className="font-bold text-xs text-slate-200 truncate">
                                {prod.name}
                              </h5>
                            </div>

                            <div className="flex items-center justify-between text-xs mt-1 pt-0.5 border-t border-slate-700/50">
                              <span className={`font-mono font-bold ${badgeInfo.text}`}>
                                {formatCurrency(prod.salePrice, settings.currencySymbol)}
                              </span>
                              {isOutOfStock ? (
                                <span className="text-[9px] font-bold text-rose-400 bg-rose-950 px-1 py-0.2 rounded">
                                  ໝົດ
                                </span>
                              ) : (
                                <span className="p-0.5 rounded-lg bg-slate-700 hover:bg-white/20 text-slate-200 transition-colors">
                                  <Plus className="w-3 h-3" />
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <button
                onClick={() => setSelectedRoomForDetails(null)}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                ປິດໜ້າຕ່າງ
              </button>

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
    </div>
  );
};
