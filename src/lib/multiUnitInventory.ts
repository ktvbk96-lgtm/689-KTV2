/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * 689 KTV - Multi-Unit Inventory Helper Functions
 * ລະບົບຄຳນວນ ແລະ ຈັດການສິນຄ້າຫຼາຍຫົວໜ່ວຍ (Single unit vs Pack/Crate)
 * ຮອງຮັບການຂາຍທັງແບບ 'ແກ້ວ/ຂວດ' ແລະ ແບບ 'ແພັກ/ລັງ' (1 ແພັກ = 24 ແກ້ວ)
 * ພ້ອມຟັງຊັນຫັກສະຕັອກ ແລະ ອັບເດດຂໍ້ມູນກັບ Google Sheets/Database
 */

import { Product, CartItem } from '../types';

export interface MultiUnitDeductionResult {
  baseQtyToDeduct: number; // ຈຳນວນແກ້ວ/ໜ່ວຍຍ່ອຍທີ່ຕ້ອງຫັກອອກຈາກສະຕັອກ
  newStock: number; // ສະຕັອກຄົງເຫຼືອໃໝ່
  unitPrice: number; // ລາຄາຕໍ່ໜ່ວຍທີ່ຂາຍ
  lineTotal: number; // ຍອດລວມລາຄາ
  unitLabel: string; // ຊື່ໜ່ວຍ ເຊັ່ນ "ແກ້ວ" ຫຼື "ແພັກ"
  multiplier: number; // ຕົວຄູນ (1 ສຳລັບແກ້ວ, 24 ສຳລັບແພັກ)
}

/**
 * 1. ຟັງຊັນຄຳນວນການຫັກສະຕັອກ ແລະ ລາຄາສິນຄ້າຫຼາຍຫົວໜ່ວຍ (Pure JavaScript/TypeScript)
 * @param product ສິນຄ້າ
 * @param quantity ຈຳນວນທີ່ຂາຍ (ເຊັ່ນ 2 ແພັກ ຫຼື 3 ແກ້ວ)
 * @param unitType 'single' (ແກ້ວ/ຂວດ) ຫຼື 'pack' (ແພັກ/ລັງ)
 */
export function calculateMultiUnitDeduction(
  product: Product,
  quantity: number,
  unitType: 'single' | 'pack' = 'single'
): MultiUnitDeductionResult {
  const isPack = unitType === 'pack' && !!product.hasMultiUnit;
  const multiplier = isPack ? (product.packMultiplier || 24) : 1;
  const baseQtyToDeduct = Math.max(0, quantity) * multiplier;
  const currentStock = Number(product.stock) || 0;
  const newStock = Math.max(0, currentStock - baseQtyToDeduct);

  // ລາຄາຕໍ່ໜ່ວຍ: ຖ້າຂາຍແບບແພັກ ໃຫ້ໃຊ້ packSalePrice (ຖ້າບໍ່ມີໃຫ້ໃຊ້ salePrice * multiplier)
  const unitPrice = isPack
    ? (product.packSalePrice && product.packSalePrice > 0
        ? product.packSalePrice
        : product.salePrice * multiplier)
    : product.salePrice;

  const lineTotal = unitPrice * quantity;
  const unitLabel = isPack ? (product.packUnit || 'ແພັກ') : (product.unit || 'ແກ້ວ');

  return {
    baseQtyToDeduct,
    newStock,
    unitPrice,
    lineTotal,
    unitLabel,
    multiplier,
  };
}

/**
 * 2. ຟັງຊັນແປງສະຕັອກເປັນຈຳນວນ ແພັກ + ແກ້ວ (ເຊັ່ນ 50 ແກ້ວ = 2 ແພັກ ກັບ 2 ແກ້ວ)
 */
export function calculateAvailablePacksAndSingles(
  stock: number,
  multiplier: number = 24,
  baseUnit: string = 'ແກ້ວ',
  packUnit: string = 'ແພັກ'
): { packs: number; singles: number; formatted: string } {
  const safeStock = Math.max(0, stock || 0);
  const safeMultiplier = Math.max(1, multiplier || 24);
  const packs = Math.floor(safeStock / safeMultiplier);
  const singles = safeStock % safeMultiplier;

  let formatted = `${safeStock} ${baseUnit}`;
  if (packs > 0 && singles > 0) {
    formatted = `${safeStock} ${baseUnit} (${packs} ${packUnit} ກັບ ${singles} ${baseUnit})`;
  } else if (packs > 0 && singles === 0) {
    formatted = `${safeStock} ${baseUnit} (${packs} ${packUnit})`;
  }

  return { packs, singles, formatted };
}

/**
 * 3. ຟັງຊັນກວດສອບສະຕັອກພໍຂາຍຫຼືບໍ່ ເມື່ອມີທັງລາຍການໃນກະຕ່າ ແລະ ລາຍການທີ່ກຳລັງຈະເພີ່ມ
 */
export function checkMultiUnitStockAvailability(
  product: Product,
  cartItems: CartItem[],
  newQty: number,
  newUnitType: 'single' | 'pack' = 'single'
): {
  isAvailable: boolean;
  currentStock: number;
  totalRequestedBase: number;
  shortageBase: number;
  errorMessage?: string;
} {
  if (product.category === 'service') {
    return { isAvailable: true, currentStock: product.stock, totalRequestedBase: newQty, shortageBase: 0 };
  }

  const currentStock = Math.max(0, product.stock || 0);
  const newMultiplier = newUnitType === 'pack' && product.hasMultiUnit ? (product.packMultiplier || 24) : 1;
  const newRequestedBase = Math.max(0, newQty) * newMultiplier;

  // ຄຳນວນຈຳນວນແກ້ວທີ່ຢູ່ໃນກະຕ່າແລ້ວ ສຳລັບສິນຄ້າຕົວນີ້
  const existingInCartBase = cartItems.reduce((sum, item) => {
    if (item.product.id === product.id) {
      const m = item.multiplier || (item.selectedUnitType === 'pack' ? (item.product.packMultiplier || 24) : 1);
      return sum + item.quantity * m;
    }
    return sum;
  }, 0);

  const totalRequestedBase = existingInCartBase + newRequestedBase;
  const isAvailable = totalRequestedBase <= currentStock;
  const shortageBase = Math.max(0, totalRequestedBase - currentStock);

  let errorMessage: string | undefined;
  if (!isAvailable) {
    const unitLabel = newUnitType === 'pack' ? (product.packUnit || 'ແພັກ') : product.unit;
    const { formatted } = calculateAvailablePacksAndSingles(
      currentStock,
      product.packMultiplier || 24,
      product.unit,
      product.packUnit || 'ແພັກ'
    );

    errorMessage =
      `⚠️ ສະຕັອກບໍ່ພຽງພໍ! ສິນຄ້າ "${product.name}" ມີຄົງເຫຼືອ ${formatted}\n` +
      `ທ່ານຕ້ອງການ: ${newQty} ${unitLabel} (${newRequestedBase} ${product.unit})\n` +
      `ຂາດອີກ: ${shortageBase} ${product.unit}`;
  }

  return {
    isAvailable,
    currentStock,
    totalRequestedBase,
    shortageBase,
    errorMessage,
  };
}

/**
 * 4. ຟັງຊັນຫັກສະຕັອກອອກຈາກອາເຣສິນຄ້າທັງໝົດ (Deduct items from product catalog)
 */
export function deductMultiUnitStockFromCatalog(
  products: Product[],
  itemsToDeduct: { productId: string; quantity: number; multiplier?: number; selectedUnitType?: 'single' | 'pack' }[]
): Product[] {
  return products.map((prod) => {
    const matches = itemsToDeduct.filter((i) => i.productId === prod.id);
    if (matches.length > 0 && prod.category !== 'service') {
      const totalBaseQtyToDeduct = matches.reduce((sum, m) => {
        const mult =
          m.multiplier ||
          (m.selectedUnitType === 'pack' ? (prod.packMultiplier || 24) : 1);
        return sum + (m.quantity * mult);
      }, 0);

      const newStock = Math.max(0, (Number(prod.stock) || 0) - totalBaseQtyToDeduct);
      const mult = prod.hasMultiUnit ? (prod.packMultiplier || 24) : 1;
      const packsInStock = prod.hasMultiUnit ? Math.floor(newStock / mult) : undefined;
      const looseBottles = prod.hasMultiUnit ? (newStock % mult) : undefined;

      return {
        ...prod,
        stock: newStock,
        packsInStock,
        looseBottles,
      };
    }
    return prod;
  });
}

/**
 * =========================================================================
 * 5. ລະບົບຈັດການສະຕັອກຫຼັກແບບ 'ແພັກ' + ເສດ 'ແກ້ວ/ຂວດ' (Pack-centric Inventory)
 * =========================================================================
 * ຮອງຮັບຖານຂໍ້ມູນທີ່ເກັບ:
 * - packsInStock (ຈຳນວນແພັກຫຼັກໃນຖານຂໍ້ມູນ)
 * - looseBottles (ເສດຂວດ/ແກ້ວທີ່ເປີດແຍກໄວ້ 0 ຫາ 23)
 * - bottlesPerPack (ຕົວຄູນ ເຊັ່ນ 24 ຂວດ/ແພັກ)
 */

export interface PackInventoryItem {
  id: string;
  name: string;
  packsInStock: number;      // ຈຳນວນແພັກຫຼັກໃນສະຕັອກ
  looseBottles: number;       // ເສດຂວດທີ່ເຫຼືອ (0 - 23)
  bottlesPerPack?: number;    // ຈຳນວນຂວດຕໍ່ 1 ແພັກ (default: 24)
  bottlePrice?: number;       // ລາຄາຂາຍຕໍ່ຂວດ
  packPrice?: number;         // ລາຄາຂາຍຕໍ່ແພັກ
}

export interface PackDeductionResult {
  success: boolean;
  message: string;
  bottlesSold: number;
  previous: {
    packsInStock: number;
    looseBottles: number;
    totalBottles: number;
  };
  current: {
    packsInStock: number;       // ຈຳນວນແພັກຄົງເຫຼືອໃໝ່
    looseBottles: number;       // ຈຳນວນເສດຂວດຄົງເຫຼືອໃໝ່
    totalBottles: number;       // ຈຳນວນຂວດລວມທັງໝົດຄົງເຫຼືອ
  };
  packsBroken: number;          // ຈຳນວນແພັກທີ່ຖືກແກະເປີດຂາຍຍ່ອຍ
  packsDeductedNet: number;     // ຈຳນວນແພັກຫຼັກທີ່ຫຼຸດລົງ
  formatted: string;            // ຂໍ້ຄວາມສະແດງຜົນ ເຊັ່ນ "9 ແພັກ ກັບ 19 ຂວດ"
}

/**
 * ຟັງຊັນຄຳນວນຫັກລົບສະຕັອກເມື່ອຂາຍເປັນ 'ຂວດ'
 * ເມື່ອຂາຍຂວດສະສົມຄົບ 24 ຂວດ ລະບົບຈະຕັດຈຳນວນແພັກໃນສະຕັອກຫຼຸດລົງອັດຕະໂນມັດ
 * 
 * @param item ຂໍ້ມູນສະຕັອກສິນຄ້າ (ມີ packsInStock, looseBottles, bottlesPerPack)
 * @param bottlesSold ຈຳນວນຂວດທີ່ຂາຍໄປ
 */
export function deductBottlesFromPackStock(
  item: PackInventoryItem,
  bottlesSold: number
): PackDeductionResult {
  const bottlesPerPack = Math.max(1, item.bottlesPerPack || 24);
  const currentPacks = Math.max(0, Number(item.packsInStock) || 0);
  const currentLoose = Math.max(0, Number(item.looseBottles) || 0);
  const soldQty = Math.max(0, Number(bottlesSold) || 0);

  // 1. ຄຳນວນຈຳນວນຂວດລວມທັງໝົດກ່ອນຂາຍ
  const totalBottlesBefore = (currentPacks * bottlesPerPack) + currentLoose;

  // 2. ກວດສອບວ່າສິນຄ້າພໍຂາຍຫຼືບໍ່
  if (soldQty > totalBottlesBefore) {
    const availablePacks = Math.floor(totalBottlesBefore / bottlesPerPack);
    const availableLoose = totalBottlesBefore % bottlesPerPack;
    return {
      success: false,
      message: `❌ ສະຕັອກບໍ່ພໍຂາຍ! ຕ້ອງການ ${soldQty} ຂວດ ແຕ່ມີທັງໝົດພຽງ ${totalBottlesBefore} ຂວດ (${availablePacks} ແພັກ ກັບ ${availableLoose} ຂວດ)`,
      bottlesSold: soldQty,
      previous: {
        packsInStock: currentPacks,
        looseBottles: currentLoose,
        totalBottles: totalBottlesBefore,
      },
      current: {
        packsInStock: currentPacks,
        looseBottles: currentLoose,
        totalBottles: totalBottlesBefore,
      },
      packsBroken: 0,
      packsDeductedNet: 0,
      formatted: `${currentPacks} ແພັກ ກັບ ${currentLoose} ຂວດ`,
    };
  }

  // 3. ຄຳນວນຈຳນວນຂວດລວມທີ່ເຫຼືອຫຼັງຈາກຂາຍ
  const totalBottlesAfter = totalBottlesBefore - soldQty;

  // 4. ແປງຈຳນວນຂວດທີ່ເຫຼືອ ກັບເປັນ (ຈຳນວນແພັກເຕັມ) ແລະ (ເສດຂວດ)
  // ເມື່ອຂາຍຄົບທຸກໆ 24 ຂວດ Math.floor ຈະຕັດຈຳນວນແພັກລົງ 1 ອັດຕະໂນມັດ
  const newPacksInStock = Math.floor(totalBottlesAfter / bottlesPerPack);
  const newLooseBottles = totalBottlesAfter % bottlesPerPack;

  const packsDeductedNet = currentPacks - newPacksInStock;
  const packsBroken = currentLoose < (soldQty % bottlesPerPack) ? 1 : 0;

  let formatted = `${newPacksInStock} ແພັກ`;
  if (newLooseBottles > 0) {
    formatted = `${newPacksInStock} ແພັກ ກັບ ${newLooseBottles} ຂວດ`;
  }

  return {
    success: true,
    message: `✅ ຫັກສະຕັອກສຳເລັດ: ຂາຍ ${soldQty} ຂວດ (ຄົງເຫຼືອ ${formatted})`,
    bottlesSold: soldQty,
    previous: {
      packsInStock: currentPacks,
      looseBottles: currentLoose,
      totalBottles: totalBottlesBefore,
    },
    current: {
      packsInStock: newPacksInStock,
      looseBottles: newLooseBottles,
      totalBottles: totalBottlesAfter,
    },
    packsBroken,
    packsDeductedNet,
    formatted,
  };
}

/**
 * ຟັງຊັນຕື່ມສະຕັອກ (Restock) ຮອງຮັບທັງການຮັບເຂົ້າເປັນແພັກ ແລະ ເປັນຂວດ
 */
export function restockPackInventory(
  item: PackInventoryItem,
  addedPacks: number = 0,
  addedBottles: number = 0
): PackInventoryItem {
  const bottlesPerPack = Math.max(1, item.bottlesPerPack || 24);
  const currentPacks = Math.max(0, Number(item.packsInStock) || 0);
  const currentLoose = Math.max(0, Number(item.looseBottles) || 0);

  const totalBottles =
    (currentPacks * bottlesPerPack) +
    currentLoose +
    (Math.max(0, addedPacks) * bottlesPerPack) +
    Math.max(0, addedBottles);

  return {
    ...item,
    packsInStock: Math.floor(totalBottles / bottlesPerPack),
    looseBottles: totalBottles % bottlesPerPack,
  };
}

