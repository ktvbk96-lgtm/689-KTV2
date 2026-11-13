/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 689 KTV - Firebase Firestore Real-Time Cloud Synchronization
 * Connects directly to project ktv-e97cb with live onSnapshot listeners.
 */

import { db } from './firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

export function listenToFirebaseStore(onUpdate: (data: any) => void): () => void {
  try {
    const docRef = doc(db, 'ktv_689', 'store');
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data) {
            onUpdate(data);
          }
        }
      },
      (error) => {
        console.warn('Firestore snapshot listener note:', error.message);
      }
    );
    return unsubscribe;
  } catch (err) {
    console.warn('Failed to initialize Firestore listener:', err);
    return () => {};
  }
}

function sanitizeForFirestore(val: any): any {
  if (val === undefined) return null;
  // Prevent Firestore 1MB single document quota rejection by stripping large data URI image strings
  if (typeof val === 'string' && val.length > 500 && val.startsWith('data:image')) {
    return '';
  }
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(sanitizeForFirestore);
  const out: Record<string, any> = {};
  for (const k of Object.keys(val)) {
    const v = val[k];
    out[k] = v === undefined ? null : sanitizeForFirestore(v);
  }
  return out;
}

export async function pushToFirebaseStore(payload: any): Promise<boolean> {
  try {
    const docRef = doc(db, 'ktv_689', 'store');
    const cleanPayload = sanitizeForFirestore(payload);
    await setDoc(
      docRef,
      {
        ...cleanPayload,
        lastUpdated: payload?.lastUpdated || new Date().toISOString(),
      },
      { merge: true }
    );
    return true;
  } catch (err: any) {
    console.warn('Firestore push note:', err.message);
    return false;
  }
}
