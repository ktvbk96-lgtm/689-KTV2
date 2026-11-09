/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * 689 KTV - Vercel Blob Storage Integration
 * Direct HTTP PUT upload to Vercel Blob Storage CDN
 * https://blob.vercel-storage.com/${Date.now()}-${file.name}
 */

// 1. Token from environment variable as specified by user
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

/**
 * Uploads a file directly to Vercel Blob Storage.
 * - HTTP PUT request to: https://blob.vercel-storage.com/${Date.now()}-${file.name}
 * - Headers:
 *     'Authorization': `Bearer ${BLOB_READ_WRITE_TOKEN}`
 *     'x-api-version': '7'
 * - Returns the resulting CDN URL from response JSON `data.url`
 */
export async function uploadToVercelBlob(file: File): Promise<string> {
  // 1. Resolve token: use process.env.BLOB_READ_WRITE_TOKEN or fetch from server endpoint if client bundle lacks it
  let token = BLOB_READ_WRITE_TOKEN;
  if (!token) {
    try {
      const res = await fetch('/api/vercel-blob/token');
      if (res.ok) {
        const json = await res.json();
        if (json?.token) {
          token = json.token;
        }
      }
    } catch {
      // server fetch failed, will handle below
    }
  }

  // Sanitize filename to ensure valid URL encoding
  const sanitizedName = file.name ? file.name.replace(/[^a-zA-Z0-9._-]/g, '_') : 'image.jpg';
  const blobPathname = `${Date.now()}-${sanitizedName}`;
  const blobEndpoint = `https://blob.vercel-storage.com/${blobPathname}`;

  // If token is missing, attempt server-side proxy upload
  if (!token) {
    console.warn('BLOB_READ_WRITE_TOKEN is not set in environment. Attempting server proxy upload...');
    const proxyUrl = await uploadViaServerProxy(file, sanitizedName);
    if (proxyUrl) return proxyUrl;
    throw new Error('ກະລຸນາຕັ້ງຄ່າ BLOB_READ_WRITE_TOKEN ໃນ Environment Variables ກ່ອນອັບໂຫຼດ');
  }

  try {
    // 2. Direct HTTP PUT request to Vercel Blob Storage
    const response = await fetch(blobEndpoint, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-api-version': '7',
      },
      body: file,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Direct Vercel Blob PUT returned ${response.status}: ${errorText}. Attempting server proxy fallback...`);
      const fallbackUrl = await uploadViaServerProxy(file, sanitizedName);
      if (fallbackUrl) return fallbackUrl;
      throw new Error(`ອັບໂຫຼດ Vercel Blob ບໍ່ສຳເລັດ (${response.status}): ${errorText.slice(0, 150)}`);
    }

    // 3. Receive JSON response and extract the `url` field
    const data = await response.json();
    if (!data || !data.url) {
      throw new Error('Vercel Blob ຕອບກັບມາແຕ່ບໍ່ພົບຟິວ "url" ໃນ JSON');
    }

    return data.url;
  } catch (err: any) {
    // Fallback through server proxy in case of browser network/CORS restrictions
    const proxyUrl = await uploadViaServerProxy(file, sanitizedName);
    if (proxyUrl) return proxyUrl;
    throw err;
  }
}

/**
 * Fallback server-side proxy in case client directly calling Vercel Blob meets CORS or missing bundle token
 */
async function uploadViaServerProxy(file: File, filename: string): Promise<string | null> {
  try {
    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve((reader.result as string) || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const fileBase64 = await base64Promise;
    if (!fileBase64) return null;

    const res = await fetch('/api/vercel-blob/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename,
        fileBase64,
        mimeType: file.type || 'image/jpeg',
      }),
    });

    if (res.ok) {
      const json = await res.json();
      if (json.success && json.url) {
        return json.url;
      }
    }
  } catch (err) {
    console.warn('Server proxy upload failed:', err);
  }
  return null;
}
