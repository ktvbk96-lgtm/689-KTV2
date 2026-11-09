/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * 689 KTV - Image Utilities & Absolute URL Normalizer
 * Ensures all product images across PC, tablet, and mobile devices
 * are served as valid absolute HTTPS URLs or portable data URIs without 404 errors.
 */

/**
 * Normalizes an image URL so it is always an absolute URL accessible from any device.
 * Converts relative paths (e.g., '/uploads/img.jpg') to full absolute URLs ('https://host/uploads/img.jpg').
 */
export function normalizeImageUrl(url?: string | null): string {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (!trimmed) return '';

  // 1. If already an absolute HTTPS/HTTP URL or Data URI, return as-is
  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('data:image/')
  ) {
    return trimmed;
  }

  // 2. Filter out invalid local disk paths (e.g. C:\..., D:\..., file://...)
  if (/^[a-zA-Z]:\\/.test(trimmed) || trimmed.startsWith('file://')) {
    console.warn('Invalid local disk path detected in image URL:', trimmed);
    return '';
  }

  // 3. Convert relative path (e.g., '/uploads/xyz.jpg' or 'uploads/xyz.jpg') to absolute URL
  if (typeof window !== 'undefined' && window.location) {
    const origin = window.location.origin;
    if (trimmed.startsWith('/')) {
      return `${origin}${trimmed}`;
    }
    return `${origin}/${trimmed}`;
  }

  return trimmed;
}

/**
 * Compress an image file to a lightweight Base64 string (max 400x400)
 * to keep sizes tiny (~15-30KB) and prevent storage bloat.
 */
export async function compressImage(file: File, maxDim = 400, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Upload an image to the backend server's /api/upload-image endpoint.
 * Returns the full permanent absolute HTTPS URL so all devices (PC, tablets) see the image.
 * Falls back to compressed base64 if offline.
 */
export async function uploadProductImage(fileOrBase64: File | string, filenameHint?: string): Promise<string> {
  let base64Data: string;

  if (typeof fileOrBase64 === 'string') {
    base64Data = fileOrBase64;
  } else {
    // Compress first to keep network payload light
    try {
      base64Data = await compressImage(fileOrBase64, 480, 0.82);
    } catch {
      base64Data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string) || '');
        reader.readAsDataURL(fileOrBase64);
      });
    }
  }

  if (!base64Data || !base64Data.startsWith('data:image/')) {
    return normalizeImageUrl(base64Data);
  }

  try {
    const response = await fetch('/api/upload-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: base64Data,
        filename: filenameHint || `prod_${Date.now()}.jpg`,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.absoluteUrl) {
        return data.absoluteUrl;
      }
      if (data.success && data.url) {
        return normalizeImageUrl(data.url);
      }
    }
  } catch (err) {
    console.warn('Direct upload to /api/upload-image failed, using compressed base64 fallback:', err);
  }

  // Fallback to compressed base64 data URI
  return base64Data;
}
