import { BillRecord, Product } from '../types';

export interface SpreadsheetInfo {
  id: string;
  name: string;
  url: string;
}

export const listExistingSpreadsheets = async (accessToken: string): Promise<SpreadsheetInfo[]> => {
  const query = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=30`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Drive API Error: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  return (data.files || []).map((file: any) => ({
    id: file.id,
    name: file.name,
    url: `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
  }));
};

export const createKtvSpreadsheet = async (accessToken: string, name = '689 KTV - ບັນທຶກຍອດຂາຍ ແລະ ສະຕັອກ'): Promise<SpreadsheetInfo> => {
  const payload = {
    properties: {
      title: name,
    },
    sheets: [
      {
        properties: {
          title: 'ຍອດຂາຍ_Orders',
          gridProperties: { rowCount: 1000, columnCount: 12 },
        },
      },
      {
        properties: {
          title: 'ລາຍລະອຽດສິນຄ້າ_ItemSales',
          gridProperties: { rowCount: 2000, columnCount: 10 },
        },
      },
      {
        properties: {
          title: 'ສະຕັອກ_Inventory',
          gridProperties: { rowCount: 200, columnCount: 8 },
        },
      },
    ],
  };

  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to create spreadsheet: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  const spreadsheetId = data.spreadsheetId;

  // Initialize Header Rows in Lao
  const headerData = [
    {
      range: 'ຍອດຂາຍ_Orders!A1:L1',
      values: [
        [
          'ເລກທີບິນ (Bill No)',
          'ປະເພດ (Type)',
          'ຊື່ຫ້ອງ (Room Name)',
          'ເວລາເລີ່ມ (Start Time)',
          'ເວລາຈົບ (End Time)',
          'ຈຳນວນນາທີ (Minutes)',
          'ຄ່າຫ້ອງ (Room Fee ₭)',
          'ຍອດລວມກ່ອນຫຼຸດ (Subtotal ₭)',
          'ສ່ວນຫຼຸດ (Discount ₭)',
          'ຍອດສຸດທິ (Total ₭)',
          'ວິທີຊຳລະ (Payment Method)',
          'ພະນັກງານ (Staff Name)',
        ],
      ],
    },
    {
      range: 'ລາຍລະອຽດສິນຄ້າ_ItemSales!A1:J1',
      values: [
        [
          'ເລກທີບິນ (Bill No)',
          'ວັນທີ-ເວລາ (Timestamp)',
          'ຊື່ຫ້ອງ/ໜ້າຮ້ານ (Room/POS)',
          'ລະຫັດສິນຄ້າ (Product ID)',
          'ຊື່ສິນຄ້າ (Product Name)',
          'ຈຳນວນ (Qty)',
          'ຫົວໜ່ວຍ (Unit)',
          'ລາຄາຕໍ່ໜ່ວຍ (Price ₭)',
          'ລວມເງິນ (Total ₭)',
          'ພະນັກງານຜູ້ຂາຍ (Seller/Server)',
        ],
      ],
    },
    {
      range: 'ສະຕັອກ_Inventory!A1:H1',
      values: [
        [
          'ລະຫັດສິນຄ້າ (ID)',
          'ຊື່ສິນຄ້າ (Product Name)',
          'ໝວດໝູ່ (Category)',
          'ຕົ້ນທຶນ (Cost ₭)',
          'ລາຄາຂາຍ (Price ₭)',
          'ຈຳນວນຄົງເຫຼືອ (Stock)',
          'ຫົວໜ່ວຍ (Unit)',
          'ຕ້ອງລະບຸຜູ້ຂາຍ (Require Seller)',
        ],
      ],
    },
  ];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: headerData,
    }),
  });

  return {
    id: spreadsheetId,
    name,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
};

export const appendBillToSheet = async (
  accessToken: string,
  spreadsheetId: string,
  bill: BillRecord
): Promise<boolean> => {
  // 1. Append to Orders sheet
  const orderRow = [
    bill.billNumber,
    bill.type === 'ktv_room' ? 'ຫ້ອງຄາຣາໂອເກະ' : 'ຂາຍໜ້າຮ້ານ (POS)',
    bill.roomName || '-',
    bill.startTime ? new Date(bill.startTime).toLocaleString('lo-LA') : '-',
    new Date(bill.endTime).toLocaleString('lo-LA'),
    bill.durationMinutes ?? 0,
    bill.roomCharge,
    bill.subtotal,
    bill.discount,
    bill.total,
    bill.payment.method === 'cash' ? 'ເງິນສົດ (Cash)' : 'ໂອນເງິນ (Transfer)',
    bill.staffName,
  ];

  const appendOrderRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ຍອດຂາຍ_Orders!A:L:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [orderRow] }),
    }
  );

  if (!appendOrderRes.ok) {
    const errorText = await appendOrderRes.text();
    console.error('Failed to append order to Google Sheets', errorText);
    return false;
  }

  // 2. Append itemized sales if any items were sold
  if (bill.items.length > 0) {
    const itemRows = bill.items.map((item) => [
      bill.billNumber,
      new Date(bill.endTime).toLocaleString('lo-LA'),
      bill.roomName || 'ຂາຍໜ້າຮ້ານ',
      item.productId,
      item.productName,
      item.quantity,
      item.unit,
      item.price,
      item.total,
      item.sellerName || '-',
    ]);

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ລາຍລະອຽດສິນຄ້າ_ItemSales!A:J:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: itemRows }),
      }
    );
  }

  return true;
};

export const syncInventoryToSheet = async (
  accessToken: string,
  spreadsheetId: string,
  products: Product[]
): Promise<boolean> => {
  const values = [
    [
      'ລະຫັດສິນຄ້າ (ID)',
      'ຊື່ສິນຄ້າ (Product Name)',
      'ໝວດໝູ່ (Category)',
      'ຕົ້ນທຶນ (Cost ₭)',
      'ລາຄາຂາຍ (Price ₭)',
      'ຈຳນວນຄົງເຫຼືອ (Stock)',
      'ຫົວໜ່ວຍ (Unit)',
      'ຕ້ອງລະບຸຜູ້ຂາຍ (Require Seller)',
    ],
    ...products.map((p) => [
      p.id,
      p.name,
      p.category,
      p.costPrice,
      p.salePrice,
      p.stock,
      p.unit,
      p.requireSeller ? 'ແມ່ນ (Yes)' : 'ບໍ່ແມ່ນ (No)',
    ]),
  ];

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ສະຕັອກ_Inventory!A1:H${values.length}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    }
  );

  return res.ok;
};
