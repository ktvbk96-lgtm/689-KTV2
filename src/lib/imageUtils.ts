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

import { uploadToVercelBlob } from './vercelBlob';
export { uploadToVercelBlob };

/**
 * Upload an image directly to Vercel Blob Storage CDN.
 * Returns the permanent HTTPS URL (e.g. https://...public.blob.vercel-storage.com/...)
 * so all devices (PC, tablet, mobile) can view the image with zero 404 or path issues.
 */
export async function uploadProductImage(fileOrBase64: File | string, filenameHint?: string): Promise<string> {
  // If already an absolute HTTPS URL (e.g. Vercel Blob or CDN), return directly
  if (typeof fileOrBase64 === 'string') {
    const trimmed = fileOrBase64.trim();
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
      return trimmed;
    }
  }

  // 1. If File object, upload directly to Vercel Blob
  if (fileOrBase64 instanceof File) {
    try {
      const vercelBlobUrl = await uploadToVercelBlob(fileOrBase64);
      if (vercelBlobUrl) return vercelBlobUrl;
    } catch (err) {
      console.warn('Vercel Blob direct upload failed, attempting fallback:', err);
    }
  }

  // 2. If Base64 string, convert to File and upload to Vercel Blob
  if (typeof fileOrBase64 === 'string' && fileOrBase64.startsWith('data:image/')) {
    try {
      const match = fileOrBase64.match(/^data:(image\/[a-zA-Z0-9+]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const byteCharacters = atob(match[2]);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1] || 'jpg';
        const filename = filenameHint || `prod_${Date.now()}.${ext}`;
        const file = new File([byteArray], filename, { type: mimeType });

        const vercelBlobUrl = await uploadToVercelBlob(file);
        if (vercelBlobUrl) return vercelBlobUrl;
      }
    } catch (err) {
      console.warn('Converting Base64 to Vercel Blob failed:', err);
    }
  }

  // 3. Fallback to /api/upload-image backend proxy
  let base64Data: string;
  if (typeof fileOrBase64 === 'string') {
    base64Data = fileOrBase64;
  } else {
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
      if (data.success && data.url) {
        return normalizeImageUrl(data.url);
      }
    }
  } catch (err) {
    console.warn('Backend image upload fallback failed:', err);
  }

  return base64Data;
}
