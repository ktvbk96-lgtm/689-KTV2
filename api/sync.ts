import { readAuthoritativeStore, applyGranularMergeAndSave } from './_store';

function setCorsAndNoCache(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
}

export default async function handler(req: any, res: any) {
  setCorsAndNoCache(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const { store, effectiveVersion } = await readAuthoritativeStore();
      return res.status(200).json({
        success: true,
        version: effectiveVersion,
        lastUpdated: store.lastUpdated,
        data: store,
      });
    } catch (err: any) {
      console.error('GET /api/sync error:', err);
      return res.status(500).json({
        success: false,
        error: err?.message || 'Failed to read authoritative store',
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const result = await applyGranularMergeAndSave(body);
      return res.status(200).json(result);
    } catch (err: any) {
      console.error('POST /api/sync error:', err);
      return res.status(500).json({
        success: false,
        error: err?.message || 'Failed to save sync mutation',
      });
    }
  }

  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
}
