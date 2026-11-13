import { put } from '@vercel/blob';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { fileBase64, filename, mimeType } = body;
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

    const blob = await put(uploadPath, buffer, {
      access: 'public',
      contentType: mimeType || 'image/jpeg',
      token,
    });

    return res.status(200).json({
      success: true,
      url: blob.url,
      pathname: blob.pathname,
    });
  } catch (err: any) {
    console.error('Vercel Blob upload error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Upload failed' });
  }
}
