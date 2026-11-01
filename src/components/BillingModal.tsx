import React, { useState, useEffect } from 'react';
import {
  Printer,
  Bluetooth,
  CheckCircle2,
  X,
  Download,
  Percent,
  AlertCircle,
  Image as ImageIcon,
  FileText,
} from 'lucide-react';
import { BillRecord, AppSettings } from '../types';
import { formatCurrency } from '../lib/storage';
import {
  printReceiptAsImageViaBluetooth,
  getReceiptImageDataUrl,
  isWebBluetoothSupported,
  ensureLaoFontsReady,
  loadReceiptImage,
} from '../lib/bluetoothPrinter';
import { FormattedNumberInput } from './FormattedNumberInput';

interface BillingModalProps {
  bill: BillRecord;
  settings: AppSettings;
  onClose: () => void;
  onConfirmPayment: (bill: BillRecord) => void;
  bluetoothConnected: boolean;
  onOpenBluetoothSetup: () => void;
  onSyncGoogleSheet?: (bill: BillRecord) => Promise<boolean>;
}

export const BillingModal: React.FC<BillingModalProps> = ({
  bill,
  settings,
  onClose,
  onConfirmPayment,
  bluetoothConnected,
  onOpenBluetoothSetup,
  onSyncGoogleSheet,
}) => {
  const [discount, setDiscount] = useState<number>(bill.discount || 0);
  const netTotal = Math.max(0, bill.subtotal - discount);

  const [isPrintingBt, setIsPrintingBt] = useState<boolean>(false);
  const [printError, setPrintError] = useState<string>('');
  const [printSuccess, setPrintSuccess] = useState<boolean>(false);
  const [isSyncingSheet, setIsSyncingSheet] = useState<boolean>(false);

  // Receipt Preview mode: 'image' (Canvas render with authentic Lao fonts) or 'paper'
  const [previewMode, setPreviewMode] = useState<'image' | 'paper'>('image');
  const [receiptImageUrl, setReceiptImageUrl] = useState<string>('');

  const currentBillState: BillRecord = {
    ...bill,
    discount,
    total: netTotal,
    payment: {
      method: 'cash',
    },
  };

  // Re-render receipt image whenever discount changes after ensuring Lao fonts are loaded
  useEffect(() => {
    let isCancelled = false;
    const generatePreview = async () => {
      try {
        await ensureLaoFontsReady();
        if (settings.receiptLogoUrl) {
          await loadReceiptImage(settings.receiptLogoUrl).catch(() => {});
        }
        if (isCancelled) return;
        const dataUrl = getReceiptImageDataUrl(currentBillState, settings);
        setReceiptImageUrl(dataUrl);
      } catch (e) {
        console.error('Error rendering receipt image:', e);
      }
    };
    generatePreview();
    return () => {
      isCancelled = true;
    };
  }, [discount, settings.receiptLogoUrl]);

  // Handle discount adjustments
  const handleSetDiscount = (val: number) => {
    const safeDiscount = Math.min(bill.subtotal, Math.max(0, val));
    setDiscount(safeDiscount);
  };

  const handleApplyPercent = (percent: number) => {
    const amount = Math.round((bill.subtotal * percent) / 100);
    handleSetDiscount(amount);
  };

  const [autoCloseAfterPrint, setAutoCloseAfterPrint] = useState<boolean>(
    settings.autoCloseAfterPrint !== undefined ? settings.autoCloseAfterPrint : true
  );

  // Print via Bluetooth as raster image (Lao font support)
  const handlePrintBluetoothImage = async () => {
    setIsPrintingBt(true);
    setPrintError('');
    setPrintSuccess(false);

    try {
      await printReceiptAsImageViaBluetooth(currentBillState, settings);
      setPrintSuccess(true);

      // Auto-finalize & close receipt modal immediately as requested
      if (autoCloseAfterPrint) {
        setTimeout(async () => {
          await handleFinalConfirm();
        }, 700);
      } else {
        setTimeout(() => setPrintSuccess(false), 4000);
      }
    } catch (err: any) {
      setPrintError(err.message || 'ບໍ່ສາມາດພິມໃບບິນຜ່ານ Bluetooth ໄດ້');
    } finally {
      setIsPrintingBt(false);
    }
  };

  // Download receipt image as PNG file
  const handleDownloadReceiptImage = () => {
    try {
      const dataUrl = receiptImageUrl || getReceiptImageDataUrl(currentBillState, settings);
      const link = document.createElement('a');
      link.download = `Bill-689KTV-${bill.billNumber}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err: any) {
      alert('ດາວໂຫຼດຮູບໃບບິນບໍ່ສຳເລັດ: ' + err.message);
    }
  };

  const handleStandardPrint = () => {
    window.print();
    if (autoCloseAfterPrint) {
      setTimeout(async () => {
        await handleFinalConfirm();
      }, 600);
    }
  };

  const handleFinalConfirm = async () => {
    if (settings.autoSyncGoogleSheets && onSyncGoogleSheet) {
      setIsSyncingSheet(true);
      try {
        await onSyncGoogleSheet(currentBillState);
        currentBillState.syncedToSheets = true;
      } catch (e) {
        console.error('Auto sync sheet error:', e);
      } finally {
        setIsSyncingSheet(false);
      }
    }

    onConfirmPayment(currentBillState);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 w-full max-w-xl shadow-2xl text-white my-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
              <Printer className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-black text-lg text-slate-100">
                ໃບບິນຮັບເງິນ / ເຊັກບິນ (689 KTV)
              </h3>
              <p className="text-xs text-slate-400">
                ເລກທີບິນ: <strong className="font-mono text-amber-400">{bill.billNumber}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Preview Selector: Image mode (Lao raster) vs Paper Text */}
        <div className="flex items-center justify-between gap-2 mb-2 bg-slate-950/60 p-1.5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPreviewMode('image')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                previewMode === 'image'
                  ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-slate-950 font-black shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>ໃບບິນແບບຮູບພາບ (Lao Image)</span>
            </button>

            <button
              type="button"
              onClick={() => setPreviewMode('paper')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                previewMode === 'paper'
                  ? 'bg-slate-800 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>ເບິ່ງແບບເຈ້ຍ (Paper)</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleDownloadReceiptImage}
            className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            title="ດາວໂຫຼດຮູບໃບບິນ PNG"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">ດາວໂຫຼດຮູບ PNG</span>
          </button>
        </div>

        {/* Printable Receipt Paper Container (thermal preview) */}
        {previewMode === 'image' ? (
          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 flex flex-col items-center justify-center max-h-72 overflow-y-auto scrollbar-thin">
            {receiptImageUrl ? (
              <div className="bg-white p-3 rounded-xl shadow-lg border border-slate-200">
                <img
                  src={receiptImageUrl}
                  alt="Receipt Preview"
                  className="max-w-full h-auto w-[320px] object-contain mx-auto"
                />
              </div>
            ) : (
              <p className="text-xs text-slate-500">ກຳລັງສ້າງຮູບໃບບິນ...</p>
            )}
            <p className="text-[10px] text-slate-400 mt-2 text-center">
              * ລະບົບປ່ຽນໃບບິນພາສາລາວເປັນຮູບພາບຄົມຊັດ (Raster Bitmap) ກ່ອນສົ່ງຫາ Mini Thermal Printer
            </p>
          </div>
        ) : (
          <div className="bg-slate-100 text-slate-900 p-5 rounded-2xl shadow-inner font-mono text-xs max-h-72 overflow-y-auto border border-slate-300 print:max-h-none print:shadow-none print:m-0 print:p-2 print:border-none print-receipt-container">
            {/* Header 689 KTV */}
            <div className="text-center pb-2 border-b border-dashed border-slate-400">
              {settings.receiptLogoUrl && (
                <div className="flex justify-center mb-2">
                  <img
                    src={settings.receiptLogoUrl}
                    alt="Shop Logo"
                    className="max-h-16 max-w-[140px] object-contain mx-auto"
                  />
                </div>
              )}
              <h2 className="text-base font-black tracking-wider text-slate-950">
                {settings.shopName}
              </h2>
              <p className="text-[11px] font-semibold text-slate-700">{settings.receiptHeader}</p>
              {settings.shopAddress && <p className="text-[10px] text-slate-600">{settings.shopAddress}</p>}
              {settings.shopPhone && <p className="text-[10px] text-slate-600">Tel: {settings.shopPhone}</p>}
              {settings.wifiPassword && (
                <p className="text-[10px] text-slate-600">WiFi: {settings.wifiPassword}</p>
              )}
            </div>

            {/* Bill Meta */}
            <div className="py-2 border-b border-dashed border-slate-400 space-y-0.5 text-[11px]">
              <div className="flex justify-between">
                <span>ເລກທີບິນ:</span>
                <span className="font-bold">{bill.billNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>ວັນທີ-ເວລາ:</span>
                <span>{new Date(bill.endTime).toLocaleString('lo-LA')}</span>
              </div>
              <div className="flex justify-between">
                <span>ພະນັກງານ:</span>
                <span>{bill.staffName}</span>
              </div>
              {bill.roomName && (
                <div className="flex justify-between font-bold text-slate-900 pt-1">
                  <span>ຫ້ອງ KTV:</span>
                  <span>{bill.roomName}</span>
                </div>
              )}
              {bill.startTime && (
                <div className="flex justify-between font-bold text-slate-950 py-0.5 bg-slate-200/80 px-1.5 rounded">
                  <span>ເວລາເປີດ - ສິ້ນສຸດ:</span>
                  <span className="font-mono">
                    {new Date(bill.startTime).toLocaleTimeString('lo-LA', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}{' '}
                    ຫາ{' '}
                    {new Date(bill.endTime).toLocaleTimeString('lo-LA', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </span>
                </div>
              )}
              {bill.timeRangeFormatted && (
                <div className="flex justify-between text-[10px] text-slate-600">
                  <span>ກຳນົດໄລຍະເວລາ:</span>
                  <span>{bill.timeRangeFormatted}</span>
                </div>
              )}
              {bill.durationMinutes !== undefined && bill.durationMinutes > 0 && (
                <div className="flex justify-between text-slate-700">
                  <span>ໄລຍະເວລາໃຊ້ງານຈິງ:</span>
                  <span>
                    {Math.floor(bill.durationMinutes / 60)} ຊມ {bill.durationMinutes % 60} ນາທີ (
                    {bill.durationMinutes} ນາທີ)
                  </span>
                </div>
              )}
            </div>

            {/* Items breakdown */}
            <div className="py-2 border-b border-dashed border-slate-400 space-y-1.5">
              {bill.roomCharge > 0 && (
                <div className="flex justify-between font-semibold">
                  <span>ຄ່າຫ້ອງຄາຣາໂອເກະ</span>
                  <span>{formatCurrency(bill.roomCharge, settings.currencySymbol)}</span>
                </div>
              )}

              {bill.items.map((item, idx) => (
                <div key={idx} className="space-y-0.5">
                  <div className="flex justify-between">
                    <span className="font-medium truncate max-w-[200px]">{item.productName}</span>
                    <span>{formatCurrency(item.total, settings.currencySymbol)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-600">
                    <span>
                      {item.quantity} {item.unit} x {formatCurrency(item.price, '')}
                    </span>
                    {item.sellerName && <span>ເສີບ: {item.sellerName}</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="py-2 border-b border-dashed border-slate-400 space-y-1 text-[11px]">
              <div className="flex justify-between text-slate-700">
                <span>ລວມເງິນ:</span>
                <span>{formatCurrency(bill.subtotal, settings.currencySymbol)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-rose-700 font-bold">
                  <span>ສ່ວນຫຼຸດ (Discount):</span>
                  <span>-{formatCurrency(discount, settings.currencySymbol)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-black text-slate-950 pt-1 border-t border-slate-400">
                <span>ຍອດສຸດທິ (TOTAL):</span>
                <span>{formatCurrency(netTotal, settings.currencySymbol)}</span>
              </div>
            </div>

            {/* Footer note */}
            <div className="pt-2 text-center text-[10px] text-slate-600 space-y-0.5">
              <p>{settings.receiptFooter}</p>
              <p className="font-black text-slate-900">*** 689 KTV ***</p>
            </div>
          </div>
        )}

        {/* Dynamic Discount Controls */}
        <div className="mt-3 bg-slate-850 border border-slate-800 rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
              <Percent className="w-3.5 h-3.5 text-amber-400" />
              <span>ກົດສ່ວນຫຼຸດຕາມໃຈ (Discount Controls):</span>
            </div>
            {discount > 0 && (
              <button
                type="button"
                onClick={() => handleSetDiscount(0)}
                className="text-[11px] text-rose-400 hover:text-rose-300 font-bold underline cursor-pointer"
              >
                ລ້າງສ່ວນຫຼຸດ (0 ₭)
              </button>
            )}
          </div>

          {/* Quick percentage pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-slate-400">ເປີເຊັນ:</span>
            {[5, 10, 15, 20, 30, 50, 100].map((p) => {
              const isSelected = discount === Math.round((bill.subtotal * p) / 100);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleApplyPercent(p)}
                  className={`px-2 py-0.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-amber-500 border-amber-400 text-slate-950 font-black shadow'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {p === 100 ? 'ຟຣີ (100%)' : `${p}%`}
                </button>
              );
            })}
          </div>

          {/* Quick cash discount presets & custom amount input */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-800">
            <div className="flex items-center gap-1 flex-wrap">
              {[10000, 20000, 50000, 100000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => handleSetDiscount(amt)}
                  className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-mono text-slate-300 cursor-pointer"
                >
                  -{amt.toLocaleString()}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-1.5">
              <span className="text-[11px] text-slate-400">ປ້ອນເອງ:</span>
              <div className="w-36">
                <FormattedNumberInput
                  value={discount || ''}
                  onChange={(num) => handleSetDiscount(num)}
                  placeholder="0"
                  max={bill.subtotal}
                  suffix={settings.currencySymbol}
                  className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-right font-mono font-bold text-xs text-amber-400 focus:ring-1 focus:ring-amber-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Print Settings & Actions */}
        <div className="mt-3 space-y-2.5">

          {/* Bluetooth Print Status / Error */}
          {printError && (
            <div className="p-2.5 bg-rose-950/80 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{printError}</span>
            </div>
          )}

          {printSuccess && (
            <div className="p-2.5 bg-emerald-950/80 border border-emerald-800/80 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>ສັ່ງພິມໃບບິນແບບຮູບພາບຜ່ານ Bluetooth ສຳເລັດແລ້ວ!</span>
            </div>
          )}

          {/* Auto close toggle after print */}
          <div className="flex items-center justify-between p-2 rounded-xl bg-slate-850 border border-slate-800">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoCloseAfterPrint}
                onChange={(e) => setAutoCloseAfterPrint(e.target.checked)}
                className="w-4 h-4 rounded accent-rose-500 cursor-pointer"
              />
              <span>ປິດໜ້າໃບບິນອັດຕະໂນມັດເມື່ອພິມສຳເລັດ (Auto-close)</span>
            </label>
            <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">
              {autoCloseAfterPrint ? 'ເປີດໃຊ້ງານ' : 'ປິດ'}
            </span>
          </div>

          {/* Print & Action Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {/* Bluetooth Thermal Print as Image */}
            <button
              onClick={handlePrintBluetoothImage}
              disabled={isPrintingBt}
              className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                bluetoothConnected
                  ? 'bg-blue-600 hover:bg-blue-500 border-blue-500 text-white shadow-md shadow-blue-600/30'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
              }`}
            >
              <Bluetooth className={`w-4 h-4 ${isPrintingBt ? 'animate-spin' : ''}`} />
              <span>
                {isPrintingBt
                  ? 'ກຳລັງພິມຮູບພາບ...'
                  : bluetoothConnected
                  ? 'ພິມຮູບພາບຜ່ານ Bluetooth'
                  : 'ເຊື່ອມຕໍ່ & ພິມຮູບ BT'}
              </span>
            </button>

            {/* Standard Browser Print */}
            <button
              onClick={handleStandardPrint}
              className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Printer className="w-4 h-4 text-amber-400" />
              <span>ພິມແບບທົ່ວໄປ (Print)</span>
            </button>
          </div>

          {/* Confirm & Close */}
          <div className="pt-1">
            <button
              onClick={handleFinalConfirm}
              disabled={isSyncingSheet}
              className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-rose-500 via-rose-600 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white text-sm font-black shadow-xl shadow-rose-600/30 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>
                {isSyncingSheet ? 'ກຳລັງບັນທຶກ Google Sheets...' : 'ຢືນຢັນເຊັກບິນ & ສຳເລັດ'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
