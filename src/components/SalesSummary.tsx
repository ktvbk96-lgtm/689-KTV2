import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  Calendar,
  Layers,
  PieChart,
  FileSpreadsheet,
  Download,
  Filter,
  Beer,
  Coffee,
  UtensilsCrossed,
  DoorOpen,
  ArrowUpRight,
  Receipt,
  User,
  Users,
  UserCheck,
  Award,
  CheckCircle,
  Eye,
  Search,
  X,
  TrendingUp,
  Percent,
  Coins,
  PackageCheck,
  ChevronDown,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { BillRecord, Product, AppSettings, ProductCategory } from '../types';
import { formatCurrency } from '../lib/storage';

interface SalesSummaryProps {
  bills: BillRecord[];
  products: Product[];
  settings: AppSettings;
  onSyncAllToSheets?: () => void;
  isSyncingSheets?: boolean;
}

export const SalesSummary: React.FC<SalesSummaryProps> = ({
  bills,
  products,
  settings,
  onSyncAllToSheets,
  isSyncingSheets,
}) => {
  // Choice 1: Overall Summary vs Choice 2: Itemized & Profit Breakdown
  const [activeChoice, setActiveChoice] = useState<'overall' | 'itemized'>('itemized');

  // Timeframe filter: daily, monthly, yearly, custom
  const [timeframe, setTimeframe] = useState<'daily' | 'monthly' | 'yearly' | 'custom'>('daily');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [selectedMonth, setSelectedMonth] = useState<string>(
    new Date().toISOString().slice(0, 7)
  );
  const [selectedYear, setSelectedYear] = useState<string>(
    new Date().getFullYear().toString()
  );
  const [customStartDate, setCustomStartDate] = useState<string>(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [customEndDate, setCustomEndDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  // Filters for Itemized view & Seller details
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedProductId, setSelectedProductId] = useState<string>('all');
  const [selectedSeller, setSelectedSeller] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'profit_desc' | 'revenue_desc' | 'qty_desc'>(
    'profit_desc'
  );

  // Bill inspect modal
  const [inspectedBill, setInspectedBill] = useState<BillRecord | null>(null);

  // Fast product lookup map by ID and normalized Name
  const productLookup = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => {
      map.set(p.id, p);
      if (p.name) {
        map.set(p.name.trim().toLowerCase(), p);
      }
    });
    return map;
  }, [products]);

  // Set quick date helpers
  const handleSetToday = () => {
    setTimeframe('daily');
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  const handleSetYesterday = () => {
    setTimeframe('daily');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    setSelectedDate(yesterday);
  };

  // Filter bills by chosen timeframe
  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      const billDate = new Date(b.endTime);
      if (timeframe === 'daily') {
        const dateStr = billDate.toISOString().split('T')[0];
        return dateStr === selectedDate;
      } else if (timeframe === 'monthly') {
        const monthStr = billDate.toISOString().slice(0, 7);
        return monthStr === selectedMonth;
      } else if (timeframe === 'yearly') {
        const yearStr = billDate.getFullYear().toString();
        return yearStr === selectedYear;
      } else if (timeframe === 'custom') {
        const dateStr = billDate.toISOString().split('T')[0];
        return dateStr >= customStartDate && dateStr <= customEndDate;
      }
      return true;
    });
  }, [bills, timeframe, selectedDate, selectedMonth, selectedYear, customStartDate, customEndDate]);

  // Collect all unique sellers across all bills
  const availableSellers = useMemo(() => {
    const sellersSet = new Set<string>();
    filteredBills.forEach((b) => {
      if (b.staffName && b.staffName.trim()) sellersSet.add(b.staffName.trim());
      b.items.forEach((it) => {
        if (it.sellerName && it.sellerName.trim()) sellersSet.add(it.sellerName.trim());
      });
    });
    return Array.from(sellersSet).sort();
  }, [filteredBills]);

  // Comprehensive Seller Performance Map (Sales, Cost, Gross Profit per seller)
  const sellerPerformanceList = useMemo(() => {
    const sellerMap = new Map<
      string,
      {
        sellerName: string;
        totalUnits: number;
        totalRevenue: number;
        totalCost: number;
        grossProfit: number;
        profitMargin: number;
        billsHandled: number;
        topItems: Map<string, number>;
      }
    >();

    filteredBills.forEach((b) => {
      // Attribute items to item.sellerName, fallback to b.staffName
      b.items.forEach((item) => {
        const seller = (item.sellerName && item.sellerName.trim()) || (b.staffName && b.staffName.trim()) || 'ບໍ່ລະບຸຜູ້ຂາຍ';
        const matchedProduct =
          productLookup.get(item.productId) ||
          productLookup.get(item.productName.trim().toLowerCase());
        const costPerUnit =
          item.costPrice !== undefined
            ? item.costPrice
            : matchedProduct?.costPrice ?? 0;
        const itemCost = item.quantity * costPerUnit;

        const current = sellerMap.get(seller) || {
          sellerName: seller,
          totalUnits: 0,
          totalRevenue: 0,
          totalCost: 0,
          grossProfit: 0,
          profitMargin: 0,
          billsHandled: 0,
          topItems: new Map<string, number>(),
        };

        current.totalUnits += item.quantity;
        current.totalRevenue += item.total;
        current.totalCost += itemCost;
        current.grossProfit += item.total - itemCost;

        const curItemQty = current.topItems.get(item.productName) || 0;
        current.topItems.set(item.productName, curItemQty + item.quantity);

        sellerMap.set(seller, current);
      });
    });

    return Array.from(sellerMap.values())
      .map((s) => ({
        ...s,
        profitMargin: s.totalRevenue > 0 ? (s.grossProfit / s.totalRevenue) * 100 : 0,
      }))
      .sort((a, b) => b.grossProfit - a.grossProfit);
  }, [filteredBills, productLookup]);

  // Calculate Overall Store Totals
  const totalRevenue = filteredBills.reduce((acc, b) => acc + b.total, 0);
  const totalRoomCharge = filteredBills.reduce((acc, b) => acc + b.roomCharge, 0);
  const totalItemsCharge = filteredBills.reduce(
    (acc, b) => acc + b.items.reduce((sum, item) => sum + item.total, 0),
    0
  );
  const totalDiscount = filteredBills.reduce((acc, b) => acc + b.discount, 0);
  const totalCash = filteredBills
    .filter((b) => b.payment.method === 'cash')
    .reduce((acc, b) => acc + b.total, 0);
  const totalTransfer = filteredBills
    .filter((b) => b.payment.method === 'transfer')
    .reduce((acc, b) => acc + b.total, 0);

  // Helper to compute cost and profit for a single bill
  const getBillCostAndProfit = (b: BillRecord) => {
    let billItemsCost = 0;
    let billItemsRevenue = 0;
    b.items.forEach((item) => {
      const matched =
        productLookup.get(item.productId) ||
        productLookup.get(item.productName.trim().toLowerCase());
      const cost =
        item.costPrice !== undefined ? item.costPrice : matched?.costPrice ?? 0;
      billItemsCost += item.quantity * cost;
      billItemsRevenue += item.total;
    });
    // Bill profit = Net bill total (including room & minus discounts) - items cost
    const billProfit = b.total - billItemsCost;
    const margin = b.total > 0 ? (billProfit / b.total) * 100 : 0;
    return { billItemsCost, billItemsRevenue, billProfit, margin };
  };

  // Calculate product-level stats, cost of goods sold, profit, and seller details
  const {
    itemizedList,
    filteredItemizedList,
    summaryStats,
  } = useMemo(() => {
    const itemMap = new Map<
      string,
      {
        productId: string;
        productName: string;
        category: ProductCategory;
        unit: string;
        costPrice: number;
        salePriceAvg: number;
        totalQty: number;
        totalCost: number;
        totalRevenue: number;
        grossProfit: number;
        profitMargin: number;
        sellers: Map<
          string,
          { qty: number; revenue: number; cost: number; profit: number }
        >;
        imageUrl?: string;
      }
    >();

    filteredBills.forEach((b) => {
      b.items.forEach((item) => {
        const matchedProduct =
          productLookup.get(item.productId) ||
          productLookup.get(item.productName.trim().toLowerCase());

        const costPerUnit =
          item.costPrice !== undefined
            ? item.costPrice
            : matchedProduct?.costPrice ?? 0;

        const category = matchedProduct?.category || 'drink';
        const imageUrl = matchedProduct?.imageUrl;

        const existing = itemMap.get(item.productId) || {
          productId: item.productId,
          productName: item.productName,
          category,
          unit: item.unit,
          costPrice: costPerUnit,
          salePriceAvg: item.price,
          totalQty: 0,
          totalCost: 0,
          totalRevenue: 0,
          grossProfit: 0,
          profitMargin: 0,
          sellers: new Map<
            string,
            { qty: number; revenue: number; cost: number; profit: number }
          >(),
          imageUrl,
        };

        const itemTotalCost = item.quantity * costPerUnit;
        const itemGrossProfit = item.total - itemTotalCost;

        existing.totalQty += item.quantity;
        existing.totalCost += itemTotalCost;
        existing.totalRevenue += item.total;
        existing.costPrice = costPerUnit;

        const sellerName =
          (item.sellerName && item.sellerName.trim()) ||
          (b.staffName && b.staffName.trim()) ||
          'ບໍ່ລະບຸຜູ້ຂາຍ';

        const curSellerData = existing.sellers.get(sellerName) || {
          qty: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
        };

        curSellerData.qty += item.quantity;
        curSellerData.revenue += item.total;
        curSellerData.cost += itemTotalCost;
        curSellerData.profit += itemGrossProfit;

        existing.sellers.set(sellerName, curSellerData);
        itemMap.set(item.productId, existing);
      });
    });

    // Compute gross profit & margin for each item
    const fullList = Array.from(itemMap.values()).map((item) => {
      const grossProfit = item.totalRevenue - item.totalCost;
      const profitMargin =
        item.totalRevenue > 0 ? (grossProfit / item.totalRevenue) * 100 : 0;
      const salePriceAvg =
        item.totalQty > 0 ? Math.round(item.totalRevenue / item.totalQty) : item.salePriceAvg;

      return {
        ...item,
        salePriceAvg,
        grossProfit,
        profitMargin,
      };
    });

    // Filter by specific product, category, search query, and SELLER
    const filtered = fullList
      .map((item) => {
        // If a specific seller is selected, scope this item's quantities & profits to that seller
        if (selectedSeller !== 'all') {
          const sellerData = item.sellers.get(selectedSeller);
          if (!sellerData || sellerData.qty <= 0) {
            return null;
          }
          return {
            ...item,
            totalQty: sellerData.qty,
            totalRevenue: sellerData.revenue,
            totalCost: sellerData.cost,
            grossProfit: sellerData.profit,
            profitMargin:
              sellerData.revenue > 0 ? (sellerData.profit / sellerData.revenue) * 100 : 0,
          };
        }
        return item;
      })
      .filter((item): item is NonNullable<typeof item> => {
        if (!item) return false;
        // Product selector filter
        if (selectedProductId !== 'all' && item.productId !== selectedProductId) {
          return false;
        }
        // Category filter
        if (selectedCategory !== 'all' && item.category !== selectedCategory) {
          return false;
        }
        // Search query filter
        if (searchQuery.trim()) {
          const query = searchQuery.trim().toLowerCase();
          return item.productName.toLowerCase().includes(query);
        }
        return true;
      });

    // Sort list
    filtered.sort((a, b) => {
      if (sortBy === 'profit_desc') return b.grossProfit - a.grossProfit;
      if (sortBy === 'revenue_desc') return b.totalRevenue - a.totalRevenue;
      if (sortBy === 'qty_desc') return b.totalQty - a.totalQty;
      if (sortBy === 'margin_desc') return b.profitMargin - a.profitMargin;
      return 0;
    });

    // Overall Cost & Profit calculation across the filtered selection
    const selTotalQty = filtered.reduce((sum, i) => sum + i.totalQty, 0);
    const selTotalRevenue = filtered.reduce((sum, i) => sum + i.totalRevenue, 0);
    const selTotalCost = filtered.reduce((sum, i) => sum + i.totalCost, 0);
    const selGrossProfit = selTotalRevenue - selTotalCost;
    const selProfitMargin =
      selTotalRevenue > 0 ? (selGrossProfit / selTotalRevenue) * 100 : 0;

    // Overall Cost & Profit across ALL items sold in this timeframe
    const allItemsCost = fullList.reduce((sum, i) => sum + i.totalCost, 0);
    const allItemsRevenue = fullList.reduce((sum, i) => sum + i.totalRevenue, 0);
    const allItemsProfit = allItemsRevenue - allItemsCost;
    const allStoreGrossProfit = totalRevenue - allItemsCost; // Room + items - discounts - product cost

    return {
      itemizedList: fullList,
      filteredItemizedList: filtered,
      summaryStats: {
        selTotalQty,
        selTotalRevenue,
        selTotalCost,
        selGrossProfit,
        selProfitMargin,
        allItemsCost,
        allItemsRevenue,
        allItemsProfit,
        allStoreGrossProfit,
      },
    };
  }, [
    filteredBills,
    productLookup,
    selectedProductId,
    selectedCategory,
    selectedSeller,
    searchQuery,
    sortBy,
    totalRevenue,
  ]);

  // Timeframe label for display
  const timeframeLabel = useMemo(() => {
    if (timeframe === 'daily') {
      const d = new Date(selectedDate);
      return `ວັນທີ ${d.toLocaleDateString('lo-LA', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`;
    } else if (timeframe === 'monthly') {
      const [year, month] = selectedMonth.split('-');
      const d = new Date(parseInt(year), parseInt(month) - 1, 1);
      return `ເດືອນ ${d.toLocaleDateString('lo-LA', { month: 'long', year: 'numeric' })}`;
    } else if (timeframe === 'yearly') {
      return `ປະຈຳປີ ${selectedYear}`;
    } else {
      return `ຊ່ວງວັນທີ ${customStartDate} ຫາ ${customEndDate}`;
    }
  }, [timeframe, selectedDate, selectedMonth, selectedYear, customStartDate, customEndDate]);

  // Export CSV of product sales, profit & sellers
  const handleExportCsv = () => {
    try {
      const headers = [
        'ລຳດັບ',
        'ລະຫັດສິນຄ້າ',
        'ຊື່ສິນຄ້າ',
        'ໝວດໝູ່',
        'ຫົວໜ່ວຍ',
        'ລາຄາຕົ້ນທຶນ',
        'ລາຄາຂາຍສະເລ່ຍ',
        'ຈຳນວນທີ່ຂາຍ',
        'ຕົ້ນທຶນລວມ',
        'ຍອດຂາຍລວມ',
        'ຍອດກຳໄລ (ຍອດຂາຍ - ຕົ້ນທຶນ)',
        'ລາຍລະອຽດຜູ້ຂາຍ',
      ];

      const rows = filteredItemizedList.map((item, idx) => {
        const sellersStr = Array.from(item.sellers.entries())
          .map(([seller, data]) => `${seller}: ${data.qty}${item.unit} (ກຳໄລ: ${data.profit})`)
          .join('; ');

        return [
          idx + 1,
          `"${item.productId}"`,
          `"${item.productName}"`,
          item.category,
          item.unit,
          item.costPrice,
          item.salePriceAvg,
          item.totalQty,
          item.totalCost,
          item.totalRevenue,
          item.grossProfit,
          `"${sellersStr}"`,
        ];
      });

      const csvContent =
        '\uFEFF' +
        [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `689KTV_Profit_Report_${timeframe}_${Date.now()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('ດາວໂຫຼດ CSV ບໍ່ສຳເລັດ: ' + e.message);
    }
  };

  // Helper for category badge
  const renderCategoryBadge = (category: ProductCategory) => {
    switch (category) {
      case 'beer':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
            <Beer className="w-2.5 h-2.5" /> ເບຍ
          </span>
        );
      case 'drink':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30 flex items-center gap-1">
            <Coffee className="w-2.5 h-2.5" /> ເຄື່ອງດື່ມ
          </span>
        );
      case 'food':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
            <UtensilsCrossed className="w-2.5 h-2.5" /> ອາຫານ
          </span>
        );
      case 'snack':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            ຂອງກິນຫຼິ້ນ
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-700 text-slate-300">
            ທົ່ວໄປ
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Top Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center shadow-lg shadow-rose-500/20">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-100 flex items-center gap-2">
                <span>ສະຫຼຸບຍອດຂາຍ & ຕົ້ນທຶນ-ກຳໄລ 689 KTV</span>
              </h1>
              <p className="text-xs text-slate-400">
                ຄຳນວນຍອດຂາຍສິນຄ້າ, ຕົ້ນທຶນນຳເຂົ້າ, ກຳໄລສຸດທິ (ຍອດຂາຍ - ຕົ້ນທຶນ) ແລະ ລາຍລະອຽດຜູ້ຂາຍແຕ່ລະຄົນ
              </p>
            </div>
          </div>
        </div>

        {/* Choice 1 vs Choice 2 Tabs */}
        <div className="flex items-center gap-2 bg-slate-800/90 p-1.5 rounded-2xl border border-slate-700/80 w-full sm:w-auto">
          <button
            onClick={() => setActiveChoice('itemized')}
            className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
              activeChoice === 'itemized'
                ? 'bg-gradient-to-r from-amber-500 to-emerald-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Choice 2: ສະຫຼຸບສິນຄ້າ & ກຳໄລ (Profit & Cost)</span>
          </button>
          <button
            onClick={() => setActiveChoice('overall')}
            className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
              activeChoice === 'overall'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Choice 1: ສະຫຼຸບລວມທັງໝົດ & ຜູ້ຂາຍ (Overall)</span>
          </button>
        </div>
      </div>

      {/* Timeframe Filter Bar (Day, Month, Year, Custom) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg space-y-3">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          {/* Timeframe Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 w-full lg:w-auto">
            <span className="text-xs font-bold text-slate-400 mr-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              <span>ຊ່ວງເວລາ:</span>
            </span>
            <button
              onClick={() => setTimeframe('daily')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                timeframe === 'daily'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              ລາຍວັນ (Daily)
            </button>
            <button
              onClick={() => setTimeframe('monthly')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                timeframe === 'monthly'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              ລາຍເດືອນ (Monthly)
            </button>
            <button
              onClick={() => setTimeframe('yearly')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                timeframe === 'yearly'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              ລາຍປີ (Yearly)
            </button>
            <button
              onClick={() => setTimeframe('custom')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                timeframe === 'custom'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              ກຳນົດເອງ (Custom)
            </button>

            {/* Quick shortcuts for Daily */}
            {timeframe === 'daily' && (
              <div className="flex items-center gap-1 ml-1 border-l border-slate-700 pl-2">
                <button
                  onClick={handleSetToday}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 cursor-pointer"
                >
                  ມື້ນີ້
                </button>
                <button
                  onClick={handleSetYesterday}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  ມື້ວານນີ້
                </button>
              </div>
            )}
          </div>

          {/* Date Selector input depending on timeframe */}
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            {timeframe === 'daily' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">ເລືອກວັນທີ:</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
            )}

            {timeframe === 'monthly' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">ເລືອກເດືອນ:</span>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
            )}

            {timeframe === 'yearly' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">ເລືອກປີ:</span>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500 cursor-pointer"
                >
                  {[2024, 2025, 2026, 2027, 2028, 2029].map((y) => (
                    <option key={y} value={y.toString()}>
                      ປີ {y}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {timeframe === 'custom' && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>ແຕ່:</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
                <span>ຫາ:</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
            )}

            {/* Google Sheets Sync Button */}
            {onSyncAllToSheets && (
              <button
                onClick={onSyncAllToSheets}
                disabled={isSyncingSheets}
                className="px-3 py-1.5 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>{isSyncingSheets ? 'ກຳລັງຊິ້ງ...' : 'ຊິ້ງລົງ Google Sheets'}</span>
              </button>
            )}

            {/* Export CSV Button */}
            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all border border-slate-700 cursor-pointer"
              title="ດາວໂຫຼດໄຟລ໌ Excel/CSV"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>ດາວໂຫຼດ CSV</span>
            </button>
          </div>
        </div>

        {/* Selected Period Badge */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
          <div className="text-slate-400 flex items-center gap-2">
            <span>ກຳລັງສະແດງ:</span>
            <span className="px-2.5 py-0.5 rounded-lg bg-rose-500/10 text-rose-300 font-bold border border-rose-500/20">
              {timeframeLabel}
            </span>
            {selectedSeller !== 'all' && (
              <span className="px-2.5 py-0.5 rounded-lg bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30 flex items-center gap-1">
                <User className="w-3 h-3" />
                <span>ຜູ້ຂາຍ: {selectedSeller}</span>
              </span>
            )}
          </div>
          <div className="text-slate-400 text-[11px]">
            ພົບທັງໝົດ <span className="font-mono font-bold text-amber-300">{filteredBills.length}</span> ໃບບິນ
          </div>
        </div>
      </div>

      {/* CHOICE 2: ITEMIZED PRODUCT SALES & PROFIT + SELLER DETAILS */}
      {activeChoice === 'itemized' && (
        <div className="space-y-6">
          {/* PRODUCT & SELLER FILTER BAR */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <Filter className="w-4 h-4 text-amber-500" />
                  <span>ເລືອກສິນຄ້າ ຫຼື ເລືອກຜູ້ຂາຍສະເພາະ (Filter Products & Sellers)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  ເລືອກສິນຄ້າ ຫຼື ພະນັກງານຂາຍເພື່ອຄຳນວນຍອດຂາຍ, ຕົ້ນທຶນ ແລະ ກຳໄລ (ຍອດຂາຍ - ຕົ້ນທຶນ = ກຳໄລ)
                </p>
              </div>

              {/* Reset filter button */}
              {(selectedProductId !== 'all' || selectedCategory !== 'all' || selectedSeller !== 'all' || searchQuery) && (
                <button
                  onClick={() => {
                    setSelectedProductId('all');
                    setSelectedCategory('all');
                    setSelectedSeller('all');
                    setSearchQuery('');
                  }}
                  className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-400 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all border border-slate-700"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>ລ້າງຕົວກອງ (Reset)</span>
                </button>
              )}
            </div>

            {/* Filter Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {/* Filter 1: Specific Product Combobox */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 block">
                  ເລືອກສິນຄ້າສະເພາະ:
                </label>
                <div className="relative">
                  <select
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 appearance-none cursor-pointer"
                  >
                    <option value="all">⭐ ທຸກລາຍການສິນຄ້າ (All Items)</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.unit})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-2.5 pointer-events-none" />
                </div>
              </div>

              {/* Filter 2: Seller / Staff Selector (REQUESTED FEATURE) */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-purple-300 block flex items-center gap-1">
                  <UserCheck className="w-3 h-3 text-purple-400" />
                  <span>ເລືອກຜູ້ຂາຍ/ພະນັກງານ:</span>
                </label>
                <div className="relative">
                  <select
                    value={selectedSeller}
                    onChange={(e) => setSelectedSeller(e.target.value)}
                    className="w-full bg-slate-800 border border-purple-500/40 rounded-xl px-3 py-2 text-xs text-purple-200 font-semibold focus:outline-none focus:ring-1 focus:ring-purple-500 appearance-none cursor-pointer"
                  >
                    <option value="all">👥 ຜູ້ຂາຍທັງໝົດ (All Sellers)</option>
                    {availableSellers.map((seller) => (
                      <option key={seller} value={seller}>
                        👤 {seller}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-purple-400 absolute right-3 top-2.5 pointer-events-none" />
                </div>
              </div>

              {/* Filter 3: Category Filter */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 block">
                  ໝວດໝູ່ສິນຄ້າ:
                </label>
                <div className="relative">
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 appearance-none cursor-pointer"
                  >
                    <option value="all">ທຸກໝວດໝູ່ (All Categories)</option>
                    <option value="beer">🍺 ເບຍ / ເຄື່ອງດື່ມມຶນເມົາ</option>
                    <option value="drink">🥤 ເຄື່ອງດື່ມ / ນ້ຳອັດລົມ / ນ້ຳດື່ມ</option>
                    <option value="food">🍲 ອາຫານ / ກັບແກ້ມ</option>
                    <option value="snack">🍿 ຂອງກິນຫຼິ້ນ</option>
                    <option value="service">🛎️ ບໍລິການ / ອື່ນໆ</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-2.5 pointer-events-none" />
                </div>
              </div>

              {/* Filter 4: Search Box */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 block">
                  ຄົ້ນຫາຊື່ສິນຄ້າ:
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ພິມຊື່ສິນຄ້າ..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Filter 5: Sort Option */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 block">
                  ຮຽງລຳດັບຕາມ:
                </label>
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 appearance-none cursor-pointer"
                  >
                    <option value="profit_desc">💰 ກຳໄລຫຼາຍສຸດ (Top Profit)</option>
                    <option value="revenue_desc">📈 ຍອດຂາຍສູງສຸດ (Top Revenue)</option>
                    <option value="qty_desc">📦 ຈຳນວນຂາຍດີສຸດ (Top Units Sold)</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-2.5 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          {/* FINANCIAL KPI CARDS: PROFIT, COST, REVENUE FOR SELECTED PRODUCT(S) & SELLER */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Revenue */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="font-semibold">
                  {selectedSeller !== 'all' ? `ຍອດຂາຍຂອງ (${selectedSeller})` : 'ຍອດຂາຍສິນຄ້າລວມ'}
                </span>
                <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <Coins className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-amber-400 tracking-tight">
                {formatCurrency(summaryStats.selTotalRevenue, settings.currencySymbol)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                <span>ຂາຍໄດ້ທັງໝົດ</span>
                <span className="font-bold text-slate-300 font-mono">
                  {summaryStats.selTotalQty.toLocaleString()}
                </span>
                <span>ໜ່ວຍ</span>
              </p>
            </div>

            {/* Card 2: Total Import Cost */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="font-semibold">
                  {selectedSeller !== 'all' ? `ຕົ້ນທຶນສິນຄ້າ (${selectedSeller})` : 'ຕົ້ນທຶນນຳເຂົ້າລວມ'}
                </span>
                <span className="p-2 rounded-xl bg-rose-500/10 text-rose-400">
                  <PackageCheck className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-rose-400 tracking-tight">
                {formatCurrency(summaryStats.selTotalCost, settings.currencySymbol)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                ຄຳນວນຈາກ: ລາຄານຳເຂົ້າ × ຈຳນວນຂາຍ
              </p>
            </div>

            {/* Card 3: Gross Profit (Revenue - Cost) */}
            <div className="bg-gradient-to-br from-emerald-950/60 to-slate-900 border-2 border-emerald-500/40 rounded-3xl p-5 shadow-xl relative overflow-hidden">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>ຍອດກຳໄລ (ຍອດຂາຍ - ຕົ້ນທຶນ)</span>
                </span>
                <span className="p-1.5 rounded-xl bg-emerald-500/20 text-emerald-300">
                  <TrendingUp className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-emerald-400 tracking-tight">
                {formatCurrency(summaryStats.selGrossProfit, settings.currencySymbol)}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-emerald-300/80">
                <span>ຄິດໄລ່: ຍອດຂາຍລວມ - ຕົ້ນທຶນສິນຄ້າ</span>
                <span className="font-bold text-emerald-300">
                  {summaryStats.selGrossProfit >= 0 ? 'ກຳໄລ' : 'ຂາດທຶນ'}
                </span>
              </div>
            </div>

            {/* Card 4: Quantity & Store Overview */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="font-semibold">ຈຳນວນລາຍການທີ່ສະແດງ</span>
                <span className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
                  <Layers className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-purple-400 tracking-tight">
                {filteredItemizedList.length} <span className="text-sm font-sans font-bold">ລາຍການ</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-800 pt-1">
                <span>ກຳໄລສະເລ່ຍ/ໜ່ວຍ:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {summaryStats.selTotalQty > 0
                    ? formatCurrency(
                        Math.round(summaryStats.selGrossProfit / summaryStats.selTotalQty),
                        settings.currencySymbol
                      )
                    : '0 ' + settings.currencySymbol}
                </span>
              </div>
            </div>
          </div>

          {/* TABLE: DETAILED PRODUCT COST & PROFIT BREAKDOWN WITH SELLERS */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-emerald-400" />
                  <span>
                    ຕາຕະລາງລາຍລະອຽດຕົ້ນທຶນ, ກຳໄລ ແລະ ຜູ້ຂາຍ ({filteredItemizedList.length} ລາຍການ)
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  ສູດຄຳນວນ: ຍອດກຳໄລ = ຍອດຂາຍລວມ - (ລາຄາຕົ້ນທຶນນຳເຂົ້າ × ຈຳນວນທີ່ຂາຍໄດ້)
                </p>
              </div>

              <div className="text-xs text-slate-400">
                ສະແດງຕາມ {timeframeLabel}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-3 text-center w-12">#</th>
                    <th className="py-3 px-4 min-w-[200px]">ລາຍການສິນຄ້າ (Product)</th>
                    <th className="py-3 px-3 text-right">ຕົ້ນທຶນ/ໜ່ວຍ</th>
                    <th className="py-3 px-3 text-right">ລາຄາຂາຍ/ໜ່ວຍ</th>
                    <th className="py-3 px-3 text-center">ຈຳນວນທີ່ຂາຍ</th>
                    <th className="py-3 px-3 text-right">ຕົ້ນທຶນລວມ</th>
                    <th className="py-3 px-4 text-right">ຍອດຂາຍລວມ</th>
                    <th className="py-3 px-4 text-right">ຍອດກຳໄລ (Profit)</th>
                    <th className="py-3 px-4 min-w-[220px]">ລາຍລະອຽດຜູ້ຂາຍ & ກຳໄລທີ່ສ້າງໄດ້</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredItemizedList.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center text-slate-500">
                        <div className="max-w-xs mx-auto space-y-2">
                          <PackageCheck className="w-8 h-8 mx-auto text-slate-600" />
                          <p className="font-semibold text-slate-400">
                            ບໍ່ພົບລາຍການຂາຍສິນຄ້າໃນຊ່ວງເວລານີ້
                          </p>
                          <p className="text-[11px] text-slate-500">
                            ລອງປ່ຽນວັນທີ, ເດືອນ, ປີ ຫຼື ປັບຕົວກອງສິນຄ້າ/ຜູ້ຂາຍໃໝ່
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredItemizedList.map((item, idx) => {
                      const sellersArr = Array.from(item.sellers.entries());
                      const isProfitable = item.grossProfit > 0;

                      return (
                        <tr
                          key={item.productId}
                          className="hover:bg-slate-800/40 transition-colors group"
                        >
                          {/* Col 1: Index */}
                          <td className="py-3 px-3 text-center text-slate-500 font-mono font-bold">
                            #{idx + 1}
                          </td>

                          {/* Col 2: Product info */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  alt={item.productName}
                                  className="w-8 h-8 rounded-lg object-cover border border-slate-700 shrink-0"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-slate-400">
                                  {item.category === 'beer' ? (
                                    <Beer className="w-4 h-4 text-amber-400" />
                                  ) : item.category === 'food' ? (
                                    <UtensilsCrossed className="w-4 h-4 text-rose-400" />
                                  ) : (
                                    <Coffee className="w-4 h-4 text-blue-400" />
                                  )}
                                </div>
                              )}
                              <div>
                                <div className="font-bold text-slate-100 flex items-center gap-1.5">
                                  <span>{item.productName}</span>
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {renderCategoryBadge(item.category)}
                                  <span className="text-[10px] text-slate-400">
                                    ຫົວໜ່ວຍ: {item.unit}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Col 3: Cost Price / Unit */}
                          <td className="py-3 px-3 text-right font-mono text-slate-400">
                            {formatCurrency(item.costPrice, settings.currencySymbol)}
                          </td>

                          {/* Col 4: Average Sale Price / Unit */}
                          <td className="py-3 px-3 text-right font-mono text-slate-300">
                            {formatCurrency(item.salePriceAvg, settings.currencySymbol)}
                          </td>

                          {/* Col 5: Total Qty Sold */}
                          <td className="py-3 px-3 text-center">
                            <span className="font-mono text-sm font-black text-amber-400">
                              {item.totalQty.toLocaleString()}
                            </span>{' '}
                            <span className="text-[11px] text-slate-400">{item.unit}</span>
                          </td>

                          {/* Col 6: Total Cost */}
                          <td className="py-3 px-3 text-right font-mono font-semibold text-rose-400">
                            {formatCurrency(item.totalCost, settings.currencySymbol)}
                          </td>

                          {/* Col 7: Total Revenue */}
                          <td className="py-3 px-4 text-right font-mono font-bold text-amber-300 text-sm">
                            {formatCurrency(item.totalRevenue, settings.currencySymbol)}
                          </td>

                          {/* Col 8: Gross Profit (Highlight) */}
                          <td className="py-3 px-4 text-right">
                            <span
                              className={`font-mono font-black text-sm px-2 py-0.5 rounded-lg inline-block ${
                                isProfitable
                                  ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/60'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {formatCurrency(item.grossProfit, settings.currencySymbol)}
                            </span>
                          </td>

                          {/* Sellers Breakdown with Qty & Profit */}
                          <td className="py-3 px-4">
                            {sellersArr.length > 0 ? (
                              <div className="flex flex-col gap-1 max-w-[240px]">
                                {sellersArr.map(([sellerName, data]) => (
                                  <div
                                    key={sellerName}
                                    className="bg-slate-800/80 border border-purple-500/30 rounded-lg p-1.5 text-[11px] flex items-center justify-between gap-1"
                                  >
                                    <div className="flex items-center gap-1 font-semibold text-purple-300 truncate">
                                      <User className="w-3 h-3 shrink-0 text-purple-400" />
                                      <span className="truncate">{sellerName}:</span>
                                      <span className="text-amber-300 font-mono">
                                        {data.qty} {item.unit}
                                      </span>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/50 px-1 py-0.5 rounded">
                                        ກຳໄລ: +{formatCurrency(data.profit, '')}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-500 text-[11px]">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {/* Table Footer Totals */}
                {filteredItemizedList.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-950 border-t-2 border-slate-700 font-bold text-xs">
                      <td colSpan={4} className="py-3.5 px-4 text-slate-300">
                        ລວມຍອດສິນຄ້າທີ່ເລືອກ ({filteredItemizedList.length} ລາຍການ):
                      </td>
                      <td className="py-3.5 px-3 text-center font-mono font-black text-amber-400">
                        {summaryStats.selTotalQty.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono font-black text-rose-400">
                        {formatCurrency(summaryStats.selTotalCost, settings.currencySymbol)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-black text-amber-300 text-sm">
                        {formatCurrency(summaryStats.selTotalRevenue, settings.currencySymbol)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-black text-emerald-400 text-sm">
                        {formatCurrency(summaryStats.selGrossProfit, settings.currencySymbol)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CHOICE 1: OVERALL SUMMARY & STORE FINANCIAL SNAPSHOT + SELLER PERFORMANCE */}
      {activeChoice === 'overall' && (
        <div className="space-y-6">
          {/* 5 Cards Stat Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Card 1: Total Revenue */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>ຍອດຂາຍລວມທັງໝົດ</span>
                <span className="p-1.5 rounded-xl bg-rose-500/10 text-rose-400">
                  <ArrowUpRight className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-rose-400">
                {formatCurrency(totalRevenue, settings.currencySymbol)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                ຈຳນວນ {filteredBills.length} ໃບບິນ
              </p>
            </div>

            {/* Card 2: Room Revenue */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>ຄ່າຫ້ອງຄາຣາໂອເກະ</span>
                <span className="p-1.5 rounded-xl bg-purple-500/10 text-purple-400">
                  <DoorOpen className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-purple-400">
                {formatCurrency(totalRoomCharge, settings.currencySymbol)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {((totalRoomCharge / (totalRevenue || 1)) * 100).toFixed(1)}% ຂອງຍອດຂາຍ
              </p>
            </div>

            {/* Card 3: Food & Drinks Revenue */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>ຄ່າເຄື່ອງດື່ມ & ອາຫານ</span>
                <span className="p-1.5 rounded-xl bg-amber-500/10 text-amber-400">
                  <Beer className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-amber-400">
                {formatCurrency(totalItemsCharge, settings.currencySymbol)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {((totalItemsCharge / (totalRevenue || 1)) * 100).toFixed(1)}% ຂອງຍອດຂາຍ
              </p>
            </div>

            {/* Card 4: Total Import Cost of Goods */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>ຕົ້ນທຶນສິນຄ້ານຳເຂົ້າ</span>
                <span className="p-1.5 rounded-xl bg-rose-500/10 text-rose-400">
                  <PackageCheck className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-rose-400">
                {formatCurrency(summaryStats.allItemsCost, settings.currencySymbol)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                ຕົ້ນທຶນເຄື່ອງດື່ມ-ອາຫານ
              </p>
            </div>

            {/* Card 5: Store Gross Profit */}
            <div className="bg-gradient-to-br from-emerald-950/60 to-slate-900 border-2 border-emerald-500/40 rounded-3xl p-5 shadow-xl relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-emerald-400 mb-2">
                <span className="font-bold">ກຳໄລລວມທັງໝົດ</span>
                <span className="p-1.5 rounded-xl bg-emerald-500/20 text-emerald-300">
                  <TrendingUp className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-emerald-400">
                {formatCurrency(summaryStats.allStoreGrossProfit, settings.currencySymbol)}
              </div>
              <p className="text-[11px] text-emerald-300/80 mt-1">
                ຍອດຂາຍລວມ - ຕົ້ນທຶນສິນຄ້າ
              </p>
            </div>
          </div>

          {/* DEDICATED SELLER PERFORMANCE & PROFIT TABLE (REQUESTED FEATURE) */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-400" />
                  <span>ສະຫຼຸບລາຍລະອຽດຜູ້ຂາຍ / ພະນັກງານ (Seller Sales, Cost & Profit)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  ສະແດງຍອດຂາຍ, ຕົ້ນທຶນ ແລະ ກຳໄລທີ່ພະນັກງານແຕ່ລະຄົນສ້າງໄດ້ (ຍອດຂາຍ - ຕົ້ນທຶນ = ກຳໄລ)
                </p>
              </div>
              <div className="text-xs text-slate-400">
                ມີຜູ້ຂາຍທັງໝົດ <span className="font-bold text-purple-300 font-mono">{sellerPerformanceList.length}</span> ຄົນ
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 uppercase">
                    <th className="py-3 px-3 text-center w-12">ອັນດັບ</th>
                    <th className="py-3 px-4">ຊື່ຜູ້ຂາຍ / ພະນັກງານ (Seller Name)</th>
                    <th className="py-3 px-3 text-center">ຈຳນວນສິນຄ້າທີ່ຂາຍ</th>
                    <th className="py-3 px-4 text-right">ຍອດຂາຍທີ່ສ້າງໄດ້</th>
                    <th className="py-3 px-4 text-right">ຕົ້ນທຶນສິນຄ້າ</th>
                    <th className="py-3 px-4 text-right">ຍອດກຳໄລທີ່ສ້າງໄດ້ (Profit)</th>
                    <th className="py-3 px-4 text-center">ການດຳເນີນການ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sellerPerformanceList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-500">
                        ຍັງບໍ່ມີຂໍ້ມູນການຂາຍຂອງພະນັກງານໃນຊ່ວງເວລານີ້
                      </td>
                    </tr>
                  ) : (
                    sellerPerformanceList.map((seller, idx) => (
                      <tr key={seller.sellerName} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-3 text-center font-mono font-bold">
                          {idx === 0 ? (
                            <span className="p-1 rounded bg-amber-500/20 text-amber-300 inline-flex items-center justify-center">
                              🥇
                            </span>
                          ) : idx === 1 ? (
                            <span className="p-1 rounded bg-slate-700 text-slate-200 inline-flex items-center justify-center">
                              🥈
                            </span>
                          ) : idx === 2 ? (
                            <span className="p-1 rounded bg-amber-800/20 text-amber-400 inline-flex items-center justify-center">
                              🥉
                            </span>
                          ) : (
                            <span className="text-slate-500">#{idx + 1}</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-100 flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-purple-950/80 border border-purple-800 flex items-center justify-center text-purple-300 text-xs font-bold">
                              {seller.sellerName.slice(0, 1)}
                            </div>
                            <span>{seller.sellerName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-bold text-amber-400">
                          {seller.totalUnits.toLocaleString()} ໜ່ວຍ
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-amber-300">
                          {formatCurrency(seller.totalRevenue, settings.currencySymbol)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-rose-400">
                          {formatCurrency(seller.totalCost, settings.currencySymbol)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-black text-emerald-400">
                          <span className="bg-emerald-950/70 border border-emerald-800/60 px-2 py-0.5 rounded-lg">
                            +{formatCurrency(seller.grossProfit, settings.currencySymbol)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => {
                              setSelectedSeller(seller.sellerName);
                              setActiveChoice('itemized');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-purple-600/80 hover:bg-purple-500 text-white text-[11px] font-semibold flex items-center gap-1 mx-auto transition-all cursor-pointer shadow-sm"
                          >
                            <span>ເບິ່ງສິນຄ້າທີ່ຂາຍ</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment Split & Additional Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
              <h4 className="text-xs font-bold text-slate-300 mb-3 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-emerald-400" />
                <span>ຊ່ອງທາງຊຳລະເງິນ (Payment Split)</span>
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-800">
                  <span className="text-slate-400">💵 ເງິນສົດ (Cash):</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {formatCurrency(totalCash, settings.currencySymbol)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-400">📱 ໂອນ / QR Transfer:</span>
                  <span className="font-mono font-bold text-blue-400">
                    {formatCurrency(totalTransfer, settings.currencySymbol)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
              <h4 className="text-xs font-bold text-slate-300 mb-3 flex items-center gap-2">
                <Percent className="w-4 h-4 text-amber-400" />
                <span>ສ່ວນຫຼຸດທີ່ມອບໃຫ້ (Discounts Given)</span>
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-800">
                  <span className="text-slate-400">ສ່ວນຫຼຸດລວມ:</span>
                  <span className="font-mono font-bold text-rose-400">
                    -{formatCurrency(totalDiscount, settings.currencySymbol)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-400">ສະເລ່ຍຕໍ່ບິນ:</span>
                  <span className="font-mono font-bold text-slate-300">
                    {filteredBills.length > 0
                      ? formatCurrency(
                          Math.round(totalDiscount / filteredBills.length),
                          settings.currencySymbol
                        )
                      : '0 ' + settings.currencySymbol}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
              <h4 className="text-xs font-bold text-slate-300 mb-3 flex items-center gap-2">
                <PackageCheck className="w-4 h-4 text-purple-400" />
                <span>ກຳໄລສະເພາະສິນຄ້າ (Food & Drinks Profit)</span>
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-800">
                  <span className="text-slate-400">ກຳໄລສິນຄ້າ (ບໍ່ລວມຄ່າຫ້ອງ):</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {formatCurrency(summaryStats.allItemsProfit, settings.currencySymbol)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-400">ຍອດຂາຍສິນຄ້າລວມ:</span>
                  <span className="font-mono font-bold text-amber-300">
                    {formatCurrency(summaryStats.allItemsRevenue, settings.currencySymbol)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Bills History Table with Cost & Profit per Bill */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-rose-500" />
                <span>ປະຫວັດໃບບິນໃນຊ່ວງເວລານີ້ ({filteredBills.length} ບິນ)</span>
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 uppercase">
                    <th className="py-3 px-4">ເລກທີບິນ</th>
                    <th className="py-3 px-4">ເວລາ</th>
                    <th className="py-3 px-4">ປະເພດ / ຫ້ອງ</th>
                    <th className="py-3 px-4">ພະນັກງານ/ຜູ້ຂາຍ</th>
                    <th className="py-3 px-4 text-right">ຄ່າຫ້ອງ</th>
                    <th className="py-3 px-4 text-right">ຕົ້ນທຶນສິນຄ້າ</th>
                    <th className="py-3 px-4 text-right">ຍອດສຸດທິ</th>
                    <th className="py-3 px-4 text-right">ກຳໄລບິນ (Profit)</th>
                    <th className="py-3 px-4 text-center">ເບິ່ງບິນ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredBills.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-500">
                        ບໍ່ພົບໃບບິນໃນຊ່ວງເວລານີ້
                      </td>
                    </tr>
                  ) : (
                    filteredBills.map((b) => {
                      const { billItemsCost, billProfit } = getBillCostAndProfit(b);
                      return (
                        <tr key={b.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-amber-400">
                            {b.billNumber}
                          </td>
                          <td className="py-3 px-4 text-slate-400">
                            {new Date(b.endTime).toLocaleTimeString('lo-LA')}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                b.type === 'ktv_room'
                                  ? 'bg-purple-950/80 text-purple-300 border border-purple-800'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {b.roomName || 'ຂາຍໜ້າຮ້ານ (POS)'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-300 font-semibold">{b.staffName}</td>
                          <td className="py-3 px-4 text-right font-mono text-slate-400">
                            {formatCurrency(b.roomCharge, settings.currencySymbol)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-rose-400">
                            {formatCurrency(billItemsCost, settings.currencySymbol)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-amber-300">
                            {formatCurrency(b.total, settings.currencySymbol)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-black text-emerald-400">
                            +{formatCurrency(billProfit, settings.currencySymbol)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => setInspectedBill(b)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View Individual Bill Details with Cost & Profit */}
      {inspectedBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl text-white">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div>
                <h4 className="font-bold text-sm text-slate-100">
                  ລາຍລະອຽດໃບບິນ: {inspectedBill.billNumber}
                </h4>
                <p className="text-[11px] text-slate-400">
                  {new Date(inspectedBill.endTime).toLocaleString('lo-LA')} | ຜູ້ດຳເນີນການ: {inspectedBill.staffName}
                </p>
              </div>
              <button
                onClick={() => setInspectedBill(null)}
                className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs mb-4 max-h-60 overflow-y-auto pr-1">
              {inspectedBill.startTime && (
                <div className="flex justify-between py-1 border-b border-slate-800 text-[11px] text-slate-300">
                  <span>ເວລາເປີດ - ສິ້ນສຸດ:</span>
                  <span className="font-mono font-bold text-amber-300">
                    {new Date(inspectedBill.startTime).toLocaleTimeString('lo-LA', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}{' '}
                    ຫາ{' '}
                    {new Date(inspectedBill.endTime).toLocaleTimeString('lo-LA', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </span>
                </div>
              )}
              {inspectedBill.timeRangeFormatted && (
                <div className="flex justify-between py-0.5 text-[10px] text-slate-400">
                  <span>ກຳນົດໄລຍະເວລາ:</span>
                  <span>{inspectedBill.timeRangeFormatted}</span>
                </div>
              )}
              {inspectedBill.roomCharge > 0 && (
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span>ຄ່າຫ້ອງ ({inspectedBill.roomName})</span>
                  <span className="font-mono text-amber-400">
                    {formatCurrency(inspectedBill.roomCharge, settings.currencySymbol)}
                  </span>
                </div>
              )}

              {inspectedBill.items.map((it, idx) => {
                const matched =
                  productLookup.get(it.productId) ||
                  productLookup.get(it.productName.trim().toLowerCase());
                const cost =
                  it.costPrice !== undefined ? it.costPrice : matched?.costPrice ?? 0;
                const itemTotalCost = it.quantity * cost;
                const itemProfit = it.total - itemTotalCost;

                return (
                  <div key={idx} className="py-1.5 border-b border-slate-800/60">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-semibold text-slate-200">{it.productName}</span>
                        <span className="text-[10px] text-slate-400 block">
                          {it.quantity} {it.unit} × {formatCurrency(it.price, '')}
                          {it.sellerName ? ` (ຜູ້ຂາຍ: ${it.sellerName})` : ''}
                        </span>
                      </div>
                      <span className="font-mono text-slate-200 font-bold">
                        {formatCurrency(it.total, settings.currencySymbol)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-slate-400 mt-0.5 pt-0.5 border-t border-slate-800/40">
                      <span>ຕົ້ນທຶນ: {formatCurrency(itemTotalCost, '')}</span>
                      <span className="text-emerald-400 font-bold font-mono">
                        ກຳໄລ: +{formatCurrency(itemProfit, settings.currencySymbol)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bill Financial Summary */}
            {(() => {
              const { billItemsCost, billProfit } = getBillCostAndProfit(inspectedBill);
              return (
                <div className="space-y-1.5 pt-2 border-t border-slate-800 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>ລວມເງິນ:</span>
                    <span>{formatCurrency(inspectedBill.subtotal, settings.currencySymbol)}</span>
                  </div>
                  {inspectedBill.discount > 0 && (
                    <div className="flex justify-between text-rose-400">
                      <span>ສ່ວນຫຼຸດ:</span>
                      <span>-{formatCurrency(inspectedBill.discount, settings.currencySymbol)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-400">
                    <span>ຕົ້ນທຶນສິນຄ້ານຳເຂົ້າ:</span>
                    <span className="font-mono text-rose-400">
                      {formatCurrency(billItemsCost, settings.currencySymbol)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-amber-300 pt-1 border-t border-slate-800">
                    <span>ຍອດສຸດທິ:</span>
                    <span>{formatCurrency(inspectedBill.total, settings.currencySymbol)}</span>
                  </div>
                  <div className="flex justify-between text-base font-black text-emerald-400 pt-1 border-t border-slate-700 bg-emerald-950/40 px-2.5 py-1.5 rounded-xl">
                    <span>ຍອດກຳໄລບິນນີ້:</span>
                    <span>+{formatCurrency(billProfit, settings.currencySymbol)}</span>
                  </div>
                </div>
              );
            })()}

            <button
              onClick={() => setInspectedBill(null)}
              className="mt-4 w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
            >
              ປິດ
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
