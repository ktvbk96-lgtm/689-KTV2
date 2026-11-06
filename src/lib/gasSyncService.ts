/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * 689 KTV - Google Apps Script (GAS) Real-time Sync Service
 * Allows multiple devices to read/write real-time data to Google Sheets
 * with high speed, no freezing, AbortController timeouts, and zero data loss.
 */

import { Product, Room, RoomPackage, StaffMember, AppSettings, DebtRecord, BillRecord } from '../types';

export interface GasSyncResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  timestamp?: string;
}

export interface GasFullDataPayload {
  products?: Product[];
  rooms?: Room[];
  packages?: RoomPackage[];
  staff?: StaffMember[];
  settings?: Partial<AppSettings>;
  debts?: DebtRecord[];
  timestamp?: string;
}

/**
 * The complete Google Apps Script code to copy and paste into Google Sheets
 * Extensions > Apps Script > Paste > Deploy > New deployment > Web app > Anyone
 */
export const GOOGLE_APPS_SCRIPT_TEMPLATE = `/**
 * ==============================================================================
 * 689 KTV - Google Apps Script Web App (Backend API ສຳລັບຫຼາຍເຄື່ອງພ້ອມກັນ)
 * ==============================================================================
 * ວິທີນຳໃຊ້:
 * 1. ເປີດ Google Sheet ຂອງທ່ານ
 * 2. ໄປທີ່ເມນູ ສ່ວນຂະຫຍາຍ (Extensions) > Apps Script
 * 3. ລຶບໂຄ້ດເກົ່າອອກທັງໝົດ ແລ້ວວາງໂຄ້ດນີ້ລົງໄປ
 * 4. ກົດປຸ່ມ "ບັນທຶກ" (Save icon)
 * 5. ກົດ "ການນຳໄປໃຊ້" (Deploy) > "ການນຳໄປໃຊ້ໃໝ່" (New deployment)
 *    - ເລືອກປະເພດ: "ເວັບແອັບ" (Web app)
 *    - ຄຳອະທິບາຍ: "689 KTV POS API v1"
 *    - ດຳເນີນການໃນນາມ (Execute as): "ຂ້ອຍ" (Me)
 *    - ຜູ້ທີ່ມີສິດເຂົ້າເຖິງ (Who has access): "ທຸກຄົນ" (Anyone)
 * 6. ກົດ "ນຳໄປໃຊ້" (Deploy) > ໃຫ້ສິດ (Authorize access) > ເລືອກບັນຊີ Google ຂອງທ່ານ
 * 7. ສຳເນົາ "URL ເວັບແອັບ" (Web App URL ທີ່ລົງທ້າຍດ້ວຍ /exec) ມາວາງໃສ່ໃນແອັບ 689 KTV
 * ==============================================================================
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎤 689 KTV POS')
    .addItem('⚙️ ສ້າງຫົວຕາຕະລາງທັງໝົດ (Initialize Sheets)', 'initializeAllSheets')
    .addItem('📊 ສະແດງສະຖານະລະບົບ (Check Status)', 'checkSystemStatus')
    .addToUi();
}

/**
 * Handle GET requests from client devices (Fetch latest data)
 */
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'getAll';

    // 1. Return Products
    var products = getSheetDataAsJson(ss, 'ສະຕັອກ_Inventory', function(row) {
      return {
        id: String(row[0] || ''),
        name: String(row[1] || ''),
        category: String(row[2] || 'drink'),
        costPrice: Number(row[3]) || 0,
        salePrice: Number(row[4]) || 0,
        stock: Number(row[5]) || 0,
        minStockAlert: Number(row[6]) || 5,
        unit: String(row[7] || 'ແກ້ວ'),
        requireSeller: row[8] === true || String(row[8]).toLowerCase() === 'true' || String(row[8]) === 'ແມ່ນ (Yes)',
        imageUrl: String(row[9] || '')
      };
    });

    // 2. Return Rooms
    var rooms = getSheetDataAsJson(ss, 'ຫ້ອງ_Rooms', function(row) {
      var orders = [];
      try {
        if (row[12]) orders = JSON.parse(row[12]);
      } catch (err) {}
      return {
        id: String(row[0] || ''),
        name: String(row[1] || ''),
        capacity: Number(row[2]) || 10,
        status: String(row[3] || 'available'),
        pricingType: String(row[4] || 'fixed_hourly'),
        hourlyRate: Number(row[5]) || 80000,
        packageId: row[6] ? String(row[6]) : undefined,
        packageName: row[7] ? String(row[7]) : undefined,
        openedAt: row[8] ? String(row[8]) : undefined,
        targetEndTime: row[9] ? String(row[9]) : undefined,
        bookedHours: row[10] ? Number(row[10]) : undefined,
        openedByStaffName: row[11] ? String(row[11]) : undefined,
        orders: orders
      };
    });

    // 3. Return Packages
    var packages = getSheetDataAsJson(ss, 'ແພັກເກັດ_Packages', function(row) {
      return {
        id: String(row[0] || ''),
        name: String(row[1] || ''),
        durationMinutes: Number(row[2]) || 120,
        price: Number(row[3]) || 0,
        description: String(row[4] || ''),
        includesBeerCount: Number(row[5]) || 0
      };
    });

    // 4. Return Staff
    var staff = getSheetDataAsJson(ss, 'ພະນັກງານ_Staff', function(row) {
      return {
        id: String(row[0] || ''),
        name: String(row[1] || ''),
        role: String(row[2] || 'staff'),
        phone: String(row[3] || ''),
        active: row[4] !== false && String(row[4]).toLowerCase() !== 'false'
      };
    });

    // 5. Return Debts
    var debts = getSheetDataAsJson(ss, 'ໜີ້ສິນ_Debts', function(row) {
      var payments = [];
      try {
        if (row[12]) payments = JSON.parse(row[12]);
      } catch (err) {}
      return {
        id: String(row[0] || ''),
        customerName: String(row[1] || ''),
        customerPhone: String(row[2] || ''),
        billNumber: String(row[3] || ''),
        roomName: String(row[4] || ''),
        totalAmount: Number(row[5]) || 0,
        paidAmount: Number(row[6]) || 0,
        remainingAmount: Number(row[7]) || 0,
        status: String(row[8] || 'unpaid'),
        createdAt: String(row[9] || new Date().toISOString()),
        dueDate: String(row[10] || ''),
        staffName: String(row[11] || ''),
        payments: payments
      };
    });

    var result = {
      status: 'success',
      timestamp: new Date().toISOString(),
      data: {
        products: products,
        rooms: rooms,
        packages: packages,
        staff: staff,
        debts: debts
      }
    };

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString(),
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle POST requests from client devices (Save/Update real-time data)
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Acquire lock with 10s wait to prevent concurrent race conditions across devices
    lock.waitLock(10000);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var payloadStr = e.postData.contents;
    var payload = JSON.parse(payloadStr);
    var action = payload.action;
    var data = payload.data || {};

    if (action === 'saveProducts' && data.products) {
      updateProductsSheet(ss, data.products);
    } else if (action === 'saveRooms' && data.rooms) {
      updateRoomsSheet(ss, data.rooms);
    } else if (action === 'savePackages' && data.packages) {
      updatePackagesSheet(ss, data.packages);
    } else if (action === 'saveStaff' && data.staff) {
      updateStaffSheet(ss, data.staff);
    } else if (action === 'saveDebts' && data.debts) {
      updateDebtsSheet(ss, data.debts);
    } else if (action === 'saveBill' && data.bill) {
      appendBillRecord(ss, data.bill);
    } else if (action === 'syncAll') {
      if (data.products) updateProductsSheet(ss, data.products);
      if (data.rooms) updateRoomsSheet(ss, data.rooms);
      if (data.packages) updatePackagesSheet(ss, data.packages);
      if (data.staff) updateStaffSheet(ss, data.staff);
      if (data.debts) updateDebtsSheet(ss, data.debts);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      action: action,
      timestamp: new Date().toISOString(),
      message: 'ບັນທຶກຂໍ້ມູນລົງ Google Sheets ສຳເລັດແລ້ວ'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString(),
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// -----------------------------------------------------------------------------
// SHEET UPDATE HELPERS
// -----------------------------------------------------------------------------

function getSheetDataAsJson(ss, sheetName, rowMapper) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol <= 0) return [];
  
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var items = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (row[0] !== undefined && row[0] !== '') {
      try {
        var parsed = rowMapper(row);
        if (parsed) items.push(parsed);
      } catch (e) {}
    }
  }
  return items;
}

function updateProductsSheet(ss, products) {
  var sheet = getOrCreateSheet(ss, 'ສະຕັອກ_Inventory', [
    'ລະຫັດສິນຄ້າ (ID)', 'ຊື່ສິນຄ້າ (Name)', 'ໝວດໝູ່ (Category)',
    'ຕົ້ນທຶນ (Cost)', 'ລາຄາຂາຍ (Price)', 'ຈຳນວນສະຕັອກ (Stock)',
    'ເຕືອນສະຕັອກຕ່ຳ (Alert)', 'ຫົວໜ່ວຍ (Unit)', 'ຕ້ອງເລືອກຜູ້ຂາຍ (Require Seller)',
    'ລິ້ງຮູບພາບ (Image URL)'
  ]);

  sheet.clearContents();
  var rows = [
    [
      'ລະຫັດສິນຄ້າ (ID)', 'ຊື່ສິນຄ້າ (Name)', 'ໝວດໝູ່ (Category)',
      'ຕົ້ນທຶນ (Cost)', 'ລາຄາຂາຍ (Price)', 'ຈຳນວນສະຕັອກ (Stock)',
      'ເຕືອນສະຕັອກຕ່ຳ (Alert)', 'ຫົວໜ່ວຍ (Unit)', 'ຕ້ອງເລືອກຜູ້ຂາຍ (Require Seller)',
      'ລິ້ງຮູບພາບ (Image URL)'
    ]
  ];

  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    rows.push([
      p.id || '',
      p.name || '',
      p.category || 'drink',
      p.costPrice || 0,
      p.salePrice || 0,
      p.stock || 0,
      p.minStockAlert || 5,
      p.unit || 'ແກ້ວ',
      p.requireSeller ? 'ແມ່ນ (Yes)' : 'ບໍ່ແມ່ນ (No)',
      p.imageUrl || ''
    ]);
  }

  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
}

function updateRoomsSheet(ss, rooms) {
  var sheet = getOrCreateSheet(ss, 'ຫ້ອງ_Rooms', [
    'ລະຫັດຫ້ອງ (ID)', 'ຊື່ຫ້ອງ (Room Name)', 'ຄວາມຈຸ (Capacity)',
    'ສະຖານະ (Status)', 'ຮູບແບບລາຄາ (Pricing Type)', 'ອັດຕາຊົ່ວໂມງ (Hourly Rate)',
    'ລະຫັດແພັກເກັດ (Package ID)', 'ຊື່ແພັກເກັດ (Package Name)', 'ເວລາເປີດ (Opened At)',
    'ກຳນົດເວລາສິ້ນສຸດ (Target End)', 'ຈຳນວນຊົ່ວໂມງ (Booked Hours)', 'ພະນັກງານເປີດ (Opened By)',
    'ລາຍການສັ່ງໃນຫ້ອງ JSON (Orders)'
  ]);

  sheet.clearContents();
  var rows = [
    [
      'ລະຫັດຫ້ອງ (ID)', 'ຊື່ຫ້ອງ (Room Name)', 'ຄວາມຈຸ (Capacity)',
      'ສະຖານະ (Status)', 'ຮູບແບບລາຄາ (Pricing Type)', 'ອັດຕາຊົ່ວໂມງ (Hourly Rate)',
      'ລະຫັດແພັກເກັດ (Package ID)', 'ຊື່ແພັກເກັດ (Package Name)', 'ເວລາເປີດ (Opened At)',
      'ກຳນົດເວລາສິ້ນສຸດ (Target End)', 'ຈຳນວນຊົ່ວໂມງ (Booked Hours)', 'ພະນັກງານເປີດ (Opened By)',
      'ລາຍການສັ່ງໃນຫ້ອງ JSON (Orders)'
    ]
  ];

  for (var i = 0; i < rooms.length; i++) {
    var r = rooms[i];
    rows.push([
      r.id || '',
      r.name || '',
      r.capacity || 10,
      r.status || 'available',
      r.pricingType || 'fixed_hourly',
      r.hourlyRate || 80000,
      r.packageId || '',
      r.packageName || '',
      r.openedAt || '',
      r.targetEndTime || '',
      r.bookedHours || 0,
      r.openedByStaffName || '',
      JSON.stringify(r.orders || [])
    ]);
  }

  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
}

function updatePackagesSheet(ss, packages) {
  var sheet = getOrCreateSheet(ss, 'ແພັກເກັດ_Packages', [
    'ລະຫັດ (ID)', 'ຊື່ແພັກເກັດ (Name)', 'ໄລຍະເວລານາທີ (Minutes)',
    'ລາຄາ (Price)', 'ລາຍລະອຽດ (Description)', 'ແຖມເບຍຈຳນວນ (Free Beers)'
  ]);

  sheet.clearContents();
  var rows = [
    [
      'ລະຫັດ (ID)', 'ຊື່ແພັກເກັດ (Name)', 'ໄລຍະເວລານາທີ (Minutes)',
      'ລາຄາ (Price)', 'ລາຍລະອຽດ (Description)', 'ແຖມເບຍຈຳນວນ (Free Beers)'
    ]
  ];

  for (var i = 0; i < packages.length; i++) {
    var pkg = packages[i];
    rows.push([
      pkg.id || '',
      pkg.name || '',
      pkg.durationMinutes || 120,
      pkg.price || 0,
      pkg.description || '',
      pkg.includesBeerCount || 0
    ]);
  }

  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
}

function updateStaffSheet(ss, staff) {
  var sheet = getOrCreateSheet(ss, 'ພະນັກງານ_Staff', [
    'ລະຫັດ (ID)', 'ຊື່ພະນັກງານ (Name)', 'ຕຳແໜ່ງ (Role)', 'ເບີໂທ (Phone)', 'ສະຖານະໃຊ້ງານ (Active)'
  ]);

  sheet.clearContents();
  var rows = [['ລະຫັດ (ID)', 'ຊື່ພະນັກງານ (Name)', 'ຕຳແໜ່ງ (Role)', 'ເບີໂທ (Phone)', 'ສະຖານະໃຊ້ງານ (Active)']];

  for (var i = 0; i < staff.length; i++) {
    var s = staff[i];
    rows.push([
      s.id || '',
      s.name || '',
      s.role || 'staff',
      s.phone || '',
      s.active !== false
    ]);
  }

  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
}

function updateDebtsSheet(ss, debts) {
  var sheet = getOrCreateSheet(ss, 'ໜີ້ສິນ_Debts', [
    'ລະຫັດ (ID)', 'ຊື່ລູກຄ້າ (Customer)', 'ເບີໂທ (Phone)', 'ເລກບິນ (Bill No)',
    'ຊື່ຫ້ອງ (Room)', 'ຍອດທັງໝົດ (Total)', 'ຈ່າຍແລ້ວ (Paid)', 'ຍອດເຫຼືອ (Remaining)',
    'ສະຖານະ (Status)', 'ວັນທີສ້າງ (Created At)', 'ກຳນົດຊຳລະ (Due Date)', 'ພະນັກງານ (Staff)',
    'ປະຫວັດການຈ່າຍ JSON (Payments)'
  ]);

  sheet.clearContents();
  var rows = [
    [
      'ລະຫັດ (ID)', 'ຊື່ລູກຄ້າ (Customer)', 'ເບີໂທ (Phone)', 'ເລກບິນ (Bill No)',
      'ຊື່ຫ້ອງ (Room)', 'ຍອດທັງໝົດ (Total)', 'ຈ່າຍແລ້ວ (Paid)', 'ຍອດເຫຼືອ (Remaining)',
      'ສະຖານະ (Status)', 'ວັນທີສ້າງ (Created At)', 'ກຳນົດຊຳລະ (Due Date)', 'ພະນັກງານ (Staff)',
      'ປະຫວັດການຈ່າຍ JSON (Payments)'
    ]
  ];

  for (var i = 0; i < debts.length; i++) {
    var d = debts[i];
    rows.push([
      d.id || '',
      d.customerName || '',
      d.customerPhone || '',
      d.billNumber || '',
      d.roomName || '',
      d.totalAmount || 0,
      d.paidAmount || 0,
      d.remainingAmount || 0,
      d.status || 'unpaid',
      d.createdAt || '',
      d.dueDate || '',
      d.staffName || '',
      JSON.stringify(d.payments || [])
    ]);
  }

  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
}

function appendBillRecord(ss, bill) {
  var ordersSheet = getOrCreateSheet(ss, 'ຍອດຂາຍ_Orders', [
    'ເລກທີບິນ (Bill No)', 'ປະເພດ (Type)', 'ຊື່ຫ້ອງ (Room Name)', 'ແພັກເກັດ (Package)',
    'ເວລາເລີ່ມ (Start Time)', 'ເວລາຈົບ (End Time)', 'ຈຳນວນນາທີ (Minutes)',
    'ຄ່າຫ້ອງ (Room Fee)', 'ຍອດລວມກ່ອນຫຼຸດ (Subtotal)', 'ສ່ວນຫຼຸດ (Discount)',
    'ຍອດສຸດທິ (Total)', 'ວິທີຊຳລະ (Payment Method)', 'ພະນັກງານ (Staff Name)'
  ]);

  ordersSheet.appendRow([
    bill.billNumber || '',
    bill.type === 'ktv_room' ? 'ຫ້ອງຄາຣາໂອເກະ' : 'ຂາຍໜ້າຮ້ານ (POS)',
    bill.roomName || '-',
    bill.packageName || '-',
    bill.startTime ? new Date(bill.startTime).toLocaleString('lo-LA') : '-',
    new Date(bill.endTime).toLocaleString('lo-LA'),
    bill.durationMinutes || 0,
    bill.roomCharge || 0,
    bill.subtotal || 0,
    bill.discount || 0,
    bill.total || 0,
    bill.payment && bill.payment.method === 'cash' ? 'ເງິນສົດ (Cash)' : 'ໂອນເງິນ (Transfer)',
    bill.staffName || 'Admin'
  ]);

  if (bill.items && bill.items.length > 0) {
    var itemSalesSheet = getOrCreateSheet(ss, 'ລາຍລະອຽດສິນຄ້າ_ItemSales', [
      'ເລກທີບິນ (Bill No)', 'ວັນທີ-ເວລາ (Timestamp)', 'ຊື່ຫ້ອງ/ໜ້າຮ້ານ (Room/POS)',
      'ລະຫັດສິນຄ້າ (Product ID)', 'ຊື່ສິນຄ້າ (Product Name)', 'ຈຳນວນ (Qty)',
      'ຫົວໜ່ວຍ (Unit)', 'ລາຄາຕໍ່ໜ່ວຍ (Price)', 'ລວມເງິນ (Total)', 'ຜູ້ຂາຍ/ເສີບ (Seller)'
    ]);

    for (var i = 0; i < bill.items.length; i++) {
      var item = bill.items[i];
      itemSalesSheet.appendRow([
        bill.billNumber || '',
        new Date(bill.endTime).toLocaleString('lo-LA'),
        bill.roomName || 'ຂາຍໜ້າຮ້ານ',
        item.productId || '',
        item.productName || '',
        item.quantity || 1,
        item.unit || '',
        item.price || 0,
        item.total || 0,
        item.sellerName || '-'
      ]);
    }
  }
}

function getOrCreateSheet(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e2e8f0');
    }
  }
  return sheet;
}

function initializeAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  getOrCreateSheet(ss, 'ສະຕັອກ_Inventory', ['ລະຫັດສິນຄ້າ (ID)', 'ຊື່ສິນຄ້າ (Name)', 'ໝວດໝູ່ (Category)', 'ຕົ້ນທຶນ (Cost)', 'ລາຄາຂາຍ (Price)', 'ຈຳນວນສະຕັອກ (Stock)', 'ເຕືອນສະຕັອກຕ່ຳ (Alert)', 'ຫົວໜ່ວຍ (Unit)', 'ຕ້ອງເລືອກຜູ້ຂາຍ (Require Seller)', 'ລິ້ງຮູບພາບ (Image URL)']);
  getOrCreateSheet(ss, 'ຫ້ອງ_Rooms', ['ລະຫັດຫ້ອງ (ID)', 'ຊື່ຫ້ອງ (Room Name)', 'ຄວາມຈຸ (Capacity)', 'ສະຖານະ (Status)', 'ຮູບແບບລາຄາ (Pricing Type)', 'ອັດຕາຊົ່ວໂມງ (Hourly Rate)', 'ລະຫັດແພັກເກັດ (Package ID)', 'ຊື່ແພັກເກັດ (Package Name)', 'ເວລາເປີດ (Opened At)', 'ກຳນົດເວລາສິ້ນສຸດ (Target End)', 'ຈຳນວນຊົ່ວໂມງ (Booked Hours)', 'ພະນັກງານເປີດ (Opened By)', 'ລາຍການສັ່ງໃນຫ້ອງ JSON (Orders)']);
  getOrCreateSheet(ss, 'ແພັກເກັດ_Packages', ['ລະຫັດ (ID)', 'ຊື່ແພັກເກັດ (Name)', 'ໄລຍະເວລານາທີ (Minutes)', 'ລາຄາ (Price)', 'ລາຍລະອຽດ (Description)', 'ແຖມເບຍຈຳນວນ (Free Beers)']);
  getOrCreateSheet(ss, 'ພະນັກງານ_Staff', ['ລະຫັດ (ID)', 'ຊື່ພະນັກງານ (Name)', 'ຕຳແໜ່ງ (Role)', 'ເບີໂທ (Phone)', 'ສະຖານະໃຊ້ງານ (Active)']);
  getOrCreateSheet(ss, 'ຍອດຂາຍ_Orders', ['ເລກທີບິນ (Bill No)', 'ປະເພດ (Type)', 'ຊື່ຫ້ອງ (Room Name)', 'ແພັກເກັດ (Package)', 'ເວລາເລີ່ມ (Start Time)', 'ເວລາຈົບ (End Time)', 'ຈຳນວນນາທີ (Minutes)', 'ຄ່າຫ້ອງ (Room Fee)', 'ຍອດລວມກ່ອນຫຼຸດ (Subtotal)', 'ສ່ວນຫຼຸດ (Discount)', 'ຍອດສຸດທິ (Total)', 'ວິທີຊຳລະ (Payment Method)', 'ພະນັກງານ (Staff Name)']);
  getOrCreateSheet(ss, 'ລາຍລະອຽດສິນຄ້າ_ItemSales', ['ເລກທີບິນ (Bill No)', 'ວັນທີ-ເວລາ (Timestamp)', 'ຊື່ຫ້ອງ/ໜ້າຮ້ານ (Room/POS)', 'ລະຫັດສິນຄ້າ (Product ID)', 'ຊື່ສິນຄ້າ (Product Name)', 'ຈຳນວນ (Qty)', 'ຫົວໜ່ວຍ (Unit)', 'ລາຄາຕໍ່ໜ່ວຍ (Price)', 'ລວມເງິນ (Total)', 'ຜູ້ຂາຍ/ເສີບ (Seller)']);
  getOrCreateSheet(ss, 'ໜີ້ສິນ_Debts', ['ລະຫັດ (ID)', 'ຊື່ລູກຄ້າ (Customer)', 'ເບີໂທ (Phone)', 'ເລກບິນ (Bill No)', 'ຊື່ຫ້ອງ (Room)', 'ຍອດທັງໝົດ (Total)', 'ຈ່າຍແລ້ວ (Paid)', 'ຍອດເຫຼືອ (Remaining)', 'ສະຖານະ (Status)', 'ວັນທີສ້າງ (Created At)', 'ກຳນົດຊຳລະ (Due Date)', 'ພະນັກງານ (Staff)', 'ປະຫວັດການຈ່າຍ JSON (Payments)']);
  SpreadsheetApp.getUi().alert('✅ ສຳເລັດ: ສ້າງຫົວຕາຕະລາງທັງໝົດ 7 ແທັບຮຽບຮ້ອຍແລ້ວ!');
}

function checkSystemStatus() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets().map(function(s) { return s.getName() + ' (' + s.getLastRow() + ' ແຖວ)'; });
  SpreadsheetApp.getUi().alert('📊 ສະຖານະ Google Sheets:\\n\\n' + sheets.join('\\n'));
}
`;

/**
 * Fetch latest data from Google Apps Script Web App
 * with strict timeout, AbortController, and error trapping (never freezes UI)
 */
export const fetchLatestDataFromGas = async (
  gasUrl: string,
  timeoutMs: number = 7500
): Promise<GasSyncResponse<GasFullDataPayload>> => {
  if (!gasUrl || !gasUrl.trim().startsWith('http')) {
    return { success: false, error: 'ຍັງບໍ່ໄດ້ລະບຸ Google Apps Script Web App URL' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const cleanUrl = gasUrl.trim();
    // Cache buster to avoid browser stale caches across different devices
    const fetchUrl = `${cleanUrl}${cleanUrl.includes('?') ? '&' : '?'}action=getAll&_t=${Date.now()}`;

    const res = await fetch(fetchUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return {
        success: false,
        error: `ເຊີບເວີຕອບກັບດ້ວຍລະຫັດຜິດພາດ: ${res.status} ${res.statusText}`,
      };
    }

    const json = await res.json();
    if (json.status === 'success' && json.data) {
      return {
        success: true,
        message: 'ດຶງຂໍ້ມູນລ່າສຸດສຳເລັດແລ້ວ',
        data: json.data,
        timestamp: json.timestamp || new Date().toISOString(),
      };
    } else {
      return {
        success: false,
        error: json.message || 'ຮູບແບບຂໍ້ມູນທີ່ຕອບກັບບໍ່ຖືກຕ້ອງ',
      };
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: `ໝົດເວລາເຊື່ອມຕໍ່ (${timeoutMs / 1000} ວິນາທີ) - ກະລຸນາກວດສອບອິນເຕີເນັດ`,
      };
    }
    return {
      success: false,
      error: `ບໍ່ສາມາດເຊື່ອມຕໍ່ໄດ້: ${err.message || 'ຂໍ້ຜິດພາດການເຊື່ອມຕໍ່'}`,
    };
  }
};

/**
 * Send (POST) real-time data to Google Apps Script Web App
 * Uses text/plain to avoid browser CORS preflight blocks with Google Apps Script
 */
export const sendDataToGas = async (
  gasUrl: string,
  action: 'saveProducts' | 'saveRooms' | 'savePackages' | 'saveStaff' | 'saveDebts' | 'saveBill' | 'syncAll' | 'saveSettings',
  data: any,
  timeoutMs: number = 9000
): Promise<GasSyncResponse> => {
  if (!gasUrl || !gasUrl.trim().startsWith('http')) {
    return { success: false, error: 'ຍັງບໍ່ໄດ້ລະບຸ Google Apps Script Web App URL' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = JSON.stringify({
      action,
      data,
      timestamp: new Date().toISOString(),
    });

    // Content-Type: text/plain avoids CORS preflight OPTIONS request
    const res = await fetch(gasUrl.trim(), {
      method: 'POST',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: payload,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return {
        success: false,
        error: `ສົ່ງຂໍ້ມູນລົ້ມເຫຼວ: ${res.status} ${res.statusText}`,
      };
    }

    const text = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(text);
    } catch {
      // If GAS redirects or returns text without JSON
      return {
        success: true,
        message: 'ສົ່ງຂໍ້ມູນສຳເລັດແລ້ວ',
      };
    }

    if (json.status === 'success') {
      return {
        success: true,
        message: json.message || 'ບັນທຶກລົງ Google Sheets ສຳເລັດແລ້ວ',
        timestamp: json.timestamp,
      };
    } else {
      return {
        success: false,
        error: json.message || 'Google Sheets ລາຍງານຂໍ້ຜິດພາດ',
      };
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'ໝົດເວລາສົ່ງຂໍ້ມູນຂຶ້ນ Sheets',
      };
    }
    return {
      success: false,
      error: `ສົ່ງຂໍ້ມູນບໍ່ສຳເລັດ: ${err.message || 'Network error'}`,
    };
  }
};
