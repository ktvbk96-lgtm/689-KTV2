/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Role,
  StaffMember,
  Product,
  Room,
  RoomPackage,
  AppSettings,
  BillRecord,
  DebtRecord,
  CartItem,
} from './types';
import {
  getStoredProducts,
  saveStoredProducts,
  getStoredRooms,
  saveStoredRooms,
  getStoredPackages,
  saveStoredPackages,
  getStoredStaff,
  saveStoredStaff,
  getStoredSettings,
  saveStoredSettings,
  getStoredBills,
  saveStoredBill,
  getStoredDebts,
  saveStoredDebts,
} from './lib/storage';
import { getBluetoothStatus } from './lib/bluetoothPrinter';
import { getAccessToken, initAuth } from './lib/firebase';
import { appendBillToSheet, syncInventoryToSheet } from './lib/googleSheets';
import { fetchLatestDataFromGas, sendDataToGas, GasFullDataPayload } from './lib/gasSyncService';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

import { Navbar } from './components/Navbar';
import { PinAuthModal } from './components/PinAuthModal';
import { PosSales } from './components/PosSales';
import { RoomManagement } from './components/RoomManagement';
import { InventoryManagement } from './components/InventoryManagement';
import { DebtManagement } from './components/DebtManagement';
import { SalesSummary } from './components/SalesSummary';
import { SettingsModal } from './components/SettingsModal';
import { BillingModal } from './components/BillingModal';
import { GoogleSheetsSyncModal } from './components/GoogleSheetsSyncModal';
import { BluetoothModal } from './components/BluetoothModal';
import { getThemeConfig } from './lib/theme';

export default function App() {
  // Authentication & Role
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentRole, setCurrentRole] = useState<Role>('staff');
  const [currentStaff, setCurrentStaff] = useState<StaffMember | undefined>(undefined);

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState<'pos' | 'rooms' | 'stock' | 'debts' | 'reports' | 'settings'>('pos');

  // Application Data States
  const [products, setProducts] = useState<Product[]>(getStoredProducts());
  const [rooms, setRooms] = useState<Room[]>(getStoredRooms());
  const [packages, setPackages] = useState<RoomPackage[]>(getStoredPackages());
  const [staffList, setStaffList] = useState<StaffMember[]>(getStoredStaff());
  const [settings, setSettings] = useState<AppSettings>(getStoredSettings());
  const [bills, setBills] = useState<BillRecord[]>(getStoredBills());
  const [debts, setDebts] = useState<DebtRecord[]>(getStoredDebts());

  // Modals
  const [activeBillingRecord, setActiveBillingRecord] = useState<BillRecord | null>(null);
  const [showSheetsModal, setShowSheetsModal] = useState<boolean>(false);
  const [showBluetoothModal, setShowBluetoothModal] = useState<boolean>(false);
  const [bluetoothConnected, setBluetoothConnected] = useState<boolean>(false);
  const [isSyncingAllSheets, setIsSyncingAllSheets] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('');

  // Google Apps Script Real-time Sync & Multi-Device States
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'syncing'>('idle');
  const [syncMessage, setSyncMessage] = useState<string>('');

  // Function to dispatch real-time sync in background to Google Sheets Web App
  const triggerGasSync = (
    action: 'saveProducts' | 'saveRooms' | 'savePackages' | 'saveStaff' | 'saveDebts' | 'saveBill' | 'syncAll',
    payload: any
  ) => {
    if (!settings.gasWebAppUrl || settings.realtimeSyncEnabled === false) return;

    setSyncStatus('syncing');
    setSyncMessage('ກຳລັງຊິ້ງຂໍ້ມູນລົງ Google Sheets...');

    sendDataToGas(settings.gasWebAppUrl, action, payload).then((res) => {
      if (res.success) {
        setSyncStatus('success');
        setSyncMessage('ຊິ້ງຂໍ້ມູນລົງ Google Sheets ສຳເລັດແລ້ວ');
        const nowStr = new Date().toISOString();
        const updatedSettings = { ...settings, lastSyncedAt: nowStr };
        setSettings(updatedSettings);
        saveStoredSettings(updatedSettings);
        setTimeout(() => setSyncStatus('idle'), 2500);
      } else {
        setSyncStatus('error');
        setSyncMessage(res.error || 'ຊິ້ງຂໍ້ມູນບໍ່ສຳເລັດ');
        setTimeout(() => setSyncStatus('idle'), 4000);
      }
    });
  };

  // Function to fetch latest data from Google Sheets (Multi-device auto loading with timeout)
  const fetchFromGas = async (isManual = false) => {
    if (!settings.gasWebAppUrl) return;

    setSyncStatus('loading');
    setSyncMessage(isManual ? 'ກຳລັງດຶງຂໍ້ມູນລ່າສຸດ...' : 'ກວດສອບ ແລະ ດຶງຂໍ້ມູນລ່າສຸດຈາກ Google Sheets...');

    try {
      // 7.5s AbortController timeout prevents freezing or infinite spinning
      const res = await fetchLatestDataFromGas(settings.gasWebAppUrl, 7500);
      if (res.success && res.data) {
        if (res.data.products && Array.isArray(res.data.products) && res.data.products.length > 0) {
          setProducts(res.data.products);
          saveStoredProducts(res.data.products);
        }
        if (res.data.rooms && Array.isArray(res.data.rooms) && res.data.rooms.length > 0) {
          setRooms(res.data.rooms);
          saveStoredRooms(res.data.rooms);
        }
        if (res.data.packages && Array.isArray(res.data.packages) && res.data.packages.length > 0) {
          setPackages(res.data.packages);
          saveStoredPackages(res.data.packages);
        }
        if (res.data.staff && Array.isArray(res.data.staff) && res.data.staff.length > 0) {
          setStaffList(res.data.staff);
          saveStoredStaff(res.data.staff);
        }
        if (res.data.debts && Array.isArray(res.data.debts) && res.data.debts.length > 0) {
          setDebts(res.data.debts);
          saveStoredDebts(res.data.debts);
        }

        const nowStr = new Date().toISOString();
        const updatedSettings = { ...settings, lastSyncedAt: nowStr };
        setSettings(updatedSettings);
        saveStoredSettings(updatedSettings);

        setSyncStatus('success');
        setSyncMessage('ດຶງຂໍ້ມູນລ່າສຸດຈາກ Sheets ສຳເລັດແລ້ວ (ອອນໄລນ໌)');
        setTimeout(() => setSyncStatus('idle'), 2500);
      } else {
        // Fast graceful fallback without hanging
        setSyncStatus('error');
        setSyncMessage(res.error || 'ບໍ່ສາມາດເຊື່ອມຕໍ່ Sheets ໄດ້ (ກຳລັງໃຊ້ຂໍ້ມູນໃນເຄື່ອງ)');
        setTimeout(() => setSyncStatus('idle'), 4000);
      }
    } catch {
      setSyncStatus('error');
      setSyncMessage('ຂໍ້ຜິດພາດການດຶງຂໍ້ມູນ (ກຳລັງໃຊ້ຂໍ້ມູນໃນເຄື່ອງ)');
      setTimeout(() => setSyncStatus('idle'), 4000);
    }
  };

  // Run on startup when gasWebAppUrl is configured + check on window focus
  useEffect(() => {
    if (settings.gasWebAppUrl) {
      fetchFromGas();
    }

    const handleFocus = () => {
      if (settings.gasWebAppUrl && settings.realtimeSyncEnabled !== false) {
        fetchFromGas();
      }
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [settings.gasWebAppUrl]);

  // Check Bluetooth and Storage Events
  useEffect(() => {
    const checkBt = () => {
      const status = getBluetoothStatus();
      setBluetoothConnected(status.connected);
    };
    checkBt();
    const btInterval = setInterval(checkBt, 4000);

    const handleStorageUpdate = () => {
      setProducts(getStoredProducts());
      setRooms(getStoredRooms());
      setBills(getStoredBills());
      setDebts(getStoredDebts());
    };

    window.addEventListener('689ktv_products_updated', handleStorageUpdate);
    window.addEventListener('689ktv_rooms_updated', handleStorageUpdate);
    window.addEventListener('689ktv_bills_updated', handleStorageUpdate);
    window.addEventListener('689ktv_debts_updated', handleStorageUpdate);

    return () => {
      clearInterval(btInterval);
      window.removeEventListener('689ktv_products_updated', handleStorageUpdate);
      window.removeEventListener('689ktv_rooms_updated', handleStorageUpdate);
      window.removeEventListener('689ktv_bills_updated', handleStorageUpdate);
      window.removeEventListener('689ktv_debts_updated', handleStorageUpdate);
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  // Helper: Deduct stock from products
  const deductProductsStock = (itemsToDeduct: { productId: string; quantity: number }[]) => {
    const updated = products.map((prod) => {
      const match = itemsToDeduct.find((i) => i.productId === prod.id);
      if (match && prod.category !== 'service') {
        return {
          ...prod,
          stock: Math.max(0, prod.stock - match.quantity),
        };
      }
      return prod;
    });
    setProducts(updated);
    saveStoredProducts(updated);
    triggerGasSync('saveProducts', { products: updated });
    return updated;
  };

  // Handle PIN Login Success
  const handlePinSuccess = (role: Role, staffMember?: StaffMember) => {
    setIsAuthenticated(true);
    setCurrentRole(role);
    setCurrentStaff(staffMember);
    showToast(`ຍິນດີຕ້ອນຮັບ ${staffMember?.name || (role === 'admin' ? 'Admin' : 'ພະນັກງານ')} ເຂົ້າສູ່ 689 KTV!`);
  };

  // Checkout POS Sale directly
  const handleCheckoutPosSale = (
    cart: CartItem[],
    discount: number,
    paymentMethod: 'cash' | 'transfer',
    cashReceived?: number
  ) => {
    const subtotal = cart.reduce(
      (sum, item) =>
        sum + (item.customPrice !== undefined ? item.customPrice : item.product.salePrice) * item.quantity,
      0
    );
    const total = Math.max(0, subtotal - discount);
    const dateNow = new Date();
    const dateStr = dateNow.toISOString().slice(0, 10).replace(/-/g, '');
    const billNumber = `689-${dateStr}-${(bills.length + 1).toString().padStart(3, '0')}`;

    // Deduct stock
    deductProductsStock(
      cart.map((c) => ({ productId: c.product.id, quantity: c.quantity }))
    );

    const newBill: BillRecord = {
      id: 'bill-' + Date.now(),
      billNumber,
      type: 'pos_sale',
      endTime: dateNow.toISOString(),
      roomCharge: 0,
      items: cart.map((c) => {
        const unitPrice = c.customPrice !== undefined ? c.customPrice : c.product.salePrice;
        return {
          productId: c.product.id,
          productName: c.product.name,
          unit: c.product.unit,
          quantity: c.quantity,
          price: unitPrice,
          total: unitPrice * c.quantity,
          sellerId: c.sellerId,
          sellerName: c.sellerName,
          costPrice: c.product.costPrice,
        };
      }),
      subtotal,
      discount,
      tax: 0,
      total,
      payment: {
        method: paymentMethod,
        cashReceived,
        change: paymentMethod === 'cash' && cashReceived && cashReceived > total ? cashReceived - total : 0,
      },
      staffName: currentStaff?.name || (currentRole === 'admin' ? 'Admin' : 'ພະນັກງານ'),
    };

    setActiveBillingRecord(newBill);
  };

  // Transfer Cart items to a KTV Room
  const handleTransferToRoom = (roomId: string, cart: CartItem[]) => {
    const targetRoom = rooms.find((r) => r.id === roomId);
    if (!targetRoom) return;

    // Deduct stock immediately
    deductProductsStock(
      cart.map((c) => ({ productId: c.product.id, quantity: c.quantity }))
    );

    const newOrders = cart.map((c) => {
      const unitPrice = c.customPrice !== undefined ? c.customPrice : c.product.salePrice;
      return {
        id: 'ord-' + Date.now() + Math.random().toString(36).substr(2, 4),
        product: c.product,
        quantity: c.quantity,
        price: unitPrice,
        orderedAt: new Date().toISOString(),
        sellerId: c.sellerId,
        sellerName: c.sellerName,
        customPrice: c.customPrice,
      };
    });

    const updatedRooms = rooms.map((r) => {
      if (r.id === roomId) {
        return {
          ...r,
          orders: [...r.orders, ...newOrders],
        };
      }
      return r;
    });

    setRooms(updatedRooms);
    saveStoredRooms(updatedRooms);
    triggerGasSync('saveRooms', { rooms: updatedRooms });
    showToast(`ໂອນ ${cart.length} ລາຍການ ເຂົ້າ ${targetRoom.name} ສຳເລັດແລ້ວ!`);
  };

  // Checkout KTV Room
  const handleCheckoutRoom = (
    room: Room,
    roomCharge: number,
    durationMinutes: number,
    startStr?: string,
    endStr?: string,
    timeRangeStr?: string
  ) => {
    const itemsTotal = room.orders.reduce((sum, o) => sum + o.price * o.quantity, 0);
    const subtotal = roomCharge + itemsTotal;
    const dateNow = new Date();
    const dateStr = dateNow.toISOString().slice(0, 10).replace(/-/g, '');
    const billNumber = `689-${dateStr}-${(bills.length + 1).toString().padStart(3, '0')}`;

    const formattedStart =
      startStr ||
      (room.openedAt
        ? new Date(room.openedAt).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '');
    const formattedEnd =
      endStr ||
      dateNow.toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false });
    const formattedTarget = room.targetEndTime
      ? new Date(room.targetEndTime).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false })
      : '';

    const timeRangeFormatted =
      timeRangeStr ||
      (formattedStart
        ? `${formattedStart} ຫາ ${formattedEnd} (ກຳນົດ: ${formattedStart} ຫາ ${formattedTarget || formattedEnd})`
        : undefined);

    const newBill: BillRecord = {
      id: 'bill-' + Date.now(),
      billNumber,
      type: 'ktv_room',
      roomName: room.name,
      packageName: room.packageName,
      bookedHours: room.bookedHours,
      startTime: room.openedAt,
      endTime: dateNow.toISOString(),
      targetEndTime: room.targetEndTime,
      timeRangeFormatted,
      durationMinutes,
      pricingType: room.pricingType,
      roomCharge,
      items: room.orders.map((o) => ({
        productId: o.product.id,
        productName: o.product.name,
        unit: o.product.unit,
        quantity: o.quantity,
        price: o.price,
        total: o.price * o.quantity,
        sellerId: o.sellerId,
        sellerName: o.sellerName,
        costPrice: o.product.costPrice,
      })),
      subtotal,
      discount: 0,
      tax: 0,
      total: subtotal,
      payment: {
        method: 'cash',
        cashReceived: subtotal,
        change: 0,
      },
      staffName: currentStaff?.name || (currentRole === 'admin' ? 'Admin' : 'ພະນັກງານ'),
    };

    // Reset room status to available
    const updatedRooms = rooms.map((r) => {
      if (r.id === room.id) {
        return {
          ...r,
          status: 'available' as const,
          openedAt: undefined,
          openedByStaffId: undefined,
          openedByStaffName: undefined,
          packageId: undefined,
          packageName: undefined,
          orders: [],
        };
      }
      return r;
    });

    setRooms(updatedRooms);
    saveStoredRooms(updatedRooms);
    triggerGasSync('saveRooms', { rooms: updatedRooms });

    setActiveBillingRecord(newBill);
  };

  // Finalize payment from billing modal
  const handleConfirmBillingPayment = (completedBill: BillRecord) => {
    saveStoredBill(completedBill);
    const updatedBills = getStoredBills();
    setBills(updatedBills);
    triggerGasSync('saveBill', { bill: completedBill });

    // If checked out as debt, auto-create Debt Record
    if (completedBill.payment?.method === 'debt') {
      const debtInfo = completedBill.payment.debtInfo;
      const newDebt: DebtRecord = {
        id: 'debt-' + Date.now(),
        customerName: debtInfo?.customerName || 'ລູກຄ້າຕິດໜີ້',
        customerPhone: debtInfo?.customerPhone,
        billId: completedBill.id,
        billNumber: completedBill.billNumber,
        roomName: completedBill.roomName,
        totalAmount: completedBill.total,
        paidAmount: 0,
        remainingAmount: completedBill.total,
        status: 'unpaid',
        createdAt: completedBill.endTime,
        dueDate: debtInfo?.dueDate,
        photoUrl: debtInfo?.photoUrl,
        note: debtInfo?.note || 'ຕິດໜີ້ຈາກໃບບິນ ' + completedBill.billNumber,
        staffName: completedBill.staffName,
        payments: [],
      };
      const updatedDebts = [newDebt, ...debts];
      setDebts(updatedDebts);
      saveStoredDebts(updatedDebts);
      triggerGasSync('saveDebts', { debts: updatedDebts });
    }

    setActiveBillingRecord(null);
    showToast(`ເຊັກບິນ ${completedBill.billNumber} ສຳເລັດແລ້ວ!`);
  };

  // Sync bill to Google Sheets
  const handleSyncBillToGoogleSheet = async (billToSync: BillRecord): Promise<boolean> => {
    if (!settings.googleSheetId) return false;
    const token = await getAccessToken();
    if (!token) return false;

    return await appendBillToSheet(token, settings.googleSheetId, billToSync);
  };

  // Bulk sync all bills & inventory to Google Sheets
  const handleBulkSyncAllToSheets = async () => {
    if (!settings.googleSheetId) {
      setShowSheetsModal(true);
      return;
    }
    const token = await getAccessToken();
    if (!token) {
      setShowSheetsModal(true);
      return;
    }

    setIsSyncingAllSheets(true);
    try {
      await syncInventoryToSheet(token, settings.googleSheetId, products);
      for (const bill of bills) {
        await appendBillToSheet(token, settings.googleSheetId, bill);
      }
      showToast('ຊິ້ງຂໍ້ມູນທັງໝົດລົງ Google Sheets ສຳເລັດແລ້ວ!');
    } catch (err: any) {
      alert('ຊິ້ງລົງ Google Sheets ບໍ່ສຳເລັດ: ' + err.message);
    } finally {
      setIsSyncingAllSheets(false);
    }
  };

  const themeConfig = getThemeConfig(settings.appTheme);

  return (
    <div
      className={`min-h-screen ${themeConfig.bgClass} flex flex-col font-sans selection:bg-rose-500 selection:text-white transition-colors duration-300`}
    >
      {/* 4-Digit PIN Lock Screen Modal (Right after opening or when locked) */}
      {!isAuthenticated && (
        <PinAuthModal
          settings={settings}
          staffList={staffList}
          onSuccess={handlePinSuccess}
        />
      )}

      {/* Main Top Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentRole={currentRole}
        currentUser={currentStaff}
        onLockScreen={() => setIsAuthenticated(false)}
        onOpenSheetsModal={() => setShowSheetsModal(true)}
        onOpenBluetoothModal={() => setShowBluetoothModal(true)}
        onSelectTheme={(themeId) => {
          const updated = { ...settings, appTheme: themeId };
          setSettings(updated);
          saveStoredSettings(updated);
          showToast(`ປ່ຽນໂທນສີເປັນ "${getThemeConfig(themeId).nameLao}" ສຳເລັດ!`);
        }}
        bluetoothConnected={bluetoothConnected}
        sheetsConfigured={!!settings.googleSheetId}
        settings={settings}
        pendingDebtsCount={debts.filter((d) => d.status !== 'paid' && d.remainingAmount > 0).length}
      />

      {/* Real-time Google Sheets Sync Status Bar */}
      {settings.gasWebAppUrl && (
        <div className="bg-slate-900/95 border-b border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs backdrop-blur-md shadow-sm">
          <div className="flex items-center gap-2">
            {syncStatus === 'loading' || syncStatus === 'syncing' ? (
              <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
            ) : syncStatus === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
            <span
              className={
                syncStatus === 'error'
                  ? 'text-rose-300 font-semibold'
                  : syncStatus === 'loading' || syncStatus === 'syncing'
                  ? 'text-amber-300 font-semibold'
                  : 'text-slate-300'
              }
            >
              {syncMessage ||
                (settings.lastSyncedAt
                  ? `Google Sheets Real-time: ຊິ້ງຄັ້ງລ່າສຸດ ${new Date(settings.lastSyncedAt).toLocaleTimeString('lo-LA')}`
                  : 'Google Sheets Real-time: ພ້ອມໃຊ້ງານ (ອອນໄລນ໌)')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {syncStatus === 'error' && (
              <button
                onClick={() => fetchFromGas(true)}
                className="px-2.5 py-1 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold border border-rose-500/40 transition-colors cursor-pointer"
              >
                ລອງໃໝ່ (Retry)
              </button>
            )}
            <button
              onClick={() => fetchFromGas(true)}
              disabled={syncStatus === 'loading' || syncStatus === 'syncing'}
              title="ດຶງຂໍ້ມູນລ່າສຸດຈາກ Google Sheets"
              className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncStatus === 'loading' || syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
              <span>ດຶງຂໍ້ມູນລ່າສຸດ</span>
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-gradient-to-r from-rose-600 to-amber-600 text-white px-4 py-2.5 rounded-2xl shadow-2xl border border-white/20 text-xs font-bold animate-bounce flex items-center gap-2">
          <span>✨</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Workspace Body */}
      <main className="flex-1 pb-16">
        {activeTab === 'pos' && (
          <PosSales
            products={products}
            staffList={staffList}
            activeRooms={rooms}
            settings={settings}
            currentStaff={currentStaff}
            onCheckoutPosSale={handleCheckoutPosSale}
            onTransferToRoom={handleTransferToRoom}
          />
        )}

        {activeTab === 'rooms' && (
          <RoomManagement
            rooms={rooms}
            packages={packages}
            products={products}
            staffList={staffList}
            settings={settings}
            currentStaff={currentStaff}
            onUpdateRooms={(updated) => {
              setRooms(updated);
              saveStoredRooms(updated);
              triggerGasSync('saveRooms', { rooms: updated });
            }}
            onCheckoutRoom={handleCheckoutRoom}
          />
        )}

        {activeTab === 'stock' && (
          <InventoryManagement
            products={products}
            currentRole={currentRole}
            settings={settings}
            onSaveProducts={(updated) => {
              setProducts(updated);
              saveStoredProducts(updated);
              triggerGasSync('saveProducts', { products: updated });
            }}
          />
        )}

        {activeTab === 'debts' && (
          <DebtManagement
            debts={debts}
            rooms={rooms}
            staffList={staffList}
            settings={settings}
            currentRole={currentRole}
            currentStaff={currentStaff}
            onSaveDebts={(updated) => {
              setDebts(updated);
              saveStoredDebts(updated);
              triggerGasSync('saveDebts', { debts: updated });
              showToast('ອັບເດດຂໍ້ມູນຍອດຄ້າງຊຳລະສຳເລັດແລ້ວ!');
            }}
            onOpenBluetoothModal={() => setShowBluetoothModal(true)}
          />
        )}

        {activeTab === 'reports' && (
          <SalesSummary
            bills={bills}
            products={products}
            settings={settings}
            onSyncAllToSheets={handleBulkSyncAllToSheets}
            isSyncingSheets={isSyncingAllSheets}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsModal
            settings={settings}
            staffList={staffList}
            packages={packages}
            rooms={rooms}
            products={products}
            onSaveSettings={(newSettings) => {
              setSettings(newSettings);
              saveStoredSettings(newSettings);
              showToast('ບັນທຶກການຕັ້ງຄ່າຮ້ານສຳເລັດແລ້ວ!');
            }}
            onSaveStaff={(newStaff) => {
              setStaffList(newStaff);
              saveStoredStaff(newStaff);
              triggerGasSync('saveStaff', { staff: newStaff });
            }}
            onSavePackages={(newPkgs) => {
              setPackages(newPkgs);
              saveStoredPackages(newPkgs);
              triggerGasSync('savePackages', { packages: newPkgs });
            }}
            onSaveRooms={(newRooms) => {
              setRooms(newRooms);
              saveStoredRooms(newRooms);
              triggerGasSync('saveRooms', { rooms: newRooms });
              showToast('ບັນທຶກຂໍ້ມູນຫ້ອງ KTV ສຳເລັດແລ້ວ!');
            }}
            onSaveProducts={(newProducts) => {
              setProducts(newProducts);
              saveStoredProducts(newProducts);
              triggerGasSync('saveProducts', { products: newProducts });
            }}
            bluetoothConnected={bluetoothConnected}
            onRefreshBluetoothStatus={() => {
              const status = getBluetoothStatus();
              setBluetoothConnected(status.connected);
            }}
          />
        )}
      </main>

      {/* Billing & Thermal Receipt Modal */}
      {activeBillingRecord && (
        <BillingModal
          bill={activeBillingRecord}
          settings={settings}
          onClose={() => setActiveBillingRecord(null)}
          onConfirmPayment={handleConfirmBillingPayment}
          bluetoothConnected={bluetoothConnected}
          onOpenBluetoothSetup={() => setShowBluetoothModal(true)}
          onSyncGoogleSheet={handleSyncBillToGoogleSheet}
          onUpdateSettings={(newSettings) => {
            setSettings(newSettings);
            saveStoredSettings(newSettings);
          }}
        />

      )}

      {/* Google Sheets Sync Modal */}
      {showSheetsModal && (
        <GoogleSheetsSyncModal
          settings={settings}
          bills={bills}
          products={products}
          rooms={rooms}
          packages={packages}
          staffList={staffList}
          debts={debts}
          onClose={() => setShowSheetsModal(false)}
          onUpdateSettings={(newSettings) => {
            setSettings(newSettings);
            saveStoredSettings(newSettings);
          }}
          onApplyRemoteData={(data) => {
            if (data.products && Array.isArray(data.products) && data.products.length > 0) {
              setProducts(data.products);
              saveStoredProducts(data.products);
            }
            if (data.rooms && Array.isArray(data.rooms) && data.rooms.length > 0) {
              setRooms(data.rooms);
              saveStoredRooms(data.rooms);
            }
            if (data.packages && Array.isArray(data.packages) && data.packages.length > 0) {
              setPackages(data.packages);
              saveStoredPackages(data.packages);
            }
            if (data.staff && Array.isArray(data.staff) && data.staff.length > 0) {
              setStaffList(data.staff);
              saveStoredStaff(data.staff);
            }
            if (data.debts && Array.isArray(data.debts) && data.debts.length > 0) {
              setDebts(data.debts);
              saveStoredDebts(data.debts);
            }
            showToast('ອັບເດດຂໍ້ມູນຈາກ Google Sheets ເຂົ້າສູ່ລະບົບຮຽບຮ້ອຍແລ້ວ!');
          }}
        />
      )}

      {/* Bluetooth Setup Modal */}
      {showBluetoothModal && (
        <BluetoothModal
          settings={settings}
          bluetoothConnected={bluetoothConnected}
          onClose={() => setShowBluetoothModal(false)}
          onRefreshStatus={() => {
            const status = getBluetoothStatus();
            setBluetoothConnected(status.connected);
          }}
          onUpdateSettings={(newSettings) => {
            setSettings(newSettings);
            saveStoredSettings(newSettings);
          }}
        />
      )}

    </div>
  );
}
