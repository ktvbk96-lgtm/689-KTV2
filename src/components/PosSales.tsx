import React, { useState } from 'react';
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  AlertTriangle,
  XCircle,
  User,
  DoorOpen,
  Receipt,
  Sparkles,
  Beer,
  Coffee,
  UtensilsCrossed,
  Cookie,
  UserCheck,
  CheckCircle2,
  Edit2,
  Check,
  X,
  DollarSign,
} from 'lucide-react';
import { Product, ProductCategory, CartItem, StaffMember, Room, AppSettings } from '../types';
import { formatCurrency } from '../lib/storage';
import {
  FormattedNumberInput,
  formatWithSeparators,
  parseCleanNumber,
} from './FormattedNumberInput';

interface PosSalesProps {
  products: Product[];
  staffList: StaffMember[];
  activeRooms: Room[];
  settings: AppSettings;
  currentStaff?: StaffMember;
  onCheckoutPosSale: (
    items: CartItem[],
    discount: number,
    paymentMethod: 'cash' | 'transfer',
    cashReceived?: number
  ) => void;
  onTransferToRoom: (roomId: string, items: CartItem[]) => void;
}

export const PosSales: React.FC<PosSalesProps> = ({
  products,
  staffList,
  activeRooms,
  settings,
  currentStaff,
  onCheckoutPosSale,
  onTransferToRoom,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountAmount, setDiscountAmount] = useState<number>(0);

  // Seller selection modal for items that require seller
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [pendingQty, setPendingQty] = useState<number>(1);
  const [pendingPrice, setPendingPrice] = useState<string>('');
  const [selectedSellerId, setSelectedSellerId] = useState<string>('');
  const [sellerModalError, setSellerModalError] = useState<string>('');

  // Inline custom price editing on cart item
  const [editingPriceIndex, setEditingPriceIndex] = useState<number | null>(null);
  const [tempPriceInput, setTempPriceInput] = useState<string>('');

  // Seller change dropdown state on cart item
  const [editingSellerIndex, setEditingSellerIndex] = useState<number | null>(null);

  // Room transfer modal
  const [showRoomSelectModal, setShowRoomSelectModal] = useState<boolean>(false);

  const categories: { id: ProductCategory | 'all'; label: string; icon: any }[] = [
    { id: 'all', label: 'ທັງໝົດ (All)', icon: Sparkles },
    { id: 'beer', label: 'ເບຍ & ເຫຼົ້າ (Beer)', icon: Beer },
    { id: 'drink', label: 'ເຄື່ອງດື່ມ (Drinks)', icon: Coffee },
    { id: 'food', label: 'ອາຫານ (Food)', icon: UtensilsCrossed },
    { id: 'snack', label: 'ຂອງກິນຫຼິ້ນ (Snacks)', icon: Cookie },
    { id: 'service', label: 'ບໍລິການ (Service)', icon: UserCheck },
  ];

  const getCategoryStyle = (category: ProductCategory) => {
    switch (category) {
      case 'beer':
        return {
          label: 'ເບຍ & ເຫຼົ້າ',
          badge: 'bg-amber-950/80 text-amber-300 border-amber-500/40',
          activePill:
            'bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-950 font-black shadow-lg shadow-amber-500/25',
          cardBorder: 'hover:border-amber-400 border-amber-900/40 hover:shadow-amber-500/10',
          priceColor: 'text-amber-400',
          btnBg: 'group-hover:bg-amber-500 group-hover:text-slate-950',
          dot: 'bg-amber-400',
        };
      case 'drink':
        return {
          label: 'ເຄື່ອງດື່ມ',
          badge: 'bg-sky-950/80 text-sky-300 border-sky-500/40',
          activePill:
            'bg-gradient-to-r from-sky-500 to-cyan-400 text-slate-950 font-black shadow-lg shadow-sky-500/25',
          cardBorder: 'hover:border-sky-400 border-sky-900/40 hover:shadow-sky-500/10',
          priceColor: 'text-sky-400',
          btnBg: 'group-hover:bg-sky-500 group-hover:text-slate-950',
          dot: 'bg-sky-400',
        };
      case 'food':
        return {
          label: 'ອາຫານ',
          badge: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40',
          activePill:
            'bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950 font-black shadow-lg shadow-emerald-500/25',
          cardBorder: 'hover:border-emerald-400 border-emerald-900/40 hover:shadow-emerald-500/10',
          priceColor: 'text-emerald-400',
          btnBg: 'group-hover:bg-emerald-500 group-hover:text-slate-950',
          dot: 'bg-emerald-400',
        };
      case 'snack':
        return {
          label: 'ຂອງກິນຫຼິ້ນ',
          badge: 'bg-orange-950/80 text-orange-300 border-orange-500/40',
          activePill:
            'bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 font-black shadow-lg shadow-orange-500/25',
          cardBorder: 'hover:border-orange-400 border-orange-900/40 hover:shadow-orange-500/10',
          priceColor: 'text-orange-400',
          btnBg: 'group-hover:bg-orange-500 group-hover:text-slate-950',
          dot: 'bg-orange-400',
        };
      case 'service':
        return {
          label: 'ບໍລິການ PR',
          badge: 'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-500/40',
          activePill:
            'bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white font-black shadow-lg shadow-fuchsia-500/25',
          cardBorder: 'hover:border-fuchsia-400 border-fuchsia-900/40 hover:shadow-fuchsia-500/10',
          priceColor: 'text-fuchsia-400',
          btnBg: 'group-hover:bg-fuchsia-500 group-hover:text-white',
          dot: 'bg-fuchsia-400',
        };
      default:
        return {
          label: 'ອື່ນໆ',
          badge: 'bg-slate-800 text-slate-300 border-slate-700',
          activePill: 'bg-slate-200 text-slate-950 font-black shadow-md',
          cardBorder: 'hover:border-slate-500 border-slate-800',
          priceColor: 'text-slate-200',
          btnBg: 'group-hover:bg-slate-700',
          dot: 'bg-slate-400',
        };
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.unit.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const getItemUnitPrice = (item: CartItem) => {
    return item.customPrice !== undefined ? item.customPrice : item.product.salePrice;
  };

  const handleProductClick = (product: Product) => {
    if (product.stock <= 0 && product.category !== 'service') {
      alert(`ສິນຄ້າ "${product.name}" ໝົດສະຕັອກແລ້ວ! ບໍ່ສາມາດຂາຍໄດ້`);
      return;
    }

    if (product.requireSeller) {
      setPendingProduct(product);
      setPendingQty(1);
      setPendingPrice(formatWithSeparators(product.salePrice));
      setSelectedSellerId(''); // ComboBox starts blank/empty as requested!
      setSellerModalError('');
      return;
    }

    addToCart(product, 1);
  };

  const confirmSellerSelection = () => {
    if (!pendingProduct) return;
    if (!selectedSellerId) {
      setSellerModalError('ທ່ານລືມເລືອກຊື່ຜູ້ຂາຍ! ກະລຸນາກົດເລືອກພະນັກງານຂາຍໃນ ComboBox ກ່ອນ');
      alert('⚠️ ທ່ານລືມເລືອກຊື່ຜູ້ຂາຍ! ກະລຸນາເລືອກພະນັກງານຂາຍໃນ ComboBox ກ່ອນຂາຍ');
      return;
    }
    const numericPrice = parseCleanNumber(pendingPrice);
    if (numericPrice <= 0) {
      setSellerModalError('ທ່ານລືມປ້ອນຈຳນວນເງິນ! ລາຄາສິນຄ້າຕ້ອງຫຼາຍກວ່າ 0 ₭');
      alert('⚠️ ທ່ານລືມປ້ອນຈຳນວນເງິນ! ລາຄາສິນຄ້າຕ້ອງຫຼາຍກວ່າ 0 ₭ (ບໍ່ສາມາດຂາຍ 0 ₭ ໄດ້)');
      return;
    }
    const seller = staffList.find((s) => s.id === selectedSellerId);
    addToCart(pendingProduct, pendingQty, selectedSellerId, seller?.name, numericPrice);
    setPendingProduct(null);
    setSellerModalError('');
  };

  const addToCart = (
    product: Product,
    quantity: number,
    sellerId?: string,
    sellerName?: string,
    customPrice?: number
  ) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (item) =>
          item.product.id === product.id &&
          item.sellerId === sellerId &&
          item.customPrice === customPrice
      );

      const currentQtyInCart = existingIndex > -1 ? prev[existingIndex].quantity : 0;
      const totalRequested = currentQtyInCart + quantity;

      if (product.category !== 'service' && totalRequested > product.stock) {
        alert(
          `ບໍ່ສາມາດເພີ່ມໄດ້! ສະຕັອກຄົງເຫຼືອພຽງ ${product.stock} ${product.unit} (ໃນກະຕ່າແລ້ວ ${currentQtyInCart})`
        );
        return prev;
      }

      if (existingIndex > -1) {
        const updated = [...prev];
        updated[existingIndex].quantity += quantity;
        return updated;
      }

      return [
        ...prev,
        {
          product,
          quantity,
          sellerId,
          sellerName,
          customPrice,
        },
      ];
    });
  };

  const updateQuantity = (index: number, newQty: number) => {
    if (newQty <= 0) {
      removeFromCart(index);
      return;
    }

    const item = cart[index];
    if (item.product.category !== 'service' && newQty > item.product.stock) {
      alert(`ສະຕັອກສິນຄ້າ "${item.product.name}" ມີພຽງ ${item.product.stock} ${item.product.unit}`);
      return;
    }

    setCart((prev) => {
      const updated = [...prev];
      updated[index].quantity = newQty;
      return updated;
    });
  };

  const removeFromCart = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
    if (editingPriceIndex === index) {
      setEditingPriceIndex(null);
    }
    if (editingSellerIndex === index) {
      setEditingSellerIndex(null);
    }
  };

  const clearCart = () => {
    setCart([]);
    setDiscountAmount(0);
    setEditingPriceIndex(null);
    setEditingSellerIndex(null);
  };

  // Custom price update on a cart row
  const handleStartEditPrice = (index: number, currentPrice: number) => {
    setEditingPriceIndex(index);
    setTempPriceInput(formatWithSeparators(currentPrice));
  };

  const handleSaveCustomPrice = (index: number) => {
    const parsed = parseCleanNumber(tempPriceInput);
    if (parsed <= 0) {
      alert('⚠️ ທ່ານລືມປ້ອນຈຳນວນເງິນ! ລາຄາສິນຄ້າຕ້ອງຫຼາຍກວ່າ 0 ₭');
      return;
    }
    setCart((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], customPrice: parsed };
      return updated;
    });
    setEditingPriceIndex(null);
  };

  const handleResetToStandardPrice = (index: number) => {
    setCart((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], customPrice: undefined };
      return updated;
    });
    setEditingPriceIndex(null);
  };

  // Update seller on a cart item row
  const handleUpdateCartItemSeller = (index: number, newSellerId: string) => {
    const s = staffList.find((staff) => staff.id === newSellerId);
    setCart((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        sellerId: newSellerId,
        sellerName: s?.name,
      };
      return updated;
    });
    setEditingSellerIndex(null);
  };

  const subtotal = cart.reduce((acc, item) => acc + getItemUnitPrice(item) * item.quantity, 0);
  const total = Math.max(0, subtotal - discountAmount);

  const handleCompleteSale = () => {
    if (cart.length === 0) {
      alert('ກະຕ່າວ່າງເປົ່າ! ກະລຸນາເລືອກສິນຄ້າກ່ອນ');
      return;
    }

    // Check if any cart item requiring seller is missing sellerId
    const missingSellerItem = cart.find(
      (item) => item.product.requireSeller && (!item.sellerId || item.sellerId.trim() === '')
    );
    if (missingSellerItem) {
      alert(
        `⚠️ ທ່ານລືມເລືອກຊື່ຜູ້ຂາຍ! ລາຍການ "${missingSellerItem.product.name}" ຍັງບໍ່ມີຊື່ຜູ້ຂາຍ ກະລຸນາເລືອກຊື່ຜູ້ຂາຍກ່ອນດຳເນີນການຂາຍ`
      );
      return;
    }

    // Check if any item has 0 or negative price
    const zeroPriceItem = cart.find((item) => getItemUnitPrice(item) <= 0);
    if (zeroPriceItem) {
      alert(
        `⚠️ ທ່ານລືມປ້ອນຈຳນວນເງິນ! ລາຍການ "${zeroPriceItem.product.name}" ມີລາຄາເປັນ 0 ₭ ກະລຸນາປ້ອນລາຄາສິນຄ້າໃຫ້ຖືກຕ້ອງ`
      );
      return;
    }

    onCheckoutPosSale(
      cart,
      discountAmount,
      'cash'
    );
    clearCart();
  };

  const handleTransferConfirm = (roomId: string) => {
    if (cart.length === 0) return;
    onTransferToRoom(roomId, cart);
    clearCart();
    setShowRoomSelectModal(false);
  };

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
      {/* 1. STICKY TOP CART BAR (ປຸ່ມກະຕ່າຢູ່ເທິງສຸດ) */}
      <div className="sticky top-16 z-30 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-3xl p-3 sm:p-4 shadow-2xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-tr from-rose-500/20 to-amber-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
            <ShoppingCart className="w-5 h-5" />
            {totalCartCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-gradient-to-r from-rose-500 to-amber-500 text-slate-950 text-[11px] font-black w-5 h-5 rounded-full flex items-center justify-center shadow-md animate-pulse">
                {totalCartCount}
              </span>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-sm text-slate-100">ກະຕ່າສິນຄ້າ (POS Cart)</span>
              <span className="text-[11px] text-slate-400 font-semibold hidden sm:inline">
                {cart.length} ລາຍການ ({totalCartCount} ອັນ)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">ຍອດລວມ:</span>
              <span className="font-mono font-black text-base text-amber-400">
                {formatCurrency(subtotal, settings.currencySymbol)}
              </span>
              {discountAmount > 0 && (
                <span className="text-[11px] text-rose-400 font-semibold">
                  (ຫຼຸດ -{formatCurrency(discountAmount, settings.currencySymbol)})
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {cart.length > 0 && (
            <button
              type="button"
              onClick={clearCart}
              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950 border border-slate-700 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
              title="ລ້າງກະຕ່າສິນຄ້າ"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const el = document.getElementById('pos-cart-panel');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="py-2.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-black text-xs shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>ເບິ່ງກະຕ່າ & ຄິດເງິນ ({formatCurrency(total, settings.currencySymbol)})</span>
          </button>
        </div>
      </div>

      {/* Main Catalog & Cart Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Product Catalog Section (7-8 cols) */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-4">
          {/* Search & Category Pills */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-lg space-y-3">
            {/* Search Box */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ຄົ້ນຫາສິນຄ້າ, ເຄື່ອງດື່ມ, ອາຫານ, ເບຍ..."
                className="w-full bg-slate-800 border border-slate-700 rounded-2xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all"
              />
            </div>

            {/* Categories */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {categories.map((cat) => {
                const Icon = cat.icon;
                const isSelected = selectedCategory === cat.id;
                const catStyle = cat.id !== 'all' ? getCategoryStyle(cat.id) : null;
                const activeClass =
                  cat.id === 'all'
                    ? 'bg-gradient-to-r from-rose-500 to-amber-500 text-white font-black shadow-md'
                    : catStyle?.activePill;

                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                      isSelected
                        ? activeClass
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-750 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Products Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {filteredProducts.map((product) => {
              const isOutOfStock = product.stock <= 0 && product.category !== 'service';
              const isLowStock =
                !isOutOfStock && product.stock <= product.minStockAlert && product.category !== 'service';
              const catStyle = getCategoryStyle(product.category);

              return (
                <div
                  key={product.id}
                  onClick={() => !isOutOfStock && handleProductClick(product)}
                  className={`relative group rounded-3xl p-3.5 flex flex-col justify-between transition-all duration-200 border text-left ${
                    isOutOfStock
                      ? 'bg-rose-950/20 border-rose-800/60 cursor-not-allowed opacity-80'
                      : isLowStock
                      ? 'bg-slate-900 border-amber-500/50 hover:border-amber-400 hover:shadow-lg hover:shadow-amber-500/10 cursor-pointer'
                      : `bg-slate-900 border-slate-800 ${catStyle.cardBorder} hover:shadow-lg cursor-pointer active:scale-[0.98]`
                  }`}
                >
                  <div>
                    {/* Product Image Banner */}
                    <div className="relative w-full h-24 mb-2.5 rounded-2xl overflow-hidden bg-slate-950 border border-slate-800/80 flex items-center justify-center">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 ${
                            isOutOfStock ? 'grayscale opacity-40' : ''
                          }`}
                          loading="lazy"
                          onError={(e) => {
                            (e.target as any).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-slate-950/60">
                          <span className="text-2xl opacity-60">
                            {product.category === 'beer'
                              ? '🍺'
                              : product.category === 'drink'
                              ? '🥤'
                              : product.category === 'food'
                              ? '🍗'
                              : product.category === 'snack'
                              ? '🍟'
                              : product.category === 'service'
                              ? '👑'
                              : '📦'}
                          </span>
                        </div>
                      )}

                      {/* Category Pill */}
                      <div className="absolute top-1.5 left-1.5">
                        <span
                          className={`text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border backdrop-blur-md ${catStyle.badge}`}
                        >
                          {catStyle.label}
                        </span>
                      </div>

                      {/* Stock Alert Badge */}
                      <div className="absolute top-1.5 right-1.5">
                        {isOutOfStock ? (
                          <span className="flex items-center gap-1 text-[9px] font-bold text-rose-300 bg-rose-950/90 border border-rose-700 px-1.5 py-0.5 rounded-full animate-pulse shadow">
                            <XCircle className="w-2.5 h-2.5 text-rose-400" />
                            <span>ໝົດ!</span>
                          </span>
                        ) : isLowStock ? (
                          <span className="flex items-center gap-1 text-[9px] font-bold text-amber-300 bg-amber-950/90 border border-amber-600 px-1.5 py-0.5 rounded-full shadow">
                            <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                            <span>ໃກ້ໝົດ ({product.stock})</span>
                          </span>
                        ) : (
                          <span className="text-[9px] font-medium text-slate-200 bg-slate-900/80 px-1.5 py-0.5 rounded-md backdrop-blur-sm border border-slate-700/60">
                            {product.stock} {product.unit}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Product Name */}
                    <h3 className="font-bold text-sm text-slate-100 line-clamp-1 mb-0.5 group-hover:text-white transition-colors">
                      {product.name}
                    </h3>

                    {product.requireSeller && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-fuchsia-300 bg-fuchsia-950/60 px-1.5 py-0.5 rounded border border-fuchsia-800/50 mb-1">
                        <User className="w-3 h-3" />
                        <span>ຕ້ອງເລືອກຜູ້ຂາຍ</span>
                      </span>
                    )}
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    <span className={`text-sm font-extrabold font-mono ${catStyle.priceColor}`}>
                      {formatCurrency(product.salePrice, settings.currencySymbol)}
                    </span>

                    {isOutOfStock ? (
                      <span className="text-[11px] font-bold text-rose-500 bg-rose-500/10 px-2 py-1 rounded-xl">
                        ຫ້າມຂາຍ
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={`p-1.5 rounded-xl bg-slate-800 ${catStyle.btnBg} text-slate-300 transition-all shadow-sm`}
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cart / Order Section (4-5 cols) */}
        <div id="pos-cart-panel" className="lg:col-span-5 xl:col-span-4 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex flex-col sticky top-24">
            {/* Cart Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-rose-400" />
                <h2 className="font-bold text-base text-slate-100">ລາຍການໃນກະຕ່າ (Order Cart)</h2>
                <span className="bg-rose-500/20 text-rose-300 text-xs px-2 py-0.5 rounded-full font-bold">
                  {totalCartCount}
                </span>
              </div>
              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 font-semibold cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>ລ້າງ</span>
                </button>
              )}
            </div>

            {/* Cart Items List with Custom Price & Seller Switch */}
            <div className="overflow-y-auto py-3 space-y-2.5 max-h-[380px] pr-1 scrollbar-thin">
              {cart.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center text-slate-500">
                  <ShoppingCart className="w-12 h-12 stroke-[1.2] mb-2 text-slate-600" />
                  <p className="text-sm font-medium">ບໍ່ມີລາຍການສິນຄ້າໃນກະຕ່າ</p>
                  <p className="text-xs text-slate-500 mt-1">
                    ກົດເລືອກສິນຄ້າຈາກເມນູດ້ານຊ້າຍເພື່ອເລີ່ມຂາຍ
                  </p>
                </div>
              ) : (
                cart.map((item, idx) => {
                  const unitPrice = getItemUnitPrice(item);
                  const isCustomPrice = item.customPrice !== undefined;
                  const isEditingPrice = editingPriceIndex === idx;
                  const isEditingSeller = editingSellerIndex === idx;

                  return (
                    <div
                      key={`${item.product.id}-${item.sellerId}-${idx}`}
                      className="bg-slate-800/70 border border-slate-700/60 rounded-2xl p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-slate-100 truncate">
                            {item.product.name}
                          </h4>

                          {/* Price & Custom Price Input */}
                          <div className="flex items-center gap-2 mt-1">
                            {isEditingPrice ? (
                              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-amber-500/60">
                                <span className="text-[10px] text-slate-400 pl-1">ລາຄາ:</span>
                                <div className="w-24">
                                  <FormattedNumberInput
                                    value={tempPriceInput}
                                    onChange={(num, formatted) => setTempPriceInput(formatted)}
                                    placeholder="0"
                                    autoFocus
                                    className="bg-slate-800 border border-slate-700 rounded-lg px-1.5 py-0.5 text-xs text-amber-400 font-mono font-bold"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleSaveCustomPrice(idx)}
                                  className="p-1 rounded bg-emerald-600 text-white cursor-pointer"
                                  title="ບັນທຶກລາຄາ"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleResetToStandardPrice(idx)}
                                  className="p-1 rounded bg-slate-700 text-slate-300 cursor-pointer"
                                  title="ໃຊ້ລາຄາມາດຕະຖານ"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleStartEditPrice(idx, unitPrice)}
                                className="group/price flex items-center gap-1 text-[11px] font-mono text-amber-400 hover:text-amber-300 cursor-pointer bg-slate-900/60 px-2 py-0.5 rounded-lg border border-slate-700/80"
                                title="ກົດເພື່ອປ້ອນລາຄາເອງ"
                              >
                                <span className="font-bold">
                                  {formatCurrency(unitPrice, settings.currencySymbol)}
                                </span>
                                {isCustomPrice ? (
                                  <span className="text-[9px] text-amber-300 bg-amber-950/80 px-1 rounded border border-amber-500/40 font-sans">
                                    ປັບເອງ
                                  </span>
                                ) : (
                                  <Edit2 className="w-2.5 h-2.5 opacity-60 group-hover/price:opacity-100 text-slate-400" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Quantity modifier */}
                        <div className="flex items-center gap-1 bg-slate-900 rounded-xl p-1 border border-slate-700">
                          <button
                            onClick={() => updateQuantity(idx, item.quantity - 1)}
                            className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-6 text-center text-xs font-bold font-mono text-white">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(idx, item.quantity + 1)}
                            className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Line Total */}
                        <div className="text-right min-w-[70px]">
                          <span className="text-xs font-black text-slate-100 font-mono">
                            {formatCurrency(unitPrice * item.quantity, settings.currencySymbol)}
                          </span>
                        </div>
                      </div>

                      {/* Seller Tag & Quick Switch */}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-700/40 text-[11px]">
                        {isEditingSeller ? (
                          <div className="flex items-center gap-1.5 w-full">
                            <span className="text-[10px] text-slate-400">ປ່ຽນຜູ້ຂາຍ:</span>
                            <select
                              value={item.sellerId || ''}
                              onChange={(e) => handleUpdateCartItemSeller(idx, e.target.value)}
                              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-[11px] text-purple-300 flex-1"
                            >
                              <option value="">-- ບໍ່ລະບຸ --</option>
                              {staffList
                                .filter((s) => s.active)
                                .map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name} ({s.role === 'admin' ? 'Admin' : 'Staff'})
                                  </option>
                                ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setEditingSellerIndex(null)}
                              className="p-1 rounded bg-slate-700 text-slate-300"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 w-full justify-between">
                            <button
                              type="button"
                              onClick={() => setEditingSellerIndex(idx)}
                              className="inline-flex items-center gap-1 text-[10px] bg-purple-950/60 border border-purple-800/40 text-purple-300 px-2 py-0.5 rounded-lg hover:border-purple-500 cursor-pointer"
                              title="ກົດເພື່ອປ່ຽນຜູ້ຂາຍ"
                            >
                              <User className="w-2.5 h-2.5 text-purple-400" />
                              <span>{item.sellerName ? `ຜູ້ຂາຍ: ${item.sellerName}` : '+ ລະບຸຜູ້ຂາຍ'}</span>
                              <Edit2 className="w-2 h-2 ml-0.5 opacity-60" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleStartEditPrice(idx, unitPrice)}
                              className="text-[10px] text-slate-400 hover:text-amber-400 flex items-center gap-1 cursor-pointer"
                            >
                              <Edit2 className="w-2.5 h-2.5" />
                              <span>ປ້ອນລາຄາເອງ</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Pricing, Discounts & Payment */}
            <div className="pt-3 border-t border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>ລວມເງິນ (Subtotal):</span>
                <span className="font-mono font-semibold text-slate-200">
                  {formatCurrency(subtotal, settings.currencySymbol)}
                </span>
              </div>

              {/* Discount input with quick percentage buttons */}
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">ສ່ວນຫຼຸດ (Discount):</span>
                  <div className="w-32">
                    <FormattedNumberInput
                      value={discountAmount || ''}
                      onChange={(num) => setDiscountAmount(num)}
                      placeholder="0"
                      max={subtotal}
                      suffix={settings.currencySymbol}
                      className="bg-slate-800 border border-slate-700 rounded-xl px-2 py-1 text-right text-xs text-amber-400 font-mono focus:ring-1 focus:ring-rose-500"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1">
                  {[5, 10, 20].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDiscountAmount(Math.round((subtotal * p) / 100))}
                      className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 font-bold"
                    >
                      {p}%
                    </button>
                  ))}
                  {discountAmount > 0 && (
                    <button
                      type="button"
                      onClick={() => setDiscountAmount(0)}
                      className="px-2 py-0.5 rounded-lg bg-rose-950/60 text-rose-300 text-[10px] font-bold"
                    >
                      ລ້າງ
                    </button>
                  )}
                </div>
              </div>

              {/* Net Total */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-sm font-black">
                <span className="text-slate-200">ຍອດສຸດທິ (Total):</span>
                <span className="font-mono text-base text-rose-400">
                  {formatCurrency(total, settings.currencySymbol)}
                </span>
              </div>


              {/* Action Buttons: Direct Checkout or Transfer to Room */}
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  disabled={cart.length === 0}
                  onClick={handleCompleteSale}
                  className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-rose-500 via-rose-600 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white text-xs font-black shadow-lg shadow-rose-500/25 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Receipt className="w-4 h-4" />
                  <span>ເຊັກບິນ & ພິມໃບບິນຂາຍ</span>
                </button>

                <button
                  type="button"
                  disabled={cart.length === 0}
                  onClick={() => setShowRoomSelectModal(true)}
                  className="w-full py-2.5 px-4 rounded-2xl bg-purple-950/80 hover:bg-purple-900 border border-purple-800 text-purple-200 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <DoorOpen className="w-4 h-4 text-purple-400" />
                  <span>ໂອນເຂົ້າຫ້ອງຄາຣາໂອເກະ</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Select Seller & Custom Price when adding item requiring seller */}
      {pendingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl text-white">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
                <UserCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-100">
                  ເລືອກພະນັກງານຜູ້ຂາຍ / ຜູ້ເສີບ
                </h3>
                <p className="text-xs text-slate-400">
                  ລາຍການ &quot;{pendingProduct.name}&quot; ຕ້ອງລະບຸຊື່ຜູ້ຂາຍ
                </p>
              </div>
            </div>

            {/* Warning Callout Banners if seller not chosen or price is 0/empty */}
            {(!selectedSellerId || parseCleanNumber(pendingPrice) <= 0 || sellerModalError) && (
              <div className="mb-4 p-3 bg-rose-950/90 border border-rose-800/90 rounded-2xl text-xs space-y-1.5 shadow-inner">
                {!selectedSellerId && (
                  <div className="text-rose-300 font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>⚠️ ທ່ານລືມເລືອກຊື່ຜູ້ຂາຍ! (ກະລຸນາກົດເລືອກໃນຊ່ອງ ComboBox)</span>
                  </div>
                )}
                {parseCleanNumber(pendingPrice) <= 0 && (
                  <div className="text-amber-300 font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>⚠️ ທ່ານລືມປ້ອນຈຳນວນເງິນ! (ລາຄາຕ້ອງຫຼາຍກວ່າ 0 ₭, ບໍ່ສາມາດຂາຍ 0 ₭ ໄດ້)</span>
                  </div>
                )}
                {sellerModalError && (
                  <p className="text-rose-200 font-semibold pl-6">{sellerModalError}</p>
                )}
              </div>
            )}

            <div className="space-y-3.5 mb-5">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">
                  ຈຳນວນທີ່ຕ້ອງການຂາຍ:
                </label>
                <div className="flex items-center gap-2 bg-slate-800 p-2 rounded-xl border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setPendingQty(Math.max(1, pendingQty - 1))}
                    className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white cursor-pointer"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="flex-1 text-center font-mono font-bold text-sm text-white">
                    {pendingQty} {pendingProduct.unit}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingQty(
                        pendingProduct.category === 'service'
                          ? pendingQty + 1
                          : Math.min(pendingProduct.stock, pendingQty + 1)
                      )
                    }
                    className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Custom price input with thousand separators and Lao helper */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs text-slate-300 font-medium">
                    ລາຄາຂາຍຕໍ່ໜ່ວຍ (ສະແດງຈຸດຂັ້ນຫຼັກພັນ / ປ້ອນເອງໄດ້):
                  </label>
                  {parseCleanNumber(pendingPrice) <= 0 && (
                    <span className="text-[10px] text-rose-400 font-bold">* ຕ້ອງປ້ອນ &gt; 0</span>
                  )}
                </div>
                <FormattedNumberInput
                  value={pendingPrice}
                  onChange={(num, formatted) => {
                    setPendingPrice(formatted);
                    if (num > 0 && selectedSellerId) setSellerModalError('');
                  }}
                  placeholder="0"
                  suffix={settings.currencySymbol}
                  showHelper={true}
                  isError={parseCleanNumber(pendingPrice) <= 0}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-amber-400 font-mono font-bold focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Seller ComboBox (starts blank/empty: value="") */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs text-slate-300 font-medium">
                    ພະນັກງານຜູ້ຂາຍ / PR / ເສີບ (ComboBox):
                  </label>
                  {!selectedSellerId && (
                    <span className="text-[10px] text-rose-400 font-bold">* ຕ້ອງເລືອກ</span>
                  )}
                </div>
                <select
                  value={selectedSellerId}
                  onChange={(e) => {
                    setSelectedSellerId(e.target.value);
                    if (e.target.value && parseCleanNumber(pendingPrice) > 0) {
                      setSellerModalError('');
                    }
                  }}
                  className={`w-full bg-slate-800 border rounded-xl px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 cursor-pointer ${
                    !selectedSellerId
                      ? 'border-rose-500/80 text-rose-300 ring-2 ring-rose-500/20'
                      : 'border-slate-700 text-white focus:ring-purple-500'
                  }`}
                >
                  <option value="">-- ກະລຸນາກົດເລືອກພະນັກງານຜູ້ຂາຍ (ComboBox) --</option>
                  {staffList
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.role === 'admin' ? 'ເຈົ້າຂອງຮ້ານ (Admin)' : 'ພະນັກງານ (Staff)'})
                      </option>
                    ))}
                </select>
                {!selectedSellerId && (
                  <p className="text-[11px] text-rose-400 mt-1 pl-1 font-semibold">
                    ⚠️ ຍັງບໍ່ໄດ້ເລືອກ! ກະລຸນາກົດເລືອກພະນັກງານໃນ ComboBox ກ່ອນ
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingProduct(null);
                  setSellerModalError('');
                }}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                ຍົກເລີກ
              </button>
              <button
                type="button"
                disabled={!selectedSellerId || parseCleanNumber(pendingPrice) <= 0}
                onClick={confirmSellerSelection}
                className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-bold shadow-md shadow-purple-600/30 transition-all cursor-pointer"
              >
                ຢືນຢັນເພີ່ມລາຍການ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Transfer to KTV Room */}
      {showRoomSelectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl text-white">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
                <DoorOpen className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-100">ໂອນສິນຄ້າເຂົ້າຫ້ອງ KTV</h3>
                <p className="text-xs text-slate-400">
                  ເລືອກຫ້ອງທີ່ກຳລັງໃຊ້ງານຢູ່ ເພື່ອລວມບິນເຊັກພ້ອມກັນ
                </p>
              </div>
            </div>

            <div className="space-y-2 mb-5 max-h-60 overflow-y-auto pr-1">
              {activeRooms
                .filter((r) => r.status === 'in_use')
                .map((room) => (
                  <button
                    key={room.id}
                    onClick={() => handleTransferConfirm(room.id)}
                    className="w-full text-left p-3.5 rounded-2xl bg-slate-800/80 hover:bg-purple-900/30 border border-slate-700/80 hover:border-purple-500/60 transition-all flex items-center justify-between group cursor-pointer"
                  >
                    <div>
                      <h4 className="font-bold text-sm text-slate-100 group-hover:text-purple-300">
                        {room.name}
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        ເປີດເມື່ອ:{' '}
                        {room.openedAt
                          ? new Date(room.openedAt).toLocaleTimeString('lo-LA', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </p>
                    </div>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-xl bg-purple-500/20 text-purple-300 group-hover:bg-purple-500 group-hover:text-white transition-all">
                      ໂອນເຂົ້າຫ້ອງນີ້
                    </span>
                  </button>
                ))}
              {activeRooms.filter((r) => r.status === 'in_use').length === 0 && (
                <p className="text-center py-6 text-xs text-slate-500">
                  ບໍ່ມີຫ້ອງໃດກຳລັງໃຊ້ງານຢູ່ (ກະລຸນາເປີດຫ້ອງກ່ອນ)
                </p>
              )}
            </div>

            <button
              onClick={() => setShowRoomSelectModal(false)}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
            >
              ຍົກເລີກ
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
