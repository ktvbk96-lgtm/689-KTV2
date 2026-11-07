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
  Type,
  ZoomIn,
  ZoomOut,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { BillRecord, AppSettings, ReceiptFontSize, ReceiptPaperWidth } from '../types';
import { formatCurrency, saveStoredSettings } from '../lib/storage';
import {
  printReceiptAsImageViaBluetooth,
  getReceiptImageDataUrl,
  isWebBluetoothSupported,
  isBluetoothBlockedError,
  isRunningInIframe,
  ensureLaoFontsReady,
  loadReceiptImage,
  connectBluetoothPrinter,
  getBluetoothStatus,
  BluetoothPrinterStatus,
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
  onUpdateSettings?: (newSettings: AppSettings) => void;
}

export const BillingModal: React.FC<BillingModalProps> = ({
  bill,
  settings,
  onClose,
  onConfirmPayment,
  bluetoothConnected,
  onOpenBluetoothSetup,
  onSyncGoogleSheet,
  onUpdateSettings,
}) => {
  const [discount, setDiscount] = useState<number>(bill.discount || 0);
  const netTotal = Math.max(0, bill.subtotal - discount);

  // Font Size & Paper Width state for instant adjustments right on the receipt
  const [receiptFontSize, setReceiptFontSize] = useState<ReceiptFontSize>(
    settings.receiptFontSize || 'large'
  );
  const [receiptPaperWidth, setReceiptPaperWidth] = useState<ReceiptPaperWidth>(
    settings.receiptPaperWidth || '58mm'
  );

  const [isPrintingBt, setIsPrintingBt] = useState<boolean>(false);
  const [printError, setPrintError] = useState<string>('');
  const [printSuccess, setPrintSuccess] = useState<boolean>(false);
  const [isSyncingSheet, setIsSyncingSheet] = useState<boolean>(false);
  const [btFallbackNotice, setBtFallbackNotice] = useState<{
    show: boolean;
    message: string;
  }>({ show: false, message: '' });

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

  // Active settings with current font size and paper width
  const activeSettings: AppSettings = {
    ...settings,
    receiptFontSize,
    receiptPaperWidth,
  };

  // Handle Font Size changes & persist to settings
  const handleUpdateFontSize = (newSize: ReceiptFontSize) => {
    setReceiptFontSize(newSize);
    const updated = { ...settings, receiptFontSize: newSize, receiptPaperWidth };
    if (onUpdateSettings) {
      onUpdateSettings(updated);
    }
    saveStoredSettings(updated);
  };

  // Handle Paper Width changes & persist to settings
  const handleUpdatePaperWidth = (newWidth: ReceiptPaperWidth) => {
    setReceiptPaperWidth(newWidth);
    const updated = { ...settings, receiptFontSize, receiptPaperWidth: newWidth };
    if (onUpdateSettings) {
      onUpdateSettings(updated);
    }
    saveStoredSettings(updated);
  };

  // Re-render receipt image whenever discount, font size, or paper width changes
  useEffect(() => {
    let isCancelled = false;
    const generatePreview = async () => {
      try {
        await ensureLaoFontsReady();
        if (activeSettings.receiptLogoUrl) {
          await loadReceiptImage(activeSettings.receiptLogoUrl).catch(() => {});
        }
        if (isCancelled) return;
        const dataUrl = getReceiptImageDataUrl(currentBillState, activeSettings);
        setReceiptImageUrl(dataUrl);
      } catch (e) {
        console.error('Error rendering receipt image:', e);
      }
    };
    generatePreview();
    return () => {
      isCancelled = true;
    };
  }, [discount, activeSettings.receiptLogoUrl, receiptFontSize, receiptPaperWidth]);

  // Handle discount adjustments
  const handleSetDiscount = (val: number) => {
    const safeDiscount = Math.min(bill.subtotal, Math.max(0, val));
    setDiscount(safeDiscount);
  };

  const handleApplyPercent = (percent: number) => {
    const amount = Math.round((bill.subtotal * percent) / 100);
    handleSetDiscount(amount);
  };

  const [localBtStatus, setLocalBtStatus] = useState<BluetoothPrinterStatus>(getBluetoothStatus());
  const [isConnectingBt, setIsConnectingBt] = useState<boolean>(false);

  useEffect(() => {
    const updateBt = () => {
      setLocalBtStatus(getBluetoothStatus());
    };
    updateBt();

    window.addEventListener('689ktv_bluetooth_connected', updateBt);
    window.addEventListener('689ktv_bluetooth_disconnected', updateBt);
    return () => {
      window.removeEventListener('689ktv_bluetooth_connected', updateBt);
      window.removeEventListener('689ktv_bluetooth_disconnected', updateBt);
    };
  }, []);

  const isEffectiveBtConnected = bluetoothConnected || localBtStatus.connected;
  const currentBtDeviceName =
    localBtStatus.deviceName ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('689ktv_last_bt_device') : '') ||
    'Bluetooth Mini Printer';

  const [autoCloseAfterPrint, setAutoCloseAfterPrint] = useState<boolean>(
    settings.autoCloseAfterPrint !== undefined ? settings.autoCloseAfterPrint : true
  );

  // Connect to Bluetooth printer directly from BillingModal
  const handleConnectBluetooth = async (): Promise<boolean> => {
    setIsConnectingBt(true);
    setPrintError('');
    try {
      const res = await connectBluetoothPrinter();
      if (res.connected) {
        setLocalBtStatus(res);
        setPrintSuccess(true);
        setTimeout(() => setPrintSuccess(false), 2500);
        return true;
      } else if (res.isBlocked) {
        setBtFallbackNotice({
          show: true,
          message:
            'Web Bluetooth ຖືກຈຳກັດ (Permissions Policy / iframe). ທ່ານສາມາດສັ່ງພິມຜ່ານ Standard Print ແທນ ຫຼື ເປີດລິ້ງໃນແທັບໃໝ່',
        });
        return false;
      } else {
        setPrintError(res.error || 'ບໍ່ສາມາດເຊື່ອມຕໍ່ Bluetooth ໄດ້');
        return false;
      }
    } catch (err: any) {
      if (isBluetoothBlockedError(err)) {
        setBtFallbackNotice({
          show: true,
          message:
            'Web Bluetooth ຖືກຈຳກັດ (Permissions Policy / iframe). ທ່ານສາມາດສັ່ງພິມຜ່ານ Standard Print ແທນ',
        });
      } else {
        setPrintError(err.message || 'ເກີດຂໍ້ຜິດພາດໃນການເຊື່ອມຕໍ່');
      }
      return false;
    } finally {
      setIsConnectingBt(false);
    }
  };

  // Fast Print: ຕັດບັນຫາທຸກຢ່າງ ແລະ ສັ່ງພິມໃບບິນອອກມາໄດ້ທັນທີ
  const handleFastPrint = async () => {
    if (isWebBluetoothSupported() && !isRunningInIframe()) {
      handlePrintBluetoothImage();
    } else {
      handleStandardPrint();
    }
  };

  // Print via Bluetooth as raster image (Lao font support)
  const handlePrintBluetoothImage = async () => {
    setIsPrintingBt(true);
    setPrintError('');
    setPrintSuccess(false);

    // If running in Google AI Studio iframe, browser permissions policy disallows navigator.bluetooth.
    if (isRunningInIframe()) {
      setIsPrintingBt(false);
      setPrintError('');
      setBtFallbackNotice({
        show: true,
        message:
          'Google AI ສະແດງຜົນໃນ iframe ເຊິ່ງບຣາວເຊີຈະບລັອກ Bluetooth. ລະບົບຈຶ່ງສັ່ງພິມໃບບິນຜ່ານ Standard Print ໃຫ້ທັນທີ (ຫຼື ເປີດແທັບໃໝ່ເພື່ອໃຊ້ Bluetooth ໂດຍກົງ)',
      });
      setTimeout(() => {
        handleStandardPrint();
      }, 350);
      return;
    }

    try {
      // If not connected yet, trigger device search & connect first!
      if (!isEffectiveBtConnected) {
        const connected = await handleConnectBluetooth();
        if (!connected) {
          setIsPrintingBt(false);
          return;
        }
      }

      await printReceiptAsImageViaBluetooth(currentBillState, activeSettings);
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
      console.warn('Bluetooth print failed, evaluating fallback:', err);
      if (isBluetoothBlockedError(err)) {
        setPrintError('');
        setBtFallbackNotice({
          show: true,
          message:
            'Web Bluetooth ຖືກຈຳກັດ. ລະບົບກຳລັງສະຫຼັບໄປສັ່ງພິມຜ່ານ Standard Print ໃຫ້ອັດຕະໂນມັດ...',
        });
        setTimeout(() => {
          handleStandardPrint();
          setTimeout(() => {
            setBtFallbackNotice({ show: false, message: '' });
          }, 2000);
        }, 400);
      } else {
        setPrintError(err.message || 'ບໍ່ສາມາດພິມໃບບິນຜ່ານ Bluetooth ໄດ້. ກະລຸນາກວດສອບເຄື່ອງພິມ');
      }
    } finally {
      setIsPrintingBt(false);
    }
  };

  // Download receipt image as PNG file
  const handleDownloadReceiptImage = () => {
    try {
      const dataUrl = receiptImageUrl || getReceiptImageDataUrl(currentBillState, activeSettings);
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

        {/* ========================================================================= */}
        {/* RECEIPT FONT SIZE & PAPER CONTROLS (ປັບຂະໜາດຕົວໜັງສືໃຫຍ່-ນ້ອຍ ຕາມໃຈ)     */}
        {/* ========================================================================= */}
        <div className="mb-3 bg-gradient-to-r from-amber-500/10 via-rose-500/10 to-purple-500/10 border border-amber-500/30 rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <Type className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-black text-amber-300">
                ປັບຂະໜາດຕົວໜັງສືໃບບິນ (Font Size):
              </span>
            </div>

            {/* Font Size Pills Selector */}
            <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
              {[
                { id: 'small', label: 'ປົກກະຕິ (S)', sub: '100%' },
                { id: 'medium', label: 'ກາງ (M)', sub: '118%' },
                { id: 'large', label: 'ໃຫຍ່ (L)', sub: '138%' },
                { id: 'xlarge', label: 'ໃຫຍ່ພິເສດ (XL)', sub: '162%' },
              ].map((f) => {
                const isSelected = receiptFontSize === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleUpdateFontSize(f.id as ReceiptFontSize)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                      isSelected
                        ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-slate-950 font-black shadow-md'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
                    }`}
                    title={`ຂະໜາດຕົວໜັງສື ${f.sub}`}
                  >
                    <span>{f.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-slate-800/70 text-[11px] text-slate-400 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">ຂະໜາດເຈ້ຍ:</span>
              <button
                type="button"
                onClick={() => handleUpdatePaperWidth('58mm')}
                className={`px-2 py-0.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  receiptPaperWidth === '58mm'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                58 ມມ (Mini)
              </button>
              <button
                type="button"
                onClick={() => handleUpdatePaperWidth('80mm')}
                className={`px-2 py-0.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  receiptPaperWidth === '80mm'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                80 ມມ (Wide)
              </button>
            </div>

            <span className="text-[10px] font-semibold text-emerald-400">
              ✓ ເຫັນຊັດເຈນເຕັມຕາ • ບັນທຶກອັດຕະໂນມັດ
            </span>
          </div>
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
        {previewMode === 'image' && (
          <div className="no-print print:hidden bg-slate-950 p-3 rounded-2xl border border-slate-800 flex flex-col items-center justify-center max-h-72 overflow-y-auto scrollbar-thin">
            {receiptImageUrl ? (
              <div className="bg-white p-3 rounded-xl shadow-lg border border-slate-200">
                <img
                  src={receiptImageUrl}
                  alt="Receipt Preview"
                  className={`max-w-full h-auto object-contain mx-auto ${
                    receiptPaperWidth === '80mm' ? 'w-[380px]' : 'w-[320px]'
                  }`}
                />
              </div>
            ) : (
              <p className="text-xs text-slate-500">ກຳລັງສ້າງຮູບໃບບິນ...</p>
            )}
            <p className="text-[10px] text-slate-400 mt-2 text-center">
              * ລະບົບປ່ຽນໃບບິນພາສາລາວເປັນຮູບພາບຄົມຊັດ (Raster Bitmap) ກ່ອນສົ່ງຫາ Mini Thermal Printer (Font: {receiptFontSize.toUpperCase()})
            </p>
          </div>
        )}

        <div
          className={`bg-slate-100 text-slate-900 p-5 rounded-2xl shadow-inner font-mono max-h-72 overflow-y-auto border border-slate-300 print:max-h-none print:shadow-none print:m-0 print:p-2 print:border-none print-receipt-container ${
            receiptPaperWidth === '58mm' ? 'paper-58mm' : 'paper-80mm'
          } receipt-font-${receiptFontSize} ${previewMode === 'image' ? 'hidden print:block' : 'block'}`}
          style={{
            fontFamily: "'Phetsarath', 'Phetsarath OT', 'Noto Sans Lao', monospace",
            fontSize: settings.receiptCustomFontSize
              ? `${settings.receiptCustomFontSize}px`
              : receiptFontSize === 'xlarge'
              ? '16px'
              : receiptFontSize === 'large'
              ? '14px'
              : receiptFontSize === 'medium'
              ? '12.5px'
              : '11px',
            lineHeight: 1.38,
          }}
        >
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
            <h2
              className={`receipt-title font-black tracking-wider text-slate-950 ${
                receiptFontSize === 'xlarge'
                  ? 'text-xl'
                  : receiptFontSize === 'large'
                  ? 'text-lg'
                  : 'text-base'
              }`}
            >
              {settings.shopName}
            </h2>
            <p className="font-semibold text-slate-700">{settings.receiptHeader}</p>
            {settings.shopAddress && <p className="text-slate-600">{settings.shopAddress}</p>}
            {settings.shopPhone && <p className="text-slate-600">Tel: {settings.shopPhone}</p>}
            {settings.wifiPassword && (
              <p className="text-slate-600">WiFi: {settings.wifiPassword}</p>
            )}
          </div>

          {/* Bill Meta */}
          <div className="py-2 border-b border-dashed border-slate-400 space-y-0.5">
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
            {bill.packageName && (
              <div className="flex justify-between font-bold text-slate-900">
                <span>ແພັກເກັດຫ້ອງ:</span>
                <span>{bill.packageName}</span>
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
              <div className="flex justify-between text-slate-600">
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
            {bill.roomCharge > 0 ? (
              <div className="flex justify-between font-semibold">
                <span>ຄ່າຫ້ອງຄາຣາໂອເກະ</span>
                <span>{formatCurrency(bill.roomCharge, settings.currencySymbol)}</span>
              </div>
            ) : bill.type === 'ktv_room' && (bill.isRoomChargePaid || bill.roomCharge === 0) ? (
              <div className="flex justify-between font-semibold text-emerald-800 bg-emerald-50 px-1 py-0.5 rounded">
                <span>ຄ່າຫ້ອງຄາຣາໂອເກະ (ຈ່າຍແລ້ວ)</span>
                <span>0 {settings.currencySymbol}</span>
              </div>
            ) : null}

            {bill.items.map((item, idx) => (
              <div key={idx} className="space-y-0.5">
                <div className="flex justify-between">
                  <span className="font-bold truncate max-w-[200px]">{item.productName}</span>
                  <span className="font-bold font-mono">
                    {formatCurrency(item.total, settings.currencySymbol)}
                  </span>
                </div>
                <div className="flex justify-between text-[0.88em] text-slate-600">
                  <span>
                    {item.quantity} {item.unit} x {formatCurrency(item.price, '')}
                  </span>
                  {item.sellerName && <span>ເສີບ: {item.sellerName}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="py-2 border-b border-dashed border-slate-400 space-y-1">
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
            <div
              className={`receipt-total flex ${settings.receiptHideTotalText !== false ? 'justify-end' : 'justify-between'} font-black text-slate-950 pt-1.5 border-t-2 border-slate-950 ${
                receiptFontSize === 'xlarge'
                  ? 'text-xl'
                  : receiptFontSize === 'large'
                  ? 'text-lg'
                  : 'text-base'
              }`}
            >
              {settings.receiptHideTotalText !== false ? (
                // เอาข้อความที่มีอยู่ในบรรทัดยอดสุทธิออก ไม่ต้องใส่
                <span className="font-black text-right w-full text-slate-950">
                  {formatCurrency(netTotal, settings.currencySymbol)}
                </span>
              ) : (
                <>
                  <span>ຍອດສຸດທິ:</span>
                  <span>{formatCurrency(netTotal, settings.currencySymbol)}</span>
                </>
              )}
            </div>
          </div>

          {/* Footer note */}
          <div className="pt-2 text-center text-slate-600 space-y-0.5">
            <p>{settings.receiptFooter}</p>
            <p className="font-black text-slate-900">*** 689 KTV ***</p>
          </div>

          {/* Paper cutter bottom spacer (ensures Windows thermal driver auto-cut cuts cleanly without clipping footer text) */}
          <div className="receipt-cut-spacer hidden print:block" style={{ height: '14mm' }} />
        </div>


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

          {/* Bluetooth Connection & Search Card (For ANY device opening shared link) */}
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    isEffectiveBtConnected
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}
                >
                  <Bluetooth className={`w-4 h-4 ${isEffectiveBtConnected ? 'animate-pulse' : ''}`} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black text-slate-100">
                      {isEffectiveBtConnected ? 'ເຊື່ອມຕໍ່ Bluetooth ແລ້ວ' : 'Bluetooth Thermal Printer'}
                    </span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isEffectiveBtConnected ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'
                      }`}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {isEffectiveBtConnected
                      ? `ເຄື່ອງພິມ: ${currentBtDeviceName}`
                      : 'ຮອງຮັບເຄື່ອງພິມ 58mm / 80mm ທຸກລຸ້ນ (Android, Windows, iOS Bluefy)'}
                  </p>
                </div>
              </div>

              {/* Search & Connect Button */}
              <button
                type="button"
                onClick={handleConnectBluetooth}
                disabled={isConnectingBt}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm ${
                  isEffectiveBtConnected
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-600/30 font-black'
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isConnectingBt ? 'animate-spin' : ''}`} />
                <span>
                  {isConnectingBt
                    ? 'ກຳລັງຄົ້ນຫາ...'
                    : isEffectiveBtConnected
                    ? 'ປ່ຽນເຄື່ອງພິມ'
                    : '🔍 ຄົ້ນຫາ & ເຊື່ອມຕໍ່ Bluetooth'}
                </span>
              </button>
            </div>

            {/* Helpful iOS Safari Tip if device is on iOS and browser lacks native Web Bluetooth */}
            {!isWebBluetoothSupported() && (
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300 flex items-start gap-2">
                <span className="text-base shrink-0">💡</span>
                <span className="leading-relaxed">
                  <strong>ສຳລັບ iPhone / iPad (iOS):</strong> Apple Safari ບໍ່ຮອງຮັບ Bluetooth ໂດຍກົງ. ທ່ານສາມາດດາວໂຫລດແອັບຟຣີ <strong>Bluefy</strong> (Web BLE Browser) ຈາກ App Store ແລ້ວເປີດລິ້ງນີ້ຈະຄົ້ນຫາ ແລະ ພິມ Bluetooth ໄດ້ 100%! ຫຼື ກົດ <strong>"ພິມແບບທົ່ວໄປ (Print)"</strong> ດ້ານລຸ່ມເພື່ອພິມຜ່ານ AirPrint ໄດ້ທັນທີ
                </span>
              </div>
            )}
          </div>

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
          <div className="space-y-2 pt-1">
            {/* Primary One-Click Instant Print */}
            <button
              type="button"
              onClick={handleFastPrint}
              disabled={isPrintingBt}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
            >
              <Printer className="w-4 h-4 text-slate-950" />
              <span>⚡ ພິມໃບບິນດ່ວນທັນທີ (Fast Print Receipt)</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              {/* Bluetooth Thermal Print as Image */}
              <button
                type="button"
                onClick={handlePrintBluetoothImage}
                disabled={isPrintingBt || isConnectingBt}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  isEffectiveBtConnected
                    ? 'bg-blue-600 hover:bg-blue-500 border-blue-500 text-white shadow-md shadow-blue-600/30 font-black'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                }`}
              >
                <Bluetooth className={`w-3.5 h-3.5 ${isPrintingBt ? 'animate-spin' : ''}`} />
                <span>
                  {isPrintingBt
                    ? 'ກຳລັງພິມ...'
                    : isEffectiveBtConnected
                    ? 'ພິມຜ່ານ Bluetooth'
                    : '🔍 ຄົ້ນຫາ & ພິມ BT'}
                </span>
              </button>

              {/* Standard Browser Print */}
              <button
                type="button"
                onClick={handleStandardPrint}
                className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-amber-400" />
                <span>ພິມແບບທົ່ວໄປ (Print)</span>
              </button>
            </div>
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

      {/* Bluetooth Fallback to Standard Print Modal (No persistent red error bar) */}
      {btFallbackNotice.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-amber-500/50 rounded-3xl p-5 w-full max-w-sm shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Printer className="w-7 h-7 animate-bounce" />
            </div>
            <div className="space-y-1.5">
              <h4 className="font-black text-base text-slate-100">
                ສະຫຼັບໄປພິມແບບມາດຕະຖານ (Standard Print)
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                {btFallbackNotice.message}
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-[11px] text-amber-300/90 font-medium">
              💡 ລະບົບປັບຂະໜາດເຈ້ຍຄວາມຮ້ອນ 58mm / 80mm ແລະ ຕັດຂອບອັດຕະໂນມັດ ສຳລັບ Windows Thermal Printer
            </div>

            {isRunningInIframe() && (
              <a
                href={typeof window !== 'undefined' ? window.location.href : '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 transition-all cursor-pointer block"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>🚀 ເປີດແທັບໃໝ່ (ເຊື່ອມຕໍ່ Bluetooth 100%)</span>
              </a>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBtFallbackNotice({ show: false, message: '' })}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
              >
                ປິດ
              </button>
              <button
                type="button"
                onClick={() => {
                  setBtFallbackNotice({ show: false, message: '' });
                  handleStandardPrint();
                }}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-lg shadow-amber-500/25 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>ພິມດຽວນີ້ (Print)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
