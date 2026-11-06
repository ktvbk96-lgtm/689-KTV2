import React, { useState } from 'react';
import { Lock, Delete, KeyRound } from 'lucide-react';
import { StaffMember, AppSettings } from '../types';

interface PinAuthModalProps {
  settings: AppSettings;
  staffList: StaffMember[];
  onSuccess: (role: 'admin' | 'staff', staffMember?: StaffMember) => void;
}

export const PinAuthModal: React.FC<PinAuthModalProps> = ({ settings, staffList, onSuccess }) => {
  const [pin, setPin] = useState<string>('');
  const [error, setError] = useState<string>('');

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
    // 1. Check Admin PIN
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

    // 2. Check Staff PIN
    if (inputPin === settings.staffPin) {
      const staffMember = staffList.find((s) => s.role === 'staff') || {
        id: 'staff-default',
        name: 'ພະນັກງານທົ່ວໄປ (Staff)',
        role: 'staff',
        active: true,
      };
      onSuccess('staff', staffMember);
      return;
    }

    // 3. Check individual staff member matching PIN/phone
    const matchedStaff = staffList.find(
      (s) => s.active && ((s as any).pin === inputPin || s.phone?.replace(/\D/g, '').endsWith(inputPin))
    );
    if (matchedStaff) {
      onSuccess(matchedStaff.role || 'staff', matchedStaff);
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

        {/* Header with Custom Brand Image or Logo */}
        <div className="text-center mb-6">
          {settings.loginLogoUrl ? (
            <div className="flex justify-center mb-3">
              <img
                src={settings.loginLogoUrl}
                alt={settings.shopName || '689 KTV'}
                className="max-h-24 max-w-[220px] object-contain rounded-2xl shadow-lg border border-slate-700/80 p-1.5 bg-slate-950/80"
              />
            </div>
          ) : (
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 shadow-lg shadow-rose-500/30 mb-3">
              <Lock className="w-8 h-8 text-white" />
            </div>
          )}

          <h1 className="text-2xl font-black tracking-wider bg-gradient-to-r from-amber-400 via-rose-400 to-purple-300 bg-clip-text text-transparent">
            {settings.shopName || '689 KTV'}
          </h1>
          <p className="text-sm text-slate-400 mt-1 font-medium">
            {settings.receiptHeader || 'ລະບົບຄຸ້ມຄອງຮ້ານຄາຣາໂອເກະ ແລະ ຂາຍສິນຄ້າ'}
          </p>
          <div className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 bg-slate-800/80 border border-slate-700/60 rounded-full text-xs text-amber-300">
            <KeyRound className="w-3.5 h-3.5" />
            <span>ກະລຸນາປ້ອນລະຫັດ PIN 4 ຫຼັກ ເພື່ອເຂົ້າສູ່ລະບົບ</span>
          </div>
        </div>

        {/* PIN Indicators */}
        <div className="flex justify-center gap-4 my-5">
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
            ລຶບໝົດ
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
      </div>
    </div>
  );
};
