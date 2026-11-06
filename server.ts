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

  // Real-time update mutation endpoint
  app.post('/api/sync', (req, res) => {
    try {
      const { action, data, senderDeviceId } = req.body || {};

      let hasChanged = false;

      if (action === 'saveRooms' && Array.isArray(data?.rooms)) {
        store.rooms = data.rooms;
        hasChanged = true;
      } else if (action === 'saveProducts' && Array.isArray(data?.products)) {
        store.products = data.products;
        hasChanged = true;
      } else if (action === 'savePackages' && Array.isArray(data?.packages)) {
        store.packages = data.packages;
        hasChanged = true;
      } else if (action === 'saveStaff' && Array.isArray(data?.staff)) {
        store.staff = data.staff;
        hasChanged = true;
      } else if (action === 'saveDebts' && Array.isArray(data?.debts)) {
        store.debts = data.debts;
        hasChanged = true;
      } else if (action === 'saveSettings' && data?.settings) {
        store.settings = { ...store.settings, ...data.settings };
        hasChanged = true;
      } else if (action === 'saveBill' && data?.bill) {
        store.bills = [data.bill, ...(store.bills || [])];
        hasChanged = true;
      } else if (action === 'saveBills' && Array.isArray(data?.bills)) {
        store.bills = data.bills;
        hasChanged = true;
      } else if ((action === 'syncAll' || action === 'clearAll' || action === 'resetAll') && data) {
        if (Array.isArray(data.rooms)) store.rooms = data.rooms;
        if (Array.isArray(data.products)) store.products = data.products;
        if (Array.isArray(data.packages)) store.packages = data.packages;
        if (Array.isArray(data.staff)) store.staff = data.staff;
        if (Array.isArray(data.debts)) store.debts = data.debts;
        if (data.settings) store.settings = { ...store.settings, ...data.settings };
        if (Array.isArray(data.bills)) store.bills = data.bills;
        hasChanged = true;
      }

      if (hasChanged) {
        store.version += 1;
        store.lastUpdated = new Date().toISOString();
        saveStore();

        // Broadcast change notification instantly to iOS, Android & Windows clients
        broadcastSse({
          type: 'update',
          action,
          version: store.version,
          lastUpdated: store.lastUpdated,
          senderDeviceId: senderDeviceId || 'unknown',
          data,
        });
      }

      res.json({
        success: true,
        version: store.version,
        lastUpdated: store.lastUpdated,
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
