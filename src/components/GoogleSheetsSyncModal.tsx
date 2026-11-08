/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  LogOut,
  X,
  FileCheck,
  Plus,
  Shield,
  Layers,
  Zap,
  Copy,
  Check,
  Code,
  Database,
  Cloud,
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  Download,
} from 'lucide-react';
import { exportStandaloneHtmlFile } from '../lib/exportSingleFile';
import { BillRecord, Product, Room, RoomPackage, StaffMember, DebtRecord, AppSettings } from '../types';
import {
  googleSignIn,
  logoutGoogle,
  initAuth,
} from '../lib/firebase';
import {
  listExistingSpreadsheets,
  createKtvSpreadsheet,
  syncInventoryToSheet,
  appendBillToSheet,
  SpreadsheetInfo,
} from '../lib/googleSheets';
import {
  fetchLatestDataFromGas,
  sendDataToGas,
  GOOGLE_APPS_SCRIPT_TEMPLATE,
  GasFullDataPayload,
} from '../lib/gasSyncService';
import { DEFAULT_GAS_WEBAPP_URL } from '../lib/initialData';

interface GoogleSheetsSyncModalProps {
  settings: AppSettings;
  bills: BillRecord[];
  products: Product[];
  rooms?: Room[];
  packages?: RoomPackage[];
  staffList?: StaffMember[];
  debts?: DebtRecord[];
  onClose: () => void;
  onUpdateSettings: (settings: AppSettings) => void;
  onApplyRemoteData?: (data: GasFullDataPayload) => void;
}

export const GoogleSheetsSyncModal: React.FC<GoogleSheetsSyncModalProps> = ({
  settings,
  bills,
  products,
  rooms = [],
  packages = [],
  staffList = [],
  debts = [],
  onClose,
  onUpdateSettings,
  onApplyRemoteData,
}) => {
  // Active Tab: 'gas' (Google Apps Script Web App - Recommended for multi-device) or 'oauth'
  const [activeTab, setActiveTab] = useState<'gas' | 'oauth'>('gas');

  // GAS State
  const [gasUrlInput, setGasUrlInput] = useState<string>(settings.gasWebAppUrl || '');
  const [isAutoSyncEnabled, setIsAutoSyncEnabled] = useState<boolean>(settings.realtimeSyncEnabled !== false);
  const [isPullingGas, setIsPullingGas] = useState<boolean>(false);
  const [isPushingGas, setIsPushingGas] = useState<boolean>(false);
  const [gasStatusMsg, setGasStatusMsg] = useState<string>('');
  const [gasErrorMsg, setGasErrorMsg] = useState<string>('');
  const [gasSuccessMsg, setGasSuccessMsg] = useState<string>('');
  const [copiedScript, setCopiedScript] = useState<boolean>(false);
  const [showScriptModal, setShowScriptModal] = useState<boolean>(false);

  // OAuth State (Existing secondary flow)
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [spreadsheets, setSpreadsheets] = useState<SpreadsheetInfo[]>([]);
  const [isLoadingSheets, setIsLoadingSheets] = useState<boolean>(false);
  const [isCreatingSheet, setIsCreatingSheet] = useState<boolean>(false);
  const [isOAuthSyncing, setIsOAuthSyncing] = useState<boolean>(false);
  const [oauthStatusMsg, setOauthStatusMsg] = useState<string>('');
  const [oauthErrorMsg, setOauthErrorMsg] = useState<string>('');

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, cachedToken) => {
        setCurrentUser(user);
        setToken(cachedToken);
        loadSpreadsheets(cachedToken);
      },
      () => {
        setCurrentUser(null);
        setToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  const loadSpreadsheets = async (tok: string) => {
    setIsLoadingSheets(true);
    setOauthErrorMsg('');
    try {
      const list = await listExistingSpreadsheets(tok);
      setSpreadsheets(list);
    } catch (err: any) {
      setOauthErrorMsg('ບໍ່ສາມາດໂຫຼດລາຍການ Spreadsheets ໄດ້: ' + (err.message || ''));
    } finally {
      setIsLoadingSheets(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setOauthErrorMsg('');
    try {
      const res = await googleSignIn();
      if (res) {
        setCurrentUser(res.user);
        setToken(res.accessToken);
        await loadSpreadsheets(res.accessToken);
      }
    } catch (err: any) {
      setOauthErrorMsg('ການເຂົ້າສູ່ລະບົບ Google ລົ້ມເຫຼວ: ' + (err.message || ''));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logoutGoogle();
    setCurrentUser(null);
    setToken(null);
    setSpreadsheets([]);
  };

  const handleCreateNewSheet = async () => {
    if (!token) return;
    setIsCreatingSheet(true);
    setOauthErrorMsg('');
    try {
      const sheet = await createKtvSpreadsheet(token, `689 KTV - ບັນທຶກຍອດຂາຍ ແລະ ສະຕັອກ (${new Date().getFullYear()})`);
      setSpreadsheets((prev) => [sheet, ...prev]);

      onUpdateSettings({
        ...settings,
        googleSheetId: sheet.id,
        googleSheetName: sheet.name,
      });

      await syncInventoryToSheet(token, sheet.id, products);
      setOauthStatusMsg('ສ້າງ Google Sheet ສຳເລັດ ແລະ ບັນທຶກຫົວຕາຕະລາງພ້ອມສະຕັອກແລ້ວ!');
    } catch (err: any) {
      setOauthErrorMsg('ສ້າງ Google Sheet ລົ້ມເຫຼວ: ' + err.message);
    } finally {
      setIsCreatingSheet(false);
    }
  };

  const handleSelectSheet = (sheet: SpreadsheetInfo) => {
    onUpdateSettings({
      ...settings,
      googleSheetId: sheet.id,
      googleSheetName: sheet.name,
    });
    setOauthStatusMsg(`ເລືອກ Google Sheet: ${sheet.name}`);
  };

  const handleSyncOAuthAllData = async () => {
    if (!token || !settings.googleSheetId) {
      alert('ກະລຸນາເລືອກ ຫຼື ສ້າງ Google Sheet ກ່ອນ!');
      return;
    }

    setIsOAuthSyncing(true);
    setOauthErrorMsg('');
    setOauthStatusMsg('ກຳລັງຊິ້ງຂໍ້ມູນຍອດຂາຍ ແລະ ສະຕັອກ...');

    try {
      await syncInventoryToSheet(token, settings.googleSheetId, products);
      for (const bill of bills) {
        await appendBillToSheet(token, settings.googleSheetId, bill);
      }
      setOauthStatusMsg('ຊິ້ງຂໍ້ມູນທັງໝົດລົງ Google Sheet ສຳເລັດແລ້ວ!');
    } catch (err: any) {
      setOauthErrorMsg('ຊິ້ງຂໍ້ມູນລົ້ມເຫຼວ: ' + err.message);
    } finally {
      setIsOAuthSyncing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // GAS REAL-TIME WEB APP HANDLERS
  // ---------------------------------------------------------------------------

  const handleSaveGasSettings = () => {
    const cleanUrl = gasUrlInput.trim();
    const updated: AppSettings = {
      ...settings,
      gasWebAppUrl: cleanUrl,
      realtimeSyncEnabled: isAutoSyncEnabled,
    };
    onUpdateSettings(updated);
    setGasSuccessMsg('ບັນທຶກການຕັ້ງຄ່າ Web App URL ສຳເລັດແລ້ວ!');
    setTimeout(() => setGasSuccessMsg(''), 3000);
  };

  // Pull latest data from Sheets (Multi-device loading)
  const handlePullFromGas = async () => {
    const cleanUrl = gasUrlInput.trim();
    if (!cleanUrl) {
      setGasErrorMsg('ກະລຸນາໃສ່ Web App URL ກ່ອນ!');
      return;
    }

    setIsPullingGas(true);
    setGasErrorMsg('');
    setGasSuccessMsg('');
    setGasStatusMsg('ກຳລັງດຶງຂໍ້ມູນລ່າສຸດຈາກ Google Sheets...');

    try {
      const res = await fetchLatestDataFromGas(cleanUrl, 8000);
      if (res.success && res.data) {
        if (onApplyRemoteData) {
          onApplyRemoteData(res.data);
        }
        const nowStr = new Date().toISOString();
        onUpdateSettings({
          ...settings,
          gasWebAppUrl: cleanUrl,
          realtimeSyncEnabled: isAutoSyncEnabled,
          lastSyncedAt: nowStr,
        });

        const prodCount = res.data.products?.length || 0;
        const roomCount = res.data.rooms?.length || 0;
        setGasSuccessMsg(`✓ ດຶງຂໍ້ມູນສຳເລັດ! ພົບສິນຄ້າ ${prodCount} ລາຍການ, ຫ້ອງ ${roomCount} ຫ້ອງ`);
      } else {
        setGasErrorMsg(res.error || 'ດຶງຂໍ້ມູນບໍ່ສຳເລັດ');
      }
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setGasErrorMsg('ບໍ່ສາມາດເຊື່ອມຕໍ່ໄດ້: ກວດສອບ URL ຕ້ອງລົງທ້າຍດ້ວຍ /exec ແລະ ຕັ້ງຄ່າ Who has access: Anyone');
      } else {
        setGasErrorMsg('ເກີດຂໍ້ຜິດພາດ: ' + (err.message || 'Network error'));
      }
    } finally {
      setIsPullingGas(false);
      setGasStatusMsg('');
    }
  };

  // Push all local data up to Sheets
  const handlePushAllToGas = async () => {
    const cleanUrl = gasUrlInput.trim();
    if (!cleanUrl) {
      setGasErrorMsg('ກະລຸນາໃສ່ Web App URL ກ່ອນ!');
      return;
    }

    setIsPushingGas(true);
    setGasErrorMsg('');
    setGasSuccessMsg('');
    setGasStatusMsg('ກຳລັງສົ່ງຂໍ້ມູນສິນຄ້າ, ຫ້ອງ, ແພັກເກັດ, ພະນັກງານ ຂຶ້ນ Sheets...');

    try {
      const payload: GasFullDataPayload = {
        products,
        rooms,
        packages,
        staff: staffList,
        debts,
        timestamp: new Date().toISOString(),
      };

      const res = await sendDataToGas(cleanUrl, 'syncAll', payload, 10000);
      if (res.success) {
        const nowStr = new Date().toISOString();
        onUpdateSettings({
          ...settings,
          gasWebAppUrl: cleanUrl,
          realtimeSyncEnabled: isAutoSyncEnabled,
          lastSyncedAt: nowStr,
        });
        setGasSuccessMsg('✓ ສົ່ງຂໍ້ມູນທັງໝົດຂຶ້ນ Google Sheets ສຳເລັດແລ້ວ!');
      } else {
        setGasErrorMsg(res.error || 'ສົ່ງຂໍ້ມູນຂຶ້ນ Sheets ບໍ່ສຳເລັດ');
      }
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setGasErrorMsg('ບໍ່ສາມາດເຊື່ອມຕໍ່ໄດ້: ກວດສອບ URL ຕ້ອງລົງທ້ายດ້ວຍ /exec ແລະ ຕັ້ງຄ່າ Who has access: Anyone');
      } else {
        setGasErrorMsg('ເກີດຂໍ້ຜິດພາດ: ' + (err.message || 'Network error'));
      }
    } finally {
      setIsPushingGas(false);
      setGasStatusMsg('');
    }
  };

  const handleCopyScript = () => {
    navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_TEMPLATE);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-5 sm:p-6 w-full max-w-2xl shadow-2xl text-white max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-100 flex items-center gap-2">
                <span>ຊິ້ງຂໍ້ມູນ Google Sheets (Real-time Sync)</span>
              </h2>
              <p className="text-xs text-slate-400">
                ເຊື່ອມຕໍ່ຖານຂໍ້ມູນ Google Sheets ເພື່ອໃຊ້ງານຫຼາຍເຄື່ອງພ້ອມກັນ
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

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 pt-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('gas')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border ${
              activeTab === 'gas'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-500/50 shadow-md shadow-emerald-600/20'
                : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-300" />
            <span>Web App Real-time (ແນະນຳ ສຳລັບຫຼາຍເຄື່ອງ)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('oauth')}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border ${
              activeTab === 'oauth'
                ? 'bg-slate-700 text-white border-slate-600 shadow-sm'
                : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-indigo-400" />
            <span>OAuth Login (ສຳຮອງ)</span>
          </button>
        </div>

        {/* Body Container */}
        <div className="flex-1 overflow-y-auto py-3 space-y-4 pr-1 scrollbar-thin">
          {/* TAB 1: GOOGLE APPS SCRIPT WEB APP (RECOMMENDED) */}
          {activeTab === 'gas' && (
            <div className="space-y-4">
              {/* Highlight Banner */}
              <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-950/70 via-slate-900 to-teal-950/70 border border-emerald-500/40 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-black text-emerald-300 text-sm">
                    <Cloud className="w-4 h-4 text-emerald-400" />
                    <span>ລະບົບ Real-time Sync ຫຼາຍເຄື່ອງພ້ອມກັນ</span>
                  </div>
                  {settings.lastSyncedAt && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                      <Clock className="w-3 h-3 text-amber-400" />
                      <span>ຊິ້ງຫຼ້າສຸດ: {new Date(settings.lastSyncedAt).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit' })}</span>
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  ທຸກຄັ້ງທີ່ມີການເພີ່ມ ຫຼື ແກ້ໄຂຫ້ອງ/ສິນຄ້າ ຂໍ້ມູນຈະຖືກສົ່ງຂຶ້ນ Google Sheets ທັນທີ. ແລະ ເມື່ອເປີດແອັບໃນເຄື່ອງອື່ນ ລະບົບຈະດຶງຂໍ້ມູນລ່າສຸດມາສະແດງໂດຍອັດຕະໂນມັດ ໂດຍບໍ່ຄ້າງ ບໍ່ໝຸນຕິ້ວໆ.
                </p>
              </div>

              {/* URL Input Form */}
              <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-200">
                      Google Apps Script Web App URL <span className="text-rose-400">*</span>:
                    </label>
                    <button
                      type="button"
                      onClick={() => setGasUrlInput(DEFAULT_GAS_WEBAPP_URL)}
                      className="text-[11px] text-amber-400 hover:text-amber-300 hover:underline font-semibold cursor-pointer"
                    >
                      ໃຊ້ URL ທີ່ຝັງມາ (Reset)
                    </button>
                  </div>
                  <input
                    type="url"
                    value={gasUrlInput}
                    onChange={(e) => setGasUrlInput(e.target.value)}
                    placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-emerald-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                    <span>* ນຳ URL ທີ່ໄດ້ຈາກການ Deploy Web App ໃນ Google Sheets ມາວາງໃສ່ນີ້</span>
                    {gasUrlInput === DEFAULT_GAS_WEBAPP_URL && (
                      <span className="text-amber-400 font-semibold">✓ ໃຊ້ URL ທີ່ຝັງມາພ້ອມໃຊ້ງານ</span>
                    )}
                  </div>
                </div>

                {/* Auto Real-time Sync Checkbox */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="autoSyncToggle"
                      checked={isAutoSyncEnabled}
                      onChange={(e) => setIsAutoSyncEnabled(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-500 focus:ring-0 cursor-pointer accent-emerald-500"
                    />
                    <label htmlFor="autoSyncToggle" className="text-xs font-semibold text-slate-300 cursor-pointer">
                      ເປີດໃຊ້ງານ Real-time Sync ອັດຕະໂນມັດ (ທຸກຄັ້ງທີ່ເພີ່ມ/ແກ້ໄຂຫ້ອງ ແລະ ສິນຄ້າ)
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveGasSettings}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 cursor-pointer border border-slate-700"
                  >
                    ບັນທຶກ URL
                  </button>
                </div>

                {/* Sync Action Buttons */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    disabled={isPullingGas || isPushingGas || !gasUrlInput.trim()}
                    onClick={handlePullFromGas}
                    className="py-2.5 px-3 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowDownToLine className={`w-3.5 h-3.5 ${isPullingGas ? 'animate-bounce' : ''}`} />
                    <span>{isPullingGas ? 'ກຳລັງດຶງຂໍ້ມູນ...' : 'ດຶງຂໍ້ມູນລ່າສຸດ (Pull)'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isPullingGas || isPushingGas || !gasUrlInput.trim()}
                    onClick={handlePushAllToGas}
                    className="py-2.5 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowUpFromLine className={`w-3.5 h-3.5 ${isPushingGas ? 'animate-pulse' : ''}`} />
                    <span>{isPushingGas ? 'ກຳລັງສົ່ງຂໍ້ມູນ...' : 'ສົ່ງຂໍ້ມູນທັງໝົດຂຶ້ນ (Push)'}</span>
                  </button>
                </div>
              </div>

              {/* Status & Feedback Messages */}
              {gasStatusMsg && (
                <div className="p-3 rounded-xl bg-indigo-950/60 border border-indigo-500/40 text-indigo-300 text-xs flex items-center gap-2 animate-pulse">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
                  <span>{gasStatusMsg}</span>
                </div>
              )}

              {gasSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-500 text-emerald-300 text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{gasSuccessMsg}</span>
                </div>
              )}

              {gasErrorMsg && (
                <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500 text-rose-300 text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{gasErrorMsg}</span>
                </div>
              )}

              {/* Section: Google Apps Script Code with 1-Click Copy */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Code className="w-4 h-4 text-amber-400" />
                    <h3 className="font-bold text-xs text-slate-200">
                      ໂຄ້ດ Google Apps Script (ສຳລັບວາງໃນ Google Sheets)
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowScriptModal(!showScriptModal)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold cursor-pointer"
                    >
                      {showScriptModal ? 'ຫຍໍ້ໂຄ້ດ' : 'ເບິ່ງໂຄ້ດ'}
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyScript}
                      className="py-1 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-md active:scale-95"
                    >
                      {copiedScript ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedScript ? 'ຄັດລອກແລ້ວ!' : 'ຄັດລອກໂຄ້ດ (Copy)'}</span>
                    </button>
                  </div>
                </div>

                {/* 5-Step Instructions */}
                <div className="text-[11px] text-slate-300 space-y-1 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                  <p className="font-bold text-amber-300 mb-1">📋 ຂັ້ນຕອນການຕິດຕັ້ງງ່າຍໆພຽງ 1 ນາທີ:</p>
                  <p>1. ເປີດ Google Sheet ຂອງທ່ານ ➔ ໄປທີ່ເມນູ <b>ສ່ວນຂະຫຍາຍ (Extensions) &gt; Apps Script</b></p>
                  <p>2. ລຶບໂຄ້ດເກົ່າອອກທັງໝົດ ແລ້ວ <b>ກົດປຸ່ມ ຄັດລອກໂຄ້ດ (Copy) ຂ້າງເທິງ</b> ມາວາງລົງໄປ</p>
                  <p>3. ກົດປຸ່ມ <b>Save (ບັນທຶກ)</b></p>
                  <p>4. ກົດ <b>Deploy (ການນຳໄປໃຊ້) &gt; New deployment (ການນຳໄປໃຊ້ໃໝ່)</b></p>
                  <p className="pl-4 text-emerald-400 font-semibold">
                    ➔ ເລືອກ: Web app &nbsp;|&nbsp; Execute as: <b>Me</b> &nbsp;|&nbsp; Who has access: <b>Anyone (ທຸກຄົນ)</b>
                  </p>
                  <p>5. ກົດ <b>Deploy</b> ➔ ສຳເນົາ <b>Web app URL</b> (ທີ່ລົງທ້າຍດ້ວຍ <code className="text-amber-400 font-mono">/exec</code>) ມາວາງໃສ່ຊ່ອງຂ້າງເທິງນີ້!</p>
                </div>

                {/* Code Preview Box */}
                {showScriptModal && (
                  <div className="relative">
                    <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[10px] font-mono text-emerald-400 max-h-52 overflow-y-auto overflow-x-auto scrollbar-thin">
                      {GOOGLE_APPS_SCRIPT_TEMPLATE}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: OAUTH DIRECT API (SECONDARY / FALLBACK) */}
          {activeTab === 'oauth' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-indigo-950/50 border border-indigo-500/40 text-xs space-y-1">
                <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-indigo-400" />
                  <span>ວິທີການເຊື່ອມຕໍ່ຜ່ານ Google OAuth ໂດຍກົງ</span>
                </span>
                <p className="text-[11px] text-slate-300">
                  ເໝາະສຳລັບການນຳໃຊ້ເຄື່ອງດຽວ ຫຼື ສຳຮອງຂໍ້ມູນລົງ Drive ໂດຍບໍ່ຕ້ອງຕັ້ງຄ່າ Apps Script.
                </p>
              </div>

              {/* Login State */}
              {!currentUser ? (
                <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800 text-center space-y-3">
                  <p className="text-xs text-slate-300">
                    ເຂົ້າສູ່ລະບົບ Google ເພື່ອເລືອກ ຫຼື ສ້າງ Google Sheet ໃນ Google Drive ຂອງທ່ານ
                  </p>
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isLoggingIn}
                    className="py-2.5 px-6 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs shadow-lg inline-flex items-center gap-2 cursor-pointer transition-all"
                  >
                    <img
                      src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                      alt="Google"
                      className="w-4 h-4"
                    />
                    <span>{isLoggingIn ? 'ກຳລັງເຂົ້າສູ່ລະບົບ...' : 'ເຂົ້າສູ່ລະບົບດ້ວຍ Google'}</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* User Profile */}
                  <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800">
                    <div className="flex items-center gap-2.5">
                      {currentUser.photoURL ? (
                        <img
                          src={currentUser.photoURL}
                          alt={currentUser.displayName || ''}
                          className="w-8 h-8 rounded-full border border-slate-700"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-xs">
                          {currentUser.displayName?.[0] || 'U'}
                        </div>
                      )}
                      <div>
                        <h4 className="font-bold text-xs text-slate-200">
                          {currentUser.displayName || 'Google User'}
                        </h4>
                        <p className="text-[10px] text-slate-400">{currentUser.email}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleGoogleLogout}
                      className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 text-xs flex items-center gap-1 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>ອອກລະບົບ</span>
                    </button>
                  </div>

                  {/* Create or Select Sheet */}
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleCreateNewSheet}
                      disabled={isCreatingSheet}
                      className="py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{isCreatingSheet ? 'ກຳລັງສ້າງ Sheet...' : '+ ສ້າງ Google Sheet ໃໝ່'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => token && loadSpreadsheets(token)}
                      disabled={isLoadingSheets}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
                      title="ໂຫຼດລາຍການຄືນໃໝ່"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSheets ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {/* Spreadsheets list */}
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                    {spreadsheets.map((s) => {
                      const isSelected = settings.googleSheetId === s.id;
                      return (
                        <div
                          key={s.id}
                          onClick={() => handleSelectSheet(s)}
                          className={`p-3 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                            isSelected
                              ? 'bg-emerald-950/60 border-emerald-500 text-white'
                              : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800/80'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <FileSpreadsheet className={`w-4 h-4 ${isSelected ? 'text-emerald-400' : 'text-slate-500'}`} />
                            <span className="font-bold text-xs">{s.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {isSelected && (
                              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-bold">
                                ໃຊ້ງານຢູ່
                              </span>
                            )}
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="p-1 rounded-lg hover:bg-white/10 text-slate-400"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Sync all via OAuth button */}
                  {settings.googleSheetId && (
                    <button
                      type="button"
                      onClick={handleSyncOAuthAllData}
                      disabled={isOAuthSyncing}
                      className="w-full py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-xs shadow-lg cursor-pointer flex items-center justify-center gap-2"
                    >
                      <RefreshCw className={`w-4 h-4 ${isOAuthSyncing ? 'animate-spin' : ''}`} />
                      <span>{isOAuthSyncing ? 'ກຳລັງຊິ້ງ...' : 'ຊິ້ງຍອດຂາຍ ແລະ ສະຕັອກທັງໝົດລົງ Sheet'}</span>
                    </button>
                  )}

                  {oauthStatusMsg && (
                    <div className="p-2.5 rounded-xl bg-emerald-950 border border-emerald-500 text-emerald-300 text-xs font-bold">
                      {oauthStatusMsg}
                    </div>
                  )}

                  {oauthErrorMsg && (
                    <div className="p-2.5 rounded-xl bg-rose-950 border border-rose-500 text-rose-300 text-xs font-bold">
                      {oauthErrorMsg}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="pt-3 border-t border-slate-800 flex items-center justify-between shrink-0">
          <span className="text-[10px] text-slate-400">
            {settings.gasWebAppUrl
              ? '✓ ເຊື່ອມຕໍ່ Google Apps Script Web App ແລ້ວ'
              : '• ຍັງບໍ່ໄດ້ກຳນົດ Web App URL'}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportStandaloneHtmlFile()}
              className="py-2 px-3.5 rounded-xl bg-teal-900/60 hover:bg-teal-800/80 border border-teal-500/40 text-teal-300 text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export index.html</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="py-2 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer transition-colors"
            >
              ປິດໜ້າຕ່າງ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
