import React, { useState, useEffect } from 'react';
import {
  Mic2,
  ShoppingCart,
  DoorOpen,
  Boxes,
  BarChart3,
  Settings,
  Lock,
  Bluetooth,
  FileSpreadsheet,
  Clock,
  Shield,
  User,
  Sparkles,
  Palette,
  HandCoins,
} from 'lucide-react';
import { Role, StaffMember, AppSettings, AppThemeId } from '../types';
import { THEMES } from '../lib/theme';

interface NavbarProps {
  activeTab: 'pos' | 'rooms' | 'stock' | 'debts' | 'reports' | 'settings';
  setActiveTab: (tab: 'pos' | 'rooms' | 'stock' | 'debts' | 'reports' | 'settings') => void;
  currentRole: Role;
  currentUser?: StaffMember;
  onLockScreen: () => void;
  onOpenSheetsModal: () => void;
  onOpenBluetoothModal: () => void;
  onSelectTheme?: (themeId: AppThemeId) => void;
  bluetoothConnected: boolean;
  sheetsConfigured: boolean;
  settings: AppSettings;
  pendingDebtsCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  currentRole,
  currentUser,
  onLockScreen,
  onOpenSheetsModal,
  onOpenBluetoothModal,
  onSelectTheme,
  bluetoothConnected,
  sheetsConfigured,
  settings,
  pendingDebtsCount = 0,
}) => {
  const [timeStr, setTimeStr] = useState<string>('');
  const [showThemePicker, setShowThemePicker] = useState<boolean>(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString('lo-LA', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    {
      id: 'pos' as const,
      label: 'ຂາຍສິນຄ້າ (POS)',
      icon: ShoppingCart,
      adminOnly: false,
      activeGradient: 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/30',
      iconColor: 'text-emerald-400',
    },
    {
      id: 'rooms' as const,
      label: 'ເປີດຫ້ອງ KTV',
      icon: DoorOpen,
      adminOnly: false,
      activeGradient: 'bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 text-white shadow-md shadow-indigo-600/30',
      iconColor: 'text-indigo-400',
    },
    {
      id: 'stock' as const,
      label: 'ກວດສອບສະຕັອກ',
      icon: Boxes,
      adminOnly: false,
      activeGradient: 'bg-gradient-to-r from-amber-600 to-yellow-600 text-white shadow-md shadow-amber-600/30',
      iconColor: 'text-amber-400',
    },
    {
      id: 'debts' as const,
      label: 'ຍອດຄ້າງຊຳລະ',
      badge: pendingDebtsCount > 0 ? pendingDebtsCount : undefined,
      icon: HandCoins,
      adminOnly: false,
      activeGradient: 'bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 text-white shadow-md shadow-rose-600/30',
      iconColor: 'text-rose-400',
    },
    {
      id: 'reports' as const,
      label: 'ສະຫຼຸບຍອດຂາຍ',
      icon: BarChart3,
      adminOnly: false,
      activeGradient: 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md shadow-blue-600/30',
      iconColor: 'text-sky-400',
    },
    {
      id: 'settings' as const,
      label: 'ຕັ້ງຄ່າລະບົບ',
      icon: Settings,
      adminOnly: true,
      activeGradient: 'bg-gradient-to-r from-slate-700 to-slate-800 text-white shadow-md shadow-slate-700/30',
      iconColor: 'text-slate-400',
    },
  ];

  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 shadow-md shadow-rose-500/20">
              <Mic2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-xl tracking-tight bg-gradient-to-r from-amber-400 via-rose-400 to-purple-300 bg-clip-text text-transparent">
                  689 KTV
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  KARAOKE
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                ລະບົບຄຸ້ມຄອງ ແລະ ຂາຍສິນຄ້າ
              </p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 bg-slate-800/60 p-1 rounded-2xl border border-slate-700/50">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              const isRestricted = item.adminOnly && currentRole !== 'admin';

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (isRestricted) {
                      alert('ເມນູນີ້ສຳລັບ Admin / ເຈົ້າຂອງຮ້ານ ເທົ່ານັ້ນ!');
                      return;
                    }
                    setActiveTab(item.id);
                  }}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? item.activeGradient
                      : isRestricted
                      ? 'text-slate-500 hover:text-slate-400 opacity-60'
                      : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${!isActive ? item.iconColor : 'text-white'}`} />
                  <span className="flex items-center gap-1.5">
                    <span>{item.label}</span>
                    {item.badge !== undefined && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-black">
                        {item.badge}
                      </span>
                    )}
                  </span>
                  {item.adminOnly && currentRole !== 'admin' && (
                    <Lock className="w-3 h-3 text-slate-500" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Action Center & Status */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Live Clock */}
            <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/60 border border-slate-700/50 text-xs font-mono text-slate-300">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>{timeStr}</span>
            </div>

            {/* Bluetooth Quick Button */}
            <button
              onClick={onOpenBluetoothModal}
              title={bluetoothConnected ? 'Bluetooth ເຊື່ອມຕໍ່ແລ້ວ' : 'ເຊື່ອມຕໍ່ Bluetooth Printer'}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                bluetoothConnected
                  ? 'bg-blue-950/60 border-blue-500/50 text-blue-300'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Bluetooth className={`w-3.5 h-3.5 ${bluetoothConnected ? 'text-blue-400 animate-pulse' : ''}`} />
              <span className="hidden sm:inline">
                {bluetoothConnected ? 'BT ພ້ອມ' : 'Bluetooth'}
              </span>
            </button>

            {/* Google Sheets Sync Button */}
            <button
              onClick={onOpenSheetsModal}
              title="ບັນທຶກ ແລະ ຊິ້ງຂໍ້ມູນລົງ Google Sheets"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                sheetsConfigured
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Google Sheets</span>
            </button>

            {/* Theme Selector Button */}
            <div className="relative">
              <button
                onClick={() => setShowThemePicker(!showThemePicker)}
                title="ເລືອກໂທນສີຂອງແອັບ (Theme Color)"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border bg-slate-800/60 border-slate-700/60 text-slate-300 hover:text-white transition-all cursor-pointer"
              >
                <Palette className="w-3.5 h-3.5 text-rose-400" />
                <span className="hidden xl:inline">ໂທນສີ</span>
              </button>

              {/* Theme Picker Dropdown */}
              {showThemePicker && (
                <div className="absolute right-0 mt-2 w-72 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-3 z-50 space-y-2">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Palette className="w-3.5 h-3.5 text-rose-400" />
                      <span>ເລືອກໂທນສີແອັບ (Theme)</span>
                    </span>
                    <button
                      onClick={() => setShowThemePicker(false)}
                      className="text-slate-400 hover:text-white text-xs cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {Object.values(THEMES).map((th) => {
                      const isSelected = (settings.appTheme || 'neon_ktv') === th.id;
                      return (
                        <button
                          key={th.id}
                          type="button"
                          onClick={() => {
                            if (onSelectTheme) {
                              onSelectTheme(th.id);
                            }
                            setShowThemePicker(false);
                          }}
                          className={`w-full text-left p-2 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${
                            isSelected
                              ? 'bg-slate-800 border-rose-500 text-white font-bold'
                              : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className="w-5 h-5 rounded-lg border border-white/20 flex items-center justify-center shrink-0"
                              style={{ backgroundColor: th.previewBg }}
                            >
                              <div
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: th.previewAccent }}
                              />
                            </div>
                            <span className="text-xs">{th.nameLao}</span>
                          </div>
                          {isSelected && <span className="text-[10px] text-rose-400">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Role & User Badge */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs">
              {currentRole === 'admin' ? (
                <>
                  <Shield className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-semibold text-amber-300">Admin</span>
                </>
              ) : (
                <>
                  <User className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-medium text-slate-300 max-w-[90px] truncate">
                    {currentUser?.name || 'ພະນັກງານ'}
                  </span>
                </>
              )}
            </div>

            {/* Lock / Switch user */}
            <button
              onClick={onLockScreen}
              title="ລັອກໜ້າຈໍ / ປ່ຽນຜູ້ໃຊ້"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
            >
              <Lock className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile Navigation bar */}
        <div className="flex md:hidden items-center justify-around py-2 border-t border-slate-800/80 gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.adminOnly && currentRole !== 'admin') {
                    alert('ເມນູນີ້ສຳລັບ Admin ເທົ່ານັ້ນ!');
                    return;
                  }
                  setActiveTab(item.id);
                }}
                className={`flex flex-col items-center gap-1 py-1 px-2 rounded-xl text-[10px] font-semibold transition-all whitespace-nowrap ${
                  isActive ? `${item.iconColor} bg-slate-800 font-bold shadow-inner` : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? item.iconColor : ''}`} />
                <span>{item.label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
