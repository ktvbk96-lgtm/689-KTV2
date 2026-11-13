import { BillRecord, Room, RoomPackage } from '../types';

/**
 * Format a Date or ISO timestamp into local calendar YYYY-MM-DD (avoids UTC timezone shift)
 */
export const getLocalDateKey = (dateInput?: string | Date): string => {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * Format a Date or ISO timestamp into local YYYY-MM
 */
export const getLocalMonthKey = (dateInput?: string | Date): string => {
  return getLocalDateKey(dateInput).slice(0, 7);
};

/**
 * Deduplicate bills by billNumber (or id if billNumber is absent).
 * Pure in-memory operation: never mutates stored DB/localStorage records.
 * Keeps the most complete/updated version when duplicates exist.
 */
export const deduplicateBills = (bills: BillRecord[]): BillRecord[] => {
  if (!Array.isArray(bills) || bills.length === 0) return [];

  const result: BillRecord[] = [];
  const keyToIndex = new Map<string, number>();

  const scoreBill = (b: BillRecord): number => {
    let score = 0;
    if ((b.roomCharge || 0) > 0) score += 100;
    if ((b.discount || 0) > 0) score += 10;
    if (b.syncedToSheets) score += 5;
    if (b.items && b.items.length > 0) score += b.items.length;
    if (b.payment?.method) score += 2;
    return score;
  };

  bills.forEach((bill) => {
    if (!bill) return;
    const rawNum = (bill.billNumber || '').trim();
    const key = rawNum ? `num:${rawNum}` : `id:${bill.id}`;

    const existingIdx = keyToIndex.get(key);
    if (existingIdx === undefined) {
      keyToIndex.set(key, result.length);
      result.push(bill);
    } else {
      const existing = result[existingIdx];
      // Replace if incoming bill has richer/more complete details
      if (scoreBill(bill) > scoreBill(existing)) {
        result[existingIdx] = bill;
      }
    }
  });

  return result;
};

/**
 * Generate a collision-free sequential bill number based on local date and existing bills
 */
export const generateNextBillNumber = (bills: BillRecord[], dateNow: Date = new Date()): string => {
  const localDateStr = getLocalDateKey(dateNow).replace(/-/g, '');
  const prefix = `689-${localDateStr}-`;
  let maxSeq = 0;

  bills.forEach((b) => {
    const num = (b.billNumber || '').trim();
    if (num.startsWith(prefix)) {
      const tail = num.slice(prefix.length);
      const parsed = parseInt(tail, 10);
      if (!isNaN(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  });

  // Ensure sequence never collides with existing count on same day
  return `${prefix}${(maxSeq + 1).toString().padStart(3, '0')}`;
};

/**
 * Extract effective package duration in minutes
 */
export const getPackageDurationMinutes = (pkg?: RoomPackage): number => {
  if (!pkg) return 60;
  if (pkg.durationMinutes && pkg.durationMinutes > 0) {
    return pkg.durationMinutes;
  }
  const text = `${pkg.name || ''} ${pkg.description || ''}`;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:ຊົ່ວໂມງ|ชั่วโมง|ຊມ|ชม|ຊ\.ມ\.|ช\.ມ\.|hrs?|hours?)/i);
  if (match) {
    const hours = parseFloat(match[1]);
    if (hours > 0) return Math.round(hours * 60);
  }
  return 120;
};

export interface PackageTier {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
}

/**
 * Normalize and sort configured room packages ascending by duration
 */
export const getSortedPackageTiers = (packages: RoomPackage[]): PackageTier[] => {
  return (packages || [])
    .map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      durationMinutes: getPackageDurationMinutes(pkg),
      price: Number(pkg.price) || 0,
    }))
    .filter((t) => t.durationMinutes > 0 && t.price > 0)
    .sort((a, b) => a.durationMinutes - b.durationMinutes);
};

/**
 * Calculate KTV room fee strictly from actual elapsed minutes and configured Packages settings.
 * - Never applies a 500,000 minimum per session.
 * - Uses proportional time for durations shorter than the 1st package.
 * - Exact-matches configured package tiers (e.g. 1h=100k, 3h=200k, 4h=300k, 5h=400k, 7h=500k)
 *   and linearly interpolates between package tiers.
 */
export const calculatePackageBasedRoomCharge = (
  durationMinutes: number,
  packages: RoomPackage[],
  fallbackHourlyRate: number = 100000
): number => {
  const mins = Math.max(0, durationMinutes);
  if (mins <= 0) return 0;

  const tiers = getSortedPackageTiers(packages);
  if (tiers.length === 0) {
    const rate = fallbackHourlyRate > 0 ? fallbackHourlyRate : 100000;
    const raw = (rate / 60) * mins;
    return Math.max(1000, Math.round(raw / 1000) * 1000);
  }

  // Exact or near-exact match (within 1 minute) to a configured package
  const exactTier = tiers.find((t) => Math.abs(t.durationMinutes - mins) <= 1);
  if (exactTier) {
    return exactTier.price;
  }

  const firstTier = tiers[0];

  // Shorter than smallest package -> pro-rata by actual minutes (no high minimum!)
  if (mins < firstTier.durationMinutes) {
    const raw = (mins / firstTier.durationMinutes) * firstTier.price;
    return Math.max(1000, Math.round(raw / 1000) * 1000);
  }

  // Between two configured package tiers -> linear interpolation
  for (let i = 0; i < tiers.length - 1; i++) {
    const lower = tiers[i];
    const upper = tiers[i + 1];
    if (mins >= lower.durationMinutes && mins <= upper.durationMinutes) {
      const span = upper.durationMinutes - lower.durationMinutes;
      if (span <= 0) return upper.price;
      const ratio = (mins - lower.durationMinutes) / span;
      const raw = lower.price + ratio * (upper.price - lower.price);
      return Math.round(raw / 1000) * 1000;
    }
  }

  // Longer than the largest configured package tier
  const lastTier = tiers[tiers.length - 1];
  const extraMins = mins - lastTier.durationMinutes;
  const perMinRate = lastTier.price / lastTier.durationMinutes;
  const raw = lastTier.price + extraMins * perMinRate;
  return Math.round(raw / 1000) * 1000;
};

/**
 * Calculate open-time (Choice 1: ນັບຕາມເວລາຈິງ) room charge cleanly per completed 30-min (0.5 hr) block,
 * starting at the full 1-hour rate immediately (no tiny 1,000 / 2,000 ₭ per-minute increments).
 * Example at 100,000 ₭/hr:
 * - 0 to 89 mins (< 1.5 hrs): 100,000 ₭ (1.0x)
 * - 90 to 119 mins (1.5 hrs): 150,000 ₭ (1.5x)
 * - 120 to 149 mins (2.0 hrs): 200,000 ₭ (2.0x)
 */
export const calculateOpenTimeHourlyCharge = (
  durationMinutes: number,
  hourlyRate: number = 100000
): number => {
  const rate = Number(hourlyRate) > 0 ? Number(hourlyRate) : 100000;
  const mins = Math.max(0, durationMinutes);
  const halfHourBlocks = Math.max(2, Math.floor(mins / 30));
  return Math.round((halfHourBlocks * rate) / 2);
};

/**
 * Calculate live/session room fee strictly according to the room's pricingType:
 * - 'package': ALWAYS returns the exact full configured package price (e.g. 400,000 ₭), never pro-rated to 1,000 ₭
 * - 'fixed_hourly': returns bookedHours * hourlyRate when bookedHours > 0
 * - 'open_time': starts at 1x hourlyRate immediately and steps cleanly every 0.5 hr cycle (1.5h = 1.5x, 2h = 2x)
 */
export const calculateRoomSessionFee = (
  room: Room,
  packages: RoomPackage[],
  defaultHourlyRate: number = 100000,
  elapsedMinutesOverride?: number
): number => {
  if (room.status !== 'in_use' || !room.openedAt) return 0;

  const elapsedMins =
    elapsedMinutesOverride !== undefined
      ? Math.max(1, elapsedMinutesOverride)
      : Math.max(1, Math.floor((Date.now() - new Date(room.openedAt).getTime()) / 60000));

  if (room.pricingType === 'package') {
    const matchedPkg =
      packages.find((p) => p.id === room.packageId) ||
      packages.find((p) => p.name === room.packageName);
    const fullPkgPrice =
      room.packagePrice && Number(room.packagePrice) > 0
        ? Number(room.packagePrice)
        : matchedPkg && Number(matchedPkg.price) > 0
        ? Number(matchedPkg.price)
        : 0;
    if (fullPkgPrice > 0) {
      return fullPkgPrice;
    }
  }

  if (room.pricingType === 'fixed_hourly') {
    const rate = room.hourlyRate || defaultHourlyRate || 100000;
    if (room.bookedHours && room.bookedHours > 0) {
      return Math.round(room.bookedHours * rate);
    }
  }

  return calculateOpenTimeHourlyCharge(
    elapsedMins,
    room.hourlyRate || defaultHourlyRate || 100000
  );
};

/**
 * Determine if a bill belongs to a KTV room session (excludes split product-only room bills)
 */
export const isKtvRoomBill = (bill: BillRecord): boolean => {
  if (bill.isSplitItemBill) return false;
  return bill.type === 'ktv_room' || Boolean(bill.roomName && bill.roomName.trim().length > 0);
};

/**
 * Resolve elapsed duration (minutes) for a bill from saved fields (startTime/endTime/durationMinutes/bookedHours)
 */
export const resolveBillDurationMinutes = (bill: BillRecord): number => {
  if (bill.durationMinutes && bill.durationMinutes > 0) {
    return bill.durationMinutes;
  }

  if (bill.startTime && bill.endTime) {
    const startMs = new Date(bill.startTime).getTime();
    const endMs = new Date(bill.endTime).getTime();
    if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
      const diffMins = Math.round((endMs - startMs) / 60000);
      return Math.max(1, diffMins);
    }
  }

  // Try parsing HH:mm - HH:mm from timeRangeFormatted if available
  if (bill.timeRangeFormatted) {
    const m = bill.timeRangeFormatted.match(/(\d{1,2}):(\d{2})\s*(?:-|ຫາ)\s*(\d{1,2}):(\d{2})/);
    if (m) {
      const sM = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      let eM = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
      if (eM <= sM) eM += 24 * 60;
      const diff = eM - sM;
      if (diff > 0 && diff < 24 * 60) return diff;
    }
  }

  if (bill.bookedHours && bill.bookedHours > 0) {
    return Math.round(bill.bookedHours * 60);
  }

  return 0;
};

/**
 * Resolve room charge dynamically for display & analytics (never mutating stored bills in DB/localStorage).
 * - Returns saved bill.roomCharge if > 0.
 * - For old KTV room bills whose stored roomCharge === 0, dynamically computes the fee
 *   from actual open duration (Start - End / durationMinutes) using configured Packages settings.
 */
export const resolveBillRoomCharge = (
  bill: BillRecord,
  packages: RoomPackage[],
  fallbackHourlyRate: number = 100000
): number => {
  if (bill.isSplitItemBill || !isKtvRoomBill(bill)) {
    return bill.roomCharge || 0;
  }

  if (bill.roomCharge && bill.roomCharge > 0) {
    return bill.roomCharge;
  }

  // If bill explicitly used a package, match the package price directly first
  if (bill.pricingType === 'package' && bill.packageName) {
    const matched = packages.find(
      (p) => p.name === bill.packageName || p.id === bill.packageName
    );
    if (matched && Number(matched.price) > 0) return Number(matched.price);
  }

  const durMins = resolveBillDurationMinutes(bill);
  if (durMins > 0) {
    if (bill.pricingType === 'open_time') {
      return calculateOpenTimeHourlyCharge(durMins, fallbackHourlyRate);
    }
    return calculatePackageBasedRoomCharge(durMins, packages, fallbackHourlyRate);
  }

  // Fallback if old bill has packageName or bookedHours without start/end times
  if (bill.packageName) {
    const matched = packages.find(
      (p) => p.name === bill.packageName || p.id === bill.packageName
    );
    if (matched && Number(matched.price) > 0) return Number(matched.price);
  }

  return 0;
};

/**
 * Resolve effective total of a bill when an old KTV bill had stored roomCharge === 0.
 * Never mutates stored bills.
 */
export const resolveBillEffectiveTotal = (
  bill: BillRecord,
  packages: RoomPackage[],
  fallbackHourlyRate: number = 100000
): number => {
  const resolvedRoom = resolveBillRoomCharge(bill, packages, fallbackHourlyRate);
  if (!isKtvRoomBill(bill) || resolvedRoom <= 0) {
    return bill.total;
  }

  // If saved bill already includes a non-zero roomCharge and isn't marked prepaid-excluded, return bill.total
  if ((bill.roomCharge || 0) > 0 && !bill.isRoomChargePaid) {
    return bill.total;
  }

  const itemsSum = (bill.items || []).reduce((s, it) => s + (it.total || 0), 0);
  const netWithoutRoom = Math.max(0, itemsSum - (bill.discount || 0));

  // If saved total already exceeds itemsSum (e.g. roomCharge was already included in total), keep saved total
  if (bill.total > netWithoutRoom + 500) {
    return bill.total;
  }

  return Math.max(0, resolvedRoom + itemsSum - (bill.discount || 0));
};
