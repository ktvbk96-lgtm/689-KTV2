import React, { useState } from 'react';
import { Lock, Delete, ShieldCheck, UserCheck, Sparkles, KeyRound } from 'lucide-react';
import { StaffMember, AppSettings } from '../types';

interface PinAuthModalProps {
  settings: AppSettings;
  staffList: StaffMember[];
  onSuccess: (role: 'admin' | 'staff', staffMember?: StaffMember) => void;
}

export const PinAuthModal: React.FC<PinAuthModalProps> = ({ settings, staffList, onSuccess }) => {
  const [pin, setPin] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');

  const handleDigit = (digit: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError('');

    if (newPin.length === 4) {
      validatePin(newPin);
    }
  };

  const handleDelete = () => {
    setPin((prev) => prev.slice(0, -1));
    setError('');
  };

  const handleClear = () => {
    setPin('');
    setError('');
  };

  const validatePin = (inputPin: string) => {
    if (inputPin === settings.adminPin) {
      const adminMember = staffList.find((s) => s.role === 'admin') || {
        id: 'staff-admin',
        name: 'Admin (ເຈົ້າຂອງຮ້ານ)',
        role: 'admin',
        active: true,
      };
      onSuccess('admin', adminMember);
      return;
    }

    if (inputPin === settings.staffPin) {
      const staffMember = selectedStaffId
        ? staffList.find((s) => s.id === selectedStaffId)
        : staffList.find((s) => s.role === 'staff') || {
            id: 'staff-default',
            name: 'ພະນັກງານທົ່ວໄປ (Staff)',
            role: 'staff',
            active: true,
          };
      onSuccess('staff', staffMember);
      return;
    }

    setError('ລະຫັດ PIN ບໍ່ຖືກຕ້ອງ! ກະລຸນາລອງໃໝ່');
    setTimeout(() => {
      setPin('');
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 text-white relative overflow-hidden">
        {/* Glow accent */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-amber-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-rose-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 shadow-lg shadow-rose-500/30 mb-3">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-wider bg-gradient-to-r from-amber-400 via-rose-400 to-purple-300 bg-clip-text text-transparent">
            689 KTV
          </h1>
          <p className="text-sm text-slate-400 mt-1 font-medium">
            ລະບົບຄຸ້ມຄອງຮ້ານຄາຣາໂອເກະ ແລະ ຂາຍສິນຄ້າ
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-slate-800/80 border border-slate-700/60 rounded-full text-xs text-amber-300">
            <KeyRound className="w-3.5 h-3.5" />
            <span>ກະລຸນາປ້ອນລະຫັດ PIN 4 ຫຼັກ ເພື່ອເຂົ້າສູ່ລະບົບ</span>
          </div>
        </div>

        {/* Staff selector optional dropdown */}
        <div className="mb-4">
          <label className="block text-xs text-slate-400 mb-1.5 font-medium">
            ເລືອກຊື່ພະນັກງານ (ກໍລະນີເຂົ້າໃຊ້ງານປົກກະຕິ):
          </label>
          <select
            value={selectedStaffId}
            onChange={(e) => setSelectedStaffId(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all"
          >
            <option value="">ເລືອກພະນັກງານ (ຫຼື ໃຊ້ຄ່າເລີ່ມຕົ້ນ)</option>
            {staffList
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.role === 'admin' ? 'ເຈົ້າຂອງຮ້ານ' : 'ພະນັກງານ'})
                </option>
              ))}
          </select>
        </div>

        {/* PIN Indicators */}
        <div className="flex justify-center gap-4 my-4">
          {[0, 1, 2, 3].map((idx) => {
            const isFilled = pin.length > idx;
            return (
              <div
                key={idx}
                className={`w-4 h-4 rounded-full transition-all duration-200 ${
                  isFilled
                    ? 'bg-rose-500 scale-125 shadow-lg shadow-rose-500/50'
                    : 'bg-slate-700 border border-slate-600'
                }`}
              />
            );
          })}
        </div>

        {/* Error message */}
        {error && (
          <div className="text-center text-xs font-semibold text-rose-400 bg-rose-950/60 border border-rose-800/60 py-1.5 px-3 rounded-lg mb-3 animate-pulse">
            {error}
          </div>
        )}

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              onClick={() => handleDigit(d)}
              className="h-14 text-xl font-bold bg-slate-800/80 hover:bg-slate-700 active:scale-95 text-slate-100 rounded-2xl border border-slate-700/80 transition-all flex items-center justify-center cursor-pointer shadow-sm hover:shadow"
            >
              {d}
            </button>
          ))}
          <button
            onClick={handleClear}
            className="h-14 text-xs font-semibold bg-slate-800/50 hover:bg-slate-800 active:scale-95 text-slate-400 rounded-2xl border border-slate-700/50 transition-all flex items-center justify-center cursor-pointer"
          >
            ລຶບໝົດ (Clear)
          </button>
          <button
            onClick={() => handleDigit('0')}
            className="h-14 text-xl font-bold bg-slate-800/80 hover:bg-slate-700 active:scale-95 text-slate-100 rounded-2xl border border-slate-700/80 transition-all flex items-center justify-center cursor-pointer shadow-sm hover:shadow"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            className="h-14 text-slate-300 bg-slate-800/50 hover:bg-slate-800 active:scale-95 rounded-2xl border border-slate-700/50 transition-all flex items-center justify-center cursor-pointer"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        {/* PIN Helper Hints - Controlled by settings.showPinHintsOnLogin */}
        {settings.showPinHintsOnLogin ? (
          <div className="p-3 bg-slate-800/50 rounded-2xl border border-slate-700/40 text-xs text-slate-400 space-y-1 animate-fadeIn">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-amber-300">
                <ShieldCheck className="w-4 h-4" />
                <span>Admin / ເຈົ້າຂອງຮ້ານ:</span>
              </span>
              <span className="font-mono bg-slate-900 px-2 py-0.5 rounded text-amber-400 font-bold">
                {settings.adminPin}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-blue-300">
                <UserCheck className="w-4 h-4" />
                <span>ພະນັກງານຂາຍ / Staff:</span>
              </span>
              <span className="font-mono bg-slate-900 px-2 py-0.5 rounded text-blue-400 font-bold">
                {settings.staffPin}
              </span>
            </div>
          </div>
        ) : (
          <div className="p-2.5 bg-slate-900/60 rounded-2xl border border-slate-800 text-center">
            <span className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5 font-medium">
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              <span>ໂໝດປອດໄພ: ເຊື່ອງລະຫັດ PIN (ສາມາດເປີດສະແດງໄດ້ໃນເມນູຕັ້ງຄ່າ)</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
