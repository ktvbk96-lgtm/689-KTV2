import fs from 'fs';
import path from 'path';
import { put, list } from '@vercel/blob';

export interface AppStore {
  version: number;
  lastUpdated: string;
  products: any[];
  rooms: any[];
  packages: any[];
  staff: any[];
  settings: any;
  debts: any[];
  bills: any[];
}

const FIRESTORE_PROJECT_ID = 'ktv-e97cb';
const FIRESTORE_DOC_URL = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/ktv_689/store`;
const BLOB_STORE_PATHNAME = '689ktv-store/store.json';

const DEFAULT_SETTINGS = {
  shopName: '689 KTV',
  shopBranch: 'ສາຂາ 1',
  shopAddress: 'ນະຄອນຫຼວງວຽງຈັນ, ສປປ ລາວ',
  shopPhone: '020-5555-6899',
  receiptHeader: '689 KTV - ຄາຣາໂອເກະ ຄຸນນະພາບສູງ',
  receiptFooter: 'ຂໍຂອບໃຈລູກຄ້າທີ່ມາອຸດໜູນ ຍິນດີຕ້ອນຮັບສະເໝີ!',
  adminPin: '8888',
  staffPin: '1234',
  currencySymbol: '₭',
  defaultHourlyRate: 80000,
  autoSyncGoogleSheets: true,
  realtimeSyncEnabled: true,
};

function createEmptyStore(): AppStore {
  return {
    version: 1,
    lastUpdated: new Date(0).toISOString(),
    products: [],
    rooms: [],
    packages: [],
    staff: [],
    settings: { ...DEFAULT_SETTINGS },
    debts: [],
    bills: [],
  };
}

export function parseTs(val?: string | null): number {
  if (!val) return 0;
  const ms = Date.parse(val);
  return Number.isFinite(ms) ? ms : 0;
}

// Compute a consistent numeric version shared between /api/sync and /api/sync/version
export function computeStoreVersion(store: Partial<AppStore>): number {
  const explicitVer = typeof store.version === 'number' && Number.isFinite(store.version) ? store.version : 0;
  const tsSec = Math.floor(parseTs(store.lastUpdated) / 1000);
  // Combining explicit version and epoch seconds guarantees polling detects updates from any backend layer
  return Math.max(explicitVer, tsSec > 0 ? tsSec : 1);
}

// ---------- Firestore REST Helpers ----------
function decodeFirestoreValue(val: any): any {
  if (!val || typeof val !== 'object') return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  if ('arrayValue' in val) {
    const arr = val.arrayValue?.values;
    return Array.isArray(arr) ? arr.map(decodeFirestoreValue) : [];
  }
  if ('mapValue' in val) {
    const fields = val.mapValue?.fields || {};
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function sanitizeForFirestore(val: any): any {
  if (val === undefined) return null;
  if (typeof val === 'string' && val.length > 500 && val.startsWith('data:image')) {
    return '';
  }
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(sanitizeForFirestore);
  const out: Record<string, any> = {};
  for (const k of Object.keys(val)) {
    const v = val[k];
    out[k] = v === undefined ? null : sanitizeForFirestore(v);
  }
  return out;
}

function encodeFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { doubleValue: 0 };
    if (Number.isInteger(val) && Number.isSafeInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(encodeFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

async function readFromFirestore(): Promise<AppStore | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(FIRESTORE_DOC_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const fields = json?.fields;
    if (!fields) return null;

    const decoded = decodeFirestoreValue({ mapValue: { fields } });
    if (!decoded || typeof decoded !== 'object') return null;

    return {
      version: typeof decoded.version === 'number' ? decoded.version : 1,
      lastUpdated: typeof decoded.lastUpdated === 'string' ? decoded.lastUpdated : new Date(0).toISOString(),
      products: Array.isArray(decoded.products) ? decoded.products : [],
      rooms: Array.isArray(decoded.rooms) ? decoded.rooms : [],
      packages: Array.isArray(decoded.packages) ? decoded.packages : [],
      staff: Array.isArray(decoded.staff) ? decoded.staff : [],
      settings: decoded.settings && typeof decoded.settings === 'object' ? { ...DEFAULT_SETTINGS, ...decoded.settings } : { ...DEFAULT_SETTINGS },
      debts: Array.isArray(decoded.debts) ? decoded.debts : [],
      bills: Array.isArray(decoded.bills) ? decoded.bills : [],
    };
  } catch (err) {
    console.warn('Firestore REST read note:', err);
    return null;
  }
}

async function readVersionFromFirestore(): Promise<{ version: number; lastUpdated: string } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(
      `${FIRESTORE_DOC_URL}?mask.fieldPaths=lastUpdated&mask.fieldPaths=version`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const fields = json?.fields;
    if (!fields) return null;
    const lastUpdated = fields.lastUpdated?.stringValue || '';
    const rawVer = fields.version?.integerValue ? Number(fields.version.integerValue) : 1;
    const version = computeStoreVersion({ version: rawVer, lastUpdated });
    return { version, lastUpdated };
  } catch {
    return null;
  }
}

async function writeToFirestore(store: AppStore, meta?: { action?: string; senderDeviceId?: string }): Promise<boolean> {
  try {
    const clean = sanitizeForFirestore({
      version: store.version,
      lastUpdated: store.lastUpdated,
      lastAction: meta?.action || 'syncAll',
      lastSenderId: meta?.senderDeviceId || 'vercel-api',
      products: store.products,
      rooms: store.rooms,
      packages: store.packages,
      staff: store.staff,
      settings: store.settings,
      debts: store.debts,
      bills: store.bills,
    });

    const fields: Record<string, any> = {};
    const updateMaskParams: string[] = [];
    for (const [k, v] of Object.entries(clean)) {
      fields[k] = encodeFirestoreValue(v);
      updateMaskParams.push(`updateMask.fieldPaths=${encodeURIComponent(k)}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(`${FIRESTORE_DOC_URL}?${updateMaskParams.join('&')}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch (err) {
    console.warn('Firestore REST write note:', err);
    return false;
  }
}

// ---------- Vercel Blob Helpers ----------
async function findStoreBlob(token: string): Promise<{ url: string; uploadedAt: Date | string } | null> {
  try {
    const primary = await list({ prefix: BLOB_STORE_PATHNAME, limit: 5, token });
    const exactPrimary = primary.blobs.find((b) => b.pathname === BLOB_STORE_PATHNAME) || primary.blobs[0];
    if (exactPrimary?.url) {
      return { url: exactPrimary.url, uploadedAt: exactPrimary.uploadedAt };
    }

    // Legacy fallback path check in case earlier deployments stored at store.json or ktv-store.json
    const legacy = await list({ prefix: 'store.json', limit: 5, token });
    const exactLegacy = legacy.blobs.find((b) => b.pathname === 'store.json') || legacy.blobs[0];
    if (exactLegacy?.url) {
      return { url: exactLegacy.url, uploadedAt: exactLegacy.uploadedAt };
    }
  } catch (err) {
    console.warn('Vercel Blob list note:', err);
  }
  return null;
}

async function readFromVercelBlob(): Promise<{ store: AppStore; uploadedAtMs: number } | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const blobMeta = await findStoreBlob(token);
    if (!blobMeta?.url) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${blobMeta.url}${blobMeta.url.includes('?') ? '&' : '?'}_t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const parsed = await res.json();
    if (!parsed || typeof parsed !== 'object') return null;

    const store: AppStore = {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      lastUpdated: typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : new Date(blobMeta.uploadedAt).toISOString(),
      products: Array.isArray(parsed.products) ? parsed.products : [],
      rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
      packages: Array.isArray(parsed.packages) ? parsed.packages : [],
      staff: Array.isArray(parsed.staff) ? parsed.staff : [],
      settings: parsed.settings && typeof parsed.settings === 'object' ? { ...DEFAULT_SETTINGS, ...parsed.settings } : { ...DEFAULT_SETTINGS },
      debts: Array.isArray(parsed.debts) ? parsed.debts : [],
      bills: Array.isArray(parsed.bills) ? parsed.bills : [],
    };
    return {
      store,
      uploadedAtMs: new Date(blobMeta.uploadedAt).getTime() || 0,
    };
  } catch (err) {
    console.warn('Vercel Blob read note:', err);
    return null;
  }
}

async function writeToVercelBlob(store: AppStore): Promise<boolean> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;
  try {
    await put(BLOB_STORE_PATHNAME, JSON.stringify(store), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      token,
    });
    return true;
  } catch (err) {
    console.warn('Vercel Blob write note:', err);
    return false;
  }
}

// ---------- Local .data/store.json Helpers ----------
function readFromLocalDisk(): AppStore | null {
  try {
    const dataDir = path.resolve(process.cwd(), '.data');
    const storeFile = path.resolve(dataDir, 'store.json');
    const defaultStoreFile = path.resolve(dataDir, 'defaultStore.json');

    for (const filePath of [storeFile, defaultStoreFile]) {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object') {
          return {
            version: typeof parsed.version === 'number' ? parsed.version : 1,
            lastUpdated: typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : new Date(0).toISOString(),
            products: Array.isArray(parsed.products) ? parsed.products : [],
            rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
            packages: Array.isArray(parsed.packages) ? parsed.packages : [],
            staff: Array.isArray(parsed.staff) ? parsed.staff : [],
            settings: parsed.settings && typeof parsed.settings === 'object' ? { ...DEFAULT_SETTINGS, ...parsed.settings } : { ...DEFAULT_SETTINGS },
            debts: Array.isArray(parsed.debts) ? parsed.debts : [],
            bills: Array.isArray(parsed.bills) ? parsed.bills : [],
          };
        }
      }
    }
  } catch (err) {
    console.warn('Local store.json read note:', err);
  }
  return null;
}

function writeToLocalDisk(store: AppStore): void {
  try {
    const dataDir = path.resolve(process.cwd(), '.data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const storeFile = path.resolve(dataDir, 'store.json');
    fs.writeFileSync(storeFile, JSON.stringify(store, null, 2), 'utf-8');
  } catch {
    // Vercel serverless filesystem is read-only — safely ignore disk write failure
  }
}

// ---------- Authoritative Candidate Selector (Read-First Protection) ----------
function scoreStore(s: AppStore): number {
  const itemCount =
    (s.products?.length || 0) +
    (s.rooms?.length || 0) +
    (s.bills?.length || 0) +
    (s.debts?.length || 0);
  if (itemCount === 0 && (s.version || 0) <= 1) return 0;
  const ts = parseTs(s.lastUpdated);
  // Primary sort key: newest timestamp; tie-breaker: data richness + version
  return ts > 0 ? ts : itemCount * 1000 + (s.version || 0);
}

function pickNewestStore(candidates: Array<AppStore | null>): AppStore {
  let best: AppStore | null = null;
  let bestScore = -1;

  for (const cand of candidates) {
    if (!cand) continue;
    const score = scoreStore(cand);
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  return best || createEmptyStore();
}

// Keep a short-lived memory cache per serverless instance to avoid redundant downloads
const globalAny = globalThis as any;

export async function readAuthoritativeStore(): Promise<{
  store: AppStore;
  effectiveVersion: number;
}> {
  const [blobResult, firestoreStore, localStore] = await Promise.all([
    readFromVercelBlob(),
    readFromFirestore(),
    Promise.resolve(readFromLocalDisk()),
  ]);

  const best = pickNewestStore([
    blobResult?.store || null,
    firestoreStore,
    localStore,
  ]);

  // Preserve imageUrl from Vercel Blob or local store if Firestore stripped data URIs
  const imageSources = [blobResult?.store, localStore].filter(Boolean) as AppStore[];
  if (imageSources.length > 0 && best.products.length > 0) {
    const imageMap = new Map<string, string>();
    for (const src of imageSources) {
      for (const p of src.products || []) {
        if (p?.id && p?.imageUrl && !imageMap.has(p.id)) {
          imageMap.set(p.id, p.imageUrl);
        }
      }
    }
    best.products = best.products.map((p) =>
      p?.imageUrl ? p : { ...p, imageUrl: imageMap.get(p.id) || '' }
    );
  }

  const effectiveVersion = computeStoreVersion(best);
  globalAny.__689ktvLastStore = best;
  globalAny.__689ktvLastVersion = effectiveVersion;

  return { store: best, effectiveVersion };
}

export async function readStoreVersion(): Promise<{
  version: number;
  lastUpdated: string;
}> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const [blobMeta, fsVer, localStore] = await Promise.all([
    token ? findStoreBlob(token) : Promise.resolve(null),
    readVersionFromFirestore(),
    Promise.resolve(readFromLocalDisk()),
  ]);

  let bestLastUpdated = fsVer?.lastUpdated || '';
  let bestTs = parseTs(bestLastUpdated);
  let bestVer = fsVer?.version || 1;

  if (localStore) {
    const localTs = parseTs(localStore.lastUpdated);
    if (localTs > bestTs) {
      bestTs = localTs;
      bestLastUpdated = localStore.lastUpdated;
      bestVer = computeStoreVersion(localStore);
    }
  }

  if (blobMeta) {
    const blobTs = new Date(blobMeta.uploadedAt).getTime() || 0;
    // If Blob was updated more recently than Firestore/local, fetch exact store lastUpdated/version
    if (blobTs > bestTs + 2000) {
      const { store, effectiveVersion } = await readAuthoritativeStore();
      return {
        version: effectiveVersion,
        lastUpdated: store.lastUpdated,
      };
    }
  }

  if (!bestLastUpdated && globalAny.__689ktvLastStore) {
    return {
      version: globalAny.__689ktvLastVersion || 1,
      lastUpdated: globalAny.__689ktvLastStore.lastUpdated,
    };
  }

  return {
    version: bestVer,
    lastUpdated: bestLastUpdated || new Date().toISOString(),
  };
}

export async function applyGranularMergeAndSave(body: any): Promise<{
  success: boolean;
  version: number;
  lastUpdated: string;
  rejectedStale: boolean;
  data: AppStore;
}> {
  const { action, data, senderDeviceId, baseVersion } = body || {};

  // Read-First Protection: NEVER write without loading the latest authoritative state first
  const { store, effectiveVersion } = await readAuthoritativeStore();
  const nowIso = new Date().toISOString();
  const clientBaseVersion = typeof baseVersion === 'number' ? baseVersion : 0;

  // Guard: ignore empty/no-op requests on load
  if (!action || !data || typeof data !== 'object') {
    return {
      success: true,
      version: effectiveVersion,
      lastUpdated: store.lastUpdated,
      rejectedStale: false,
      data: store,
    };
  }

  let hasChanged = false;
  let rejectedStale = false;

  // Full Admin Reset / Master Restore (ONLY allowed via explicit resetAll / clearAll)
  if ((action === 'resetAll' || action === 'clearAll') && data) {
    if (Array.isArray(data.rooms)) store.rooms = data.rooms;
    if (Array.isArray(data.products)) store.products = data.products;
    if (Array.isArray(data.packages)) store.packages = data.packages;
    if (Array.isArray(data.staff)) store.staff = data.staff;
    if (Array.isArray(data.debts)) store.debts = data.debts;
    if (data.settings) store.settings = { ...store.settings, ...data.settings };
    if (Array.isArray(data.bills)) store.bills = data.bills;
    hasChanged = true;
  } else {
    // 1. Atomic Stock Deductions (POS checkout, room checkout, split pay, room transfer)
    if (Array.isArray(data.stockDeductions) && data.stockDeductions.length > 0) {
      for (const adj of data.stockDeductions) {
        if (!adj?.productId || !(adj.deductQty > 0)) continue;
        const idx = (store.products || []).findIndex((p: any) => p.id === adj.productId);
        if (idx >= 0) {
          const prod = store.products[idx];
          if (prod.category === 'service') continue;
          const nextStock = Math.max(0, (Number(prod.stock) || 0) - Number(adj.deductQty));
          const updatedProd: any = {
            ...prod,
            stock: nextStock,
            updatedAt: nowIso,
          };
          if (updatedProd.hasMultiUnit) {
            const mult = Number(updatedProd.packMultiplier) || 24;
            updatedProd.packsInStock = Math.floor(nextStock / mult);
            updatedProd.looseBottles = nextStock % mult;
          }
          store.products[idx] = updatedProd;
          hasChanged = true;
        }
      }
    }

    // 2. Granular Products Merge (changedProducts + explicit deletedProductIds)
    const incomingProducts = Array.isArray(data.changedProducts)
      ? data.changedProducts
      : action === 'saveProducts' && Array.isArray(data.products)
      ? data.products
      : null;

    if (data.clearProducts === true) {
      if ((store.products || []).length > 0) {
        store.products = [];
        hasChanged = true;
      }
    } else {
      if (incomingProducts && incomingProducts.length > 0) {
        const current = [...(store.products || [])];
        for (const inc of incomingProducts) {
          if (!inc?.id) continue;
          const idx = current.findIndex((p: any) => p.id === inc.id);
          const inTs = parseTs(inc.updatedAt);
          if (idx === -1) {
            current.push({ ...inc, updatedAt: inc.updatedAt || nowIso });
            hasChanged = true;
          } else {
            const ex = current[idx];
            const exTs = parseTs(ex.updatedAt);
            if (
              (exTs > 0 && inTs > 0 && inTs < exTs) ||
              (exTs > 0 && inTs === 0 && clientBaseVersion > 0 && clientBaseVersion < effectiveVersion)
            ) {
              rejectedStale = true;
              continue;
            }
            const mergedProd = {
              ...inc,
              imageUrl: inc.imageUrl || ex.imageUrl || '',
              updatedAt: inc.updatedAt || nowIso,
            };
            if (JSON.stringify(ex) !== JSON.stringify(mergedProd)) {
              current[idx] = mergedProd;
              hasChanged = true;
            }
          }
        }
        store.products = current;
      }
      if (Array.isArray(data.deletedProductIds) && data.deletedProductIds.length > 0) {
        const delSet = new Set(data.deletedProductIds);
        const filtered = (store.products || []).filter((p: any) => !delSet.has(p.id));
        if (filtered.length !== (store.products || []).length) {
          store.products = filtered;
          hasChanged = true;
        }
      }
    }

    // 3. Granular Rooms Merge (changedRooms + explicit deletedRoomIds)
    const incomingRooms = Array.isArray(data.changedRooms)
      ? data.changedRooms
      : action === 'saveRooms' && Array.isArray(data.rooms)
      ? data.rooms
      : null;

    if (incomingRooms && incomingRooms.length > 0) {
      const current = [...(store.rooms || [])];
      for (const inc of incomingRooms) {
        if (!inc?.id && !inc?.name) continue;
        const idx = current.findIndex(
          (r: any) => r.id === inc.id || (inc.name && r.name === inc.name)
        );
        const inTs = parseTs(inc.updatedAt);
        if (idx === -1) {
          current.push({ ...inc, updatedAt: inc.updatedAt || nowIso });
          hasChanged = true;
        } else {
          const ex = current[idx];
          const exTs = parseTs(ex.updatedAt);
          if (
            (exTs > 0 && inTs > 0 && inTs < exTs) ||
            (exTs > 0 && inTs === 0 && clientBaseVersion > 0 && clientBaseVersion < effectiveVersion)
          ) {
            rejectedStale = true;
            continue;
          }
          const nextRoom = { ...inc, updatedAt: inc.updatedAt || nowIso };
          if (JSON.stringify(ex) !== JSON.stringify(nextRoom)) {
            current[idx] = nextRoom;
            hasChanged = true;
          }
        }
      }
      store.rooms = current;
    }
    if (Array.isArray(data.deletedRoomIds) && data.deletedRoomIds.length > 0) {
      const delSet = new Set(data.deletedRoomIds);
      const filtered = (store.rooms || []).filter((r: any) => !delSet.has(r.id));
      if (filtered.length !== (store.rooms || []).length) {
        store.rooms = filtered;
        hasChanged = true;
      }
    }

    // 4. Granular Bills Merge (Upsert single/changed bill — NEVER overwrite full bills array)
    if (data.clearAllBills === true || action === 'clearAllBills') {
      if ((store.bills || []).length > 0) {
        store.bills = [];
        hasChanged = true;
      }
    } else {
      const billsToUpsert = [
        ...(data.bill ? [data.bill] : []),
        ...(Array.isArray(data.changedBills) ? data.changedBills : []),
      ];
      if (billsToUpsert.length > 0) {
        const current = [...(store.bills || [])];
        for (const inc of billsToUpsert) {
          if (!inc?.id) continue;
          const trimNum = (inc.billNumber || '').trim();
          const idx = current.findIndex(
            (b: any) => b.id === inc.id || (trimNum && (b.billNumber || '').trim() === trimNum)
          );
          const stamped = { ...inc, updatedAt: inc.updatedAt || nowIso };
          if (idx === -1) {
            current.unshift(stamped);
            hasChanged = true;
          } else {
            const ex = current[idx];
            const inTs = parseTs(inc.updatedAt);
            const exTs = parseTs(ex.updatedAt);
            if (exTs > 0 && inTs > 0 && inTs < exTs) {
              rejectedStale = true;
              continue;
            }
            if (JSON.stringify(ex) !== JSON.stringify(stamped)) {
              current[idx] = stamped;
              hasChanged = true;
            }
          }
        }
        store.bills = current;
      }
      if (Array.isArray(data.deletedBillIds) && data.deletedBillIds.length > 0) {
        const delSet = new Set(data.deletedBillIds);
        const delNums = new Set(
          (store.bills || [])
            .filter((b: any) => delSet.has(b.id) && b.billNumber?.trim())
            .map((b: any) => b.billNumber.trim())
        );
        const filtered = (store.bills || []).filter(
          (b: any) => !delSet.has(b.id) && (!b.billNumber?.trim() || !delNums.has(b.billNumber.trim()))
        );
        if (filtered.length !== (store.bills || []).length) {
          store.bills = filtered;
          hasChanged = true;
        }
      }
    }

    // 5. Granular Debts Merge (changedDebts + deletedDebtIds)
    if (data.clearAllDebts === true) {
      if ((store.debts || []).length > 0) {
        store.debts = [];
        hasChanged = true;
      }
    } else {
      const incomingDebts = Array.isArray(data.changedDebts)
        ? data.changedDebts
        : action === 'saveDebts' && Array.isArray(data.debts)
        ? data.debts
        : null;
      if (incomingDebts && incomingDebts.length > 0) {
        const current = [...(store.debts || [])];
        for (const inc of incomingDebts) {
          if (!inc?.id) continue;
          const idx = current.findIndex((d: any) => d.id === inc.id);
          const inTs = parseTs(inc.updatedAt);
          if (idx === -1) {
            current.unshift({ ...inc, updatedAt: inc.updatedAt || nowIso });
            hasChanged = true;
          } else {
            const ex = current[idx];
            const exTs = parseTs(ex.updatedAt);
            if (exTs > 0 && inTs > 0 && inTs < exTs) {
              rejectedStale = true;
              continue;
            }
            const stamped = { ...inc, updatedAt: inc.updatedAt || nowIso };
            if (JSON.stringify(ex) !== JSON.stringify(stamped)) {
              current[idx] = stamped;
              hasChanged = true;
            }
          }
        }
        store.debts = current;
      }
      if (Array.isArray(data.deletedDebtIds) && data.deletedDebtIds.length > 0) {
        const delSet = new Set(data.deletedDebtIds);
        const filtered = (store.debts || []).filter((d: any) => !delSet.has(d.id));
        if (filtered.length !== (store.debts || []).length) {
          store.debts = filtered;
          hasChanged = true;
        }
      }
    }

    // 6. Packages, Staff & Settings
    if (action === 'savePackages' && Array.isArray(data.packages)) {
      if (JSON.stringify(store.packages) !== JSON.stringify(data.packages)) {
        store.packages = data.packages;
        hasChanged = true;
      }
    }
    if (action === 'saveStaff' && Array.isArray(data.staff)) {
      if (JSON.stringify(store.staff) !== JSON.stringify(data.staff)) {
        store.staff = data.staff;
        hasChanged = true;
      }
    }
    if (action === 'saveSettings' && data.settings) {
      const mergedSettings = { ...store.settings, ...data.settings };
      if (JSON.stringify(store.settings) !== JSON.stringify(mergedSettings)) {
        store.settings = mergedSettings;
        hasChanged = true;
      }
    }
  }

  let nextEffectiveVersion = effectiveVersion;

  if (hasChanged) {
    store.version = (Number(store.version) || 1) + 1;
    store.lastUpdated = nowIso;
    nextEffectiveVersion = computeStoreVersion(store);

    // Persist in parallel across Vercel Blob, Firebase Firestore, and local disk (if writable)
    writeToLocalDisk(store);
    await Promise.all([
      writeToVercelBlob(store),
      writeToFirestore(store, { action, senderDeviceId }),
    ]);

    globalAny.__689ktvLastStore = store;
    globalAny.__689ktvLastVersion = nextEffectiveVersion;
  }

  return {
    success: true,
    version: nextEffectiveVersion,
    lastUpdated: store.lastUpdated,
    rejectedStale,
    data: store,
  };
}
