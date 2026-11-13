import { readStoreVersion } from '../_store';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const info = await readStoreVersion();
    return res.status(200).json({
      version: info.version,
      lastUpdated: info.lastUpdated,
    });
  } catch (err: any) {
    console.error('GET /api/sync/version error:', err);
    return res.status(500).json({
      error: err?.message || 'Failed to read sync version',
    });
  }
}
