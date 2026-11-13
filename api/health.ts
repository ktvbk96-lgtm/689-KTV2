import { readStoreVersion } from './_store';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const info = await readStoreVersion();
    return res.status(200).json({
      status: 'ok',
      version: info.version,
      lastUpdated: info.lastUpdated,
      time: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      error: err?.message || 'Health check failed',
    });
  }
}
