import React, { useState, useMemo, useRef } from 'react';
import {
  HandCoins,
  Search,
  Plus,
  Camera,
  Upload,
  Calendar,
  Phone,
  User,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  Clock,
  Printer,
  Trash2,
  Eye,
  X,
  CreditCard,
  History,
  FileText,
  Image as ImageIcon,
  Sparkles,
  ExternalLink,
  ChevronRight,
  Filter,
  Check,
  RotateCcw,
  Video,
  Edit,
  Lock,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import { DebtRecord, DebtPaymentEntry, AppSettings, StaffMember, Room, Role } from '../types';
import { formatCurrency } from '../lib/storage';
import {
  printDebtSlipAsImageViaBluetooth,
  getDebtSlipImageDataUrl,
  getBluetoothStatus,
} from '../lib/bluetoothPrinter';
import { FormattedNumberInput } from './FormattedNumberInput';

interface DebtManagementProps {
  debts: DebtRecord[];
  rooms: Room[];
  staffList: StaffMember[];
  settings: AppSettings;
  currentRole?: Role;
  currentStaff?: StaffMember;
  onSaveDebts: (updatedDebts: DebtRecord[]) => void;
  onOpenBluetoothModal?: () => void;
}

export const DebtManagement: React.FC<DebtManagementProps> = ({
  debts,
  rooms,
  staffList,
  settings,
  currentRole = 'staff',
  currentStaff,
  onSaveDebts,
  onOpenBluetoothModal,
}) => {
  // Permission checks determined by Admin
  const canEdit = currentRole === 'admin' || !!settings.staffCanEditDebt;
  const canDelete = currentRole === 'admin' || !!settings.staffCanDeleteDebt;

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'unpaid' | 'partially_paid' | 'paid'>('pending');
  const [sortBy, setSortBy] = useState<'remaining_desc' | 'date_desc' | 'date_asc' | 'amount_desc'>('remaining_desc');

  // Modal States
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [payingDebt, setPayingDebt] = useState<DebtRecord | null>(null);
  const [editingDebt, setEditingDebt] = useState<DebtRecord | null>(null);
  const [inspectingPhoto, setInspectingPhoto] = useState<{ url: string; title: string } | null>(null);
  const [historyDebt, setHistoryDebt] = useState<DebtRecord | null>(null);
  const [printingDebt, setPrintingDebt] = useState<DebtRecord | null>(null);
  const [isPrintingBt, setIsPrintingBt] = useState<boolean>(false);
  const [printSuccess, setPrintSuccess] = useState<boolean>(false);
  const [printError, setPrintError] = useState<string>('');

  // Add Debt Form State
  const [newCustomerName, setNewCustomerName] = useState<string>('');
  const [newCustomerPhone, setNewCustomerPhone] = useState<string>('');
  const [newTotalAmount, setNewTotalAmount] = useState<number>(0);
  const [newRoomName, setNewRoomName] = useState<string>('');
  const [newBillNumber, setNewBillNumber] = useState<string>('');
  const [newDueDate, setNewDueDate] = useState<string>('');
  const [newNote, setNewNote] = useState<string>('');
  const [newPhotoUrl, setNewPhotoUrl] = useState<string>('');
  const [addFormError, setAddFormError] = useState<string>('');

  // Edit Debt Form State
  const [editCustomerName, setEditCustomerName] = useState<string>('');
  const [editCustomerPhone, setEditCustomerPhone] = useState<string>('');
  const [editTotalAmount, setEditTotalAmount] = useState<number>(0);
  const [editRoomName, setEditRoomName] = useState<string>('');
  const [editDueDate, setEditDueDate] = useState<string>('');
  const [editNote, setEditNote] = useState<string>('');
  const [editPhotoUrl, setEditPhotoUrl] = useState<string>('');
  const [editFormError, setEditFormError] = useState<string>('');

  // Payment Form State
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer'>('cash');
  const [paymentNote, setPaymentNote] = useState<string>('');
  const [paymentError, setPaymentError] = useState<string>('');

  // Webcam Capture State
  const [showWebcamModal, setShowWebcamModal] = useState<boolean>(false);
  const [webcamTarget, setWebcamTarget] = useState<'new' | 'existing'>('new');
  const [targetDebtForPhoto, setTargetDebtForPhoto] = useState<DebtRecord | null>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Statistics Calculations
  const stats = useMemo(() => {
    let totalOriginalDebt = 0;
    let totalPaid = 0;
    let totalRemaining = 0;
    let activePendingCount = 0;
    let fullyPaidCount = 0;

    debts.forEach((d) => {
      totalOriginalDebt += d.totalAmount || 0;
      totalPaid += d.paidAmount || 0;
      totalRemaining += d.remainingAmount || 0;
      if (d.status === 'paid' || d.remainingAmount <= 0) {
        fullyPaidCount++;
      } else {
        activePendingCount++;
      }
    });

    return {
      totalOriginalDebt,
      totalPaid,
      totalRemaining,
      activePendingCount,
      fullyPaidCount,
      totalCount: debts.length,
    };
  }, [debts]);

  // Filtered & Sorted Debts List
  const filteredDebts = useMemo(() => {
    return debts
      .filter((d) => {
        // Status filter
        if (statusFilter === 'pending') {
          if (d.status === 'paid' || d.remainingAmount <= 0) return false;
        } else if (statusFilter === 'unpaid') {
          if (d.status !== 'unpaid' || d.paidAmount > 0) return false;
        } else if (statusFilter === 'partially_paid') {
          if (d.status !== 'partially_paid') return false;
        } else if (statusFilter === 'paid') {
          if (d.status !== 'paid' && d.remainingAmount > 0) return false;
        }

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchName = d.customerName.toLowerCase().includes(q);
          const matchPhone = d.customerPhone ? d.customerPhone.toLowerCase().includes(q) : false;
          const matchRoom = d.roomName ? d.roomName.toLowerCase().includes(q) : false;
          const matchBill = d.billNumber ? d.billNumber.toLowerCase().includes(q) : false;
          const matchNote = d.note ? d.note.toLowerCase().includes(q) : false;
          return matchName || matchPhone || matchRoom || matchBill || matchNote;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'remaining_desc') {
          return b.remainingAmount - a.remainingAmount;
        } else if (sortBy === 'amount_desc') {
          return b.totalAmount - a.totalAmount;
        } else if (sortBy === 'date_desc') {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        } else if (sortBy === 'date_asc') {
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
        return 0;
      });
  }, [debts, statusFilter, searchQuery, sortBy]);

  // Handle File Upload or Camera Capture from <input>
  const handleProcessImageFile = (file: File, isForExistingDebt = false) => {
    if (!file.type.startsWith('image/')) {
      alert('ກະລຸນາເລືອກໄຟລ໌ຮູບພາບເທົ່ານັ້ນ');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (isForExistingDebt && targetDebtForPhoto) {
        const updated = debts.map((d) =>
          d.id === targetDebtForPhoto.id ? { ...d, photoUrl: result } : d
        );
        onSaveDebts(updated);
        setTargetDebtForPhoto(null);
      } else {
        setNewPhotoUrl(result);
      }
    };
    reader.readAsDataURL(file);
  };

  // Start Live Webcam
  const startWebcam = async (mode: 'new' | 'existing', debtTarget?: DebtRecord) => {
    setWebcamTarget(mode);
    if (debtTarget) setTargetDebtForPhoto(debtTarget);
    setCameraError('');
    setShowWebcamModal(true);

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        setWebcamStream(stream);
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        }, 150);
      } else {
        setCameraError('Browser ບໍ່ຮອງຮັບການເປີດກ້ອງຖ່າຍຮູບ ກະລຸນາໃຊ້ອັບໂຫຼດໄຟລ໌ແທນ');
      }
    } catch (err: any) {
      console.warn('Camera access denied or error:', err);
      setCameraError('ບໍ່ສາມາດເຂົ້າເຖິງກ້ອງຖ່າຍຮູບໄດ້: ' + (err.message || 'ກະລຸນາອະນຸຍາດການໃຊ້ງານກ້ອງ'));
    }
  };

  // Stop Webcam
  const stopWebcam = () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach((track) => track.stop());
      setWebcamStream(null);
    }
    setShowWebcamModal(false);
    setTargetDebtForPhoto(null);
  };

  // Capture Photo from Webcam
  const captureWebcamSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    if (webcamTarget === 'existing' && targetDebtForPhoto) {
      const updated = debts.map((d) =>
        d.id === targetDebtForPhoto.id ? { ...d, photoUrl: dataUrl } : d
      );
      onSaveDebts(updated);
    } else {
      setNewPhotoUrl(dataUrl);
    }
    stopWebcam();
  };

  // Create New Debt Record
  const handleCreateDebt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim()) {
      setAddFormError('ກະລຸນາປ້ອນຊື່ລູກຄ້າ / ຜູ້ຕິດໜີ້');
      return;
    }
    if (!newTotalAmount || newTotalAmount <= 0) {
      setAddFormError('ກະລຸນາປ້ອນຈຳນວນເງິນຕິດໜີ້ ຫຼາຍກວ່າ 0');
      return;
    }

    const dateNow = new Date();
    const dateStr = dateNow.toISOString().slice(0, 10).replace(/-/g, '');
    const newDebt: DebtRecord = {
      id: 'debt-' + Date.now(),
      customerName: newCustomerName.trim(),
      customerPhone: newCustomerPhone.trim() || undefined,
      billNumber: newBillNumber.trim() || `689-DEBT-${dateStr}-${(debts.length + 1).toString().padStart(3, '0')}`,
      roomName: newRoomName.trim() || undefined,
      totalAmount: newTotalAmount,
      paidAmount: 0,
      remainingAmount: newTotalAmount,
      status: 'unpaid',
      createdAt: dateNow.toISOString(),
      dueDate: newDueDate || undefined,
      photoUrl: newPhotoUrl || undefined,
      note: newNote.trim() || undefined,
      staffName: currentStaff?.name || 'Admin (ເຈົ້າຂອງຮ້ານ)',
      payments: [],
    };

    const updated = [newDebt, ...debts];
    onSaveDebts(updated);

    // Reset Form
    setNewCustomerName('');
    setNewCustomerPhone('');
    setNewTotalAmount(0);
    setNewRoomName('');
    setNewBillNumber('');
    setNewDueDate('');
    setNewNote('');
    setNewPhotoUrl('');
    setAddFormError('');
    setShowAddModal(false);
  };

  // Open Payment Modal
  const handleOpenPayment = (debt: DebtRecord) => {
    setPayingDebt(debt);
    setPaymentAmount(debt.remainingAmount);
    setPaymentMethod('cash');
    setPaymentNote('');
    setPaymentError('');
  };

  // Submit Payment for a Debt
  const handleSubmitPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingDebt) return;

    if (!paymentAmount || paymentAmount <= 0) {
      setPaymentError('ກະລຸນາປ້ອນຈຳນວນເງິນທີ່ຮັບຊຳລະ');
      return;
    }

    if (paymentAmount > payingDebt.remainingAmount) {
      setPaymentError(`ຈຳນວນເງິນເກີນຍອດຄ້າງຊຳລະ (${formatCurrency(payingDebt.remainingAmount, settings.currencySymbol)})`);
      return;
    }

    const newPaymentEntry: DebtPaymentEntry = {
      id: 'pay-' + Date.now(),
      amount: paymentAmount,
      paidAt: new Date().toISOString(),
      paymentMethod,
      note: paymentNote.trim() || undefined,
      staffName: currentStaff?.name || 'Admin',
    };

    const newPaidAmount = payingDebt.paidAmount + paymentAmount;
    const newRemaining = Math.max(0, payingDebt.totalAmount - newPaidAmount);
    const newStatus = newRemaining <= 0 ? 'paid' : 'partially_paid';

    const updatedDebt: DebtRecord = {
      ...payingDebt,
      paidAmount: newPaidAmount,
      remainingAmount: newRemaining,
      status: newStatus,
      payments: [newPaymentEntry, ...(payingDebt.payments || [])],
    };

    const updatedList = debts.map((d) => (d.id === payingDebt.id ? updatedDebt : d));
    onSaveDebts(updatedList);
    setPayingDebt(null);
  };

  // Start Edit Debt Record
  const handleStartEdit = (debt: DebtRecord) => {
    if (!canEdit) {
      alert('ຂໍອະໄພ! ສິດທິໃນການແກ້ໄຂລາຍການຕິດໜີ້ຖືກກຳນົດໃຫ້ສະເພາະ Admin ເທົ່ານັ້ນ.\n(Admin ສາມາດເປີດສິດທິນີ້ໃຫ້ພະນັກງານໄດ້ໃນເມນູຕັ້ງຄ່າ)');
      return;
    }
    setEditingDebt(debt);
    setEditCustomerName(debt.customerName);
    setEditCustomerPhone(debt.customerPhone || '');
    setEditTotalAmount(debt.totalAmount);
    setEditRoomName(debt.roomName || '');
    setEditDueDate(debt.dueDate || '');
    setEditNote(debt.note || '');
    setEditPhotoUrl(debt.photoUrl || '');
    setEditFormError('');
  };

  // Save Edit Debt Record
  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDebt) return;
    if (!editCustomerName.trim()) {
      setEditFormError('ກະລຸນາປ້ອນຊື່ລູກຄ້າ / ຜູ້ຕິດໜີ້');
      return;
    }
    if (!editTotalAmount || editTotalAmount <= 0) {
      setEditFormError('ກະລຸນາປ້ອນຈຳນວນເງິນຕິດໜີ້ ຫຼາຍກວ່າ 0');
      return;
    }
    if (editTotalAmount < editingDebt.paidAmount) {
      setEditFormError(`ຍອດໜີ້ໃໝ່ບໍ່ສາມາດນ້ອຍກວ່າຍອດທີ່ລູກຄ້າຊຳລະແລ້ວ (${formatCurrency(editingDebt.paidAmount, settings.currencySymbol)})`);
      return;
    }

    const newRemaining = Math.max(0, editTotalAmount - editingDebt.paidAmount);
    const newStatus = newRemaining <= 0 ? 'paid' : editingDebt.paidAmount > 0 ? 'partially_paid' : 'unpaid';

    const updatedDebt: DebtRecord = {
      ...editingDebt,
      customerName: editCustomerName.trim(),
      customerPhone: editCustomerPhone.trim() || undefined,
      totalAmount: editTotalAmount,
      remainingAmount: newRemaining,
      status: newStatus,
      roomName: editRoomName.trim() || undefined,
      dueDate: editDueDate || undefined,
      note: editNote.trim() || undefined,
      photoUrl: editPhotoUrl || undefined,
    };

    const updatedList = debts.map((d) => (d.id === editingDebt.id ? updatedDebt : d));
    onSaveDebts(updatedList);
    setEditingDebt(null);
  };

  // Delete Debt Record
  const handleDeleteDebt = (debt: DebtRecord) => {
    if (!canDelete) {
      alert('ຂໍອະໄພ! ສິດທິໃນການລຶບລາຍການຕິດໜີ້ຖືກກຳນົດໃຫ້ສະເພາະ Admin ເທົ່ານັ້ນ.\n(Admin ສາມາດເປີດສິດທິນີ້ໃຫ້ພະນັກງານໄດ້ໃນເມນູຕັ້ງຄ່າ)');
      return;
    }
    if (confirm(`ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການລຶບລາຍການຕິດໜີ້ຂອງ "${debt.customerName}"?`)) {
      const updated = debts.filter((d) => d.id !== debt.id);
      onSaveDebts(updated);
    }
  };

  // Print Debt Slip via Bluetooth
  const handlePrintBt = async (debt: DebtRecord) => {
    setIsPrintingBt(true);
    setPrintError('');
    setPrintSuccess(false);
    try {
      await printDebtSlipAsImageViaBluetooth(debt, settings);
      setPrintSuccess(true);
      setTimeout(() => setPrintSuccess(false), 3500);
    } catch (err: any) {
      setPrintError(err.message || 'ບໍ່ສາມາດພິມໃບຕິດໜີ້ຜ່ານ Bluetooth ໄດ້');
    } finally {
      setIsPrintingBt(false);
    }
  };

  // Browser standard print
  const handleBrowserPrint = () => {
    window.print();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Hidden File / Camera Inputs for quick triggers */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleProcessImageFile(e.target.files[0], !!targetDebtForPhoto);
          }
        }}
      />
      <input
        type="file"
        ref={cameraInputRef}
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleProcessImageFile(e.target.files[0], !!targetDebtForPhoto);
          }
        }}
      />

      {/* Page Title & Action Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-rose-600 flex items-center justify-center text-white shadow-lg shadow-rose-500/20">
              <HandCoins className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <span>ສະຫຼຸບຜູ້ຄ້າງຍອດຊຳລະ / ບັນຊີຕິດໜີ້</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                  DEBT LEDGER
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                ຄຸ້ມຄອງຍອດໜີ້, ຖ່າຍຮູບລູກຄ້າ/ໃບສັນຍາ, ລວມຍອດຄ້າງຊຳລະ ແລະ ບັນທຶກການຊຳລະເງິນ
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500 via-rose-500 to-purple-600 hover:from-amber-600 hover:to-purple-700 text-white font-black text-xs shadow-lg shadow-rose-500/25 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>+ ບັນທຶກລູກຄ້າຕິດໜີ້ໃໝ່</span>
          </button>
        </div>
      </div>

      {/* STATS DASHBOARD CARDS - HIGHLIGHT TOTAL OUTSTANDING BALANCE */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* GRAND TOTAL OUTSTANDING DEBT (ຍອດຄ້າງຊຳລະຕົວຈິງ) */}
        <div className="relative overflow-hidden p-5 rounded-3xl bg-gradient-to-br from-rose-950/80 via-slate-900 to-slate-900 border-2 border-rose-500/50 shadow-2xl shadow-rose-950/50">
          <div className="absolute top-0 right-0 w-28 h-28 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-rose-300 flex items-center gap-1.5 uppercase tracking-wider">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>ລວມຍອດຄ້າງຊຳລະທັງໝົດ</span>
            </span>
            <span className="text-[10px] bg-rose-500 text-white font-black px-2 py-0.5 rounded-full uppercase">
              ຕ້ອງເກັບ
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-rose-400 font-mono tracking-tight drop-shadow-md">
            {formatCurrency(stats.totalRemaining, settings.currencySymbol)}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between border-t border-rose-900/40 pt-2 font-medium">
            <span>ລູກຄ້າທີ່ຍັງຄ້າງ:</span>
            <span className="font-bold text-rose-300 font-mono">
              {stats.activePendingCount} ຄົນ / ບັນຊີ
            </span>
          </div>
        </div>

        {/* TOTAL COLLECTED / PAID BACK */}
        <div className="p-5 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 uppercase tracking-wider">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>ຍອດຮັບຊຳລະແລ້ວ</span>
            </span>
            <span className="text-[10px] bg-emerald-950 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-800/40">
              ເກັບໄດ້
            </span>
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono tracking-tight">
            {formatCurrency(stats.totalPaid, settings.currencySymbol)}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-800 pt-2 font-medium">
            <span>ຊຳລະໝົດແລ້ວ:</span>
            <span className="font-bold text-emerald-400 font-mono">
              {stats.fullyPaidCount} ລາຍການ
            </span>
          </div>
        </div>

        {/* TOTAL ORIGINAL DEBT AMOUNT */}
        <div className="p-5 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5 uppercase tracking-wider">
              <DollarSign className="w-4 h-4 text-amber-400" />
              <span>ຍອດໜີ້ສິນລວມທັງໝົດ</span>
            </span>
            <span className="text-[10px] bg-amber-950/60 text-amber-300 font-bold px-2 py-0.5 rounded-full border border-amber-800/40">
              ຍອດເດີມ
            </span>
          </div>
          <div className="text-2xl font-black text-amber-400 font-mono tracking-tight">
            {formatCurrency(stats.totalOriginalDebt, settings.currencySymbol)}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-800 pt-2 font-medium">
            <span>ອັດຕາເກັບໄດ້:</span>
            <span className="font-bold text-amber-300 font-mono">
              {stats.totalOriginalDebt > 0
                ? Math.round((stats.totalPaid / stats.totalOriginalDebt) * 100)
                : 0}
              %
            </span>
          </div>
        </div>

        {/* TOTAL DEBTORS COUNT & SUMMARY */}
        <div className="p-5 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-purple-300 flex items-center gap-1.5 uppercase tracking-wider">
                <User className="w-4 h-4 text-purple-400" />
                <span>ລູກຄ້າຕິດໜີ້ທັງໝົດ</span>
              </span>
              <span className="text-[10px] bg-purple-950/60 text-purple-300 font-bold px-2 py-0.5 rounded-full border border-purple-800/40">
                ລວມ
              </span>
            </div>
            <div className="text-2xl font-black text-purple-300 font-mono tracking-tight">
              {stats.totalCount} <span className="text-sm font-sans font-normal text-slate-400">ລາຍການ</span>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-800 pt-2 font-medium">
            <span>ພ້ອມຮູບຫຼັກຖານ:</span>
            <span className="font-bold text-purple-300 font-mono">
              {debts.filter((d) => !!d.photoUrl).length} ຮູບ
            </span>
          </div>
        </div>
      </div>

      {/* SEARCH, FILTER TABS & SORT CONTROLS */}
      <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ຄົ້ນຫາຊື່ລູກຄ້າ, ເບີໂທ, ຫ້ອງ KTV, ເລກທີບິນ..."
              className="w-full bg-slate-800 border border-slate-700 rounded-2xl pl-10 pr-10 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all font-medium"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Sort Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 whitespace-nowrap">ຮຽງຕາມ:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500 font-medium"
            >
              <option value="remaining_desc">ຍອດຄ້າງຊຳລະ (ຫຼາຍ ຫາ ໜ້ອຍ)</option>
              <option value="amount_desc">ຍອດໜີ້ທັງໝົດ (ສູງສຸດ)</option>
              <option value="date_desc">ວັນທີຫຼ້າສຸດ</option>
              <option value="date_asc">ວັນທີເກົ່າສຸດ</option>
            </select>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none pt-1 border-t border-slate-800/80">
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
              statusFilter === 'pending'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25'
                : 'bg-slate-800/70 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>⚠️ ຍັງຄ້າງຊຳລະ ({stats.activePendingCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('unpaid')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
              statusFilter === 'unpaid'
                ? 'bg-red-600 text-white shadow-md shadow-red-600/25'
                : 'bg-slate-800/70 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <span>🔴 ຍັງບໍ່ຈ່າຍເລີຍ</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('partially_paid')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
              statusFilter === 'partially_paid'
                ? 'bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/25'
                : 'bg-slate-800/70 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <span>🟡 ຈ່າຍບາງສ່ວນ</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('paid')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
              statusFilter === 'paid'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25'
                : 'bg-slate-800/70 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>🟢 ຊຳລະຄົບແລ້ວ ({stats.fullyPaidCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-slate-200 text-slate-950 font-black shadow-md'
                : 'bg-slate-800/70 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <span>ທັງໝົດ ({stats.totalCount})</span>
          </button>
        </div>
      </div>

      {/* DEBT CARDS GRID */}
      {filteredDebts.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-500 space-y-3">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-600">
            <HandCoins className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-slate-300">ບໍ່ພົບລາຍການຜູ້ຄ້າງຍອດຊຳລະ</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {searchQuery
              ? 'ບໍ່ມີລາຍການທີ່ຕົງກັບຄຳຄົ້ນຫາຂອງທ່ານ ລອງປ່ຽນຄຳຄົ້ນຫາໃໝ່'
              : statusFilter === 'pending'
              ? 'ບໍ່ມີລູກຄ້າທີ່ຄ້າງຊຳລະໃນຕອນນີ້ ທຸກຍອດໄດ້ຮັບການຊຳລະຮຽບຮ້ອຍແລ້ວ!'
              : 'ຍັງບໍ່ມີລາຍການບັນທຶກໃນໝວດໝູ່ນີ້'}
          </p>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="mt-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-rose-400" />
            <span>+ ບັນທຶກລາຍການຕິດໜີ້ໃໝ່</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDebts.map((debt) => {
            const isFullyPaid = debt.status === 'paid' || debt.remainingAmount <= 0;
            const isPartial = debt.status === 'partially_paid' && debt.remainingAmount > 0;
            const progressPercent =
              debt.totalAmount > 0
                ? Math.min(100, Math.round((debt.paidAmount / debt.totalAmount) * 100))
                : 0;

            return (
              <div
                key={debt.id}
                className={`bg-slate-900 border rounded-3xl p-5 shadow-xl flex flex-col justify-between transition-all hover:border-slate-600 ${
                  isFullyPaid
                    ? 'border-emerald-900/40 bg-slate-900/80'
                    : isPartial
                    ? 'border-amber-700/50 hover:shadow-amber-500/5'
                    : 'border-rose-800/60 hover:shadow-rose-500/10'
                }`}
              >
                <div>
                  {/* Top Header: Customer Name & Status Badge */}
                  <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-800">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-base text-white truncate flex items-center gap-1.5">
                        <User className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="truncate">{debt.customerName}</span>
                      </h3>
                      {debt.customerPhone ? (
                        <a
                          href={`tel:${debt.customerPhone}`}
                          className="text-xs text-sky-400 hover:text-sky-300 font-mono inline-flex items-center gap-1 mt-0.5"
                          title="ກົດເພື່ອໂທອອກ"
                        >
                          <Phone className="w-3 h-3" />
                          <span>{debt.customerPhone}</span>
                        </a>
                      ) : (
                        <span className="text-[11px] text-slate-500">ບໍ່ໄດ້ລະບຸເບີໂທ</span>
                      )}
                    </div>

                    {/* Status Badge */}
                    <div className="shrink-0">
                      {isFullyPaid ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-950 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          <span>ຈ່າຍຄົບແລ້ວ</span>
                        </span>
                      ) : isPartial ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-950 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                          <span>ຈ່າຍບາງສ່ວນ</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-950 text-rose-300 border border-rose-500/40 flex items-center gap-1 animate-pulse">
                          <span>ຍັງບໍ່ຈ່າຍ</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Photo Preview & Room/Bill Reference */}
                  <div className="py-3 flex gap-3 items-center">
                    {/* Photo with Camera button / Click to View */}
                    <div className="relative shrink-0">
                      {debt.photoUrl ? (
                        <div
                          onClick={() =>
                            setInspectingPhoto({
                              url: debt.photoUrl!,
                              title: `ຮູບຫຼັກຖານ: ${debt.customerName}`,
                            })
                          }
                          className="w-16 h-16 rounded-2xl overflow-hidden border border-slate-700 bg-slate-800 cursor-pointer group relative shadow-md"
                          title="ກົດເພື່ອເບິ່ງຮູບເຕັມ"
                        >
                          <img
                            src={debt.photoUrl}
                            alt={debt.customerName}
                            className="w-full h-full object-cover transition-transform group-hover:scale-110"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Eye className="w-5 h-5 text-white" />
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => {
                            setTargetDebtForPhoto(debt);
                            startWebcam('existing', debt);
                          }}
                          className="w-16 h-16 rounded-2xl border border-dashed border-slate-700 hover:border-amber-500 bg-slate-800/60 flex flex-col items-center justify-center text-slate-400 hover:text-amber-400 cursor-pointer transition-all"
                          title="ກົດເພື່ອຖ່າຍຮູບລູກຄ້າ / ບິນຕິດໜີ້"
                        >
                          <Camera className="w-5 h-5 mb-0.5" />
                          <span className="text-[9px] font-bold">+ ຖ່າຍຮູບ</span>
                        </div>
                      )}
                    </div>

                    {/* Room, Bill, and Dates Info */}
                    <div className="min-w-0 flex-1 space-y-1 text-xs">
                      {debt.roomName && (
                        <div className="text-slate-300 font-medium truncate flex items-center gap-1">
                          <span className="text-slate-400">ຫ້ອງ:</span>
                          <span className="text-amber-400 font-bold">{debt.roomName}</span>
                        </div>
                      )}
                      {debt.billNumber && (
                        <div className="text-[11px] text-slate-400 font-mono truncate">
                          ບິນ: {debt.billNumber}
                        </div>
                      )}
                      <div className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        <span>{new Date(debt.createdAt).toLocaleDateString('lo-LA')}</span>
                        {debt.dueDate && (
                          <span className="text-amber-400 font-semibold ml-1">
                            (ກຳນົດ: {debt.dueDate})
                          </span>
                        )}
                      </div>
                      {debt.note && (
                        <p className="text-[11px] text-slate-300 bg-slate-800/60 px-2 py-1 rounded-lg line-clamp-2 border border-slate-700/50">
                          {debt.note}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Amounts Breakdown & Outstanding Balance */}
                  <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">ຍອດໜີ້ທັງໝົດ:</span>
                      <span className="font-mono text-slate-300 font-bold">
                        {formatCurrency(debt.totalAmount, settings.currencySymbol)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">ຊຳລະແລ້ວ:</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {formatCurrency(debt.paidAmount, settings.currencySymbol)}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isFullyPaid
                            ? 'bg-emerald-500'
                            : isPartial
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                        }`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>

                    {/* Outstanding Balance Highlight */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                      <span className="text-xs font-bold text-slate-200">
                        {isFullyPaid ? 'ສະຖານະ:' : 'ຍອດຄ້າງຊຳລະ:'}
                      </span>
                      <span
                        className={`font-mono text-base font-black ${
                          isFullyPaid ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isFullyPaid
                          ? 'ຈ່າຍຄົບ 0 ' + settings.currencySymbol
                          : formatCurrency(debt.remainingAmount, settings.currencySymbol)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Action Buttons Footer */}
                <div className="pt-3 border-t border-slate-800 mt-3 flex items-center justify-between gap-1.5">
                  {/* Payment Button */}
                  {!isFullyPaid ? (
                    <button
                      type="button"
                      onClick={() => handleOpenPayment(debt)}
                      className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>ຮັບຊຳລະເງິນ</span>
                    </button>
                  ) : (
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 py-1">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>ຊຳລະສຳເລັດແລ້ວ</span>
                    </span>
                  )}

                  {/* Payment History Button */}
                  {debt.payments && debt.payments.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setHistoryDebt(debt)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
                      title="ເບິ່ງປະຫວັດການຈ່າຍເງິນ"
                    >
                      <History className="w-4 h-4" />
                    </button>
                  )}

                  {/* Edit Debt Button (Admin or authorized staff) */}
                  <button
                    type="button"
                    onClick={() => handleStartEdit(debt)}
                    className={`p-2 rounded-xl transition-all cursor-pointer ${
                      canEdit
                        ? 'bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300'
                        : 'bg-slate-800/40 text-slate-600 hover:text-slate-500 cursor-not-allowed'
                    }`}
                    title={canEdit ? 'ແກ້ໄຂລາຍການຕິດໜີ້' : 'ສິດແກ້ໄຂສະເພາະ Admin (ຕັ້ງຄ່າໄດ້ໃນເມນູຕັ້ງຄ່າ)'}
                  >
                    {canEdit ? <Edit className="w-4 h-4" /> : <Lock className="w-3.5 h-3.5" />}
                  </button>

                  {/* Print Slip Button */}
                  <button
                    type="button"
                    onClick={() => {
                      setPrintingDebt(debt);
                      handlePrintBt(debt);
                    }}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 transition-all cursor-pointer"
                    title="ພິມໃບຕິດໜີ້ / ໃບຮັບເງິນ (ESC/POS)"
                  >
                    <Printer className="w-4 h-4" />
                  </button>

                  {/* Delete Button (Admin or authorized staff) */}
                  <button
                    type="button"
                    onClick={() => handleDeleteDebt(debt)}
                    className={`p-2 rounded-xl transition-all cursor-pointer ${
                      canDelete
                        ? 'bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400'
                        : 'bg-slate-800/40 text-slate-600 hover:text-slate-500 cursor-not-allowed'
                    }`}
                    title={canDelete ? 'ລຶບລາຍການຕິດໜີ້' : 'ສິດລຶບສະເພາະ Admin (ຕັ້ງຄ່າໄດ້ໃນເມນູຕັ້ງຄ່າ)'}
                  >
                    {canDelete ? <Trash2 className="w-4 h-4" /> : <Lock className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD NEW DEBT RECORD (+ ບັນທຶກລູກຄ້າຕິດໜີ້ໃໝ່)                     */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 w-full max-w-xl shadow-2xl text-white my-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <HandCoins className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-lg text-slate-100">
                    ບັນທຶກລູກຄ້າຕິດໜີ້ / ຄ້າງຊຳລະໃໝ່
                  </h3>
                  <p className="text-xs text-slate-400">
                    ປ້ອນຂໍ້ມູນລູກຄ້າ, ຍອດເງິນ, ພ້ອມຖ່າຍຮູບຫຼັກຖານ
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {addFormError && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{addFormError}</span>
              </div>
            )}

            <form onSubmit={handleCreateDebt} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Customer Name */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    ຊື່ລູກຄ້າ / ຜູ້ຕິດໜີ້ (Customer Name) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="ຕົວຢ່າງ: ທ່ານ ສົມພອນ, ນາງ ດາວັນ"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                {/* Customer Phone */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    ເບີໂທລະສັບ (Phone Number)
                  </label>
                  <input
                    type="tel"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="020-xxxx-xxxx"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                {/* Total Debt Amount */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    ຈຳນວນເງິນຕິດໜີ້ ({settings.currencySymbol}) <span className="text-rose-400">*</span>
                  </label>
                  <FormattedNumberInput
                    value={newTotalAmount || ''}
                    onChange={(num) => setNewTotalAmount(num)}
                    placeholder="0"
                    suffix={settings.currencySymbol}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-amber-400 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                {/* Room Reference */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    ຫ້ອງ KTV / ຈຸດຂາຍ (Room Reference)
                  </label>
                  <select
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  >
                    <option value="">-- ເລືອກຫ້ອງ KTV (ຫຼື ບໍ່ລະບຸ) --</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                    <option value="POS ຂາຍໜ້າຮ້ານ">POS ຂາຍໜ້າຮ້ານ (Counter)</option>
                  </select>
                </div>

                {/* Due Date */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    ວັນທີຄົບກຳນົດຊຳລະ (Due Date)
                  </label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  ໝາຍເຫດ / ລາຍການສິນຄ້າທີ່ຕິດ (Notes)
                </label>
                <textarea
                  rows={2}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="ເຊັ່ນ: ຕິດຄ່າເບຍ 2 ລັງ ແລະ ຄ່າຫ້ອງ 3 ຊົ່ວໂມງ..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              {/* PHOTO CAPTURE & UPLOAD SECTION (ກ້ອງຖ່າຍຮູບ / ອັບໂຫຼດຮູບຫຼັກຖານ) */}
              <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-amber-400" />
                    <span>ຮູບພາບຫຼັກຖານ / ຮູບລູກຄ້າ / ບິນເຊັນຕິດໜີ້</span>
                  </span>
                  {newPhotoUrl && (
                    <button
                      type="button"
                      onClick={() => setNewPhotoUrl('')}
                      className="text-[11px] text-rose-400 hover:text-rose-300 font-bold"
                    >
                      ລຶບຮູບ
                    </button>
                  )}
                </div>

                {newPhotoUrl ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={newPhotoUrl}
                      alt="Preview"
                      className="w-20 h-20 rounded-xl object-cover border border-amber-500/50 shadow"
                    />
                    <div className="space-y-1 text-xs">
                      <span className="text-emerald-400 font-bold block">✓ ຕິດຮູບຮຽບຮ້ອຍແລ້ວ</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startWebcam('new')}
                          className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-[11px] font-semibold"
                        >
                          ຖ່າຍໃໝ່
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-[11px] font-semibold"
                        >
                          ປ່ຽນໄຟລ໌
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        // If mobile supports camera capture input, or start webcam modal
                        if (/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
                          cameraInputRef.current?.click();
                        } else {
                          startWebcam('new');
                        }
                      }}
                      className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-amber-500 text-slate-300 hover:text-white flex flex-col items-center justify-center gap-1 transition-all cursor-pointer"
                    >
                      <Camera className="w-5 h-5 text-amber-400" />
                      <span className="text-xs font-bold">ຖ່າຍຮູບ (Take Photo)</span>
                      <span className="text-[10px] text-slate-400">ເປີດກ້ອງຖ່າຍສົດ</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-rose-500 text-slate-300 hover:text-white flex flex-col items-center justify-center gap-1 transition-all cursor-pointer"
                    >
                      <Upload className="w-5 h-5 text-rose-400" />
                      <span className="text-xs font-bold">ອັບໂຫຼດຮູບ (Upload)</span>
                      <span className="text-[10px] text-slate-400">ເລືອກຈາກ Gallery/File</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Form Buttons */}
              <div className="flex gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  ຍົກເລີກ
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-rose-500 to-purple-600 hover:from-amber-600 hover:to-purple-700 text-white font-black text-xs shadow-lg shadow-rose-500/25 cursor-pointer"
                >
                  ບັນທຶກຕິດໜີ້ (Save Debt)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: RECORD PAYMENT (ຮັບຊຳລະເງິນຕິດໜີ້)                                  */}
      {/* ========================================================================= */}
      {payingDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl text-white space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <CreditCard className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-100">
                    ຮັບຊຳລະເງິນຕິດໜີ້ / ຈ່າຍໜີ້
                  </h3>
                  <p className="text-xs text-slate-400">
                    ລູກຄ້າ: <strong className="text-white">{payingDebt.customerName}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPayingDebt(null)}
                className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Debt Status Banner */}
            <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">ຍອດໜີ້ທັງໝົດ:</span>
                <span className="font-mono text-slate-300">
                  {formatCurrency(payingDebt.totalAmount, settings.currencySymbol)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">ຈ່າຍແລ້ວກ່ອນໜ້າ:</span>
                <span className="font-mono text-emerald-400">
                  {formatCurrency(payingDebt.paidAmount, settings.currencySymbol)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-800 font-bold">
                <span className="text-rose-400">ຍອດຄ້າງຊຳລະປະຈຸບັນ:</span>
                <span className="font-mono text-base text-rose-400 font-black">
                  {formatCurrency(payingDebt.remainingAmount, settings.currencySymbol)}
                </span>
              </div>
            </div>

            {paymentError && (
              <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs font-semibold">
                {paymentError}
              </div>
            )}

            <form onSubmit={handleSubmitPayment} className="space-y-3.5">
              {/* Payment Amount Input */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-300">
                    ຈຳນວນເງິນທີ່ຮັບຊຳລະ ({settings.currencySymbol}):
                  </label>
                  <button
                    type="button"
                    onClick={() => setPaymentAmount(payingDebt.remainingAmount)}
                    className="text-[11px] text-amber-400 hover:text-amber-300 font-bold cursor-pointer"
                  >
                    [ ຈ່າຍຄົບທັງໝົດ ]
                  </button>
                </div>

                <FormattedNumberInput
                  value={paymentAmount || ''}
                  onChange={(num) => setPaymentAmount(num)}
                  max={payingDebt.remainingAmount}
                  placeholder="0"
                  suffix={settings.currencySymbol}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-base text-emerald-400 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Payment Method Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  ຊ່ອງທາງການຊຳລະ (Payment Method):
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cash')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      paymentMethod === 'cash'
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    💵 ເງິນສົດ (Cash)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('transfer')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      paymentMethod === 'transfer'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    📲 ໂອນເງິນ (Transfer)
                  </button>
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  ໝາຍເຫດການຊຳລະ:
                </label>
                <input
                  type="text"
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  placeholder="ເຊັ່ນ: ໂອນຜ່ານ BCEL One, ຈ່າຍເງິນສົດໜ້າຮ້ານ..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Projected Remaining */}
              <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between text-xs">
                <span className="text-slate-400">ຍອດຄົງເຫຼືອຫຼັງຊຳລະ:</span>
                <span className="font-mono font-bold text-slate-200">
                  {formatCurrency(
                    Math.max(0, payingDebt.remainingAmount - paymentAmount),
                    settings.currencySymbol
                  )}
                </span>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setPayingDebt(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  ຍົກເລີກ
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs shadow-lg shadow-emerald-600/25 cursor-pointer"
                >
                  ຢືນຢັນຮັບຊຳລະ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: WEBCAM LIVE CAMERA SNAPSHOT                                        */}
      {/* ========================================================================= */}
      {showWebcamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-5 w-full max-w-lg shadow-2xl text-white space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Camera className="w-4 h-4 text-amber-400" />
                <span>ຖ່າຍຮູບສົດດ້ວຍກ້ອງ (Live Camera Snapshot)</span>
              </h3>
              <button
                type="button"
                onClick={stopWebcam}
                className="p-1 rounded-xl hover:bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {cameraError ? (
              <div className="p-4 rounded-2xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs text-center space-y-2">
                <p>{cameraError}</p>
                <button
                  type="button"
                  onClick={() => {
                    stopWebcam();
                    fileInputRef.current?.click();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-rose-800 text-white text-xs font-bold"
                >
                  ເລືອກອັບໂຫຼດຮູບຈາກໄຟລ໌ແທນ
                </button>
              </div>
            ) : (
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-video flex items-center justify-center border border-slate-800">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={stopWebcam}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                ຍົກເລີກ
              </button>
              {!cameraError && (
                <button
                  type="button"
                  onClick={captureWebcamSnapshot}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white font-black text-xs shadow-lg shadow-rose-500/30 flex items-center gap-2 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>ກົດຖ່າຍຮູບ (Capture)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: INSPECT FULL SIZE PHOTO                                            */}
      {/* ========================================================================= */}
      {inspectingPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-4 w-full max-w-xl shadow-2xl text-white space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="font-bold text-sm text-slate-100 truncate pr-2">
                {inspectingPhoto.title}
              </h3>
              <button
                type="button"
                onClick={() => setInspectingPhoto(null)}
                className="p-1 rounded-xl hover:bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl overflow-hidden bg-black flex items-center justify-center max-h-[70vh]">
              <img
                src={inspectingPhoto.url}
                alt={inspectingPhoto.title}
                className="max-h-[70vh] w-auto object-contain"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <a
                href={inspectingPhoto.url}
                download="debt-proof.jpg"
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold"
              >
                ດາວໂຫຼດຮູບ
              </a>
              <button
                type="button"
                onClick={() => setInspectingPhoto(null)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
              >
                ປິດ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: PAYMENT HISTORY                                                    */}
      {/* ========================================================================= */}
      {historyDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl text-white space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-base text-slate-100">
                  ປະຫວັດການຊຳລະເງິນ: {historyDebt.customerName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setHistoryDebt(null)}
                className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {historyDebt.payments && historyDebt.payments.length > 0 ? (
                historyDebt.payments.map((p, idx) => (
                  <div
                    key={p.id || idx}
                    className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-emerald-400 block font-mono text-sm">
                        +{formatCurrency(p.amount, settings.currencySymbol)}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(p.paidAt).toLocaleString('lo-LA')}
                      </span>
                      {p.note && <p className="text-[10px] text-slate-300 mt-0.5">{p.note}</p>}
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] bg-slate-700 text-slate-200 px-2 py-0.5 rounded-full">
                        {p.paymentMethod === 'transfer' ? '📲 ໂອນ' : '💵 ເງິນສົດ'}
                      </span>
                      <span className="block text-[10px] text-slate-500 mt-1">
                        ຜູ້ຮັບ: {p.staffName || 'Admin'}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-slate-500 text-xs">ຍັງບໍ່ມີປະຫວັດການຊຳລະ</div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setHistoryDebt(null)}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold"
              >
                ປິດ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDIT DEBT RECORD (ແກ້ໄຂລາຍການຕິດໜີ້ - Admin/Authorized Staff)       */}
      {/* ========================================================================= */}
      {editingDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 w-full max-w-xl shadow-2xl text-white my-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
                  <Edit className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-lg text-slate-100">
                    ແກ້ໄຂຂໍ້ມູນລູກຄ້າຕິດໜີ້
                  </h3>
                  <p className="text-xs text-slate-400">
                    ແກ້ໄຂຊື່, ເບີໂທ, ຍອດໜີ້ ຫຼື ຮູບພາບຫຼັກຖານ
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingDebt(null)}
                className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {editFormError && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    ຊື່ລູກຄ້າ / ຜູ້ຕິດໜີ້ <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editCustomerName}
                    onChange={(e) => setEditCustomerName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    ເບີໂທລະສັບ (Phone Number)
                  </label>
                  <input
                    type="tel"
                    value={editCustomerPhone}
                    onChange={(e) => setEditCustomerPhone(e.target.value)}
                    placeholder="020-xxxx-xxxx"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    ຍອດໜີ້ທັງໝົດ ({settings.currencySymbol}) <span className="text-rose-400">*</span>
                  </label>
                  <FormattedNumberInput
                    value={editTotalAmount || ''}
                    onChange={(num) => setEditTotalAmount(num)}
                    suffix={settings.currencySymbol}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-amber-400 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  {editingDebt.paidAmount > 0 && (
                    <span className="text-[10px] text-emerald-400 block mt-1">
                      * ຈ່າຍມາແລ້ວ: {formatCurrency(editingDebt.paidAmount, settings.currencySymbol)} (ຍອດຄ້າງຈະຄິດໄລ່ໃໝ່ອັດຕະໂນມັດ)
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    ຫ້ອງ KTV / ຈຸດຂາຍ (Room Reference)
                  </label>
                  <select
                    value={editRoomName}
                    onChange={(e) => setEditRoomName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">-- ເລືອກຫ້ອງ KTV (ຫຼື ບໍ່ລະບຸ) --</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                    <option value="POS ຂາຍໜ້າຮ້ານ">POS ຂາຍໜ້າຮ້ານ (Counter)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    ວັນທີຄົບກຳນົດຊຳລະ (Due Date)
                  </label>
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  ໝາຍເຫດ (Notes)
                </label>
                <textarea
                  rows={2}
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {/* Photo replacement */}
              <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-amber-400" />
                    <span>ຮູບພາບຫຼັກຖານ / ບິນຕິດໜີ້</span>
                  </span>
                  {editPhotoUrl && (
                    <button
                      type="button"
                      onClick={() => setEditPhotoUrl('')}
                      className="text-[11px] text-rose-400 hover:text-rose-300 font-bold"
                    >
                      ລຶບຮູບອອກ
                    </button>
                  )}
                </div>

                {editPhotoUrl ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={editPhotoUrl}
                      alt="Edit Preview"
                      className="w-20 h-20 rounded-xl object-cover border border-amber-500/50 shadow"
                    />
                    <div className="space-y-1">
                      <span className="text-xs text-emerald-400 font-bold block">✓ ມີຮູບຫຼັກຖານແລ້ວ</span>
                      <label className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold text-slate-200 cursor-pointer">
                        <Upload className="w-3.5 h-3.5" />
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
                                setEditPhotoUrl(ev.target?.result as string);
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <label className="w-full p-3 rounded-xl border border-dashed border-slate-700 hover:border-sky-500 bg-slate-800/80 flex items-center justify-center gap-2 cursor-pointer text-xs font-bold text-slate-300 hover:text-white transition-all">
                    <Camera className="w-4 h-4 text-sky-400" />
                    <span>+ ອັບໂຫຼດ ຫຼື ຖ່າຍຮູບຫຼັກຖານໃໝ່</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            setEditPhotoUrl(ev.target?.result as string);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                )}
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingDebt(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  ຍົກເລີກ
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs shadow-lg shadow-sky-600/25 cursor-pointer"
                >
                  ບັນທຶກການແກ້ໄຂ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
