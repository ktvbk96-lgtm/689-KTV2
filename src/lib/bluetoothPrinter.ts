import { BillRecord, AppSettings, DebtRecord } from '../types';

// Web Bluetooth thermal printer driver (ESC/POS)
let bluetoothDevice: any = null;
let printerCharacteristic: any = null;

export interface BluetoothPrinterStatus {
  connected: boolean;
  deviceName?: string;
  error?: string;
}

export const isWebBluetoothSupported = (): boolean => {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
};

export const connectBluetoothPrinter = async (): Promise<BluetoothPrinterStatus> => {
  if (!isWebBluetoothSupported()) {
    throw new Error('Web Bluetooth is not supported in this browser. Please use Google Chrome or Edge.');
  }

  try {
    const device = await (navigator as any).bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb', // Standard Serial/Printer
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
        '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC
        0xffe0, // Common Chinese mini thermal printers (GOOJPRT, PT-210, etc.)
        0x18f0,
      ],
    });

    device.addEventListener('gattserverdisconnected', onDisconnected);
    const server = await device.gatt.connect();

    const services = await server.getPrimaryServices();
    let writeChar = null;

    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      for (const char of characteristics) {
        if (char.properties.write || char.properties.writeWithoutResponse) {
          writeChar = char;
          break;
        }
      }
      if (writeChar) break;
    }

    if (!writeChar) {
      throw new Error('No writable printer characteristic found on this device');
    }

    bluetoothDevice = device;
    printerCharacteristic = writeChar;

    return {
      connected: true,
      deviceName: device.name || 'Bluetooth Mini Printer',
    };
  } catch (err: any) {
    console.error('Bluetooth connection failed:', err);
    return {
      connected: false,
      error: err.message || 'Failed to connect to Bluetooth printer',
    };
  }
};

const onDisconnected = () => {
  bluetoothDevice = null;
  printerCharacteristic = null;
  window.dispatchEvent(new Event('689ktv_bluetooth_disconnected'));
};

export const disconnectBluetoothPrinter = async () => {
  if (bluetoothDevice && bluetoothDevice.gatt.connected) {
    await bluetoothDevice.gatt.disconnect();
  }
  bluetoothDevice = null;
  printerCharacteristic = null;
};

export const getBluetoothStatus = (): BluetoothPrinterStatus => {
  if (bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected && printerCharacteristic) {
    return {
      connected: true,
      deviceName: bluetoothDevice.name || 'Bluetooth Thermal Printer',
    };
  }
  return { connected: false };
};

// Ensure Lao and Thai Google Fonts are fully loaded before rendering to canvas
export const ensureLaoFontsReady = async (): Promise<boolean> => {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await (document as any).fonts.ready;
      await (document as any).fonts.load('bold 16px "Noto Sans Lao"');
      await (document as any).fonts.load('bold 24px "Noto Sans Lao"');
      return true;
    } catch (e) {
      console.warn('Font loading check completed with system fallback:', e);
      return true;
    }
  }
  return true;
};

// ==========================================
// RENDER LAO RECEIPT TO CANVAS (HIGH RES BITMAP)
// ==========================================
// Mini thermal printers lack Lao fonts in hardware.
// Image Cache for receipt logos
const imageCache = new Map<string, HTMLImageElement>();
export const loadReceiptImage = (src: string): Promise<HTMLImageElement> => {
  if (imageCache.has(src)) {
    const cached = imageCache.get(src)!;
    if (cached.complete && cached.naturalWidth > 0) return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('Failed to load logo image'));
    img.src = src;
  });
};

// Rendering Lao text on HTML5 Canvas ensures authentic Lao typography prints clearly.

export const renderReceiptToCanvas = (
  bill: BillRecord,
  settings: AppSettings,
  printWidthDots: number = 384 // Standard 58mm printer width (384 dots)
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = printWidthDots;

  // Temporary canvas to measure height
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  // Lao font stack with highest priority to Google Noto Sans Lao
  const laoFont = '"Noto Sans Lao", "Noto Sans Thai", "Noto Sans", "Phetsarath OT", "Saysettha OT", "Lao UI", sans-serif';
  const monoFont = '"Courier New", Courier, monospace';

  let estimatedHeight = 450; // Base header & footer
  if (settings.receiptLogoUrl) estimatedHeight += 100;
  if (bill.type === 'ktv_room') estimatedHeight += 160;
  estimatedHeight += bill.items.length * 60;
  if (bill.discount > 0) estimatedHeight += 36;

  canvas.height = Math.max(650, estimatedHeight);

  // Fill pure white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';

  let y = 18;
  const paddingX = 14;
  const contentWidth = canvas.width - paddingX * 2;

  // 0. LOGO IMAGE (If configured)
  if (settings.receiptLogoUrl && imageCache.has(settings.receiptLogoUrl)) {
    const logoImg = imageCache.get(settings.receiptLogoUrl)!;
    if (logoImg.complete && logoImg.naturalWidth > 0) {
      const maxLogoW = 160;
      const maxLogoH = 80;
      let drawW = logoImg.naturalWidth;
      let drawH = logoImg.naturalHeight;
      const ratio = Math.min(maxLogoW / drawW, maxLogoH / drawH, 1);
      drawW = Math.round(drawW * ratio);
      drawH = Math.round(drawH * ratio);
      ctx.drawImage(logoImg, Math.round((canvas.width - drawW) / 2), y, drawW, drawH);
      y += drawH + 12;
    }
  }

  // 1. SHOP TITLE: 689 KTV
  ctx.font = `bold 28px ${laoFont}`;
  ctx.textAlign = 'center';
  ctx.fillText(settings.shopName || '689 KTV', canvas.width / 2, y);
  y += 38;

  // Subheader
  if (settings.receiptHeader) {
    ctx.font = `bold 14px ${laoFont}`;
    ctx.fillText(settings.receiptHeader, canvas.width / 2, y);
    y += 22;
  }

  // Branch / Address / Phone / WiFi
  ctx.font = `12px ${laoFont}`;
  if (settings.shopAddress) {
    ctx.fillText(settings.shopAddress, canvas.width / 2, y);
    y += 18;
  }
  if (settings.shopPhone) {
    ctx.fillText(`Tel: ${settings.shopPhone}`, canvas.width / 2, y);
    y += 18;
  }
  if (settings.wifiPassword) {
    ctx.fillText(`WiFi: ${settings.wifiPassword}`, canvas.width / 2, y);
    y += 18;
  }

  y += 8;

  // Dashed line
  const drawDashedLine = (currY: number) => {
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.moveTo(paddingX, currY);
    ctx.lineTo(canvas.width - paddingX, currY);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  drawDashedLine(y);
  y += 10;

  // Bill metadata (Bill No, Date, Staff, Room, Time)
  ctx.textAlign = 'left';
  ctx.font = `12px ${monoFont}`;

  const drawRow = (label: string, value: string, isBold = false) => {
    ctx.font = isBold ? `bold 12px ${laoFont}` : `12px ${laoFont}`;
    ctx.textAlign = 'left';
    ctx.fillText(label, paddingX, y);
    ctx.textAlign = 'right';
    ctx.fillText(value, canvas.width - paddingX, y);
    y += 18;
  };

  drawRow('ເລກທີບິນ (Bill No):', bill.billNumber, true);
  const formattedDate = new Date(bill.endTime).toLocaleDateString('lo-LA');
  const formattedEndTime = new Date(bill.endTime).toLocaleTimeString('lo-LA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  drawRow('ວັນທີ-ເວລາ:', `${formattedDate} ${formattedEndTime}`);
  drawRow('ພະນັກງານ:', bill.staffName || 'Admin');

  if (bill.type === 'ktv_room') {
    y += 2;
    drawRow('ຫ້ອງ KTV:', bill.roomName || 'ຫ້ອງ KTV', true);

    if (bill.startTime) {
      const formattedStartTime = new Date(bill.startTime).toLocaleTimeString('lo-LA', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      drawRow('ເວລາເປີດ - ສິ້ນສຸດ:', `${formattedStartTime} ຫາ ${formattedEndTime}`, true);
    }

    if (bill.timeRangeFormatted) {
      drawRow('ກຳນົດໄລຍະເວລາ:', bill.timeRangeFormatted);
    }

    if (bill.durationMinutes !== undefined && bill.durationMinutes > 0) {
      const h = Math.floor(bill.durationMinutes / 60);
      const m = bill.durationMinutes % 60;
      drawRow('ໄລຍະເວລາຕົວຈິງ:', `${h} ຊມ ${m} ນາທີ (${bill.durationMinutes} ນາທີ)`);
    }

    if (bill.roomCharge > 0) {
      drawRow('ຄ່າຫ້ອງ:', `${bill.roomCharge.toLocaleString()} ${settings.currencySymbol}`, true);
    }
  }

  y += 4;
  drawDashedLine(y);
  y += 10;

  // Table header
  ctx.font = `bold 12px ${laoFont}`;
  ctx.textAlign = 'left';
  ctx.fillText('ລາຍການສິນຄ້າ', paddingX, y);
  ctx.textAlign = 'center';
  ctx.fillText('ຈຳນວນ', paddingX + contentWidth * 0.58, y);
  ctx.textAlign = 'right';
  ctx.fillText('ລາຄາ', canvas.width - paddingX, y);
  y += 20;

  drawDashedLine(y);
  y += 10;

  // Items
  bill.items.forEach((item) => {
    ctx.font = `bold 12px ${laoFont}`;
    ctx.textAlign = 'left';

    // Truncate name if too long for one line
    const nameText = item.productName.length > 20 ? item.productName.substring(0, 19) + '…' : item.productName;
    ctx.fillText(nameText, paddingX, y);

    ctx.font = `11px ${monoFont}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${item.quantity} ${item.unit}`, paddingX + contentWidth * 0.58, y);

    ctx.textAlign = 'right';
    ctx.fillText(`${item.total.toLocaleString()}`, canvas.width - paddingX, y);
    y += 18;

    if (item.sellerName) {
      ctx.font = `10px ${laoFont}`;
      ctx.textAlign = 'left';
      ctx.fillText(`  (ຜູ້ເສີບ/ຂາຍ: ${item.sellerName})`, paddingX + 8, y);
      y += 16;
    }
  });

  y += 4;
  drawDashedLine(y);
  y += 10;

  // Subtotal & Discount
  drawRow('ລວມເງິນ (Subtotal):', `${bill.subtotal.toLocaleString()} ${settings.currencySymbol}`);

  if (bill.discount > 0) {
    drawRow('ສ່ວນຫຼຸດ (Discount):', `-${bill.discount.toLocaleString()} ${settings.currencySymbol}`, true);
  }

  y += 6;
  // Grand TOTAL (Big Bold)
  ctx.fillStyle = '#000000';
  ctx.font = `bold 18px ${laoFont}`;
  ctx.textAlign = 'left';
  ctx.fillText('ຍອດສຸດທິ (TOTAL):', paddingX, y);
  ctx.textAlign = 'right';
  ctx.fillText(`${bill.total.toLocaleString()} ${settings.currencySymbol}`, canvas.width - paddingX, y);
  y += 28;

  drawDashedLine(y);
  y += 14;

  // Footer Message
  ctx.font = `11px ${laoFont}`;
  ctx.textAlign = 'center';
  ctx.fillText(settings.receiptFooter || 'ຂໍຂອບໃຈລູກຄ້າທີ່ມາອຸດໜູນ!', canvas.width / 2, y);
  y += 18;
  ctx.font = `bold 13px ${laoFont}`;
  ctx.fillText('*** 689 KTV ***', canvas.width / 2, y);
  y += 24;

  // Crop canvas to actual height used
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = canvas.width;
  finalCanvas.height = y;
  const finalCtx = finalCanvas.getContext('2d');
  if (finalCtx) {
    finalCtx.fillStyle = '#FFFFFF';
    finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    finalCtx.drawImage(canvas, 0, 0);
  }

  return finalCanvas;
};

// Convert Canvas to ESC/POS Raster Bit Image (GS v 0)
export const convertCanvasToEscPosRaster = (canvas: HTMLCanvasElement): Uint8Array => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  const width = canvas.width;
  const height = canvas.height;
  const widthBytes = Math.ceil(width / 8);

  const imgData = ctx.getImageData(0, 0, width, height);
  const pixels = imgData.data;

  const chunks: number[] = [];
  const addBytes = (...bytes: number[]) => {
    chunks.push(...bytes);
  };

  // Initialize printer: ESC @
  addBytes(0x1b, 0x40);

  // Send raster in bands/strips of max 128 rows to ensure BLE buffer safety
  const maxRowsPerBand = 128;
  let startY = 0;

  while (startY < height) {
    const bandHeight = Math.min(maxRowsPerBand, height - startY);

    // ESC/POS Command: GS v 0 m xL xH yL yH
    // m = 0 (normal)
    const xL = widthBytes % 256;
    const xH = Math.floor(widthBytes / 256);
    const yL = bandHeight % 256;
    const yH = Math.floor(bandHeight / 256);

    addBytes(0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH);

    for (let r = 0; r < bandHeight; r++) {
      const currentY = startY + r;
      for (let b = 0; b < widthBytes; b++) {
        let byteVal = 0;
        for (let bit = 0; bit < 8; bit++) {
          const currentX = b * 8 + bit;
          if (currentX < width) {
            const pixelIdx = (currentY * width + currentX) * 4;
            const red = pixels[pixelIdx];
            const green = pixels[pixelIdx + 1];
            const blue = pixels[pixelIdx + 2];
            const alpha = pixels[pixelIdx + 3];

            // Luminance
            const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;

            // If dark pixel (and not transparent), set bit to 1 (burn thermal dot)
            // Using 185 threshold ensures crisp Lao vowel marks and tone accents
            if (alpha > 100 && luminance < 185) {
              byteVal |= 0x80 >> bit;
            }
          }
        }
        chunks.push(byteVal);
      }
    }

    startY += bandHeight;
  }

  // Feed paper 3 lines: ESC d 3
  addBytes(0x1b, 0x64, 0x03);

  // Cut paper (partial or full cut): GS V 66 0
  addBytes(0x1d, 0x56, 0x42, 0x00);

  return new Uint8Array(chunks);
};

// Print Receipt as Image via Bluetooth (Crisp Lao font rendering)
export const printReceiptAsImageViaBluetooth = async (
  bill: BillRecord,
  settings: AppSettings
): Promise<boolean> => {
  if (!printerCharacteristic) {
    const conn = await connectBluetoothPrinter();
    if (!conn.connected || !printerCharacteristic) {
      throw new Error(conn.error || 'Bluetooth printer is not connected');
    }
  }

  // Ensure Lao fonts and logo image are ready so glyphs render properly on canvas
  await ensureLaoFontsReady();
  if (settings.receiptLogoUrl) {
    await loadReceiptImage(settings.receiptLogoUrl).catch(() => {});
  }

  // 1. Render high quality Lao receipt to canvas
  const canvas = renderReceiptToCanvas(bill, settings, 384);

  // 2. Convert to ESC/POS raster bit image commands
  const rasterBytes = convertCanvasToEscPosRaster(canvas);

  // 3. Send over BLE in chunks of 128 bytes with pacing
  const chunkSize = 128;
  for (let i = 0; i < rasterBytes.length; i += chunkSize) {
    const chunk = rasterBytes.slice(i, i + chunkSize);
    if (printerCharacteristic.writeValueWithoutResponse) {
      await printerCharacteristic.writeValueWithoutResponse(chunk);
    } else {
      await printerCharacteristic.writeValue(chunk);
    }
    await new Promise((res) => setTimeout(res, 25));
  }

  return true;
};

// Get Data URL of the receipt image (for web preview & PNG download)
export const getReceiptImageDataUrl = (bill: BillRecord, settings: AppSettings): string => {
  const canvas = renderReceiptToCanvas(bill, settings, 384);
  return canvas.toDataURL('image/png');
};

// Fallback plain ESC/POS receipt
export const generateEscPosReceipt = (bill: BillRecord, settings: AppSettings): Uint8Array => {
  const encoder = new TextEncoder();
  const chunks: number[] = [];

  const addBytes = (...bytes: number[]) => {
    chunks.push(...bytes);
  };

  const addText = (text: string) => {
    const encoded = encoder.encode(text);
    for (let i = 0; i < encoded.length; i++) {
      chunks.push(encoded[i]);
    }
  };

  addBytes(0x1b, 0x40);
  addBytes(0x1b, 0x61, 0x01);
  addBytes(0x1d, 0x21, 0x11);
  addText(`${settings.shopName}\n`);
  addBytes(0x1d, 0x21, 0x00);
  addText(`${settings.receiptHeader}\n`);
  if (settings.shopAddress) addText(`${settings.shopAddress}\n`);
  if (settings.shopPhone) addText(`Tel: ${settings.shopPhone}\n`);
  if (settings.wifiPassword) addText(`WiFi: ${settings.wifiPassword}\n`);

  addText('--------------------------------\n');
  addBytes(0x1b, 0x61, 0x00);
  addText(`Bill No : ${bill.billNumber}\n`);
  addText(`Date    : ${new Date(bill.endTime).toLocaleString('en-GB')}\n`);
  addText(`Staff   : ${bill.staffName}\n`);

  if (bill.type === 'ktv_room') {
    addText(`Room    : ${bill.roomName}\n`);
    if (bill.startTime) {
      const s = new Date(bill.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const e = new Date(bill.endTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      addText(`Time    : ${s} - ${e}\n`);
      if (bill.timeRangeFormatted) {
        addText(`Booked  : ${bill.timeRangeFormatted}\n`);
      }
      addText(`Duration: ${bill.durationMinutes || 0} mins\n`);
    }
    addText(`Room Fee: ${bill.roomCharge.toLocaleString()} Kip\n`);
  }

  addText('--------------------------------\n');
  addText('Item             Qty       Total\n');
  addText('--------------------------------\n');

  bill.items.forEach((item) => {
    const name = item.productName.substring(0, 15).padEnd(16, ' ');
    const qty = `${item.quantity} ${item.unit}`.padEnd(8, ' ');
    const total = `${item.total.toLocaleString()} K`.padStart(8, ' ');
    addText(`${name}${qty}${total}\n`);
    if (item.sellerName) {
      addText(`  (Server: ${item.sellerName})\n`);
    }
  });

  addText('--------------------------------\n');
  addBytes(0x1b, 0x61, 0x02);
  addText(`Subtotal: ${bill.subtotal.toLocaleString()} Kip\n`);
  if (bill.discount > 0) {
    addText(`Discount: -${bill.discount.toLocaleString()} Kip\n`);
  }
  addBytes(0x1d, 0x21, 0x01);
  addText(`TOTAL: ${bill.total.toLocaleString()} Kip\n`);
  addBytes(0x1d, 0x21, 0x00);

  addBytes(0x1b, 0x61, 0x01);
  addText('--------------------------------\n');
  addText(`${settings.receiptFooter}\n`);
  addText('*** 689 KTV ***\n\n\n\n');

  addBytes(0x1d, 0x56, 0x42, 0x00);
  return new Uint8Array(chunks);
};

export const printViaBluetooth = async (bill: BillRecord, settings: AppSettings): Promise<boolean> => {
  // Default to raster image printing so Lao language displays with zero question marks!
  return await printReceiptAsImageViaBluetooth(bill, settings);
};

// Render Lao Debt Slip / Receipt Statement to Canvas (58mm = 384px width)
export const renderDebtSlipToCanvas = (
  debt: DebtRecord,
  settings: AppSettings,
  canvasWidth: number = 384
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = 1200; // temporary height, will be cropped
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';

  const laoFont = '"Noto Sans Lao", "Phetsarath OT", sans-serif';
  const monoFont = '"Courier New", Courier, monospace';
  const paddingX = 14;
  let y = 20;

  // Header Title
  ctx.textAlign = 'center';
  ctx.font = `bold 22px ${laoFont}`;
  ctx.fillText(settings.shopName || '689 KTV', canvas.width / 2, y);
  y += 26;

  ctx.font = `bold 15px ${laoFont}`;
  ctx.fillText('ໃບຢັ້ງຢືນຄ້າງຊຳລະ / ຕິດໜີ້', canvas.width / 2, y);
  y += 18;
  ctx.font = `12px ${laoFont}`;
  ctx.fillText('DEBT / CREDIT STATEMENT', canvas.width / 2, y);
  y += 20;

  if (settings.shopPhone) {
    ctx.fillText(`Tel: ${settings.shopPhone}`, canvas.width / 2, y);
    y += 18;
  }

  // Dashed separator
  const drawDashed = (currY: number) => {
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.moveTo(paddingX, currY);
    ctx.lineTo(canvas.width - paddingX, currY);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  drawDashed(y);
  y += 12;

  const drawRow = (label: string, value: string, isBold = false) => {
    ctx.font = isBold ? `bold 12px ${laoFont}` : `12px ${laoFont}`;
    ctx.textAlign = 'left';
    ctx.fillText(label, paddingX, y);
    ctx.textAlign = 'right';
    ctx.fillText(value, canvas.width - paddingX, y);
    y += 18;
  };

  drawRow('ຊື່ລູກຄ້າ (Customer):', debt.customerName, true);
  if (debt.customerPhone) {
    drawRow('ເບີໂທ (Phone):', debt.customerPhone);
  }
  if (debt.roomName) {
    drawRow('ຫ້ອງ KTV (Room):', debt.roomName);
  }
  if (debt.billNumber) {
    drawRow('ເລກທີບິນ (Bill No):', debt.billNumber);
  }
  const dateFormatted = new Date(debt.createdAt).toLocaleDateString('lo-LA');
  drawRow('ວັນທີບັນທຶກ:', dateFormatted);
  if (debt.dueDate) {
    drawRow('ກຳນົດຊຳລະ:', debt.dueDate, true);
  }
  drawRow('ພະນັກງານບັນທຶກ:', debt.staffName || 'Admin');

  y += 4;
  drawDashed(y);
  y += 14;

  // Amounts Breakdown
  ctx.textAlign = 'left';
  ctx.font = `12px ${laoFont}`;
  drawRow('ຍອດໜີ້ທັງໝົດ (Total Debt):', `${debt.totalAmount.toLocaleString()} ${settings.currencySymbol}`);
  drawRow('ຊຳລະແລ້ວ (Paid So Far):', `${debt.paidAmount.toLocaleString()} ${settings.currencySymbol}`);

  y += 4;
  ctx.fillStyle = '#000000';
  ctx.fillRect(paddingX, y, canvas.width - paddingX * 2, 34);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 13px ${laoFont}`;
  ctx.textAlign = 'left';
  ctx.fillText('ຍອດຄ້າງຊຳລະ (REMAINING):', paddingX + 8, y + 22);
  ctx.textAlign = 'right';
  ctx.font = `bold 15px ${monoFont}`;
  ctx.fillText(`${debt.remainingAmount.toLocaleString()} ${settings.currencySymbol}`, canvas.width - paddingX - 8, y + 22);
  ctx.fillStyle = '#000000';
  y += 44;

  // Status Badge
  ctx.textAlign = 'center';
  ctx.font = `bold 13px ${laoFont}`;
  const statusText =
    debt.status === 'paid'
      ? '✓ ຊຳລະຄົບຖ້ວນແລ້ວ (FULLY PAID)'
      : debt.status === 'partially_paid'
      ? '⚡ ຈ່າຍບາງສ່ວນ (PARTIALLY PAID)'
      : '⚠️ ຍັງຄ້າງຊຳລະ (UNPAID)';
  ctx.fillText(statusText, canvas.width / 2, y);
  y += 20;

  if (debt.note) {
    ctx.textAlign = 'left';
    ctx.font = `11px ${laoFont}`;
    ctx.fillText(`ໝາຍເຫດ: ${debt.note}`, paddingX, y);
    y += 18;
  }

  y += 8;
  drawDashed(y);
  y += 24;

  // Signatures
  ctx.textAlign = 'center';
  ctx.font = `11px ${laoFont}`;
  ctx.fillText('( ລາຍເຊັນລູກຄ້າ / Customer )', canvas.width * 0.28, y);
  ctx.fillText('( ລາຍເຊັນຜູ້ຮັບ / Staff )', canvas.width * 0.72, y);
  y += 35;

  ctx.fillText('.................................', canvas.width * 0.28, y);
  ctx.fillText('.................................', canvas.width * 0.72, y);
  y += 24;

  ctx.font = `11px ${laoFont}`;
  ctx.fillText('*** ຂໍຂອບໃຈ 689 KTV ***', canvas.width / 2, y);
  y += 20;

  // Crop to actual height used
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = canvas.width;
  finalCanvas.height = y;
  const finalCtx = finalCanvas.getContext('2d');
  if (finalCtx) {
    finalCtx.fillStyle = '#FFFFFF';
    finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    finalCtx.drawImage(canvas, 0, 0);
  }
  return finalCanvas;
};

export const getDebtSlipImageDataUrl = (debt: DebtRecord, settings: AppSettings): string => {
  const canvas = renderDebtSlipToCanvas(debt, settings, 384);
  return canvas.toDataURL('image/png');
};

export const printDebtSlipAsImageViaBluetooth = async (
  debt: DebtRecord,
  settings: AppSettings
): Promise<boolean> => {
  if (!bluetoothDevice || !bluetoothDevice.gatt || !bluetoothDevice.gatt.connected || !printerCharacteristic) {
    const res = await connectBluetoothPrinter();
    if (!res.connected) {
      throw new Error(res.error || 'Bluetooth printer is not connected');
    }
  }

  await ensureLaoFontsReady();
  const canvas = renderDebtSlipToCanvas(debt, settings, 384);
  const rasterBytes = convertCanvasToEscPosRaster(canvas);

  const chunkSize = 128;
  for (let i = 0; i < rasterBytes.length; i += chunkSize) {
    const chunk = rasterBytes.slice(i, i + chunkSize);
    if (printerCharacteristic.writeValueWithoutResponse) {
      await printerCharacteristic.writeValueWithoutResponse(chunk);
    } else {
      await printerCharacteristic.writeValue(chunk);
    }
    await new Promise((res) => setTimeout(res, 25));
  }
  return true;
};

