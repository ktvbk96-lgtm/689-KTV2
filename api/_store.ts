import { neon } from '@neondatabase/serverless';

export interface StaffPermissionsPayload {
  posSales: boolean;
  roomManagement: boolean;
  editActiveBill: boolean;
  voidBill: boolean;
  applyDiscount: boolean;
  manageStock: boolean;
  viewReports: boolean;
  manageStaff: boolean;
}

export interface AppStore {
  version: number;
  lastUpdated: string;
  lastUpdatedByDevice?: string;
  lastUpdatedDeviceType?: 'Mobile' | 'Tablet' | 'PC';
  lastSenderId?: string;
  lastAction?: string;
  products: any[];
  rooms: any[];
  packages: any[];
  staff: any[];
  settings: any;
  debts: any[];
  bills: any[];
  stockHistory: any[];
}

const ADMIN_ALL_PERMISSIONS: StaffPermissionsPayload = {
  posSales: true,
  roomManagement: true,
  editActiveBill: true,
  voidBill: true,
  applyDiscount: true,
  manageStock: true,
  viewReports: true,
  manageStaff: true,
};

const DEFAULT_STAFF_PERMISSIONS: StaffPermissionsPayload = {
  posSales: true,
  roomManagement: true,
  editActiveBill: false,
  voidBill: true,
  applyDiscount: false,
  manageStock: true,
  viewReports: true,
  manageStaff: false,
};

const DEFAULT_SETTINGS = {
  shopName: '689 KTV',
  shopBranch: '',
  shopAddress: '',
  shopPhone: '',
  receiptHeader: '689 KTV',
  receiptFooter: 'ຂໍຂອບໃຈລູກຄ້າທີ່ມາອຸດໜູນ!',
  adminPin: '8888',
  staffPin: '1234',
  currencySymbol: '₭',
  defaultHourlyRate: 80000,
  autoSyncGoogleSheets: true,
  realtimeSyncEnabled: true,
};

/**
 * STRICT ZERO MOCK DATA:
 * Returns purely empty collections [] when Neon Postgres has no records yet.
 */
function createEmptyStore(): AppStore {
  return {
    version: 0,
    lastUpdated: '',
    lastUpdatedByDevice: '',
    lastUpdatedDeviceType: undefined,
    lastSenderId: '',
    lastAction: '',
    products: [],
    rooms: [],
    packages: [],
    staff: [],
    settings: { ...DEFAULT_SETTINGS },
    debts: [],
    bills: [],
    stockHistory: [],
  };
}

export function hasNeonDatabase(): boolean {
  const url = process.env.DATABASE_URL;
  return Boolean(url && url.trim().length > 0);
}

export function parseTs(val?: string | null): number {
  if (!val) return 0;
  const ms = Date.parse(val);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeStaffRow(s: any): any {
  const role = s?.role === 'admin' ? 'admin' : 'staff';
  const permissions =
    role === 'admin'
      ? { ...ADMIN_ALL_PERMISSIONS }
      : { ...DEFAULT_STAFF_PERMISSIONS, ...(s?.permissions || {}) };
  return {
    id: String(s?.id || ''),
    name: String(s?.name || ''),
    role,
    pin: s?.pin ? String(s.pin) : '',
    phone: s?.phone ? String(s.phone) : '',
    active: s?.active !== false,
    permissions,
    updatedAt: s?.updatedAt || s?.updated_at || new Date().toISOString(),
  };
}

function getSqlClient() {
  const url = process.env.DATABASE_URL;
  if (!url || !url.trim()) {
    return null;
  }
  return neon(url.trim());
}

let tablesInitialized = false;

/**
 * Safely auto-creates tables via CREATE TABLE IF NOT EXISTS.
 * NEVER uses DROP or TRUNCATE.
 */
async function ensureTablesExist(sql: ReturnType<typeof neon<false, false>>): Promise<void> {
  if (tablesInitialized) return;

  await sql`
    CREATE TABLE IF NOT EXISTS ktv_store_state (
      store_key TEXT PRIMARY KEY,
      version BIGINT NOT NULL DEFAULT 1,
      last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      data JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ktv_staff_permissions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      pin TEXT,
      phone TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  tablesInitialized = true;
}

function parseJsonField(val: any): any {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return {};
    }
  }
  return val && typeof val === 'object' ? val : {};
}

async function syncStaffTableUpsert(
  sql: ReturnType<typeof neon<false, false>>,
  staffList: any[],
  deletedStaffIds?: string[]
): Promise<void> {
  for (const raw of staffList) {
    if (!raw?.id || !raw?.name) continue;
    const s = normalizeStaffRow(raw);
    const permsJson = JSON.stringify(s.permissions);
    const updatedIso = s.updatedAt || new Date().toISOString();

    await sql`
      INSERT INTO ktv_staff_permissions (id, name, role, pin, phone, active, permissions, updated_at)
      VALUES (${s.id}, ${s.name}, ${s.role}, ${s.pin || null}, ${s.phone || null}, ${s.active}, ${permsJson}::jsonb, ${updatedIso}::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        pin = EXCLUDED.pin,
        phone = EXCLUDED.phone,
        active = EXCLUDED.active,
        permissions = EXCLUDED.permissions,
        updated_at = EXCLUDED.updated_at
    `;
  }

  // Mark removed non-admin staff inactive instead of running destructive SQL DELETE
  if (Array.isArray(deletedStaffIds) && deletedStaffIds.length > 0) {
    for (const delId of deletedStaffIds) {
      if (!delId) continue;
      await sql`
        UPDATE ktv_staff_permissions
        SET active = FALSE, updated_at = NOW()
        WHERE id = ${String(delId)} AND role <> 'admin'
      `;
    }
  }
}

/**
 * GET /api/sync helper — Read-Only from Neon Postgres.
 * If DATABASE_URL is absent (Preview mode), returns mode: 'local_preview' without touching any DB.
 */
export async function readAuthoritativeStore(): Promise<{
  mode: 'neon_postgres' | 'local_preview';
  hasDatabase: boolean;
  store: AppStore | null;
  effectiveVersion: number;
}> {
  const sql = getSqlClient();
  if (!sql) {
    return {
      mode: 'local_preview',
      hasDatabase: false,
      store: null,
      effectiveVersion: 0,
    };
  }

  await ensureTablesExist(sql);

  const [stateRows, staffRows] = await Promise.all([
    sql`
      SELECT version, last_updated, data
      FROM ktv_store_state
      WHERE store_key = 'main'
      LIMIT 1
    `,
    sql`
      SELECT id, name, role, pin, phone, active, permissions, updated_at
      FROM ktv_staff_permissions
      ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id ASC
    `,
  ]);

  const store = createEmptyStore();

  if (Array.isArray(stateRows) && stateRows.length > 0) {
    const row: any = stateRows[0];
    const data = parseJsonField(row.data);
    const ver = Number(row.version) || 1;
    const lastUpd = row.last_updated
      ? new Date(row.last_updated).toISOString()
      : typeof data.lastUpdated === 'string'
      ? data.lastUpdated
      : '';

    store.version = ver;
    store.lastUpdated = lastUpd;
    store.lastUpdatedByDevice = typeof data.lastUpdatedByDevice === 'string' ? data.lastUpdatedByDevice : '';
    store.lastUpdatedDeviceType =
      data.lastUpdatedDeviceType === 'Mobile' ||
      data.lastUpdatedDeviceType === 'Tablet' ||
      data.lastUpdatedDeviceType === 'PC'
        ? data.lastUpdatedDeviceType
        : undefined;
    store.lastSenderId = typeof data.lastSenderId === 'string' ? data.lastSenderId : '';
    store.lastAction = typeof data.lastAction === 'string' ? data.lastAction : '';
    store.products = Array.isArray(data.products) ? data.products : [];
    store.rooms = Array.isArray(data.rooms) ? data.rooms : [];
    store.packages = Array.isArray(data.packages) ? data.packages : [];
    store.staff = Array.isArray(data.staff) ? data.staff.map(normalizeStaffRow) : [];
    store.settings =
      data.settings && typeof data.settings === 'object'
        ? { ...DEFAULT_SETTINGS, ...data.settings }
        : { ...DEFAULT_SETTINGS };
    store.debts = Array.isArray(data.debts) ? data.debts : [];
    store.bills = Array.isArray(data.bills) ? data.bills : [];
    store.stockHistory = Array.isArray(data.stockHistory) ? data.stockHistory : [];
  }

  // Hydrate staff & granular permissions directly from ktv_staff_permissions table if populated
  if (Array.isArray(staffRows) && staffRows.length > 0) {
    store.staff = staffRows.map((r: any) =>
      normalizeStaffRow({
        id: r.id,
        name: r.name,
        role: r.role,
        pin: r.pin,
        phone: r.phone,
        active: r.active,
        permissions: parseJsonField(r.permissions),
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
      })
    );
  }

  return {
    mode: 'neon_postgres',
    hasDatabase: true,
    store,
    effectiveVersion: store.version,
  };
}

/**
 * Lightweight GET /api/sync/version helper from Neon Postgres.
 */
export async function readStoreVersion(): Promise<{
  mode: 'neon_postgres' | 'local_preview';
  hasDatabase: boolean;
  version: number;
  lastUpdated: string;
  lastUpdatedByDevice?: string;
  lastUpdatedDeviceType?: 'Mobile' | 'Tablet' | 'PC';
  lastSenderId?: string;
  lastAction?: string;
}> {
  const sql = getSqlClient();
  if (!sql) {
    return {
      mode: 'local_preview',
      hasDatabase: false,
      version: 0,
      lastUpdated: '',
    };
  }

  await ensureTablesExist(sql);

  const rows = await sql`
    SELECT
      version,
      last_updated,
      data->>'lastUpdatedByDevice' AS last_updated_by_device,
      data->>'lastUpdatedDeviceType' AS last_updated_device_type,
      data->>'lastSenderId' AS last_sender_id,
      data->>'lastAction' AS last_action
    FROM ktv_store_state
    WHERE store_key = 'main'
    LIMIT 1
  `;

  if (Array.isArray(rows) && rows.length > 0) {
    const row: any = rows[0];
    const devType =
      row.last_updated_device_type === 'Mobile' ||
      row.last_updated_device_type === 'Tablet' ||
      row.last_updated_device_type === 'PC'
        ? row.last_updated_device_type
        : undefined;
    return {
      mode: 'neon_postgres',
      hasDatabase: true,
      version: Number(row.version) || 1,
      lastUpdated: row.last_updated ? new Date(row.last_updated).toISOString() : '',
      lastUpdatedByDevice: row.last_updated_by_device || '',
      lastUpdatedDeviceType: devType,
      lastSenderId: row.last_sender_id || '',
      lastAction: row.last_action || '',
    };
  }

  return {
    mode: 'neon_postgres',
    hasDatabase: true,
    version: 0,
    lastUpdated: '',
  };
}

function mergeArrayById(existing: any[], incoming: any[], nowIso: string, preserveImage = false): any[] {
  const result = [...existing];
  for (const inc of incoming) {
    if (!inc?.id) continue;
    const idx = result.findIndex((item) => item.id === inc.id);
    if (idx === -1) {
      result.push({ ...inc, updatedAt: inc.updatedAt || nowIso });
    } else {
      const ex = result[idx];
      const merged = preserveImage
        ? { ...ex, ...inc, imageUrl: inc.imageUrl || ex.imageUrl || '', updatedAt: inc.updatedAt || nowIso }
        : { ...ex, ...inc, updatedAt: inc.updatedAt || nowIso };
      result[idx] = merged;
    }
  }
  return result;
}

function mergeBillsByIdOrNumber(existing: any[], incoming: any[], nowIso: string): any[] {
  const result = [...existing];
  for (const inc of incoming) {
    if (!inc?.id) continue;
    const trimNum = String(inc.billNumber || '').trim();
    const idx = result.findIndex(
      (b) => b.id === inc.id || (trimNum && String(b.billNumber || '').trim() === trimNum)
    );
    const stamped = { ...inc, updatedAt: inc.updatedAt || nowIso };
    if (idx === -1) {
      result.unshift(stamped);
    } else {
      result[idx] = { ...result[idx], ...stamped };
    }
  }
  return result;
}

/**
 * POST /api/sync — Read-First Granular Merge + Strict Anti-Empty-Overwrite Protection into Neon Postgres.
 */
export async function applyGranularMergeAndSave(body: any): Promise<{
  success: boolean;
  mode: 'neon_postgres' | 'local_preview';
  hasDatabase: boolean;
  skippedRemoteWrite?: boolean;
  version: number;
  lastUpdated: string;
  rejectedStale: boolean;
  data: AppStore | null;
}> {
  const sql = getSqlClient();
  if (!sql) {
    // Preview mode without DATABASE_URL -> operate strictly in browser localStorage, never touch real DB
    return {
      success: true,
      mode: 'local_preview',
      hasDatabase: false,
      skippedRemoteWrite: true,
      version: 0,
      lastUpdated: new Date().toISOString(),
      rejectedStale: false,
      data: null,
    };
  }

  const { action, data, baseVersion, senderDeviceId, deviceType, deviceLabel } = body || {};
  const { store: existingStore, effectiveVersion } = await readAuthoritativeStore();
  const store = existingStore || createEmptyStore();
  const nowIso = new Date().toISOString();
  const clientBaseVersion = typeof baseVersion === 'number' ? baseVersion : 0;

  if (!action || !data || typeof data !== 'object' || Object.keys(data).length === 0) {
    return {
      success: false,
      mode: 'neon_postgres',
      hasDatabase: true,
      version: effectiveVersion,
      lastUpdated: store.lastUpdated,
      rejectedStale: true,
      data: store,
    };
  }

  // HARD PROTECTION RULE 2: Never allow blind wipe/reset actions or empty [] overwrites
  if (
    action === 'resetAll' ||
    action === 'clearAll' ||
    action === 'clearAllBills' ||
    data.clearProducts === true ||
    data.clearAllBills === true ||
    data.clearAllDebts === true
  ) {
    return {
      success: false,
      mode: 'neon_postgres',
      hasDatabase: true,
      version: effectiveVersion,
      lastUpdated: store.lastUpdated,
      rejectedStale: true,
      data: store,
    };
  }

  // Reject empty-array overwrite attempts when DB already holds data
  const emptyOverwriteBlocked =
    (Array.isArray(data.products) && data.products.length === 0 && store.products.length > 0) ||
    (Array.isArray(data.rooms) && data.rooms.length === 0 && store.rooms.length > 0) ||
    (Array.isArray(data.packages) && data.packages.length === 0 && store.packages.length > 0) ||
    (Array.isArray(data.staff) && data.staff.length === 0 && store.staff.length > 0) ||
    (Array.isArray(data.bills) && data.bills.length === 0 && store.bills.length > 0) ||
    (Array.isArray(data.debts) && data.debts.length === 0 && store.debts.length > 0) ||
    (Array.isArray(data.stockHistory) && data.stockHistory.length === 0 && (store.stockHistory || []).length > 0);
  if (emptyOverwriteBlocked) {
    return {
      success: false,
      mode: 'neon_postgres',
      hasDatabase: true,
      version: effectiveVersion,
      lastUpdated: store.lastUpdated,
      rejectedStale: true,
      data: store,
    };
  }

  let hasChanged = false;
  let rejectedStale = false;
  let staffChanged = false;
  let deletedStaffIds: string[] = [];

  // Explicit "Upload Local Device Data to Cloud" (Non-destructive merge: NEVER overwrites cloud with empty [])
  if (action === 'uploadLocalToCloud') {
    if (Array.isArray(data.products) && data.products.length > 0) {
      const merged = mergeArrayById(store.products, data.products, nowIso, true);
      if (JSON.stringify(store.products) !== JSON.stringify(merged)) {
        store.products = merged;
        hasChanged = true;
      }
    }
    if (Array.isArray(data.rooms) && data.rooms.length > 0) {
      const merged = mergeArrayById(store.rooms, data.rooms, nowIso);
      if (JSON.stringify(store.rooms) !== JSON.stringify(merged)) {
        store.rooms = merged;
        hasChanged = true;
      }
    }
    if (Array.isArray(data.packages) && data.packages.length > 0) {
      const merged = mergeArrayById(store.packages, data.packages, nowIso);
      if (JSON.stringify(store.packages) !== JSON.stringify(merged)) {
        store.packages = merged;
        hasChanged = true;
      }
    }
    if (Array.isArray(data.staff) && data.staff.length > 0) {
      const normalizedIncoming = data.staff.map(normalizeStaffRow);
      const merged = mergeArrayById(store.staff, normalizedIncoming, nowIso).map(normalizeStaffRow);
      if (JSON.stringify(store.staff) !== JSON.stringify(merged)) {
        store.staff = merged;
        hasChanged = true;
        staffChanged = true;
      }
    }
    if (Array.isArray(data.debts) && data.debts.length > 0) {
      const merged = mergeArrayById(store.debts, data.debts, nowIso);
      if (JSON.stringify(store.debts) !== JSON.stringify(merged)) {
        store.debts = merged;
        hasChanged = true;
      }
    }
    if (Array.isArray(data.bills) && data.bills.length > 0) {
      const merged = mergeBillsByIdOrNumber(store.bills, data.bills, nowIso);
      if (JSON.stringify(store.bills) !== JSON.stringify(merged)) {
        store.bills = merged;
        hasChanged = true;
      }
    }
    if (Array.isArray(data.stockHistory) && data.stockHistory.length > 0) {
      const merged = mergeArrayById(store.stockHistory || [], data.stockHistory, nowIso);
      if (JSON.stringify(store.stockHistory || []) !== JSON.stringify(merged)) {
        store.stockHistory = merged;
        hasChanged = true;
      }
    }
    if (data.settings && typeof data.settings === 'object') {
      const mergedSettings = { ...store.settings, ...data.settings };
      if (JSON.stringify(store.settings) !== JSON.stringify(mergedSettings)) {
        store.settings = mergedSettings;
        hasChanged = true;
      }
    }
  } else {
    // 1. Atomic Stock Deductions
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

    // 2. Granular Products Merge (NEVER wipe products with empty [])
    const incomingProducts = Array.isArray(data.changedProducts)
      ? data.changedProducts
      : action === 'saveProducts' && Array.isArray(data.products) && data.products.length > 0
      ? data.products
      : null;

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

    // 3. Granular Rooms Merge (NEVER wipe rooms with empty [])
    const incomingRooms = Array.isArray(data.changedRooms)
      ? data.changedRooms
      : action === 'saveRooms' && Array.isArray(data.rooms) && data.rooms.length > 0
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

    // 4. Granular Bills Merge (NEVER wipe all bills with empty [])
    const billsToUpsert = [
      ...(data.bill ? [data.bill] : []),
      ...(Array.isArray(data.changedBills) ? data.changedBills : []),
    ];
    if (billsToUpsert.length > 0) {
      const current = [...(store.bills || [])];
      for (const inc of billsToUpsert) {
        if (!inc?.id) continue;
        const trimNum = String(inc.billNumber || '').trim();
        const idx = current.findIndex(
          (b: any) => b.id === inc.id || (trimNum && String(b.billNumber || '').trim() === trimNum)
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

    // 5. Granular Debts Merge (NEVER wipe debts with empty [])
    const incomingDebts = Array.isArray(data.changedDebts)
      ? data.changedDebts
      : action === 'saveDebts' && Array.isArray(data.debts) && data.debts.length > 0
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

    // 6. Packages (NEVER overwrite with empty [])
    if (action === 'savePackages' && Array.isArray(data.packages) && data.packages.length > 0) {
      if (JSON.stringify(store.packages) !== JSON.stringify(data.packages)) {
        store.packages = data.packages;
        hasChanged = true;
      }
    }

    // 7. Staff & Granular Permissions (NEVER wipe staff with empty []; Admin always retains all permissions)
    if (action === 'saveStaff' && Array.isArray(data.staff) && data.staff.length > 0) {
      const incomingNormalized = data.staff.map(normalizeStaffRow);
      // Protect any existing admin account from accidental deletion
      const prevIds = new Set((store.staff || []).map((s: any) => s.id));
      const nextIds = new Set(incomingNormalized.map((s: any) => s.id));
      deletedStaffIds = Array.from(prevIds).filter((id) => !nextIds.has(id));

      if (JSON.stringify(store.staff) !== JSON.stringify(incomingNormalized)) {
        store.staff = incomingNormalized;
        hasChanged = true;
        staffChanged = true;
      }
    }

    // 8. Settings
    if (action === 'saveSettings' && data.settings && typeof data.settings === 'object') {
      const mergedSettings = { ...store.settings, ...data.settings };
      if (JSON.stringify(store.settings) !== JSON.stringify(mergedSettings)) {
        store.settings = mergedSettings;
        hasChanged = true;
      }
    }

    // 9. Granular Stock Restock History Merge (Additive — NEVER wipes existing history with empty [])
    const incomingStockHistory = Array.isArray(data.changedStockHistory)
      ? data.changedStockHistory
      : action === 'saveStockHistory' && Array.isArray(data.stockHistory) && data.stockHistory.length > 0
      ? data.stockHistory
      : null;

    if (incomingStockHistory && incomingStockHistory.length > 0) {
      const current = [...(store.stockHistory || [])];
      for (const inc of incomingStockHistory) {
        if (!inc?.id) continue;
        const idx = current.findIndex((h: any) => h.id === inc.id);
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
      store.stockHistory = current;
    }
    if (Array.isArray(data.deletedStockHistoryIds) && data.deletedStockHistoryIds.length > 0) {
      const delSet = new Set(data.deletedStockHistoryIds);
      const filtered = (store.stockHistory || []).filter((h: any) => !delSet.has(h.id));
      if (filtered.length !== (store.stockHistory || []).length) {
        store.stockHistory = filtered;
        hasChanged = true;
      }
    }
  }

  let nextVersion = effectiveVersion;

  if (hasChanged) {
    nextVersion = (Number(store.version) || 0) + 1;
    store.version = nextVersion;
    store.lastUpdated = nowIso;
    if (typeof senderDeviceId === 'string' && senderDeviceId.trim()) {
      store.lastSenderId = senderDeviceId.trim();
    }
    if (deviceType === 'Mobile' || deviceType === 'Tablet' || deviceType === 'PC') {
      store.lastUpdatedDeviceType = deviceType;
    }
    if (typeof deviceLabel === 'string' && deviceLabel.trim()) {
      store.lastUpdatedByDevice = deviceLabel.trim();
    } else if (store.lastUpdatedDeviceType) {
      store.lastUpdatedByDevice = store.lastUpdatedDeviceType;
    }
    store.lastAction = String(action);

    if (staffChanged) {
      await syncStaffTableUpsert(sql, store.staff, deletedStaffIds);
    }

    const payloadJson = JSON.stringify(store);
    await sql`
      INSERT INTO ktv_store_state (store_key, version, last_updated, data)
      VALUES ('main', ${nextVersion}, ${nowIso}::timestamptz, ${payloadJson}::jsonb)
      ON CONFLICT (store_key) DO UPDATE SET
        version = EXCLUDED.version,
        last_updated = EXCLUDED.last_updated,
        data = EXCLUDED.data
    `;
  }

  return {
    success: true,
    mode: 'neon_postgres',
    hasDatabase: true,
    version: nextVersion,
    lastUpdated: store.lastUpdated,
    rejectedStale,
    data: store,
  };
}
