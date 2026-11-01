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
} from 'lucide-react';
import { BillRecord, Product, AppSettings } from '../types';
import {
  googleSignIn,
  logoutGoogle,
  getAccessToken,
  initAuth,
} from '../lib/firebase';
import {
  listExistingSpreadsheets,
  createKtvSpreadsheet,
  syncInventoryToSheet,
  appendBillToSheet,
  SpreadsheetInfo,
} from '../lib/googleSheets';

interface GoogleSheetsSyncModalProps {
  settings: AppSettings;
  bills: BillRecord[];
  products: Product[];
  onClose: () => void;
  onUpdateSettings: (settings: AppSettings) => void;
}

export const GoogleSheetsSyncModal: React.FC<GoogleSheetsSyncModalProps> = ({
  settings,
  bills,
  products,
  onClose,
  onUpdateSettings,
}) => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [spreadsheets, setSpreadsheets] = useState<SpreadsheetInfo[]>([]);
  const [isLoadingSheets, setIsLoadingSheets] = useState<boolean>(false);
  const [isCreatingSheet, setIsCreatingSheet] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

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
    setErrorMsg('');
    try {
      const list = await listExistingSpreadsheets(tok);
      setSpreadsheets(list);
    } catch (err: any) {
      console.error('Failed to list spreadsheets', err);
      setErrorMsg('ບໍ່ສາມາດໂຫຼດລາຍການ Spreadsheets ໄດ້: ' + (err.message || ''));
    } finally {
      setIsLoadingSheets(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setErrorMsg('');
    try {
      const res = await googleSignIn();
      if (res) {
        setCurrentUser(res.user);
        setToken(res.accessToken);
        await loadSpreadsheets(res.accessToken);
      }
    } catch (err: any) {
      setErrorMsg('ການເຂົ້າສູ່ລະບົບ Google ລົ້ມເຫຼວ: ' + (err.message || ''));
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
    setErrorMsg('');
    try {
      const sheet = await createKtvSpreadsheet(token, `689 KTV - ບັນທຶກຍອດຂາຍ ແລະ ສະຕັອກ (${new Date().getFullYear()})`);
      setSpreadsheets((prev) => [sheet, ...prev]);

      // Save to settings
      onUpdateSettings({
        ...settings,
        googleSheetId: sheet.id,
        googleSheetName: sheet.name,
      });

      // Immediately sync current inventory
      await syncInventoryToSheet(token, sheet.id, products);

      setSyncStatusMsg('ສ້າງ Google Sheet ສຳເລັດ ແລະ ບັນທຶກຫົວຕາຕະລາງພ້ອມສະຕັອກແລ້ວ!');
    } catch (err: any) {
      setErrorMsg('ສ້າງ Google Sheet ລົ້ມເຫຼວ: ' + err.message);
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
    setSyncStatusMsg(`ເລືອກ Google Sheet: ${sheet.name}`);
  };

  const handleSyncAllData = async () => {
    if (!token || !settings.googleSheetId) {
      alert('ກະລຸນາເລືອກ ຫຼື ສ້າງ Google Sheet ກ່ອນ!');
      return;
    }

    setIsSyncing(true);
    setErrorMsg('');
    setSyncStatusMsg('ກຳລັງຊິ້ງຂໍ້ມູນຍອດຂາຍ ແລະ ສະຕັອກ...');

    try {
      // 1. Sync inventory
      await syncInventoryToSheet(token, settings.googleSheetId, products);

      // 2. Sync all bills
      for (const bill of bills) {
        await appendBillToSheet(token, settings.googleSheetId, bill);
      }

      setSyncStatusMsg(`ຊິ້ງຂໍ້ມູນສຳເລັດ! ບັນທຶກ ${bills.length} ໃບບິນ ແລະ ${products.length} ລາຍການສະຕັອກ.`);
    } catch (err: any) {
      setErrorMsg('ເກີດຂໍ້ຜິດພາດໃນການຊິ້ງ: ' + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-2xl shadow-2xl text-white my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-black text-lg text-slate-100">
                ເຊື່ອມຕໍ່ Google Sheets (ບັນທຶກຂໍ້ມູນອັດຕະໂນມັດ)
              </h3>
              <p className="text-xs text-slate-400">
                ບັນທຶກຍອດຂາຍ, ລາຍລະອຽດສິນຄ້າ ແລະ ສະຕັອກລົງໃນ Google Spreadsheet ຂອງທ່ານ
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Auth Section */}
        {!currentUser ? (
          <div className="p-6 rounded-3xl bg-slate-800/60 border border-slate-700 text-center space-y-4 my-4">
            <div className="max-w-md mx-auto space-y-2">
              <h4 className="font-bold text-sm text-slate-200">
                ເຂົ້າສູ່ລະບົບດ້ວຍບັນຊີ Google
              </h4>
              <p className="text-xs text-slate-400">
                ເພື່ອໃຫ້ລະບົບ 689 KTV ສາມາດບັນທຶກໃບບິນ ແລະ ສະຕັອກລົງໃນ Google Sheets ຂອງເຈົ້າໄດ້ຢ່າງປອດໄພ
              </p>
            </div>

            {/* Official Sign In with Google style button as required by Skill */}
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isLoggingIn}
                className="inline-flex items-center gap-3 px-5 py-3 rounded-2xl bg-white text-slate-800 hover:bg-slate-100 font-semibold text-xs shadow-lg transition-all cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <svg className="w-5 h-5" viewBox="0 0 48 48">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>{isLoggingIn ? 'ກຳລັງເຂົ້າສູ່ລະບົບ...' : 'Sign in with Google (ເຂົ້າສູ່ລະບົບ)'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Account Info bar */}
            <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt={currentUser.displayName || ''}
                    className="w-9 h-9 rounded-full border border-emerald-500/50"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-xs">
                    {currentUser.email?.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <h4 className="font-bold text-xs text-slate-100">
                    {currentUser.displayName || 'Google Account'}
                  </h4>
                  <p className="text-[11px] text-slate-400">{currentUser.email}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleLogout}
                className="px-3 py-1.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>ອອກຈາກລະບົບ</span>
              </button>
            </div>

            {/* Current Selected Sheet Status */}
            {settings.googleSheetId ? (
              <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-xs text-emerald-300">
                      ເຊື່ອມຕໍ່ກັບ Google Sheet ນີ້ແລ້ວ:
                    </span>
                  </div>
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${settings.googleSheetId}/edit`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 hover:text-emerald-300 underline"
                  >
                    <span>ເປີດໃນ Google Sheets</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="text-sm font-black text-slate-100 font-mono">
                  {settings.googleSheetName || settings.googleSheetId}
                </div>

                <div className="pt-2 flex items-center justify-between border-t border-emerald-900/40 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.autoSyncGoogleSheets}
                      onChange={(e) =>
                        onUpdateSettings({ ...settings, autoSyncGoogleSheets: e.target.checked })
                      }
                      className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                    />
                    <span className="text-slate-300">
                      ຊິ້ງອັດຕະໂນມັດທຸກຄັ້ງທີ່ເຊັກບິນສຳເລັດ (Auto-sync)
                    </span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-600/50 text-xs text-amber-300 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>ຍັງບໍ່ທັນມີ Spreadsheet ທີ່ເຊື່ອມຕໍ່! ກະລຸນາສ້າງໃໝ່ ຫຼື ເລືອກຈາກລາຍການລຸ່ມນີ້</span>
              </div>
            )}

            {/* Status & Error Messages */}
            {syncStatusMsg && (
              <div className="p-3 bg-emerald-950/80 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>{syncStatusMsg}</span>
              </div>
            )}
            {errorMsg && (
              <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Action Buttons: Create New Sheet or Manual Sync */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={handleCreateNewSheet}
                disabled={isCreatingSheet}
                className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>{isCreatingSheet ? 'ກຳລັງສ້າງ...' : 'ສ້າງ Google Sheet ສຳລັບ 689 KTV ໃໝ່'}</span>
              </button>

              <button
                type="button"
                onClick={handleSyncAllData}
                disabled={isSyncing || !settings.googleSheetId}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'ກຳລັງຊິ້ງຂໍ້ມູນ...' : 'ຊິ້ງຂໍ້ມູນທັງໝົດດຽວນີ້ (Sync Now)'}</span>
              </button>
            </div>

            {/* List of Existing Spreadsheets from User's Drive */}
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>ເລືອກຈາກ Google Sheets ໃນ Google Drive:</span>
                <button
                  onClick={() => token && loadSpreadsheets(token)}
                  disabled={isLoadingSheets}
                  className="hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingSheets ? 'animate-spin' : ''}`} />
                  <span>ໂຫຼດໃໝ່</span>
                </button>
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
                {spreadsheets.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">
                    {isLoadingSheets ? 'ກຳລັງໂຫຼດ...' : 'ບໍ່ພົບ Spreadsheet ໃນ Google Drive'}
                  </p>
                ) : (
                  spreadsheets.map((sheet) => (
                    <div
                      key={sheet.id}
                      onClick={() => handleSelectSheet(sheet)}
                      className={`p-2.5 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition-all ${
                        settings.googleSheetId === sheet.id
                          ? 'bg-emerald-950/60 border-emerald-500 text-white font-bold'
                          : 'bg-slate-800/60 border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <FileCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="truncate">{sheet.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {settings.googleSheetId === sheet.id ? 'ເລືອກແລ້ວ' : 'ເລືອກ'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="py-2.5 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
          >
            ປິດໜ້າຕ່າງ
          </button>
        </div>
      </div>
    </div>
  );
};
