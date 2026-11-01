import React, { useState } from 'react';
import {
  Settings,
  Printer,
  Bluetooth,
  KeyRound,
  Users,
  Store,
  DollarSign,
  Package,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Save,
  DoorOpen,
  Edit,
  X,
  Palette,
  UserCheck,
  Check,
  Eye,
  EyeOff,
  Lock,
  Camera,
  Upload,
  Image as ImageIcon,
  ShieldAlert,
} from 'lucide-react';
import { AppSettings, StaffMember, RoomPackage, Room, Product, AppThemeId } from '../types';
import {
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
  isWebBluetoothSupported,
} from '../lib/bluetoothPrinter';
import { formatCurrency } from '../lib/storage';
import { THEMES } from '../lib/theme';

interface SettingsModalProps {
  settings: AppSettings;
  staffList: StaffMember[];
  packages: RoomPackage[];
  rooms: Room[];
  products?: Product[];
  onSaveSettings: (newSettings: AppSettings) => void;
  onSaveStaff: (newStaff: StaffMember[]) => void;
  onSavePackages: (newPackages: RoomPackage[]) => void;
  onSaveRooms: (newRooms: Room[]) => void;
  onSaveProducts?: (newProducts: Product[]) => void;
  bluetoothConnected: boolean;
  onRefreshBluetoothStatus: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  staffList,
  packages,
  rooms,
  products = [],
  onSaveSettings,
  onSaveStaff,
  onSavePackages,
  onSaveRooms,
  onSaveProducts,
  bluetoothConnected,
  onRefreshBluetoothStatus,
}) => {
  const [formData, setFormData] = useState<AppSettings>({ ...settings });
  const [localStaff, setLocalStaff] = useState<StaffMember[]>([...staffList]);
  const [localPackages, setLocalPackages] = useState<RoomPackage[]>([...packages]);
  const [localRooms, setLocalRooms] = useState<Room[]>([...rooms]);
  const [localProducts, setLocalProducts] = useState<Product[]>([...products]);

  const [activeTab, setActiveTab] = useState<
    'theme' | 'sellers' | 'rooms' | 'receipt' | 'printer' | 'security' | 'packages'
  >('theme');

  // Staff Management inputs
  const [newStaffName, setNewStaffName] = useState<string>('');
  const [newStaffPhone, setNewStaffPhone] = useState<string>('');
  const [newStaffRole, setNewStaffRole] = useState<'admin' | 'staff'>('staff');

  // Staff Edit modal state
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [editStaffName, setEditStaffName] = useState<string>('');
  const [editStaffPhone, setEditStaffPhone] = useState<string>('');
  const [editStaffRole, setEditStaffRole] = useState<'admin' | 'staff'>('staff');

  // New Room inputs
  const [newRoomName, setNewRoomName] = useState<string>('');
  const [newRoomCapacity, setNewRoomCapacity] = useState<number>(8);
  const [newRoomHourlyRate, setNewRoomHourlyRate] = useState<number>(
    settings.defaultHourlyRate || 80000
  );

  // Edit Room Modal state
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editRoomName, setEditRoomName] = useState<string>('');
  const [editRoomCapacity, setEditRoomCapacity] = useState<number>(8);
  const [editRoomHourlyRate, setEditRoomHourlyRate] = useState<number>(80000);

  // Bluetooth connection states
  const [btLoading, setBtLoading] = useState<boolean>(false);
  const [btMessage, setBtMessage] = useState<string>('');
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const handleSaveAll = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(formData);
    onSaveStaff(localStaff);
    onSavePackages(localPackages);
    onSaveRooms(localRooms);
    if (onSaveProducts) {
      onSaveProducts(localProducts);
    }
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleConnectBt = async () => {
    setBtLoading(true);
    setBtMessage('');
    try {
      const res = await connectBluetoothPrinter();
      if (res.connected) {
        setBtMessage(`ເຊື່ອມຕໍ່ສຳເລັດ: ${res.deviceName}`);
        onRefreshBluetoothStatus();
      } else {
        setBtMessage(`ບໍ່ສາມາດເຊື່ອມຕໍ່ໄດ້: ${res.error}`);
      }
    } catch (err: any) {
      setBtMessage(`ຂໍ້ຜິດພາດ: ${err.message}`);
    } finally {
      setBtLoading(false);
    }
  };

  const handleDisconnectBt = async () => {
    await disconnectBluetoothPrinter();
    onRefreshBluetoothStatus();
    setBtMessage('ຕັດການເຊື່ອມຕໍ່ Bluetooth ແລ້ວ');
  };

  // STAFF ACTIONS
  const handleAddStaff = () => {
    if (!newStaffName.trim()) return;
    const newMember: StaffMember = {
      id: 'staff-' + Date.now(),
      name: newStaffName.trim(),
      role: newStaffRole,
      phone: newStaffPhone.trim(),
      active: true,
    };
    const updated = [...localStaff, newMember];
    setLocalStaff(updated);
    onSaveStaff(updated);
    setNewStaffName('');
    setNewStaffPhone('');
  };

  const handleStartEditStaff = (staff: StaffMember) => {
    setEditingStaff(staff);
    setEditStaffName(staff.name);
    setEditStaffPhone(staff.phone || '');
    setEditStaffRole(staff.role);
  };

  const handleSaveEditStaff = () => {
    if (!editingStaff || !editStaffName.trim()) return;
    const updated = localStaff.map((s) => {
      if (s.id === editingStaff.id) {
        return {
          ...s,
          name: editStaffName.trim(),
          phone: editStaffPhone.trim(),
          role: editStaffRole,
        };
      }
      return s;
    });
    setLocalStaff(updated);
    onSaveStaff(updated);
    setEditingStaff(null);
  };

  const handleRemoveStaff = (id: string, name: string) => {
    if (confirm(`ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການລຶບພະນັກງານ "${name}" ອອກຈາກລະບົບ?`)) {
      const updated = localStaff.filter((s) => s.id !== id);
      setLocalStaff(updated);
      onSaveStaff(updated);
    }
  };

  // Toggle seller requirement on a product
  const handleToggleProductRequireSeller = (productId: string) => {
    const updated = localProducts.map((p) => {
      if (p.id === productId) {
        return { ...p, requireSeller: !p.requireSeller };
      }
      return p;
    });
    setLocalProducts(updated);
    if (onSaveProducts) {
      onSaveProducts(updated);
    }
  };

  // Theme selection
  const handleSelectTheme = (themeId: AppThemeId) => {
    const updatedSettings = { ...formData, appTheme: themeId };
    setFormData(updatedSettings);
    onSaveSettings(updatedSettings);
  };

  // ROOM MANAGEMENT ACTIONS
  const handleAddRoom = () => {
    if (!newRoomName.trim()) {
      alert('ກະລຸນາປ້ອນຊື່ ຫຼື ເບີຫ້ອງ!');
      return;
    }
    const newRoom: Room = {
      id: 'room-' + Date.now(),
      name: newRoomName.trim(),
      capacity: newRoomCapacity || 6,
      status: 'available',
      pricingType: 'fixed_hourly',
      hourlyRate: newRoomHourlyRate || 80000,
      orders: [],
    };
    const updated = [...localRooms, newRoom];
    setLocalRooms(updated);
    onSaveRooms(updated);
    setNewRoomName('');
    setNewRoomCapacity(8);
  };

  const handleStartEditRoom = (room: Room) => {
    setEditingRoom(room);
    setEditRoomName(room.name);
    setEditRoomCapacity(room.capacity);
    setEditRoomHourlyRate(room.hourlyRate);
  };

  const handleSaveEditRoom = () => {
    if (!editingRoom || !editRoomName.trim()) return;
    const updated = localRooms.map((r) => {
      if (r.id === editingRoom.id) {
        return {
          ...r,
          name: editRoomName.trim(),
          capacity: editRoomCapacity,
          hourlyRate: editRoomHourlyRate,
        };
      }
      return r;
    });
    setLocalRooms(updated);
    onSaveRooms(updated);
    setEditingRoom(null);
  };

  const handleDeleteRoom = (roomId: string, roomName: string) => {
    const target = localRooms.find((r) => r.id === roomId);
    if (target && target.status === 'in_use') {
      alert(`ຫ້ອງ "${roomName}" ກຳລັງມີລູກຄ້າໃຊ້ງານຢູ່! ບໍ່ສາມາດລຶບໄດ້`);
      return;
    }
    if (confirm(`ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການລຶບ "${roomName}" ອອກຈາກລະບົບ?`)) {
      const updated = localRooms.filter((r) => r.id !== roomId);
      setLocalRooms(updated);
      onSaveRooms(updated);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Settings className="w-6 h-6 text-amber-500" />
            <h1 className="text-xl font-black text-slate-100">
              ຕັ້ງຄ່າລະບົບ 689 KTV (System Settings)
            </h1>
          </div>
          <p className="text-xs text-slate-400">
            ປັບແຕ່ງໂທນສີ, ຈັດການຜູ້ຂາຍ/ພະນັກງານ, ແກ້ໄຂເບີຫ້ອງ, Bluetooth Printer, ແລະ ລະຫັດ PIN
          </p>
        </div>

        {saveSuccess && (
          <div className="px-3 py-1.5 rounded-xl bg-emerald-950 border border-emerald-500 text-emerald-300 text-xs font-bold flex items-center gap-1.5 animate-bounce">
            <CheckCircle2 className="w-4 h-4" />
            <span>ບັນທຶກການຕັ້ງຄ່າສຳເລັດແລ້ວ!</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {[
          { id: 'theme', label: 'ໂທນສີແອັບ (Theme)', icon: Palette },
          { id: 'sellers', label: 'ຜູ້ຂາຍ & ພະນັກງານ', icon: Users },
          { id: 'rooms', label: 'ຈັດການເບີຫ້ອງ (Rooms)', icon: DoorOpen },
          { id: 'receipt', label: 'ຫົວໃບບິນ / ຮ້ານ', icon: Store },
          { id: 'printer', label: 'Bluetooth Printer', icon: Bluetooth },
          { id: 'security', label: 'ລະຫັດ PIN', icon: KeyRound },
          { id: 'packages', label: 'ແພັກເກັດຫ້ອງ', icon: Package },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-slate-950 shadow-md font-black'
                  : 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Contents */}
      <form
        onSubmit={handleSaveAll}
        className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6"
      >
        {/* TAB: THEME COLORS (ເລືອກພື້ນທີ່ສີຂອງ application) */}
        {activeTab === 'theme' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                  <Palette className="w-5 h-5 text-rose-400" />
                  <span>ເລືອກໂທນສີຂອງແອັບພລິເຄຊັນ (App Color Theme)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  ເລືອກໂທນສີພື້ນຫຼັງ ແລະ ສີແສງ Neon ທີ່ທ່ານມັກໃຫ້ສະບາຍຕາ
                </p>
              </div>

              <span className="text-xs font-bold px-3 py-1 rounded-xl bg-slate-800 border border-slate-700 text-amber-300">
                ໂທນປະຈຸບັນ: {THEMES[formData.appTheme || 'neon_ktv']?.nameLao}
              </span>
            </div>

            {/* Themes Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.values(THEMES).map((th) => {
                const isSelected = (formData.appTheme || 'neon_ktv') === th.id;
                return (
                  <div
                    key={th.id}
                    onClick={() => handleSelectTheme(th.id)}
                    className={`p-4 rounded-2xl border-2 transition-all cursor-pointer relative flex flex-col justify-between ${
                      isSelected
                        ? 'border-rose-500 bg-slate-800 shadow-xl shadow-rose-500/10'
                        : 'border-slate-800 bg-slate-800/40 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      {/* Theme Preview Color Swatches */}
                      <div className="flex items-center gap-2 mb-3">
                        <div
                          className="w-8 h-8 rounded-xl border border-white/20 shadow-inner flex items-center justify-center font-bold text-xs"
                          style={{ backgroundColor: th.previewBg }}
                        >
                          <div
                            className="w-3.5 h-3.5 rounded-full"
                            style={{ backgroundColor: th.previewAccent }}
                          />
                        </div>

                        <div>
                          <h4 className="font-bold text-xs text-slate-100">{th.nameLao}</h4>
                          <span className="text-[10px] text-slate-400 font-mono">{th.nameEn}</span>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-400">{th.description}</p>
                    </div>

                    <div className="mt-4 pt-2 border-t border-slate-700/60 flex items-center justify-between">
                      <div
                        className="h-2 w-16 rounded-full bg-gradient-to-r"
                        style={{
                          backgroundImage: `linear-gradient(to right, ${th.previewAccent}, #f59e0b)`,
                        }}
                      />
                      {isSelected ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black text-rose-400">
                          <Check className="w-3.5 h-3.5" />
                          <span>ກຳລັງໃຊ້ງານ</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 hover:text-white">ກົດເລືອກ</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Print Auto-close Toggle */}
            <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-xs text-slate-200">
                    ປິດໜ້າໃບບິນອັດຕະໂນມັດເມື່ອພິມແລ້ວ (Auto-Close After Print)
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    ເມື່ອກົດສັ່ງພິມໃບບິນຜ່ານ Bluetooth ຫຼື ພິມທົ່ວໄປ ລະບົບຈະບັນທຶກ ແລະ
                    ປິດໜ້າໃບບິນທັນທີ
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={formData.autoCloseAfterPrint !== false}
                  onChange={(e) =>
                    setFormData({ ...formData, autoCloseAfterPrint: e.target.checked })
                  }
                  className="w-5 h-5 accent-rose-500 cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB: SELLERS & STAFF MANAGEMENT (ແກ້ໄຂຊື່ຜູ້ຂາຍ, ປັບປ່ຽນຜູ້ຂາຍໃນຕັ້ງຄ່າ) */}
        {activeTab === 'sellers' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-400" />
                  <span>ຈັດການພະນັກງານ ແລະ ຜູ້ຂາຍ (Staff & Sellers)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  ແກ້ໄຂ ຫຼື ປ່ຽນຊື່ພະນັກງານ, ຕັ້ງຄ່າລາຍການສິນຄ້າທີ່ຕ້ອງລະບຸຜູ້ຂາຍ
                </p>
              </div>

              <span className="text-xs font-bold px-3 py-1 rounded-xl bg-purple-950/80 border border-purple-800 text-purple-300">
                {localStaff.length} ຄົນ
              </span>
            </div>

            {/* Add staff form */}
            <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700 space-y-3">
              <span className="text-xs font-bold text-amber-300 block">
                + ເພີ່ມພະນັກງານ / ຜູ້ຂາຍໃໝ່:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <input
                  type="text"
                  placeholder="ຊື່ພະນັກງານ (ຕົວຢ່າງ: ນ້ອຍ, ຕຸກຕາ, ຄຳ...)"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  className="sm:col-span-5 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
                <input
                  type="text"
                  placeholder="ເບີໂທລະສັບ (ທາງເລືອກ)"
                  value={newStaffPhone}
                  onChange={(e) => setNewStaffPhone(e.target.value)}
                  className="sm:col-span-4 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
                <select
                  value={newStaffRole}
                  onChange={(e) => setNewStaffRole(e.target.value as any)}
                  className="sm:col-span-2 bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white"
                >
                  <option value="staff">ພະນັກງານ</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="button"
                  onClick={handleAddStaff}
                  className="sm:col-span-1 py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>ເພີ່ມ</span>
                </button>
              </div>
            </div>

            {/* Staff list with Edit / Rename Action */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-300 block">
                ລາຍຊື່ພະນັກງານ (ກົດດິນສໍເພື່ອແກ້ໄຂ ຫຼື ປ່ຽນຊື່):
              </span>
              {localStaff.map((staff) => (
                <div
                  key={staff.id}
                  className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-700/80 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-900/40 border border-purple-700/50 flex items-center justify-center text-purple-300 font-bold text-xs">
                      {staff.name.slice(0, 2)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-xs text-slate-100">{staff.name}</h4>
                        <span
                          className={`text-[9px] px-2 py-0.2 rounded-full font-bold ${
                            staff.role === 'admin'
                              ? 'bg-amber-950 text-amber-300 border border-amber-600'
                              : 'bg-blue-950 text-blue-300 border border-blue-600'
                          }`}
                        >
                          {staff.role === 'admin' ? 'Admin / ເຈົ້າຂອງຮ້ານ' : 'ພະນັກງານ / ຜູ້ຂາຍ'}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {staff.phone ? `ໂທ: ${staff.phone}` : 'ບໍ່ມີເບີໂທລະສັບ'} • ID: {staff.id}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Edit button */}
                    <button
                      type="button"
                      onClick={() => handleStartEditStaff(staff)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-400 border border-slate-700 transition-colors cursor-pointer"
                      title="ແກ້ໄຂ / ປ່ຽນຊື່ພະນັກງານ"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>

                    {staff.role !== 'admin' && (
                      <button
                        type="button"
                        onClick={() => handleRemoveStaff(staff.id, staff.name)}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-700 transition-colors cursor-pointer"
                        title="ລຶບພະນັກງານ"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Product require seller quick toggles */}
            {localProducts.length > 0 && (
              <div className="pt-4 border-t border-slate-800 space-y-3">
                <div>
                  <h4 className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-fuchsia-400" />
                    <span>ກຳນົດລາຍການສິນຄ້າທີ່ຕ້ອງເລືອກຜູ້ຂາຍ (Require Seller Items)</span>
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    ສິນຄ້າທີ່ມີເຄື່ອງໝາຍຕິກ ຈະບັງຄັບໃຫ້ເລືອກພະນັກງານຜູ້ຂາຍ/ເສີບກ່ອນຂາຍ
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                  {localProducts.map((p) => (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-xl bg-slate-800/50 border border-slate-700/60 flex items-center justify-between"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="text-xs font-bold text-slate-200 block truncate">
                          {p.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {formatCurrency(p.salePrice, formData.currencySymbol)} • {p.category}
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={!!p.requireSeller}
                        onChange={() => handleToggleProductRequireSeller(p.id)}
                        className="w-4 h-4 accent-fuchsia-500 cursor-pointer shrink-0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Modal: Edit Staff */}
            {editingStaff && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl text-white space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                      <Edit className="w-5 h-5 text-purple-400" />
                      <span>ແກ້ໄຂ / ປ່ຽນຊື່ພະນັກງານ</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => setEditingStaff(null)}
                      className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        ຊື່ພະນັກງານ / ຜູ້ຂາຍ:
                      </label>
                      <input
                        type="text"
                        required
                        value={editStaffName}
                        onChange={(e) => setEditStaffName(e.target.value)}
                        placeholder="ຊື່ພະນັກງານ"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">ເບີໂທລະສັບ:</label>
                      <input
                        type="text"
                        value={editStaffPhone}
                        onChange={(e) => setEditStaffPhone(e.target.value)}
                        placeholder="020-xxxx-xxxx"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">ຕຳແໜ່ງ (Role):</label>
                      <select
                        value={editStaffRole}
                        onChange={(e) => setEditStaffRole(e.target.value as any)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                      >
                        <option value="staff">ພະນັກງານທົ່ວໄປ (Staff / ຜູ້ຂາຍ)</option>
                        <option value="admin">Admin (ເຈົ້າຂອງຮ້ານ)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setEditingStaff(null)}
                      className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                    >
                      ຍົກເລີກ
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEditStaff}
                      className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-600/25 cursor-pointer"
                    >
                      ບັນທຶກການແກ້ໄຂ
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: ROOM MANAGEMENT (ແກ້ໄຂເບີຫ້ອງ KTV) */}
        {activeTab === 'rooms' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                  <DoorOpen className="w-5 h-5 text-indigo-400" />
                  <span>ຈັດການເບີຫ້ອງຄາຣາໂອເກະ 689 KTV</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  ເພີ່ມເບີຫ້ອງໃໝ່, ແກ້ໄຂຊື່/ເບີຫ້ອງ, ຄວາມຈຸຄົນ, ແລະ ລາຄາຄ່າຫ້ອງຕໍ່ຊົ່ວໂມງ
                </p>
              </div>
              <span className="text-xs font-bold px-3 py-1 rounded-xl bg-indigo-950/80 border border-indigo-700/50 text-indigo-300">
                ທັງໝົດ {localRooms.length} ຫ້ອງ
              </span>
            </div>

            {/* Add New Room Form */}
            <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700 space-y-3">
              <span className="text-xs font-bold text-amber-300 block">
                + ເພີ່ມເບີຫ້ອງໃໝ່ (Add New Room):
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-5">
                  <label className="block text-[11px] text-slate-400 mb-1">
                    ຊື່ / ເບີຫ້ອງ (Room Name/No):
                  </label>
                  <input
                    type="text"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    placeholder="ຕົວຢ່າງ: ຫ້ອງ VIP 689, ຫ້ອງ 06, ຫ້ອງ 07..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[11px] text-slate-400 mb-1">ຄວາມຈຸ (ຄົນ):</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={newRoomCapacity}
                    onChange={(e) => setNewRoomCapacity(parseInt(e.target.value) || 6)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-slate-400 mb-1">
                    ລາຄາ ({formData.currencySymbol}/ຊມ):
                  </label>
                  <input
                    type="number"
                    step="5000"
                    value={newRoomHourlyRate}
                    onChange={(e) => setNewRoomHourlyRate(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={handleAddRoom}
                    className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-bold text-xs shadow-md shadow-indigo-600/30 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>ເພີ່ມຫ້ອງ</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Room List Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {localRooms.map((room) => {
                const isInUse = room.status === 'in_use';
                return (
                  <div
                    key={room.id}
                    className={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                      isInUse
                        ? 'bg-rose-950/20 border-rose-800/60'
                        : 'bg-slate-800/50 border-slate-700/80 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm ${
                          isInUse
                            ? 'bg-rose-500/20 border border-rose-500/50 text-rose-400 animate-pulse'
                            : 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-400'
                        }`}
                      >
                        <DoorOpen className="w-6 h-6" />
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-extrabold text-sm text-slate-100">{room.name}</h4>
                          {isInUse ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/50 text-rose-300">
                              ກຳລັງໃຊ້ງານ
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-700/50 text-emerald-300">
                              ຫວ່າງ (ພ້ອມໃຊ້)
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-400 mt-0.5">
                          ຄວາມຈຸ: <span className="font-bold text-slate-300">{room.capacity} ຄົນ</span>{' '}
                          • ລາຄາ:{' '}
                          <span className="font-bold font-mono text-amber-400">
                            {formatCurrency(room.hourlyRate, formData.currencySymbol)}
                          </span>
                          /ຊົ່ວໂມງ
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleStartEditRoom(room)}
                        className="p-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors cursor-pointer"
                        title="ແກ້ໄຂເບີຫ້ອງ"
                      >
                        <Edit className="w-4 h-4 text-amber-400" />
                      </button>

                      <button
                        type="button"
                        disabled={isInUse}
                        onClick={() => handleDeleteRoom(room.id, room.name)}
                        className={`p-2 rounded-xl transition-colors ${
                          isInUse
                            ? 'opacity-40 cursor-not-allowed text-slate-600 bg-slate-800'
                            : 'bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 cursor-pointer'
                        }`}
                        title={isInUse ? 'ຫ້ອງກຳລັງໃຊ້ງານ ບໍ່ສາມາດລຶບໄດ້' : 'ລຶບຫ້ອງ'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal: Edit Room */}
            {editingRoom && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl text-white space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                      <Edit className="w-5 h-5 text-amber-400" />
                      <span>ແກ້ໄຂເບີຫ້ອງ (Edit Room)</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => setEditingRoom(null)}
                      className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        ຊື່ / ເບີຫ້ອງ (Room Name/Number):
                      </label>
                      <input
                        type="text"
                        required
                        value={editRoomName}
                        onChange={(e) => setEditRoomName(e.target.value)}
                        placeholder="ຕົວຢ່າງ: ຫ້ອງ VIP 689, ຫ້ອງ 01"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">ຄວາມຈຸ (ຄົນ):</label>
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={editRoomCapacity}
                          onChange={(e) => setEditRoomCapacity(parseInt(e.target.value) || 1)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          ລາຄາ ({formData.currencySymbol}/ຊມ):
                        </label>
                        <input
                          type="number"
                          step="5000"
                          value={editRoomHourlyRate}
                          onChange={(e) =>
                            setEditRoomHourlyRate(parseFloat(e.target.value) || 0)
                          }
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setEditingRoom(null)}
                      className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                    >
                      ຍົກເລີກ
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEditRoom}
                      className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 text-slate-950 font-black text-xs shadow-lg shadow-rose-500/20 cursor-pointer"
                    >
                      ບັນທຶກການແກ້ໄຂ
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: RECEIPT & SHOP SETTINGS */}
        {activeTab === 'receipt' && (
          <div className="space-y-4">
            <h3 className="font-bold text-sm text-slate-200 border-b border-slate-800 pb-2 flex items-center justify-between">
              <span>ປັບແຕ່ງຫົວໃບບິນ ແລະ ຂໍ້ມູນຮ້ານ 689 KTV</span>
              <span className="text-[11px] text-amber-400 font-normal">ຮອງຮັບການໃສ່ຮູບພາບ/ໂລໂກ້</span>
            </h3>

            {/* Receipt Logo Image Upload Section */}
            <div className="p-4 rounded-2xl bg-slate-850 border border-slate-700/80 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4 text-rose-400" />
                    <span>ຮູບພາບ/ໂລໂກ້ ສ່ວນຫົວຂອງໃບບິນ (Receipt Header Logo)</span>
                  </span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    ຮູບນີ້ຈະຖືກພິມອອກຢູ່ສ່ວນເທິງສຸດຂອງໃບບິນ ແລະ ສະແດງໃນໃບຮັບເງິນທັງໝົດ
                  </p>
                </div>
                {formData.receiptLogoUrl && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, receiptLogoUrl: '' })}
                    className="text-xs text-rose-400 hover:text-rose-300 font-bold cursor-pointer"
                  >
                    ລຶບໂລໂກ້ອອກ
                  </button>
                )}
              </div>

              {formData.receiptLogoUrl ? (
                <div className="flex items-center gap-4 p-3 bg-slate-900 rounded-xl border border-slate-700">
                  <div className="w-20 h-20 bg-white rounded-lg p-1 flex items-center justify-center shrink-0 border border-slate-600 shadow">
                    <img
                      src={formData.receiptLogoUrl}
                      alt="Receipt Logo"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                  <div className="space-y-1.5 flex-1">
                    <span className="text-xs text-emerald-400 font-bold block">✓ ຕິດຕັ້ງຮູບໂລໂກ້ສຳເລັດແລ້ວ</span>
                    <p className="text-[11px] text-slate-400">
                      ຮູບນີ້ຈະປະກົດຢູ່ເທິງສຸດຂອງໃບບິນ Thermal Printer ແລະ ໃບບິນແບບຮູບພາບ
                    </p>
                    <label className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 cursor-pointer transition-all">
                      <Upload className="w-3.5 h-3.5 text-amber-400" />
                      <span>ປ່ຽນຮູບໃໝ່</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              setFormData({
                                ...formData,
                                receiptLogoUrl: ev.target?.result as string,
                              });
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <label className="flex-1 w-full p-4 rounded-xl border-2 border-dashed border-slate-700 hover:border-rose-500 bg-slate-900/60 hover:bg-slate-900 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all group">
                    <Upload className="w-6 h-6 text-slate-400 group-hover:text-rose-400 transition-colors" />
                    <span className="text-xs font-bold text-slate-200 group-hover:text-white">
                      + ອັບໂຫຼດຮູບພາບໂລໂກ້ຫົວໃບບິນ
                    </span>
                    <span className="text-[10px] text-slate-400">
                      ຮອງຮັບ PNG, JPG, WebP (ແນະນຳຮູບສີ່ຫຼ່ຽມ ຫຼື ພື້ນຫຼັງຂາວ/ໂປ່ງໃສ)
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            setFormData({
                              ...formData,
                              receiptLogoUrl: ev.target?.result as string,
                            });
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  ຊື່ຮ້ານໃນຫົວໃບບິນ (Shop Name):
                </label>
                <input
                  type="text"
                  required
                  value={formData.shopName}
                  onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
                  placeholder="689 KTV"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  ຂໍ້ຄວາມຍ່ອຍຫົວໃບບິນ (Subheader):
                </label>
                <input
                  type="text"
                  value={formData.receiptHeader}
                  onChange={(e) => setFormData({ ...formData, receiptHeader: e.target.value })}
                  placeholder="ຄາຣາໂອເກະ ຄຸນນະພາບສູງ..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">ເບີໂທລະສັບ (Phone):</label>
                <input
                  type="text"
                  value={formData.shopPhone}
                  onChange={(e) => setFormData({ ...formData, shopPhone: e.target.value })}
                  placeholder="020-5555-6899"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  WiFi Password (ສຳລັບລູກຄ້າ):
                </label>
                <input
                  type="text"
                  value={formData.wifiPassword || ''}
                  onChange={(e) => setFormData({ ...formData, wifiPassword: e.target.value })}
                  placeholder="Password: 689ktvvip"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">ທີ່ຢູ່ຮ້ານ (Address):</label>
                <input
                  type="text"
                  value={formData.shopAddress}
                  onChange={(e) => setFormData({ ...formData, shopAddress: e.target.value })}
                  placeholder="ນະຄອນຫຼວງວຽງຈັນ, ສປປ ລາວ"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">
                  ຂໍ້ຄວາມທ້າຍໃບບິນ (Receipt Footer):
                </label>
                <input
                  type="text"
                  value={formData.receiptFooter}
                  onChange={(e) => setFormData({ ...formData, receiptFooter: e.target.value })}
                  placeholder="ຂໍຂອບໃຈລູກຄ້າທີ່ມາອຸດໜູນ ຍິນດີຕ້ອນຮັບສະເໝີ!"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  ສັນຍະລັກສະກຸນເງິນ (Currency Symbol):
                </label>
                <input
                  type="text"
                  value={formData.currencySymbol}
                  onChange={(e) => setFormData({ ...formData, currencySymbol: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-amber-400 font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  ຄ່າຫ້ອງຕໍ່ຊົ່ວໂມງເລີ່ມຕົ້ນ ({formData.currencySymbol}/ຊມ):
                </label>
                <input
                  type="number"
                  step="10000"
                  value={formData.defaultHourlyRate}
                  onChange={(e) =>
                    setFormData({ ...formData, defaultHourlyRate: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-amber-400 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB: BLUETOOTH PRINTER */}
        {activeTab === 'printer' && (
          <div className="space-y-4">
            <h3 className="font-bold text-sm text-slate-200 border-b border-slate-800 pb-2">
              ເຊື່ອມຕໍ່ Bluetooth Mini Thermal Printer
            </h3>

            <p className="text-xs text-slate-400">
              ຮອງຮັບ Bluetooth Thermal Printer ຂະໜາດ 58mm ແລະ 80mm ທຸກລຸ້ນ ທຸກຍີ່ຫໍ້ (ESC/POS)
              ເຊັ່ນ GOOJPRT, XP-58, PT-210, MPT-II, POS-58
            </p>

            <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                    bluetoothConnected
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                      : 'bg-slate-700/40 text-slate-400 border border-slate-600/40'
                  }`}
                >
                  <Bluetooth className={`w-6 h-6 ${bluetoothConnected ? 'animate-pulse' : ''}`} />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-100">
                    {bluetoothConnected
                      ? 'Bluetooth Printer ເຊື່ອມຕໍ່ແລ້ວ (ພ້ອມພິມຮູບພາບ)'
                      : 'ຍັງບໍ່ໄດ້ເຊື່ອມຕໍ່ Bluetooth Printer'}
                  </h4>
                  <p className="text-xs text-slate-400">
                    {isWebBluetoothSupported()
                      ? 'Web Bluetooth API ພ້ອມໃຊ້ງານໃນ Browser ນີ້'
                      : 'Browser ບໍ່ຮອງຮັບ Web Bluetooth (ແນະນຳໃຊ້ Google Chrome / Edge)'}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                {bluetoothConnected ? (
                  <button
                    type="button"
                    onClick={handleDisconnectBt}
                    className="px-4 py-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold cursor-pointer"
                  >
                    ຕັດການເຊື່ອມຕໍ່
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnectBt}
                    disabled={btLoading}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-600/30 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Bluetooth className="w-4 h-4" />
                    <span>{btLoading ? 'ກຳລັງຄົ້ນຫາ...' : 'ຄົ້ນຫາ & ເຊື່ອມຕໍ່ Bluetooth'}</span>
                  </button>
                )}
              </div>
            </div>

            {btMessage && (
              <div className="p-3 bg-slate-800 rounded-xl text-xs text-slate-300 font-mono">
                {btMessage}
              </div>
            )}
          </div>
        )}

        {/* TAB: PIN SECURITY */}
        {activeTab === 'security' && (
          <div className="space-y-4">
            <h3 className="font-bold text-sm text-slate-200 border-b border-slate-800 pb-2">
              ປ່ຽນລະຫັດ PIN 4 ຫຼັກ ສຳລັບເຂົ້າສູ່ລະບົບ
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-800/40 space-y-2">
                <span className="font-bold text-xs text-amber-300 block">
                  👑 ລະຫັດ PIN Admin (ເຈົ້າຂອງຮ້ານ - 4 ຫຼັກ):
                </span>
                <input
                  type="password"
                  maxLength={4}
                  required
                  value={formData.adminPin}
                  onChange={(e) => setFormData({ ...formData, adminPin: e.target.value })}
                  placeholder="8888"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-lg font-mono font-bold text-amber-400 tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <p className="text-[11px] text-slate-400">
                  * ສາມາດເຂົ້າເມນູຕັ້ງຄ່າ, ແກ້ໄຂເບີຫ້ອງ, ປ່ຽນຜູ້ຂາຍ, ແລະ ເບິ່ງສະຫຼຸບຍອດທັງໝົດ
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-blue-950/20 border border-blue-800/40 space-y-2">
                <span className="font-bold text-xs text-blue-300 block">
                  👤 ລະຫັດ PIN ພະນັກງານທົ່ວໄປ (Staff - 4 ຫຼັກ):
                </span>
                <input
                  type="password"
                  maxLength={4}
                  required
                  value={formData.staffPin}
                  onChange={(e) => setFormData({ ...formData, staffPin: e.target.value })}
                  placeholder="1234"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-lg font-mono font-bold text-blue-400 tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[11px] text-slate-400">
                  * ສາມາດຂາຍສິນຄ້າ, ເປີດຫ້ອງຄາຣາໂອເກະ, ແລະ ເຊັກບິນ
                </p>
              </div>
            </div>

            {/* Privacy & Display PIN hints Toggle Card */}
            <div className="p-4 rounded-2xl bg-slate-800/80 border border-slate-700 space-y-3 mt-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {formData.showPinHintsOnLogin ? (
                      <Eye className="w-5 h-5 text-amber-400" />
                    ) : (
                      <EyeOff className="w-5 h-5 text-emerald-400" />
                    )}
                    <h4 className="font-bold text-sm text-slate-100">
                      ສະແດງລະຫັດ PIN ຕົວຢ່າງໃນໜ້າເຂົ້າສູ່ລະບົບ (Show PIN hints on Login)
                    </h4>
                  </div>
                  <p className="text-xs text-slate-400 max-w-xl leading-relaxed">
                    ເລືອກວ່າຈະໃຫ້ລະບົບສະແດງລະຫັດ PIN ຂອງ Admin ແລະ ພະນັກງານ ຢູ່ໜ້າ Login ຫຼື ບໍ່.
                    {formData.showPinHintsOnLogin ? (
                      <span className="text-amber-400 font-semibold block mt-0.5">
                        ⚠️ ຕອນນີ້: ເປີດສະແດງລະຫັດຢູ່ (ຄົນອື່ນທີ່ເປີດແອັບຈະເຫັນລະຫັດຜ່ານທັງໝົດ)
                      </span>
                    ) : (
                      <span className="text-emerald-400 font-semibold block mt-0.5">
                        🛡️ ຕອນນີ້: ເຊື່ອງລະຫັດ PIN ປອດໄພ (ບໍ່ມີໃຜເຫັນລະຫັດຜ່ານໃນໜ້າ Login)
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        showPinHintsOnLogin: !formData.showPinHintsOnLogin,
                      })
                    }
                    className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      formData.showPinHintsOnLogin ? 'bg-amber-500' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        formData.showPinHintsOnLogin ? 'translate-x-7' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  <span className="text-xs font-bold text-slate-300 min-w-[70px]">
                    {formData.showPinHintsOnLogin ? 'ສະແດງ PIN' : 'ເຊື່ອງ PIN'}
                  </span>
                </div>
              </div>

              {/* Status pill callout */}
              <div
                className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                  formData.showPinHintsOnLogin
                    ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                    : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {formData.showPinHintsOnLogin ? (
                    <Eye className="w-4 h-4 shrink-0 text-amber-400" />
                  ) : (
                    <Lock className="w-4 h-4 shrink-0 text-emerald-400" />
                  )}
                  <span>
                    {formData.showPinHintsOnLogin
                      ? 'ໂໝດສະແດງ: ລະຫັດ Admin (' +
                        formData.adminPin +
                        ') ແລະ ພະນັກງານ (' +
                        formData.staffPin +
                        ') ຈະປະກົດຢູ່ໜ້າຈໍປ້ອນ PIN'
                      : 'ໂໝດປອດໄພສູງ: ລະຫັດ PIN ຈະຖືກເຊື່ອງ ບໍ່ໃຫ້ໃຜແນມເຫັນເດັດຂາດ'}
                  </span>
                </div>
              </div>
            </div>

            {/* DEBT MANAGEMENT PERMISSIONS (Admin Configures Staff Rights) */}
            <div className="p-4 rounded-2xl bg-slate-800/80 border border-slate-700 space-y-3 mt-4">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
                <ShieldAlert className="w-5 h-5 text-amber-400" />
                <div>
                  <h4 className="font-bold text-sm text-slate-100">
                    ສິດທິການຈັດການຍອດຄ້າງຊຳລະ / ຕິດໜີ້ (Debt Permissions)
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Admin ກຳນົດວ່າພະນັກງານທົ່ວໄປ (Staff) ສາມາດແກ້ໄຂ ຫຼື ລຶບລາຍການຕິດໜີ້ໄດ້ຫຼືບໍ່
                  </p>
                </div>
              </div>

              {/* Toggle 1: Allow Staff to Edit Debts */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-200 block">
                    1. ອະນຸຍາດໃຫ້ພະນັກງານ &quot;ແກ້ໄຂ&quot; ລາຍການຕິດໜີ້ໄດ້
                  </span>
                  <p className="text-[11px] text-slate-400">
                    {formData.staffCanEditDebt
                      ? '✓ ພະນັກງານສາມາດແກ້ໄຂຊື່, ເບີໂທ, ຍອດເງິນ ແລະ ຮູບຫຼັກຖານຕິດໜີ້ໄດ້'
                      : '🔒 ສະເພາະ Admin ເທົ່ານັ້ນທີ່ສາມາດແກ້ໄຂລາຍການຕິດໜີ້ໄດ້'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        staffCanEditDebt: !formData.staffCanEditDebt,
                      })
                    }
                    className={`relative inline-flex h-6 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      formData.staffCanEditDebt ? 'bg-amber-500' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        formData.staffCanEditDebt ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  <span className="text-xs font-bold text-slate-300 min-w-[50px]">
                    {formData.staffCanEditDebt ? 'ອະນຸຍາດ' : 'ປິດ'}
                  </span>
                </div>
              </div>

              {/* Toggle 2: Allow Staff to Delete Debts */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-200 block">
                    2. ອະນຸຍາດໃຫ້ພະນັກງານ &quot;ລຶບ&quot; ລາຍການຕິດໜີ້ໄດ້
                  </span>
                  <p className="text-[11px] text-slate-400">
                    {formData.staffCanDeleteDebt
                      ? '⚠️ ພະນັກງານສາມາດລຶບລາຍການຕິດໜີ້ອອກຈາກລະບົບໄດ້'
                      : '🔒 ສະເພາະ Admin ເທົ່ານັ້ນທີ່ສາມາດລຶບລາຍການຕິດໜີ້ໄດ້ (ແນະນຳ)'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        staffCanDeleteDebt: !formData.staffCanDeleteDebt,
                      })
                    }
                    className={`relative inline-flex h-6 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      formData.staffCanDeleteDebt ? 'bg-rose-500' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        formData.staffCanDeleteDebt ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  <span className="text-xs font-bold text-slate-300 min-w-[50px]">
                    {formData.staffCanDeleteDebt ? 'ອະນຸຍາດ' : 'ປິດ'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: ROOM PACKAGES */}
        {activeTab === 'packages' && (
          <div className="space-y-4">
            <h3 className="font-bold text-sm text-slate-200 border-b border-slate-800 pb-2">
              ແພັກເກັດຫ້ອງຄາຣາໂອເກະ (Choice 1)
            </h3>

            <div className="space-y-3">
              {localPackages.map((pkg, idx) => (
                <div
                  key={pkg.id}
                  className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      value={pkg.name}
                      onChange={(e) => {
                        const updated = [...localPackages];
                        updated[idx].name = e.target.value;
                        setLocalPackages(updated);
                      }}
                      className="font-bold text-xs text-white bg-slate-900 border border-slate-700 px-2 py-1 rounded-lg flex-1"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="10000"
                        value={pkg.price}
                        onChange={(e) => {
                          const updated = [...localPackages];
                          updated[idx].price = parseFloat(e.target.value) || 0;
                          setLocalPackages(updated);
                        }}
                        className="w-28 text-right font-mono font-bold text-xs text-amber-400 bg-slate-900 border border-slate-700 px-2 py-1 rounded-lg"
                      />
                      <span className="text-xs text-slate-400">{formData.currencySymbol}</span>
                    </div>
                  </div>

                  <input
                    type="text"
                    value={pkg.description}
                    onChange={(e) => {
                      const updated = [...localPackages];
                      updated[idx].description = e.target.value;
                      setLocalPackages(updated);
                    }}
                    placeholder="ລາຍລະອຽດແພັກເກັດ..."
                    className="w-full text-[11px] text-slate-300 bg-slate-900 border border-slate-700 px-2 py-1 rounded-lg"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Save button footer */}
        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            type="submit"
            className="py-3 px-6 rounded-2xl bg-gradient-to-r from-amber-500 via-rose-500 to-purple-600 hover:from-amber-600 hover:to-purple-700 text-white font-black text-xs shadow-lg shadow-rose-500/25 flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>ບັນທຶກການຕັ້ງຄ່າທັງໝົດ (Save Settings)</span>
          </button>
        </div>
      </form>
    </div>
  );
};
