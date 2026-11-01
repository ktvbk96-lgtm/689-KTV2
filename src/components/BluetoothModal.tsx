import React, { useState } from 'react';
import {
  Bluetooth,
  Printer,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  Power,
  Sliders,
  HelpCircle,
} from 'lucide-react';
import { AppSettings, BillRecord } from '../types';
import {
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
  isWebBluetoothSupported,
  printViaBluetooth,
} from '../lib/bluetoothPrinter';

interface BluetoothModalProps {
  settings: AppSettings;
  bluetoothConnected: boolean;
  onClose: () => void;
  onRefreshStatus: () => void;
}

export const BluetoothModal: React.FC<BluetoothModalProps> = ({
  settings,
  bluetoothConnected,
  onClose,
  onRefreshStatus,
}) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [isTestPrinting, setIsTestPrinting] = useState<boolean>(false);

  const handleConnect = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await connectBluetoothPrinter();
      if (res.connected) {
        setMessage(`ເຊື່ອມຕໍ່ສຳເລັດແລ້ວ: ${res.deviceName}`);
        onRefreshStatus();
      } else {
        setMessage(`ບໍ່ສາມາດເຊື່ອມຕໍ່ໄດ້: ${res.error || 'ກະລຸນາລອງໃໝ່'}`);
      }
    } catch (err: any) {
      setMessage(`ຂໍ້ຜິດພາດ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnectBluetoothPrinter();
    onRefreshStatus();
    setMessage('ຕັດການເຊື່ອມຕໍ່ Bluetooth ແລ້ວ');
  };

  const handleTestPrint = async () => {
    setIsTestPrinting(true);
    setMessage('');
    try {
      const sampleBill: BillRecord = {
        id: 'test-' + Date.now(),
        billNumber: '689-TEST-001',
        type: 'pos_sale',
        endTime: new Date().toISOString(),
        roomCharge: 0,
        items: [
          {
            productId: 'test-1',
            productName: 'ທົດສອບການພິມ 689 KTV',
            unit: 'ບິນ',
            quantity: 1,
            price: 0,
            total: 0,
            sellerName: 'System Test',
          },
        ],
        subtotal: 0,
        discount: 0,
        tax: 0,
        total: 0,
        payment: { method: 'cash' },
        staffName: 'Admin',
      };

      await printViaBluetooth(sampleBill, settings);
      setMessage('ສົ່ງຄຳສັ່ງພິມທົດສອບສຳເລັດແລ້ວ!');
    } catch (err: any) {
      setMessage('ພິມທົດສອບລົ້ມເຫຼວ: ' + err.message);
    } finally {
      setIsTestPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Bluetooth className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-black text-base text-slate-100">
                ຕັ້ງຄ່າ Bluetooth Thermal Printer
              </h3>
              <p className="text-xs text-slate-400">
                ເຊື່ອມຕໍ່ເຄື່ອງພິມໃບບິນຂະໜາດນ້ອຍ Mini Printer 58mm / 80mm
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  bluetoothConnected ? 'bg-blue-400 animate-ping' : 'bg-slate-600'
                }`}
              />
              <div>
                <h4 className="font-bold text-xs text-slate-200">
                  {bluetoothConnected
                    ? 'Bluetooth ເຊື່ອມຕໍ່ແລ້ວ (ພ້ອມພິມ)'
                    : 'ຍັງບໍ່ທັນໄດ້ເຊື່ອມຕໍ່'}
                </h4>
                <p className="text-[11px] text-slate-400">
                  {isWebBluetoothSupported()
                    ? 'ຮອງຮັບ Web Bluetooth API'
                    : 'ກະລຸນາໃຊ້ງານຜ່ານ Chrome ຫຼື Edge ເທິງ Android/PC/Mac'}
                </p>
              </div>
            </div>

            <div>
              {bluetoothConnected ? (
                <button
                  onClick={handleDisconnect}
                  className="px-3 py-1.5 rounded-xl bg-rose-950 border border-rose-800 text-rose-300 text-xs font-bold cursor-pointer"
                >
                  ຕັດການເຊື່ອມຕໍ່
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={loading}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-600/30 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Bluetooth className="w-4 h-4" />
                  <span>{loading ? 'ກຳລັງຄົ້ນຫາ...' : 'ຄົ້ນຫາ & ເຊື່ອມຕໍ່'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Test Print button */}
          {bluetoothConnected && (
            <div className="pt-1">
              <button
                onClick={handleTestPrint}
                disabled={isTestPrinting}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4 text-amber-400" />
                <span>
                  {isTestPrinting ? 'ກຳລັງທົດສອບ...' : 'ພິມທົດສອບໃບບິນ (Test Print ESC/POS)'}
                </span>
              </button>
            </div>
          )}

          {/* Message Feedback */}
          {message && (
            <div className="p-3 bg-slate-800 rounded-xl text-xs text-slate-200 font-mono">
              {message}
            </div>
          )}

          {/* Setup tips */}
          <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 text-xs text-slate-400 space-y-1.5">
            <div className="font-bold text-slate-300 flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-amber-400" />
              <span>ຄຳແນະນຳໃນການເຊື່ອມຕໍ່:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
              <li>ເປີດສະວິດເຄື່ອງພິມ Mini Printer ແລະ ເປີດ Bluetooth ໃນອຸປະກອນຂອງທ່ານ</li>
              <li>ກົດປຸ່ມ &quot;ຄົ້ນຫາ & ເຊື່ອມຕໍ່&quot; ແລ້ວເລືອກຊື່ເຄື່ອງພິມຂອງທ່ານໃນລາຍການທີ່ສະແດງ</li>
              <li>ຖ້າບໍ່ມີເຄື່ອງພິມ Bluetooth ທ່ານຍັງສາມາດກົດ &quot;ພິມແບບທົ່ວໄປ (Print)&quot; ໃນໜ້າເຊັກບິນໄດ້ເຊັ່ນກັນ</li>
            </ul>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex justify-end mt-4">
          <button
            onClick={onClose}
            className="py-2.5 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
          >
            ປິດ
          </button>
        </div>
      </div>
    </div>
  );
};
