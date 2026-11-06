/**
 * ==============================================================================
 * 689 KTV - Google Apps Script Web App Backend (Code.gs)
 * ຮອງຮັບທັງ HtmlService.createTemplateFromFile('Index') ແລະ Real-time API
 * ==============================================================================
 * 
 * ວິທີນຳໃຊ້:
 * 1. ເປີດ Google Sheet ຂອງທ່ານ
 * 2. ໄປທີ່ Extensions (ສ່ວນຂະຫຍາຍ) > Apps Script
 * 3. ວາງໂຄ້ດນີ້ລົງໃນໄຟລ໌ "Code.gs"
 * 4. ກົດ + > ເລືອກ HTML > ຕັ້ງຊື່ເປັນ "Index" ແລ້ວນຳໂຄ້ດຈາກ Index.html ມາວາງ
 * 5. ກົດ Deploy > New deployment > ເລືອກ Web app:
 *    - Execute as: Me (ຂ້ອຍ)
 *    - Who has access: Anyone (ທຸກຄົນ)
 * 6. ທ່ານຈະໄດ້ Web App URL ທີ່ເປີດໃຊ້ງານໄດ້ທັນທີທຸກອຸປະກອນ!
 * ==============================================================================
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : null;
  
  // ຖ້າບໍ່ມີ parameter action ໃຫ້ render ໜ້າເວັບ Index.html
  if (!action) {
    return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('689 KTV - ລະບົບຄຸ້ມຄອງຮ້ານ ແລະ POS')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (action === 'getAll') {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      data: {
        products: getSheetData(ss, 'Products'),
        rooms: getSheetData(ss, 'Rooms'),
        debts: getSheetData(ss, 'Debts'),
        timestamp: new Date().toISOString()
      }
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', msg: '689 KTV Active' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    var raw = e.postData.contents;
    var parsed = JSON.parse(raw);
    var action = parsed.action;
    var data = parsed.data || {};
    
    if (action === 'saveRooms' && data.rooms) {
      saveSheetData(ss, 'Rooms', data.rooms);
    } else if (action === 'saveProducts' && data.products) {
      saveSheetData(ss, 'Products', data.products);
    } else if (action === 'saveDebts' && data.debts) {
      saveSheetData(ss, 'Debts', data.debts);
    } else if (action === 'saveBill' && data.bill) {
      appendBillRecord(ss, data.bill);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', timestamp: new Date().toISOString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ສຳລັບການເອີ້ນຜ່ານ google.script.run ໂດຍກົງໃນ Index.html (Zero-Lag, ບໍ່ມີບັນຫາ CORS)
function handleGasApi(action, dataJson) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = {};
  if (dataJson) {
    try { data = JSON.parse(dataJson); } catch(e) {}
  }
  
  if (action === 'getAll') {
    return {
      status: 'success',
      data: {
        products: getSheetData(ss, 'Products'),
        rooms: getSheetData(ss, 'Rooms'),
        debts: getSheetData(ss, 'Debts'),
        timestamp: new Date().toISOString()
      }
    };
  }
  
  if (action === 'saveRooms' && data.rooms) {
    saveSheetData(ss, 'Rooms', data.rooms);
  } else if (action === 'saveProducts' && data.products) {
    saveSheetData(ss, 'Products', data.products);
  } else if (action === 'saveDebts' && data.debts) {
    saveSheetData(ss, 'Debts', data.debts);
  } else if (action === 'saveBill' && data.bill) {
    appendBillRecord(ss, data.bill);
  }
  
  return { status: 'success', timestamp: new Date().toISOString() };
}

function getSheetData(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var jsonCell = sheet.getRange(2, 1).getValue();
  try {
    return JSON.parse(jsonCell);
  } catch(e) {
    return [];
  }
}

function saveSheetData(ss, sheetName, dataArray) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1).setValue("JSON_PAYLOAD");
    sheet.getRange(1, 2).setValue("LAST_UPDATED");
  }
  sheet.getRange(2, 1).setValue(JSON.stringify(dataArray));
  sheet.getRange(2, 2).setValue(new Date().toISOString());
}

function appendBillRecord(ss, bill) {
  var sheet = ss.getSheetByName('SalesHistory');
  if (!sheet) {
    sheet = ss.insertSheet('SalesHistory');
    sheet.appendRow(['Date', 'BillNumber', 'Room/POS', 'Package', 'Staff', 'RoomCharge', 'ItemsCount', 'TotalKip']);
  }
  sheet.appendRow([
    new Date().toISOString(),
    bill.billNumber || '',
    bill.roomName || 'POS Direct',
    bill.packageName || '-',
    bill.staffName || '',
    bill.roomCharge || 0,
    (bill.items ? bill.items.length : 0),
    bill.total || 0
  ]);
}
