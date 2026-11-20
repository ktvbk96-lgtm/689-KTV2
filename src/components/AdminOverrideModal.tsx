import React, { useState, useEffect } from 'react';
import { ShieldAlert, Delete, KeyRound, X, Lock } from 'lucide-react';
import { AppSettings, StaffMember } from '../types';
import { verifyAdminOverridePin } from '../lib/permissions';

interface AdminOverrideModalProps {
  isOpen: boolean;
  actionTitle: string;
  actionDescription?: string;
  settings: AppSettings;
  staffList: StaffMember[];
  onApprove: (approvedByName: string) => void;
  onCancel: () => void;
}

export const AdminOverrideModal: React.FC<AdminOverrideModalProps> = ({
  isOpen,
  actionTitle,
  actionDescription,
  settings,
  staffList,
  onApprove,
  onCancel,
}) => {
  const [pin, setPin] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const tryValidate = (candidate: string) => {
    const res = verifyAdminOverridePin(candidate, settings, staffList);
    if (res.valid) {
      setPin('');
      setError('');
      onApprove(res.approvedBy || 'Admin');
    } else {
      setError('ລະຫັດ Admin PIN ບໍ່ຖືກຕ້ອງ! ກະລຸນາລອງໃໝ່ (รหัส PIN ผู้ดูแลไม่ถูกต้อง)');
      setTimeout(() => setPin(''), 450);
    }
  };

  const handleDigit = (d: string) => {
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    setError('');
    const expectedLen = (settings.adminPin || '8888').trim().length;
    if (next.length === expectedLen) {
      tryValidate(next);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
      <div className="w-full max-w-sm bg-slate-900 border border-amber-500/50 rounded-3xl shadow-2xl p-6 text-white relative overflow-hidden">
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-sm text-amber-300">
                ຕ້ອງການການອະນຸມັດຈາກ Admin
              </h3>
              <p className="text-[11px] text-slate-300 font-semibold">{actionTitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {actionDescription && (
          <div className="mt-3 p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/50 text-[11px] text-amber-200 leading-relaxed flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span>{actionDescription}</span>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-4 flex items-center justify-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-amber-400" />
          <span>ປ້ອນລະຫັດ PIN ຂອງ Admin / ເຈົ້າຂອງຮ້ານ ເພື່ອອະນຸມັດ</span>
        </p>

        {/* PIN dots */}
        <div className="flex justify-center gap-3.5 my-4">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className={`w-4 h-4 rounded-full transition-all duration-150 ${
                pin.length > idx
                  ? 'bg-amber-400 scale-125 shadow-lg shadow-amber-400/50'
                  : 'bg-slate-700 border border-slate-600'
              }`}
            />
          ))}
        </div>

        {error && (
          <div className="text-center text-[11px] font-bold text-rose-400 bg-rose-950/60 border border-rose-800/60 py-1.5 px-3 rounded-xl mb-3">
            {error}
          </div>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => handleDigit(d)}
              className="h-12 text-lg font-bold bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-100 rounded-xl border border-slate-700 transition-all cursor-pointer"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setPin('');
              setError('');
            }}
            className="h-12 text-xs font-semibold bg-slate-800/60 hover:bg-slate-800 text-slate-400 rounded-xl border border-slate-700/60 cursor-pointer"
          >
            ລ້າງ
          </button>
          <button
            type="button"
            onClick={() => handleDigit('0')}
            className="h-12 text-lg font-bold bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-100 rounded-xl border border-slate-700 transition-all cursor-pointer"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => {
              setPin((p) => p.slice(0, -1));
              setError('');
            }}
            className="h-12 flex items-center justify-center bg-slate-800/60 hover:bg-slate-800 text-slate-300 rounded-xl border border-slate-700/60 cursor-pointer"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
          >
            ຍົກເລີກ
          </button>
          <button
            type="button"
            disabled={pin.length < 4}
            onClick={() => tryValidate(pin)}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black cursor-pointer disabled:opacity-40"
          >
            ອະນຸມັດ (Approve)
          </button>
        </div>
      </div>
    </div>
  );
};
