/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * 689 KTV POS - Full-Stack Real-time Sync Server
 * Provides ultra-fast instant cross-device state synchronization across
 * iOS (iPhone/iPad), Android, and Windows PC.
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(__dirname, '.data');
const STORE_FILE = path.resolve(DATA_DIR, 'store.json');
const DEFAULT_STORE_FILE = path.resolve(DATA_DIR, 'defaultStore.json');

// Ensure storage directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

interface AppStore {
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

function loadInitialStore(): AppStore {
  if (fs.existsSync(STORE_FILE)) {
    try {
      const content = fs.readFileSync(STORE_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.version === 'number') {
        return parsed;
      }
    } catch (err) {
      console.error('Failed to parse existing store.json, using defaults', err);
    }
  }

  if (fs.existsSync(DEFAULT_STORE_FILE)) {
    try {
      const content = fs.readFileSync(DEFAULT_STORE_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed) {
        fs.writeFileSync(STORE_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
        return parsed;
      }
    } catch (e) {
      console.error('Failed to read defaultStore.json', e);
    }
  }

  const defaultStore: AppStore = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    products: [],
    rooms: [],
    packages: [],
    staff: [],
    settings: {
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
    },
    debts: [],
    bills: [],
  };

  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(defaultStore, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write default store.json', e);
  }

  return defaultStore;
}

const store: AppStore = loadInitialStore();

function saveStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving store.json', err);
  }
}

// Active Server-Sent Events (SSE) connections for zero-latency multi-device push
const sseClients = new Set<express.Response>();

function broadcastSse(eventData: any) {
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function startServer() {
  const app = express();

  // Allow JSON parsing up to 25MB for image uploads / bill logos
  app.use(express.json({ limit: '25mb' }));

  // CORS headers
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Serve static uploaded product images
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Vercel Blob Token check endpoint
  app.get('/api/vercel-blob/token', (req, res) => {
    res.json({
      configured: !!process.env.BLOB_READ_WRITE_TOKEN,
      token: process.env.BLOB_READ_WRITE_TOKEN || '',
    });
  });

  // Vercel Blob Server Upload Proxy endpoint
  app.post('/api/vercel-blob/upload', async (req, res) => {
    try {
      const { fileBase64, filename, mimeType } = req.body || {};
      const token = process.env.BLOB_READ_WRITE_TOKEN;

      if (!token) {
        return res.status(500).json({
          success: false,
          error: 'BLOB_READ_WRITE_TOKEN is not configured in server environment variables.',
        });
      }

      if (!fileBase64 || typeof fileBase64 !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing file data' });
      }

      const cleanData = fileBase64.replace(/^data:[a-zA-Z0-9/+-]+;base64,/, '');
      const buffer = Buffer.from(cleanData, 'base64');
      const safeFilename = (filename || `prod_${Date.now()}.jpg`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const uploadPath = `${Date.now()}-${safeFilename}`;
      const uploadUrl = `https://blob.vercel-storage.com/${uploadPath}`;

      const vercelRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'x-api-version': '7',
          'Content-Type': mimeType || 'image/jpeg',
        },
        body: buffer,
      });

      if (!vercelRes.ok) {
        const errorText = await vercelRes.text();
        return res.status(vercelRes.status).json({ success: false, error: errorText });
      }

      const data = await vercelRes.json();
      res.json({
        success: true,
        url: data.url,
        pathname: data.pathname,
      });
    } catch (err: any) {
      console.error('Vercel Blob server proxy error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Image Upload endpoint - saves image to Vercel Blob (or local storage fallback) and returns permanent URL
  app.post('/api/upload-image', async (req, res) => {
    try {
      const { image, filename } = req.body || {};
      if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
        return res.status(400).json({ success: false, error: 'Invalid image data' });
      }

      // Extract image extension from data URI e.g. data:image/png;base64,...
      const match = image.match(/^data:image\/([a-zA-Z0-9+]+);base64,/);
      const ext = match ? (match[1] === 'jpeg' ? 'jpg' : match[1]) : 'jpg';
      const base64Data = image.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      const safeFilename = (filename || `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_');

      // 1. If Vercel Blob token is configured, upload directly to Vercel Blob!
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (token) {
        try {
          const uploadPath = `${Date.now()}-${safeFilename}`;
          const uploadUrl = `https://blob.vercel-storage.com/${uploadPath}`;
          const vercelRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'x-api-version': '7',
              'Content-Type': `image/${ext === 'jpg' ? 'jpeg' : ext}`,
            },
            body: buffer,
          });

          if (vercelRes.ok) {
            const blobData = await vercelRes.json();
            if (blobData && blobData.url) {
              return res.json({
                success: true,
                filename: safeFilename,
                url: blobData.url,
                absoluteUrl: blobData.url,
                storage: 'vercel_blob',
              });
            }
          }
        } catch (vercelErr) {
          console.warn('Vercel Blob upload in /api/upload-image failed, falling back to local file:', vercelErr);
        }
      }

      // 2. Fallback to local server disk storage
      const filePath = path.resolve(UPLOADS_DIR, safeFilename);
      fs.writeFileSync(filePath, buffer);

      // Construct absolute URL (using Host header)
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.get('host');
      const absoluteUrl = `${protocol}://${host}/uploads/${safeFilename}`;
      const relativeUrl = `/uploads/${safeFilename}`;

      res.json({
        success: true,
        filename: safeFilename,
        url: relativeUrl,
        absoluteUrl,
        storage: 'local',
      });
    } catch (err: any) {
      console.error('Image upload error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Google Apps Script CORS Bypass Proxy
  // Server-side fetch eliminates all browser CORS and 302 redirect issues
  app.all('/api/gas-proxy', async (req, res) => {
    try {
      const targetUrl = (req.query.url as string) || (req.body && req.body.url);
      if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.startsWith('http')) {
        return res.status(400).json({ success: false, error: 'Missing or invalid target Google Apps Script URL' });
      }

      // Filter out dummy/placeholder URLs
      if (targetUrl.includes('AKfycbwP7K5U-POS-689KTV-WEBAPP') || targetUrl.includes('AKfycb...')) {
        return res.json({
          success: false,
          error: 'Google Apps Script URL is placeholder (not deployed yet)',
          isPlaceholder: true,
        });
      }

      const method = req.method === 'POST' ? 'POST' : 'GET';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 14000);

      let fetchUrl = targetUrl;
      let fetchOptions: RequestInit = {
        method,
        signal: controller.signal,
        redirect: 'follow', // Automatically follows Google 302 redirects
      };

      if (method === 'GET') {
        const queryParams = new URLSearchParams();
        for (const [k, v] of Object.entries(req.query)) {
          if (k !== 'url') queryParams.append(k, String(v));
        }
        if (queryParams.toString()) {
          fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + queryParams.toString();
        }
        fetchOptions.headers = {
          'Accept': 'application/json, text/plain, */*',
        };
      } else {
        // POST request - send as text/plain so GAS receives it cleanly
        const postData = req.body?.data !== undefined ? req.body : req.body;
        fetchOptions.headers = {
          'Content-Type': 'text/plain;charset=utf-8',
        };
        fetchOptions.body = typeof postData === 'string' ? postData : JSON.stringify(postData);
      }

      const gasResponse = await fetch(fetchUrl, fetchOptions);
      clearTimeout(timeoutId);

      const responseText = await gasResponse.text();
      let responseJson: any = null;
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        // Returned HTML (e.g., Google login page or error)
        if (responseText.includes('accounts.google.com') || responseText.includes('Service Login')) {
          return res.json({
            success: false,
            error: 'Google Apps Script requires authorization. Please set "Who has access" to "Anyone" when deploying.',
          });
        }
        return res.json({
          success: gasResponse.ok,
          message: responseText.slice(0, 500),
        });
      }

      res.json(responseJson);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return res.json({ success: false, error: 'Google Apps Script request timed out (14s)' });
      }
      res.json({ success: false, error: err.message || 'Error connecting to Google Apps Script' });
    }
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      version: store.version,
      lastUpdated: store.lastUpdated,
      clientsCount: sseClients.size,
      time: new Date().toISOString(),
    });
  });

  // Full state query endpoint
  app.get('/api/sync', (req, res) => {
    res.json({
      success: true,
      version: store.version,
      lastUpdated: store.lastUpdated,
      data: store,
    });
  });

  // Lightweight version check endpoint (for high-efficiency polling)
  app.get('/api/sync/version', (req, res) => {
    res.json({
      version: store.version,
      lastUpdated: store.lastUpdated,
    });
  });

  // Helper to safely parse ISO timestamps for conflict resolution
  const parseTs = (val?: string): number => {
    if (!val) return 0;
    const ms = Date.parse(val);
    return Number.isFinite(ms) ? ms : 0;
  };

  // Real-time update mutation endpoint (Granular Merge + Timestamp Guard — Prevents Full State Overwrite)
  app.post('/api/sync', (req, res) => {
    try {
      const { action, data, senderDeviceId, baseVersion } = req.body || {};
      const nowIso = new Date().toISOString();
      const clientBaseVersion = typeof baseVersion === 'number' ? baseVersion : 0;

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
        // 1. Atomic Stock Deductions (from POS checkout, room checkout, split pay, or room transfer)
        if (Array.isArray(data?.stockDeductions) && data.stockDeductions.length > 0) {
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
        const incomingProducts = Array.isArray(data?.changedProducts)
          ? data.changedProducts
          : action === 'saveProducts' && Array.isArray(data?.products)
          ? data.products
          : null;

        if (data?.clearProducts === true) {
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
                if ((exTs > 0 && inTs > 0 && inTs < exTs) || (exTs > 0 && inTs === 0 && clientBaseVersion > 0 && clientBaseVersion < store.version)) {
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
          if (Array.isArray(data?.deletedProductIds) && data.deletedProductIds.length > 0) {
            const delSet = new Set(data.deletedProductIds);
            const filtered = (store.products || []).filter((p: any) => !delSet.has(p.id));
            if (filtered.length !== (store.products || []).length) {
              store.products = filtered;
              hasChanged = true;
            }
          }
        }

        // 3. Granular Rooms Merge (changedRooms + explicit deletedRoomIds)
        const incomingRooms = Array.isArray(data?.changedRooms)
          ? data.changedRooms
          : action === 'saveRooms' && Array.isArray(data?.rooms)
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
              // Timestamp guard: NEVER let older device overwrite newer room state on server
              if (
                (exTs > 0 && inTs > 0 && inTs < exTs) ||
                (exTs > 0 && inTs === 0 && clientBaseVersion > 0 && clientBaseVersion < store.version)
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
        if (Array.isArray(data?.deletedRoomIds) && data.deletedRoomIds.length > 0) {
          const delSet = new Set(data.deletedRoomIds);
          const filtered = (store.rooms || []).filter((r: any) => !delSet.has(r.id));
          if (filtered.length !== (store.rooms || []).length) {
            store.rooms = filtered;
            hasChanged = true;
          }
        }

        // 4. Granular Bills Merge (Upsert single/changed bill — NEVER overwrite full bills array blindly)
        if (data?.clearAllBills === true || action === 'clearAllBills') {
          if ((store.bills || []).length > 0) {
            store.bills = [];
            hasChanged = true;
          }
        } else {
          const billsToUpsert = [
            ...(data?.bill ? [data.bill] : []),
            ...(Array.isArray(data?.changedBills) ? data.changedBills : []),
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
          if (Array.isArray(data?.deletedBillIds) && data.deletedBillIds.length > 0) {
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
        if (data?.clearAllDebts === true) {
          if ((store.debts || []).length > 0) {
            store.debts = [];
            hasChanged = true;
          }
        } else {
          const incomingDebts = Array.isArray(data?.changedDebts)
            ? data.changedDebts
            : action === 'saveDebts' && Array.isArray(data?.debts)
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
          if (Array.isArray(data?.deletedDebtIds) && data.deletedDebtIds.length > 0) {
            const delSet = new Set(data.deletedDebtIds);
            const filtered = (store.debts || []).filter((d: any) => !delSet.has(d.id));
            if (filtered.length !== (store.debts || []).length) {
              store.debts = filtered;
              hasChanged = true;
            }
          }
        }

        // 6. Packages, Staff & Settings
        if (action === 'savePackages' && Array.isArray(data?.packages)) {
          if (JSON.stringify(store.packages) !== JSON.stringify(data.packages)) {
            store.packages = data.packages;
            hasChanged = true;
          }
        }
        if (action === 'saveStaff' && Array.isArray(data?.staff)) {
          if (JSON.stringify(store.staff) !== JSON.stringify(data.staff)) {
            store.staff = data.staff;
            hasChanged = true;
          }
        }
        if (action === 'saveSettings' && data?.settings) {
          const mergedSettings = { ...store.settings, ...data.settings };
          if (JSON.stringify(store.settings) !== JSON.stringify(mergedSettings)) {
            store.settings = mergedSettings;
            hasChanged = true;
          }
        }
      }

      if (hasChanged) {
        store.version += 1;
        store.lastUpdated = nowIso;
        saveStore();

        // Broadcast authoritative merged state instantly to all other connected devices
        broadcastSse({
          type: 'update',
          action,
          version: store.version,
          lastUpdated: store.lastUpdated,
          senderDeviceId: senderDeviceId || 'unknown',
          data: store,
        });
      }

      res.json({
        success: true,
        version: store.version,
        lastUpdated: store.lastUpdated,
        rejectedStale,
        data: store,
      });
    } catch (err: any) {
      console.error('Error handling sync update:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Server-Sent Events (SSE) stream for zero-latency multi-device push
  app.get('/api/sync/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    sseClients.add(res);

    // Initial handshake
    res.write(`data: ${JSON.stringify({ type: 'handshake', version: store.version, lastUpdated: store.lastUpdated })}\n\n`);

    // Heartbeat ping every 15s to keep connections alive on mobile devices (iOS Safari & Android)
    const pingTimer = setInterval(() => {
      try {
        res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`);
      } catch {
        clearInterval(pingTimer);
        sseClients.delete(res);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(pingTimer);
      sseClients.delete(res);
    });
  });

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎤 689 KTV POS Multi-Device Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
