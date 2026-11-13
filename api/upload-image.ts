import { put } from '@vercel/blob';
import fs from 'fs';
import path from 'path';

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
    const { image, filename } = body;
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return res.status(400).json({ success: false, error: 'Invalid image data' });
    }

    const match = image.match(/^data:image\/([a-zA-Z0-9+]+);base64,/);
    const ext = match ? (match[1] === 'jpeg' ? 'jpg' : match[1]) : 'jpg';
    const base64Data = image.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const safeFilename = (
      filename || `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`
    ).replace(/[^a-zA-Z0-9._-]/g, '_');

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (token) {
      try {
        const uploadPath = `${Date.now()}-${safeFilename}`;
        const blob = await put(uploadPath, buffer, {
          access: 'public',
          contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
          token,
        });
        if (blob?.url) {
          return res.status(200).json({
            success: true,
            filename: safeFilename,
            url: blob.url,
            absoluteUrl: blob.url,
            storage: 'vercel_blob',
          });
        }
      } catch (vercelErr) {
        console.warn('Vercel Blob upload in /api/upload-image failed:', vercelErr);
      }
    }

    // Local writable fallback (for local dev when BLOB_READ_WRITE_TOKEN is absent)
    const uploadsDir = path.resolve(process.cwd(), '.data', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const filePath = path.resolve(uploadsDir, safeFilename);
    fs.writeFileSync(filePath, buffer);

    const protocol = req.headers?.['x-forwarded-proto'] || 'https';
    const host = req.headers?.host || 'localhost:3000';
    const relativeUrl = `/uploads/${safeFilename}`;
    const absoluteUrl = `${protocol}://${host}${relativeUrl}`;

    return res.status(200).json({
      success: true,
      filename: safeFilename,
      url: relativeUrl,
      absoluteUrl,
      storage: 'local',
    });
  } catch (err: any) {
    console.error('Image upload error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Upload failed' });
  }
}
