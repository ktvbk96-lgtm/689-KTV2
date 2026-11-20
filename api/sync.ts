import { readAuthoritativeStore, applyGranularMergeAndSave } from './_store.js';

function setCorsAndNoCache(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
}

async function parseJsonBody(req: any): Promise<any> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      return req.body.trim() ? JSON.parse(req.body) : {};
    }
    if (Buffer.isBuffer(req.body)) {
      const str = req.body.toString('utf-8').trim();
      return str ? JSON.parse(str) : {};
    }
    if (typeof req.body === 'object') {
      return req.body;
    }
  }

  // Fallback for raw Node.js IncomingMessage streams when body wasn't pre-parsed
  if (req && typeof req.on === 'function' && !req.readableEnded) {
    const raw = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
    return raw.trim() ? JSON.parse(raw) : {};
  }

  return {};
}

export default async function handler(req: any, res: any) {
  setCorsAndNoCache(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const result = await readAuthoritativeStore();
      return res.status(200).json({
        success: true,
        mode: result.mode,
        hasDatabase: result.hasDatabase,
        version: result.effectiveVersion,
        lastUpdated: result.store?.lastUpdated || '',
        lastUpdatedByDevice: result.store?.lastUpdatedByDevice || '',
        lastUpdatedDeviceType: result.store?.lastUpdatedDeviceType,
        lastSenderId: result.store?.lastSenderId || '',
        lastAction: result.store?.lastAction || '',
        data: result.store,
      });
    } catch (err: any) {
      console.error('GET /api/sync Neon Postgres error:', err);
      return res.status(500).json({
        success: false,
        error: err?.message || 'Failed to read from Neon Postgres',
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const result = await applyGranularMergeAndSave(body);
      return res.status(200).json(result);
    } catch (err: any) {
      console.error('POST /api/sync Neon Postgres error:', err);
      return res.status(500).json({
        success: false,
        error: err?.message || 'Failed to save to Neon Postgres',
      });
    }
  }

  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
}
