import React from 'react';
import {
  Cloud,
  CloudDownload,
  CloudUpload,
  Monitor,
  Smartphone,
  Tablet,
  Clock,
  ShieldCheck,
  X,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { CloudUpdateNotice, DeviceType } from '../lib/realtimeSync';

const formatSyncTimestamp = (iso?: string): string => {
  if (!iso) return 'ไม่ระบุเวลา';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
};

const getActionLabel = (action?: string): string => {
  switch (action) {
    case 'saveRooms':
      return 'อัปเดตสถานะห้อง / ต่อเวลาห้อง';
    case 'saveProducts':
      return 'อัปเดตสินค้า / สต็อก';
    case 'saveBill':
    case 'saveBills':
      return 'บันทึกบิล / เช็กบิล';
    case 'saveDebts':
      return 'อัปเดตรายการค้างชำระ';
    case 'saveStaff':
      return 'อัปเดตข้อมูลพนักงาน / สิทธิ์';
    case 'savePackages':
      return 'อัปเดตแพ็กเกจห้อง';
    case 'saveSettings':
      return 'อัปเดตการตั้งค่าร้าน';
    case 'uploadLocalToCloud':
      return 'ส่งข้อมูลจากอีกเครื่องขึ้น Cloud';
    default:
      return 'มีการแก้ไขข้อมูลล่าสุด';
  }
};

export const DeviceTypeIcon: React.FC<{ type?: DeviceType; className?: string }> = ({
  type,
  className = 'w-4 h-4',
}) => {
  if (type === 'Mobile') return <Smartphone className={className} />;
  if (type === 'Tablet') return <Tablet className={className} />;
  return <Monitor className={className} />;
};

interface CloudUpdateConfirmModalProps {
  isOpen: boolean;
  notice: CloudUpdateNotice | null;
  onConfirmUpdate: () => void;
  onDefer: () => void;
}

export const CloudUpdateConfirmModal: React.FC<CloudUpdateConfirmModalProps> = ({
  isOpen,
  notice,
  onConfirmUpdate,
  onDefer,
}) => {
  if (!isOpen || !notice) return null;

  const productsCount = Array.isArray(notice.data?.products) ? notice.data.products.length : 0;
  const roomsCount = Array.isArray(notice.data?.rooms) ? notice.data.rooms.length : 0;
  const staffCount = Array.isArray(notice.data?.staff) ? notice.data.staff.length : 0;
  const billsCount = Array.isArray(notice.data?.bills) ? notice.data.bills.length : 0;
  const debtsCount = Array.isArray(notice.data?.debts) ? notice.data.debts.length : 0;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-cyan-500/40 shadow-2xl shadow-cyan-950/50 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-cyan-950/90 via-slate-900 to-emerald-950/70 border-b border-cyan-500/25 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-400/35 flex items-center justify-center text-cyan-300 shrink-0">
              <CloudDownload className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white leading-snug">
                พบข้อมูลอัปเดตล่าสุดจากอีกเครื่อง
              </h3>
              <p className="text-xs sm:text-sm text-cyan-200/90 mt-0.5">
                ต้องการอัปเดตเป็นข้อมูลล่าสุดไหม?
              </p>
            </div>
          </div>
          <button
            onClick={onDefer}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="ดูไว้ก่อน / ยังไม่อัปเดต"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Source Device & Timestamp Card */}
          <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-bold">
                  <DeviceTypeIcon type={notice.lastUpdatedDeviceType} className="w-3.5 h-3.5" />
                  {notice.lastUpdatedByDevice || notice.lastUpdatedDeviceType}
                </span>
                <span className="text-xs text-slate-400">v{notice.version}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-amber-300 font-medium">
                <Clock className="w-3.5 h-3.5" />
                <span>{formatSyncTimestamp(notice.lastUpdated)}</span>
              </div>
            </div>

            <div className="text-xs text-slate-300 flex items-center gap-2 pt-1 border-t border-slate-800/80">
              <Cloud className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>รายการอัปเดตล่าสุด: <strong className="text-white">{getActionLabel(notice.lastAction)}</strong></span>
            </div>
          </div>

          {/* Snapshot Summary */}
          <div>
            <div className="text-xs font-semibold text-slate-400 mb-2">
              ข้อมูลล่าสุดบน Cloud (Neon Postgres):
            </div>
            <div className="grid grid-cols-5 gap-2 text-center">
              <div className="rounded-lg bg-slate-800/70 border border-slate-700/60 py-2 px-1">
                <div className="text-base font-bold text-white">{productsCount}</div>
                <div className="text-[11px] text-slate-400">สินค้า</div>
              </div>
              <div className="rounded-lg bg-slate-800/70 border border-slate-700/60 py-2 px-1">
                <div className="text-base font-bold text-white">{roomsCount}</div>
                <div className="text-[11px] text-slate-400">ห้อง</div>
              </div>
              <div className="rounded-lg bg-slate-800/70 border border-slate-700/60 py-2 px-1">
                <div className="text-base font-bold text-white">{billsCount}</div>
                <div className="text-[11px] text-slate-400">บิล</div>
              </div>
              <div className="rounded-lg bg-slate-800/70 border border-slate-700/60 py-2 px-1">
                <div className="text-base font-bold text-white">{staffCount}</div>
                <div className="text-[11px] text-slate-400">พนักงาน</div>
              </div>
              <div className="rounded-lg bg-slate-800/70 border border-slate-700/60 py-2 px-1">
                <div className="text-base font-bold text-white">{debtsCount}</div>
                <div className="text-[11px] text-slate-400">ค้างชำระ</div>
              </div>
            </div>
          </div>

          {/* Safety Notice */}
          <div className="flex items-start gap-2.5 rounded-xl bg-emerald-950/35 border border-emerald-500/25 px-3.5 py-2.5 text-xs text-emerald-200/90">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              ระบบจะยังไม่เขียนทับหน้าจอของคุณจนกว่าคุณจะกดยืนยัน หากกด <strong>"ดูไว้ก่อน"</strong> คุณสามารถกดอัปเดตภายหลังได้จากแถบด้านบนทุกเมื่อ
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-slate-950/70 border-t border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
          <button
            onClick={onDefer}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            ดูไว้ก่อน / ยังไม่อัปเดต
          </button>
          <button
            onClick={onConfirmUpdate}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-sm font-bold shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            อัปเดตเป็นข้อมูลล่าสุด
          </button>
        </div>
      </div>
    </div>
  );
};

interface PushCloudConfirmModalProps {
  isOpen: boolean;
  isUploading: boolean;
  counts: {
    products: number;
    rooms: number;
    packages: number;
    staff: number;
    bills: number;
    debts: number;
  };
  deviceLabel: string;
  onConfirmPush: () => void;
  onClose: () => void;
}

export const PushCloudConfirmModal: React.FC<PushCloudConfirmModalProps> = ({
  isOpen,
  isUploading,
  counts,
  deviceLabel,
  onConfirmPush,
  onClose,
}) => {
  if (!isOpen) return null;

  const totalItems =
    counts.products + counts.rooms + counts.packages + counts.staff + counts.bills + counts.debts;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-amber-500/40 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-amber-950/80 via-slate-900 to-slate-900 border-b border-amber-500/25 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/35 flex items-center justify-center text-amber-300 shrink-0">
              <CloudUpload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">ยืนยันส่งข้อมูลเครื่องนี้ขึ้น Cloud</h3>
              <p className="text-xs text-amber-200/80">เครื่องต้นทาง: {deviceLabel}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isUploading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-slate-800/70 border border-slate-700/60 py-2">
              <div className="text-base font-bold text-white">{counts.products}</div>
              <div className="text-[11px] text-slate-400">สินค้า</div>
            </div>
            <div className="rounded-lg bg-slate-800/70 border border-slate-700/60 py-2">
              <div className="text-base font-bold text-white">{counts.rooms}</div>
              <div className="text-[11px] text-slate-400">ห้อง</div>
            </div>
            <div className="rounded-lg bg-slate-800/70 border border-slate-700/60 py-2">
              <div className="text-base font-bold text-white">{counts.bills}</div>
              <div className="text-[11px] text-slate-400">บิล</div>
            </div>
            <div className="rounded-lg bg-slate-800/70 border border-slate-700/60 py-2">
              <div className="text-base font-bold text-white">{counts.packages}</div>
              <div className="text-[11px] text-slate-400">แพ็กเกจ</div>
            </div>
            <div className="rounded-lg bg-slate-800/70 border border-slate-700/60 py-2">
              <div className="text-base font-bold text-white">{counts.staff}</div>
              <div className="text-[11px] text-slate-400">พนักงาน</div>
            </div>
            <div className="rounded-lg bg-slate-800/70 border border-slate-700/60 py-2">
              <div className="text-base font-bold text-white">{counts.debts}</div>
              <div className="text-[11px] text-slate-400">ค้างชำระ</div>
            </div>
          </div>

          {totalItems === 0 ? (
            <div className="flex items-start gap-2.5 rounded-xl bg-rose-950/40 border border-rose-500/35 px-3.5 py-2.5 text-xs text-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>
                เครื่องนี้ยังไม่มีข้อมูล (0 รายการ) ระบบป้องกัน Zero-Overwrite จะไม่อนุญาตให้ส่งข้อมูลว่างขึ้นไปทับฐานข้อมูล
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl bg-emerald-950/35 border border-emerald-500/25 px-3.5 py-2.5 text-xs text-emerald-200/90">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                ระบบจะอัปเดตและผสานข้อมูล (Safe Merge) ขึ้น Neon Postgres พร้อมบันทึกเวลาและชื่อเครื่องนี้ เพื่อให้เครื่องอื่นกดยืนยันรับข้อมูลล่าสุดได้ทันที
              </span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-950/70 border-t border-slate-800 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            disabled={isUploading}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            onClick={onConfirmPush}
            disabled={isUploading || totalItems === 0}
            className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold flex items-center gap-2 transition-colors cursor-pointer"
          >
            <CloudUpload className={`w-4 h-4 ${isUploading ? 'animate-bounce' : ''}`} />
            {isUploading ? 'กำลังส่งข้อมูล...' : 'ยืนยันส่งข้อมูลขึ้น Cloud'}
          </button>
        </div>
      </div>
    </div>
  );
};
