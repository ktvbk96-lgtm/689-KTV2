import React, { useState, useRef } from 'react';
import {
  Boxes,
  Plus,
  Search,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Edit,
  Trash2,
  Beer,
  Coffee,
  UtensilsCrossed,
  Cookie,
  UserCheck,
  X,
  Upload,
  Image as ImageIcon,
  Sparkles,
  RotateCcw,
  PlusCircle,
  PackagePlus,
  Package,
  RefreshCw,
} from 'lucide-react';
import { Product, ProductCategory, Role, AppSettings } from '../types';
import { formatCurrency } from '../lib/storage';
import { INITIAL_PRODUCTS } from '../lib/initialData';
import { FormattedNumberInput } from './FormattedNumberInput';
import { calculateAvailablePacksAndSingles } from '../lib/multiUnitInventory';
import { normalizeImageUrl, uploadProductImage } from '../lib/imageUtils';

interface InventoryManagementProps {
  products: Product[];
  currentRole: Role;
  settings: AppSettings;
  onSaveProducts: (updatedProducts: Product[]) => void;
}

export const InventoryManagement: React.FC<InventoryManagementProps> = ({
  products,
  currentRole,
  settings,
  onSaveProducts,
}) => {
  const [search, setSearch] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'out' | 'low' | 'normal'>('all');

  // Add / Edit Product Modal state
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAddingNew, setIsAddingNew] = useState<boolean>(false);
  const [isUploadingImage, setIsUploadingImage] = useState<boolean>(false);

  // Dedicated Restock (ບວກສະຕັອກເພີ່ມ) State
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);
  const [restockAddAmount, setRestockAddAmount] = useState<number>(20);
  const [restockUnitType, setRestockUnitType] = useState<'single' | 'pack'>('single');

  // Form State
  const [formData, setFormData] = useState<Partial<Product>>({
    name: '',
    category: 'beer',
    costPrice: 0,
    salePrice: 0,
    stock: 20,
    minStockAlert: 5,
    unit: 'ແກ້ວ',
    requireSeller: false,
    imageUrl: '',
    hasMultiUnit: false,
    packUnit: 'ແພັກ',
    packMultiplier: 24,
    packSalePrice: 0,
    packCostPrice: 0,
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const categories = [
    { id: 'all', label: 'ທັງໝົດ' },
    { id: 'beer', label: 'ເບຍ & ເຫຼົ້າ' },
    { id: 'drink', label: 'ເຄື່ອງດື່ມ' },
    { id: 'food', label: 'ອາຫານ' },
    { id: 'snack', label: 'ຂອງກິນຫຼິ້ນ' },
    { id: 'service', label: 'ບໍລິການ' },
  ];

  // Quick preset sample images
  const samplePhotoPresets = [
    {
      label: '🍺 ເບຍລາວ',
      url: 'https://images.unsplash.com/photo-1608270199042-7cfd3f4439fa?w=400&auto=format&fit=crop&q=80',
    },
    {
      label: '🥤 ນ້ຳດື່ມ/ໂຄ້ກ',
      url: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&auto=format&fit=crop&q=80',
    },
    {
      label: '🍗 ປີກໄກ່ທອດ',
      url: 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=400&auto=format&fit=crop&q=80',
    },
    {
      label: '🍟 ເຟຣນຟຣາຍ',
      url: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?w=400&auto=format&fit=crop&q=80',
    },
    {
      label: '🥗 ຕຳໝາກຫຸ່ງ',
      url: 'https://images.unsplash.com/photo-1559847844-5315695dadae?w=400&auto=format&fit=crop&q=80',
    },
    {
      label: '🍉 ໝາກໄມ້ລວມ',
      url: 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=400&auto=format&fit=crop&q=80',
    },
  ];

  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.unit.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = filterCategory === 'all' || p.category === filterCategory;

    let matchesStock = true;
    if (stockStatusFilter === 'out') {
      matchesStock = p.stock <= 0 && p.category !== 'service';
    } else if (stockStatusFilter === 'low') {
      matchesStock = p.stock > 0 && p.stock <= p.minStockAlert && p.category !== 'service';
    } else if (stockStatusFilter === 'normal') {
      matchesStock = p.stock > p.minStockAlert || p.category === 'service';
    }

    return matchesSearch && matchesCategory && matchesStock;
  });

  const outOfStockCount = products.filter((p) => p.stock <= 0 && p.category !== 'service').length;
  const lowStockCount = products.filter(
    (p) => p.stock > 0 && p.stock <= p.minStockAlert && p.category !== 'service'
  ).length;

  const handleOpenAddModal = () => {
    setFormData({
      id: 'prod-' + Date.now(),
      name: '',
      category: 'beer',
      costPrice: 15000,
      salePrice: 22000,
      stock: 24,
      minStockAlert: 6,
      unit: 'ແກ້ວ',
      requireSeller: false,
      imageUrl: '',
    });
    setIsAddingNew(true);
    setEditingProduct(null);
  };

  const handleOpenEditModal = (product: Product) => {
    setFormData({ ...product });
    setEditingProduct(product);
    setIsAddingNew(false);
  };

  // Handle image file upload (uploads to server & returns permanent absolute URL)
  const handleImageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('ກະລຸນາເລືອກໄຟລ໌ຮູບພາບເທົ່ານັ້ນ (JPG, PNG, WEBP...)');
      return;
    }

    setIsUploadingImage(true);
    try {
      const permanentUrl = await uploadProductImage(file, `prod_${Date.now()}_${file.name}`);
      setFormData((prev) => ({ ...prev, imageUrl: permanentUrl }));
    } catch (err: any) {
      console.error('Image upload failed:', err);
      alert('ອັບໂຫຼດຮູບພາບບໍ່ສຳເລັດ: ' + (err?.message || 'ເກີດຂໍ້ຜິດພາດ'));
    } finally {
      setIsUploadingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSaveProduct = (e?: React.FormEvent) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }

    // Dismiss mobile virtual keyboard so viewport does not jump
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const trimmedName = (formData.name || '').trim();
    if (!trimmedName) {
      alert('⚠️ ກະລຸນາປ້ອນຊື່ສິນຄ້າ / ເມນູ!');
      return;
    }

    const finalUnit = (formData.unit || '').trim() || 'ອັນ';
    // Ensure imageUrl is an absolute HTTPS/HTTP URL across all devices
    const normalizedImg = normalizeImageUrl(formData.imageUrl?.trim()) || undefined;

    let updatedList: Product[];
    if (isAddingNew) {
      const newProd: Product = {
        id: formData.id || 'prod-' + Date.now(),
        name: trimmedName,
        category: (formData.category as ProductCategory) || 'other',
        costPrice: Number(formData.costPrice) || 0,
        salePrice: Number(formData.salePrice) || 0,
        stock: Number(formData.stock) || 0,
        minStockAlert: Number(formData.minStockAlert) || 5,
        unit: finalUnit,
        requireSeller: !!formData.requireSeller,
        imageUrl: normalizedImg,
        hasMultiUnit: !!formData.hasMultiUnit,
        packUnit: formData.hasMultiUnit ? (formData.packUnit?.trim() || 'ແພັກ') : undefined,
        packMultiplier: formData.hasMultiUnit ? (Number(formData.packMultiplier) || 24) : undefined,
        packSalePrice: formData.hasMultiUnit
          ? (Number(formData.packSalePrice) || (Number(formData.salePrice) * (Number(formData.packMultiplier) || 24)))
          : undefined,
        packCostPrice: formData.hasMultiUnit
          ? (Number(formData.packCostPrice) || (Number(formData.costPrice) * (Number(formData.packMultiplier) || 24)))
          : undefined,
      };
      updatedList = [newProd, ...products];
    } else if (editingProduct) {
      updatedList = products.map((p) =>
        p.id === editingProduct.id
          ? ({
              ...p,
              name: trimmedName,
              category: (formData.category as ProductCategory) || p.category,
              costPrice: Number(formData.costPrice) || 0,
              salePrice: Number(formData.salePrice) || 0,
              stock: Number(formData.stock) || 0,
              minStockAlert: Number(formData.minStockAlert) || 5,
              unit: finalUnit,
              requireSeller: !!formData.requireSeller,
              imageUrl: normalizedImg,
              hasMultiUnit: !!formData.hasMultiUnit,
              packUnit: formData.hasMultiUnit ? (formData.packUnit?.trim() || 'ແພັກ') : undefined,
              packMultiplier: formData.hasMultiUnit ? (Number(formData.packMultiplier) || 24) : undefined,
              packSalePrice: formData.hasMultiUnit
                ? (Number(formData.packSalePrice) || (Number(formData.salePrice) * (Number(formData.packMultiplier) || 24)))
                : undefined,
              packCostPrice: formData.hasMultiUnit
                ? (Number(formData.packCostPrice) || (Number(formData.costPrice) * (Number(formData.packMultiplier) || 24)))
                : undefined,
            } as Product)
          : p
      );
    } else {
      return;
    }

    onSaveProducts(updatedList);
    setIsAddingNew(false);
    setEditingProduct(null);
  };

  const handleDeleteProduct = (id: string, name: string) => {
    if (currentRole !== 'admin') {
      alert('ສະເພາະ Admin ເທົ່ານັ້ນທີ່ສາມາດລຶບສິນຄ້າໄດ້!');
      return;
    }
    if (confirm(`ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການລຶບສິນຄ້າ "${name}" ອອກຈາກລະບົບ?`)) {
      onSaveProducts(products.filter((p) => p.id !== id));
    }
  };

  const handleClearAllProducts = () => {
    if (currentRole !== 'admin') {
      alert('ສະເພາະ Admin ເທົ່ານັ້ນທີ່ສາມາດລຶບສິນຄ້າທັງໝົດໄດ້!');
      return;
    }
    const pin = window.prompt(`⚠️ ຢືນຢັນລຶບສິນຄ້າທັງໝົດ (${products.length} ລາຍການ)\nກະລຸນາປ້ອນລະຫັດ Admin PIN:`);
    if (!pin) return;
    if (pin !== settings.adminPin && pin !== '8888') {
      alert('ລະຫັດ Admin PIN ບໍ່ຖືກຕ້ອງ!');
      return;
    }
    if (window.confirm(`⚠️ ເຕືອນ: ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການລຶບສິນຄ້າທັງໝົດ ${products.length} ລາຍການອອກຈາກລະບົບ?`)) {
      onSaveProducts([]);
    }
  };

  const handleResetAllStockToZero = () => {
    if (currentRole !== 'admin') {
      alert('ສະເພາະ Admin ເທົ່ານັ້ນທີ່ສາມາດຣີເຊັດສະຕັອກໄດ້!');
      return;
    }
    if (window.confirm('ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການປັບຈຳນວນສະຕັອກສິນຄ້າທັງໝົດໃຫ້ເປັນ 0?')) {
      const updated = products.map((p) => ({
        ...p,
        stock: p.category === 'service' ? p.stock : 0,
      }));
      onSaveProducts(updated);
    }
  };

  const handleRestoreDefaultProducts = () => {
    if (currentRole !== 'admin') {
      alert('ສະເພາະ Admin ເທົ່ານັ້ນທີ່ສາມາດຄືນຄ່າເລີ່ມຕົ້ນໄດ້!');
      return;
    }
    if (window.confirm('ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການຄືນຄ່າເມນູສິນຄ້າເລີ່ມຕົ້ນຂອງຮ້ານ (Default)?')) {
      onSaveProducts(INITIAL_PRODUCTS);
    }
  };

  const handleQuickAdjustStock = (productId: string, delta: number) => {
    const updated = products.map((p) => {
      if (p.id === productId) {
        return {
          ...p,
          stock: Math.max(0, p.stock + delta),
        };
      }
      return p;
    });
    onSaveProducts(updated);
  };

  const handleOpenRestockModal = (prod: Product) => {
    setRestockProduct(prod);
    setRestockUnitType(prod.hasMultiUnit ? 'pack' : 'single');
    setRestockAddAmount(prod.hasMultiUnit ? 1 : 20);
  };

  const handleConfirmRestock = (e?: React.FormEvent) => {
    if (e && e.preventDefault) e.preventDefault();
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (!restockProduct) return;
    const isPack = restockUnitType === 'pack' && !!restockProduct.hasMultiUnit;
    const multiplier = isPack ? (restockProduct.packMultiplier || 24) : 1;
    const entered = Number(restockAddAmount) || 0;
    if (entered <= 0) {
      alert('ກະລຸນາປ້ອນຈຳນວນທີ່ຕ້ອງການເພີ່ມ / ຕື່ມເຂົ້າ ຫຼາຍກວ່າ 0!');
      return;
    }
    const toAdd = entered * multiplier;
    const oldStock = restockProduct.stock;
    const newStock = Math.max(0, oldStock + toAdd);
    const updated = products.map((p) =>
      p.id === restockProduct.id ? { ...p, stock: newStock } : p
    );
    onSaveProducts(updated);
    setRestockProduct(null);
    setRestockAddAmount(20);
    setRestockUnitType('single');
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header & Stats Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Boxes className="w-6 h-6 text-amber-500" />
            <h1 className="text-xl font-black text-slate-100">
              ກວດສອບສະຕັອກສິນຄ້າ 689 KTV (Stock & Inventory)
            </h1>
          </div>
          <p className="text-xs text-slate-400">
            ເພີ່ມຮູບພາບເມນູອາຫານ-ເຄື່ອງດື່ມ, ເຕືອນສີແດງເມື່ອສິນຄ້າໝົດ (ຫ້າມຂາຍ) ແລະ ເຕືອນສີເຫຼືອງເມື່ອໃກ້ໝົດ
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Out of stock alert pill */}
          <button
            onClick={() => setStockStatusFilter(stockStatusFilter === 'out' ? 'all' : 'out')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
              outOfStockCount > 0
                ? 'bg-rose-950/80 border-rose-500 text-rose-300 shadow-md shadow-rose-950/30 animate-pulse'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            <XCircle className="w-4 h-4 text-rose-400" />
            <span>ສິນຄ້າໝົດ: {outOfStockCount} ລາຍການ</span>
          </button>

          {/* Low stock pill */}
          <button
            onClick={() => setStockStatusFilter(stockStatusFilter === 'low' ? 'all' : 'low')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
              lowStockCount > 0
                ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>ໃກ້ໝົດ: {lowStockCount} ລາຍການ</span>
          </button>

          {/* Admin Bulk Actions */}
          {currentRole === 'admin' && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleClearAllProducts}
                className="px-3 py-2 rounded-2xl bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 hover:text-white text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm"
                title="Admin ລຶບສິນຄ້າທັງໝົດອອກຈາກລະບົບ"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>ລຶບທັງໝົດ</span>
              </button>
              <button
                type="button"
                onClick={handleResetAllStockToZero}
                className="px-3 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                title="Admin ຕັ້ງຄ່າສະຕັອກສິນຄ້າທັງໝົດໃຫ້ເປັນ 0"
              >
                <span>ສະຕັອກ=0</span>
              </button>
              <button
                type="button"
                onClick={handleRestoreDefaultProducts}
                className="px-3 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                title="Admin ຄືນຄ່າເມນູເລີ່ມຕົ້ນ (Default)"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                <span>ຄືນຄ່າເລີ່ມຕົ້ນ</span>
              </button>
            </div>
          )}

          {/* Add product button */}
          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2 rounded-2xl bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 text-white font-bold text-xs shadow-md shadow-rose-500/20 flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ ເພີ່ມສິນຄ້າ / ເມນູໃໝ່</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-lg flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ຄົ້ນຫາຊື່ສິນຄ້າ, ຫົວໜ່ວຍ..."
            className="w-full bg-slate-800 border border-slate-700 rounded-2xl pl-10 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 scrollbar-none">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilterCategory(c.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                filterCategory === c.id
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 uppercase font-semibold tracking-wider">
                <th className="py-3 px-3 text-center">ຮູບພາບ</th>
                <th className="py-3 px-4">ຊື່ສິນຄ້າ (Product Name)</th>
                <th className="py-3 px-4">ໝວດໝູ່</th>
                <th className="py-3 px-4 text-right">ຕົ້ນທຶນ</th>
                <th className="py-3 px-4 text-right">ລາຄາຂາຍ</th>
                <th className="py-3 px-4 text-center">ສະຖານະສະຕັອກ</th>
                <th className="py-3 px-4 text-center">ຈຳນວນຄົງເຫຼືອ</th>
                <th className="py-3 px-4 text-center">ປັບສະຕັອກດ່ວນ</th>
                <th className="py-3 px-4 text-center">ຈັດການ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    ບໍ່ພົບຂໍ້ມູນສິນຄ້າທີ່ກົງກັບເງື່ອນໄຂ
                  </td>
                </tr>
              ) : (
                filteredProducts.map((prod) => {
                  const isOutOfStock = prod.stock <= 0 && prod.category !== 'service';
                  const isLowStock =
                    !isOutOfStock && prod.stock <= prod.minStockAlert && prod.category !== 'service';

                  return (
                    <tr
                      key={prod.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isOutOfStock
                          ? 'bg-rose-950/20'
                          : isLowStock
                          ? 'bg-amber-950/10'
                          : ''
                      }`}
                    >
                      {/* Image Thumbnail */}
                      <td className="py-2.5 px-3 text-center">
                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-800 border border-slate-700 mx-auto flex items-center justify-center shrink-0">
                          {prod.imageUrl ? (
                            <img
                              src={normalizeImageUrl(prod.imageUrl)}
                              alt={prod.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as any).style.display = 'none';
                              }}
                            />
                          ) : (
                            <ImageIcon className="w-5 h-5 text-slate-600" />
                          )}
                        </div>
                      </td>

                      {/* Name & Require Seller flag */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-100 flex items-center gap-2">
                          <span>{prod.name}</span>
                          {prod.requireSeller && (
                            <span className="text-[10px] bg-purple-900/40 text-purple-300 border border-purple-800/40 px-1.5 py-0.5 rounded">
                              ຕ້ອງເລືອກຜູ້ຂາຍ
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500">
                          ID: {prod.id} • ຫົວໜ່ວຍ: {prod.unit}
                        </span>
                      </td>

                      {/* Category */}
                      <td className="py-3 px-4">
                        <span className="text-slate-300 bg-slate-800 px-2 py-0.5 rounded-lg text-[11px]">
                          {prod.category}
                        </span>
                      </td>

                      {/* Cost */}
                      <td className="py-3 px-4 text-right font-mono text-slate-400">
                        {formatCurrency(prod.costPrice, settings.currencySymbol)}
                      </td>

                      {/* Sale Price */}
                      <td className="py-3 px-4 text-right font-mono font-bold text-amber-400">
                        {formatCurrency(prod.salePrice, settings.currencySymbol)}
                      </td>

                      {/* Stock Status Badge */}
                      <td className="py-3 px-4 text-center">
                        {isOutOfStock ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-300 bg-rose-950/90 border border-rose-700 px-2.5 py-1 rounded-full animate-pulse">
                            <XCircle className="w-3 h-3 text-rose-400" />
                            <span>ສິນຄ້າໝົດ (ຫ້າມຂາຍ)</span>
                          </span>
                        ) : isLowStock ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300 bg-amber-950/80 border border-amber-600 px-2.5 py-1 rounded-full">
                            <AlertTriangle className="w-3 h-3 text-amber-400" />
                            <span>ໃກ້ໝົດ (ເຕືອນ)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/50 border border-emerald-800 px-2.5 py-1 rounded-full">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>ປົກກະຕິ</span>
                          </span>
                        )}
                      </td>

                      {/* Quantity & Quick Restock */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div>
                            <span
                              className={`font-mono text-base font-black ${
                                isOutOfStock
                                  ? 'text-rose-400 underline decoration-rose-500'
                                  : isLowStock
                                  ? 'text-amber-400'
                                  : 'text-slate-100'
                              }`}
                            >
                              {prod.stock}
                            </span>{' '}
                            <span className="text-[11px] text-slate-400">{prod.unit}</span>
                            {prod.hasMultiUnit && (
                              <span className="text-[10px] font-mono font-bold text-emerald-400 block">
                                ({calculateAvailablePacksAndSingles(prod.stock, prod.packMultiplier || 24, prod.unit, prod.packUnit || 'ແພັກ').packs} {prod.packUnit || 'ແພັກ'}{prod.stock % (prod.packMultiplier || 24) > 0 ? ` +${prod.stock % (prod.packMultiplier || 24)}` : ''})
                              </span>
                            )}
                          </div>

                          {prod.category !== 'service' && (
                            <button
                              type="button"
                              onClick={() => handleOpenRestockModal(prod)}
                              className="px-2 py-0.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/80 text-emerald-300 hover:text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer touch-manipulation transition-all active:scale-95 shadow-sm"
                              title={`ກົດຕື່ມສະຕັອກ ${prod.name} (ບວກເພີ່ມ)`}
                            >
                              <PlusCircle className="w-3 h-3 text-emerald-400" />
                              <span>+ ຕື່ມສະຕັອກ</span>
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Quick Adjust Buttons */}
                      <td className="py-3 px-4 text-center">
                        {prod.category !== 'service' ? (
                          <div className="inline-flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                            <button
                              type="button"
                              onClick={() => handleQuickAdjustStock(prod.id, -1)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer touch-manipulation"
                              title="ລົດລົງ 1"
                            >
                              -1
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickAdjustStock(prod.id, 5)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-emerald-900/60 text-emerald-300 text-xs font-bold cursor-pointer touch-manipulation"
                              title="ເພີ່ມ 5"
                            >
                              +5
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickAdjustStock(prod.id, 12)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-amber-900/60 text-amber-300 text-xs font-bold cursor-pointer touch-manipulation"
                              title="ເພີ່ມ 1 ລັງ (12)"
                            >
                              +12
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickAdjustStock(prod.id, 20)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-sky-900/60 text-sky-300 text-xs font-bold cursor-pointer touch-manipulation"
                              title="ເພີ່ມ 20 ອັນ"
                            >
                              +20
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-500 text-[11px]">-</span>
                        )}
                      </td>

                      {/* Action edit/delete */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(prod)}
                            className="min-w-[36px] min-h-[36px] p-2 sm:p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white transition-all cursor-pointer touch-manipulation flex items-center justify-center shadow-sm"
                            title="ແກ້ໄຂສິນຄ້າ ແລະ ຮູບພາບ"
                          >
                            <Edit className="w-4 h-4 text-amber-400" />
                          </button>
                          {currentRole === 'admin' && (
                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(prod.id, prod.name)}
                              className="min-w-[36px] min-h-[36px] p-2 sm:p-1.5 rounded-xl bg-slate-800 hover:bg-rose-950 active:scale-95 text-slate-400 hover:text-rose-400 transition-all cursor-pointer touch-manipulation flex items-center justify-center shadow-sm"
                              title="ລຶບສິນຄ້າ"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add or Edit Product (Includes Image Upload & URL) */}
      {(isAddingNew || editingProduct) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 w-full max-w-lg shadow-2xl text-white my-auto max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-amber-400" />
                <span>{isAddingNew ? 'ເພີ່ມສິນຄ້າ / ເມນູໃໝ່' : 'ແກ້ໄຂສິນຄ້າ ແລະ ຮູບພາບ'}</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsAddingNew(false);
                  setEditingProduct(null);
                }}
                className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer touch-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} noValidate className="space-y-4">
              {/* Product Photo Upload Section */}
              <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700 space-y-2.5">
                <label className="block text-xs font-bold text-amber-300">
                  📸 ຮູບພາບສິນຄ້າ (Product Image):
                </label>

                <div className="flex items-center gap-4">
                  {/* Image Preview Box */}
                  <div className="w-20 h-20 rounded-2xl bg-slate-900 border-2 border-dashed border-slate-700 overflow-hidden flex items-center justify-center shrink-0">
                    {formData.imageUrl ? (
                      <img
                        src={normalizeImageUrl(formData.imageUrl)}
                        alt="Preview"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as any).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="text-center p-1 text-slate-500">
                        <ImageIcon className="w-6 h-6 mx-auto mb-1 opacity-50" />
                        <span className="text-[9px]">ບໍ່ມີຮູບ</span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 space-y-2">
                    {/* Hidden file input */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      onChange={handleImageFileUpload}
                      className="hidden"
                    />

                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={isUploadingImage}
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
                      >
                        {isUploadingImage ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>ກຳລັງອັບໂຫຼດ...</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-3.5 h-3.5" />
                            <span>ອັບໂຫຼດຮູບຈາກເຄື່ອງ</span>
                          </>
                        )}
                      </button>

                      {formData.imageUrl && (
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, imageUrl: '' })}
                          className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-400 text-xs cursor-pointer"
                        >
                          ລຶບຮູບ
                        </button>
                      )}
                    </div>

                    {/* Or URL input */}
                    <input
                      type="text"
                      value={formData.imageUrl || ''}
                      onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                      placeholder="ຫຼື ວາງລິ້ງ URL ຮູບພາບ (https://...)"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                </div>

                {/* Sample Presets */}
                <div className="pt-1">
                  <span className="text-[10px] text-slate-400 block mb-1">ເລືອກຮູບຕົວຢ່າງໄວ:</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {samplePhotoPresets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setFormData({ ...formData, imageUrl: preset.url })}
                        className="px-2 py-0.5 rounded-lg bg-slate-900 hover:bg-slate-750 border border-slate-700 text-[10px] text-slate-300 cursor-pointer"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  ຊື່ສິນຄ້າ (Product Name): <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="ຕົວຢ່າງ: ເບຍລາວ ຂວດໃຫຍ່, ນ້ຳດື່ມ, ປີກໄກ່ທອດ..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">ໝວດໝູ່:</label>
                  <select
                    value={formData.category || 'beer'}
                    onChange={(e) =>
                      setFormData({ ...formData, category: e.target.value as ProductCategory })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="beer">ເບຍ & ເຫຼົ້າ</option>
                    <option value="drink">ເຄື່ອງດື່ມ</option>
                    <option value="food">ອາຫານ</option>
                    <option value="snack">ຂອງກິນຫຼິ້ນ</option>
                    <option value="service">ບໍລິການ / PR</option>
                    <option value="other">ອື່ນໆ</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">ຫົວໜ່ວຍ (Unit):</label>
                  <input
                    type="text"
                    value={formData.unit || ''}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    placeholder="ແກ້ວ, ຕຸກ, ຈານ, ຊຸດ, ກະປ໋ອງ..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    ຕົ້ນທຶນ ({settings.currencySymbol}):
                  </label>
                  <FormattedNumberInput
                    value={formData.costPrice || ''}
                    onChange={(num) => setFormData({ ...formData, costPrice: num })}
                    placeholder="0"
                    suffix={settings.currencySymbol}
                    showHelper={true}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    ລາຄາຂາຍ ({settings.currencySymbol}):
                  </label>
                  <FormattedNumberInput
                    value={formData.salePrice || ''}
                    onChange={(num) => setFormData({ ...formData, salePrice: num })}
                    placeholder="0"
                    suffix={settings.currencySymbol}
                    showHelper={true}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">ຈຳນວນໃນສະຕັອກ:</label>
                  <input
                    type="number"
                    value={formData.stock ?? 0}
                    onChange={(e) =>
                      setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  {/* Quick Add Chips in Edit Modal */}
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    <span className="text-[10px] text-slate-400">ບວກເພີ່ມ:</span>
                    {[5, 10, 12, 20, 24, 50].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() =>
                          setFormData((prev) => ({
                            ...prev,
                            stock: Math.max(0, (Number(prev.stock) || 0) + num),
                          }))
                        }
                        className="px-1.5 py-0.5 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 active:scale-95 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold cursor-pointer touch-manipulation transition-all"
                        title={`ບວກເພີ່ມ ${num}`}
                      >
                        +{num}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    ຈຳນວນເຕືອນໃກ້ໝົດ (Alert):
                  </label>
                  <input
                    type="number"
                    value={formData.minStockAlert ?? 5}
                    onChange={(e) =>
                      setFormData({ ...formData, minStockAlert: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Multi-unit Inventory Configuration (ຂາຍຫຼາຍໜ່ວຍ: ແກ້ວ & ແພັກ/ລັງ) */}
              <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                      <Package className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-bold text-xs text-slate-200 block">
                        ຂາຍຫຼາຍໜ່ວຍ (Multi-Unit: ແກ້ວ/ຂວດ & ແພັກ/ລັງ)
                      </span>
                      <span className="text-[11px] text-slate-400">
                        ເປີດໃຫ້ສິນຄ້າຂາຍໄດ້ທັງແບບດ່ຽວ ແລະ ແບບແພັກ (1 ແພັກ = 24 ແກ້ວ)
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!formData.hasMultiUnit}
                    onChange={(e) => setFormData({ ...formData, hasMultiUnit: e.target.checked })}
                    className="w-5 h-5 accent-emerald-500 cursor-pointer"
                  />
                </div>

                {formData.hasMultiUnit && (
                  <div className="pt-2.5 border-t border-slate-700/80 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-300 mb-1 font-semibold">
                          ຊື່ໜ່ວຍແພັກ (Pack Unit):
                        </label>
                        <input
                          type="text"
                          value={formData.packUnit || ''}
                          onChange={(e) => setFormData({ ...formData, packUnit: e.target.value })}
                          placeholder="ແພັກ, ລັງ, ກ່ອງ..."
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-300 mb-1 font-semibold">
                          ຈຳນວນ {formData.unit || 'ແກ້ວ'} ຕໍ່ 1 {formData.packUnit || 'ແພັກ'}:
                        </label>
                        <input
                          type="number"
                          min="2"
                          value={formData.packMultiplier ?? 24}
                          onChange={(e) =>
                            setFormData({ ...formData, packMultiplier: Math.max(2, parseInt(e.target.value) || 2) })
                          }
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-300 mb-1">
                          ລາຄາຂາຍແບບ {formData.packUnit || 'ແພັກ'} ({settings.currencySymbol}):
                        </label>
                        <FormattedNumberInput
                          value={formData.packSalePrice || ''}
                          onChange={(num) => setFormData({ ...formData, packSalePrice: num })}
                          placeholder={formatCurrency((Number(formData.salePrice) || 0) * (Number(formData.packMultiplier) || 24), '')}
                          suffix={settings.currencySymbol}
                          showHelper={true}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-300 mb-1">
                          ຕົ້ນທຶນແບບ {formData.packUnit || 'ແພັກ'} ({settings.currencySymbol}):
                        </label>
                        <FormattedNumberInput
                          value={formData.packCostPrice || ''}
                          onChange={(num) => setFormData({ ...formData, packCostPrice: num })}
                          placeholder={formatCurrency((Number(formData.costPrice) || 0) * (Number(formData.packMultiplier) || 24), '')}
                          suffix={settings.currencySymbol}
                          showHelper={true}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center justify-between font-mono">
                      <span>ສະຫຼຸບ: 1 {formData.packUnit || 'ແພັກ'} = {formData.packMultiplier || 24} {formData.unit || 'ແກ້ວ'}</span>
                      <span>ລາຄາສະເລ່ຍ: {Math.round(((Number(formData.packSalePrice) || (Number(formData.salePrice) || 0) * (Number(formData.packMultiplier) || 24)) / (Number(formData.packMultiplier) || 24))).toLocaleString()} {settings.currencySymbol}/{formData.unit || 'ແກ້ວ'}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Require Seller Flag */}
              <div className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-between">
                <div>
                  <span className="font-bold text-xs text-slate-200 block">
                    ຕ້ອງເລືອກພະນັກງານຜູ້ຂາຍ (Require Seller)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    ບັງຄັບໃຫ້ເລືອກຜູ້ຂາຍ/ເສີບກ່ອນເພີ່ມລາຍການ
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={!!formData.requireSeller}
                  onChange={(e) => setFormData({ ...formData, requireSeller: e.target.checked })}
                  className="w-5 h-5 accent-rose-500 cursor-pointer"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingNew(false);
                    setEditingProduct(null);
                  }}
                  className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-slate-300 text-xs sm:text-sm font-semibold cursor-pointer touch-manipulation flex items-center justify-center"
                >
                  ຍົກເລີກ
                </button>
                <button
                  type="submit"
                  onClick={(e) => {
                    // Fallback directly on touch/click in case native submit is delayed
                    if (e.isDefaultPrevented()) return;
                    handleSaveProduct(e);
                  }}
                  className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 active:scale-[0.98] text-white text-xs sm:text-sm font-bold shadow-lg shadow-rose-500/20 cursor-pointer touch-manipulation flex items-center justify-center"
                >
                  ບັນທຶກສິນຄ້າ & ຮູບພາບ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* Dedicated Restock Modal: ຕື່ມສະຕັອກສິນຄ້າ (ບວກເພີ່ມອັດຕະໂນມັດ) */}
      {/* ============================================================== */}
      {restockProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-emerald-500/30 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl shadow-emerald-950/40 my-auto">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-950/70 via-slate-900 to-slate-900 border-b border-emerald-500/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <PackagePlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white flex items-center gap-2">
                    ຕື່ມສະຕັອກສິນຄ້າ (Restock)
                  </h3>
                  <p className="text-xs text-emerald-400/90 font-medium">
                    ບວກຈຳນວນເພີ່ມໃສ່ສະຕັອກເດີມອັດຕະໂນມັດ
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRestockProduct(null)}
                className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer touch-manipulation"
              >
                ✕
              </button>
            </div>

            {/* Modal Form */}
            <form
              onSubmit={handleConfirmRestock}
              className="p-5 sm:p-6 space-y-4"
              autoComplete="off"
            >
              {/* Target Product Badge */}
              <div className="p-3.5 rounded-2xl bg-slate-800/70 border border-slate-700/80 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-400">ສິນຄ້າທີ່ເລືອກ:</div>
                  <div className="text-sm font-black text-white truncate">
                    {restockProduct.name}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    ໝວດໝູ່: {categories.find((c) => c.id === restockProduct.category)?.label || restockProduct.category}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] text-slate-400">ສະຕັອກເດີມ:</div>
                  <div className="text-lg font-mono font-black text-amber-400">
                    {restockProduct.stock}{' '}
                    <span className="text-xs text-slate-400 font-normal">
                      {restockProduct.unit}
                    </span>
                  </div>
                </div>
              </div>

              {/* Multi-unit Restock Toggle (Single bottle vs Pack/Crate) */}
              {restockProduct.hasMultiUnit && (
                <div className="p-1.5 bg-slate-950/80 rounded-2xl border border-slate-700/80 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setRestockUnitType('single');
                      setRestockAddAmount(20);
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer touch-manipulation ${
                      restockUnitType === 'single'
                        ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                        : 'text-slate-300 hover:text-white bg-slate-800/60'
                    }`}
                  >
                    <span>🍾 ຕື່ມແບບ {restockProduct.unit}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRestockUnitType('pack');
                      setRestockAddAmount(1);
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer touch-manipulation ${
                      restockUnitType === 'pack'
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md font-black'
                        : 'text-slate-300 hover:text-white bg-slate-800/60'
                    }`}
                  >
                    <span>📦 ຕື່ມແບບ {restockProduct.packUnit || 'ແພັກ'} (x{restockProduct.packMultiplier || 24} {restockProduct.unit})</span>
                  </button>
                </div>
              )}

              {/* Input for Add Quantity */}
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5 flex items-center justify-between">
                  <span>
                    ຈຳນວນທີ່ຕ້ອງການບວກເພີ່ມ (+):
                  </span>
                  <span className="text-[11px] text-emerald-400 font-normal">
                    {restockUnitType === 'pack'
                      ? `1 ${restockProduct.packUnit || 'ແພັກ'} = ${restockProduct.packMultiplier || 24} ${restockProduct.unit}`
                      : 'ປ້ອນຕົວເລກທີ່ມາຕື່ມ'}
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    autoFocus
                    value={restockAddAmount || ''}
                    onChange={(e) => setRestockAddAmount(Math.max(0, parseInt(e.target.value) || 0))}
                    placeholder={restockUnitType === 'pack' ? '1' : '20'}
                    className="w-full bg-slate-950 border-2 border-emerald-500/50 rounded-2xl px-4 py-3 text-lg font-mono font-bold text-emerald-300 placeholder-slate-600 focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-400"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
                    {restockUnitType === 'pack' ? (restockProduct.packUnit || 'ແພັກ') : restockProduct.unit}
                  </span>
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div>
                <div className="text-[11px] font-semibold text-slate-400 mb-2">
                  ກົດເລືອກຈຳນວນດ່ວນ (Presets):
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {restockUnitType === 'pack'
                    ? [
                        { label: '+1 ແພັກ', val: 1 },
                        { label: '+2 ແພັກ', val: 2 },
                        { label: '+3 ແພັກ', val: 3 },
                        { label: '+4 ແພັກ', val: 4 },
                        { label: '+5 ແພັກ', val: 5 },
                        { label: '+10 ແພັກ', val: 10 },
                        { label: '+20 ແພັກ', val: 20 },
                        { label: '+50 ແພັກ', val: 50 },
                      ].map((chip) => (
                        <button
                          key={chip.val}
                          type="button"
                          onClick={() => setRestockAddAmount(chip.val)}
                          className={`min-h-[40px] px-2 py-1.5 rounded-xl text-xs font-bold font-mono transition-all border cursor-pointer touch-manipulation flex items-center justify-center text-center ${
                            restockAddAmount === chip.val
                              ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-md shadow-emerald-500/30'
                              : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                          }`}
                        >
                          {chip.label}
                        </button>
                      ))
                    : [
                        { label: '+5', val: 5 },
                        { label: '+10', val: 10 },
                        { label: '+12 (1 ລັງ)', val: 12 },
                        { label: '+20', val: 20 },
                        { label: '+24 (2 ລັງ)', val: 24 },
                        { label: '+30', val: 30 },
                        { label: '+50', val: 50 },
                        { label: '+100', val: 100 },
                      ].map((chip) => (
                        <button
                          key={chip.val}
                          type="button"
                          onClick={() => setRestockAddAmount(chip.val)}
                          className={`min-h-[40px] px-2 py-1.5 rounded-xl text-xs font-bold font-mono transition-all border cursor-pointer touch-manipulation flex items-center justify-center text-center ${
                            restockAddAmount === chip.val
                              ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-md shadow-emerald-500/30'
                              : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                          }`}
                        >
                          {chip.label}
                        </button>
                      ))}
                </div>
              </div>

              {/* Live Calculation Preview Card */}
              {(() => {
                const isPack = restockUnitType === 'pack' && !!restockProduct.hasMultiUnit;
                const multiplier = isPack ? (restockProduct.packMultiplier || 24) : 1;
                const baseQtyToAdd = (Number(restockAddAmount) || 0) * multiplier;
                const newTotalBase = Math.max(0, restockProduct.stock + baseQtyToAdd);
                const packSummary = calculateAvailablePacksAndSingles(
                  newTotalBase,
                  restockProduct.packMultiplier || 24,
                  restockProduct.unit,
                  restockProduct.packUnit || 'ແພັກ'
                );

                return (
                  <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 space-y-2">
                    <div className="text-[11px] font-bold text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>ສະຫຼຸບການບວກສະຕັອກ (Live Summary):</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-300 pt-1 border-t border-emerald-500/20 font-mono">
                      <span>ສະຕັອກເດີມ:</span>
                      <span className="font-bold text-slate-300">
                        {restockProduct.stock} {restockProduct.unit}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-emerald-400 font-mono">
                      <span>+ ບວກເພີ່ມເຂົ້າ:</span>
                      <span className="font-bold text-emerald-400">
                        +{Number(restockAddAmount) || 0} {isPack ? (restockProduct.packUnit || 'ແພັກ') : restockProduct.unit}
                        {isPack && ` (${baseQtyToAdd} ${restockProduct.unit})`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-white pt-2 border-t border-emerald-500/30 font-mono">
                      <span className="font-black text-amber-300">ລວມສະຕັອກໃໝ່ທີ່ຈະໄດ້:</span>
                      <span className="text-base font-black text-emerald-400 bg-emerald-950/80 px-2.5 py-0.5 rounded-lg border border-emerald-500/40">
                        {newTotalBase} {restockProduct.unit}
                        {restockProduct.hasMultiUnit && (
                          <span className="text-[11px] text-slate-300 font-normal block text-right">
                            ({packSummary.packs} {restockProduct.packUnit || 'ແພັກ'}{packSummary.singles > 0 ? ` +${packSummary.singles}` : ''})
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Modal Actions */}
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setRestockProduct(null)}
                  className="flex-1 min-h-[46px] py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-slate-300 text-xs sm:text-sm font-semibold cursor-pointer touch-manipulation flex items-center justify-center transition-all"
                >
                  ຍົກເລີກ
                </button>
                <button
                  type="submit"
                  onClick={(e) => {
                    if (e.isDefaultPrevented()) return;
                    handleConfirmRestock(e);
                  }}
                  className="flex-1 min-h-[46px] py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] text-white text-xs sm:text-sm font-black shadow-lg shadow-emerald-600/30 cursor-pointer touch-manipulation flex items-center justify-center gap-1.5 transition-all"
                >
                  <PackagePlus className="w-4 h-4" />
                  <span>
                    ຢືນຢັນບວກສະຕັອກ (+{Number(restockAddAmount) || 0} {restockUnitType === 'pack' ? (restockProduct.packUnit || 'ແພັກ') : restockProduct.unit})
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
