export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({
    configured: !!process.env.BLOB_READ_WRITE_TOKEN,
    token: process.env.BLOB_READ_WRITE_TOKEN || '',
  });
}
