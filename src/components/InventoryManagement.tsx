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
} from 'lucide-react';
import { Product, ProductCategory, Role, AppSettings } from '../types';
import { formatCurrency } from '../lib/storage';
import { FormattedNumberInput } from './FormattedNumberInput';

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

  // Handle image file upload (converts to Base64)
  const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('ກະລຸນາເລືອກໄຟລ໌ຮູບພາບເທົ່ານັ້ນ (JPG, PNG, WEBP...)');
      return;
    }

    // Read and compress or store as base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setFormData((prev) => ({ ...prev, imageUrl: result }));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      alert('ກະລຸນາປ້ອນຊື່ສິນຄ້າ!');
      return;
    }

    let updatedList: Product[];
    if (isAddingNew) {
      const newProd: Product = {
        id: formData.id || 'prod-' + Date.now(),
        name: formData.name,
        category: (formData.category as ProductCategory) || 'other',
        costPrice: Number(formData.costPrice) || 0,
        salePrice: Number(formData.salePrice) || 0,
        stock: Number(formData.stock) || 0,
        minStockAlert: Number(formData.minStockAlert) || 5,
        unit: formData.unit || 'ອັນ',
        requireSeller: !!formData.requireSeller,
        imageUrl: formData.imageUrl?.trim() || undefined,
      };
      updatedList = [newProd, ...products];
    } else if (editingProduct) {
      updatedList = products.map((p) =>
        p.id === editingProduct.id
          ? ({
              ...p,
              name: formData.name!,
              category: (formData.category as ProductCategory) || p.category,
              costPrice: Number(formData.costPrice) || 0,
              salePrice: Number(formData.salePrice) || 0,
              stock: Number(formData.stock) || 0,
              minStockAlert: Number(formData.minStockAlert) || 5,
              unit: formData.unit || p.unit,
              requireSeller: !!formData.requireSeller,
              imageUrl: formData.imageUrl?.trim() || undefined,
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
                              src={prod.imageUrl}
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

                      {/* Quantity */}
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`font-mono text-sm font-black ${
                            isOutOfStock
                              ? 'text-rose-400 underline decoration-rose-500'
                              : isLowStock
                              ? 'text-amber-400'
                              : 'text-slate-200'
                          }`}
                        >
                          {prod.stock}
                        </span>{' '}
                        <span className="text-[10px] text-slate-400">{prod.unit}</span>
                      </td>

                      {/* Quick Adjust Buttons */}
                      <td className="py-3 px-4 text-center">
                        {prod.category !== 'service' ? (
                          <div className="inline-flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                            <button
                              onClick={() => handleQuickAdjustStock(prod.id, -1)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
                            >
                              -1
                            </button>
                            <button
                              onClick={() => handleQuickAdjustStock(prod.id, 5)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-emerald-900/60 text-emerald-300 text-xs font-bold cursor-pointer"
                            >
                              +5
                            </button>
                            <button
                              onClick={() => handleQuickAdjustStock(prod.id, 12)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-amber-900/60 text-amber-300 text-xs font-bold cursor-pointer"
                              title="ເພີ່ມ 1 ລັງ (12)"
                            >
                              +12
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
                            onClick={() => handleOpenEditModal(prod)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                            title="ແກ້ໄຂສິນຄ້າ ແລະ ຮູບພາບ"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          {currentRole === 'admin' && (
                            <button
                              onClick={() => handleDeleteProduct(prod.id, prod.name)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                              title="ລຶບສິນຄ້າ"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg shadow-2xl text-white my-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-amber-400" />
                <span>{isAddingNew ? 'ເພີ່ມສິນຄ້າ / ເມນູໃໝ່' : 'ແກ້ໄຂສິນຄ້າ ແລະ ຮູບພາບ'}</span>
              </h3>
              <button
                onClick={() => {
                  setIsAddingNew(false);
                  setEditingProduct(null);
                }}
                className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-4">
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
                        src={formData.imageUrl}
                        alt="Preview"
                        className="w-full h-full object-cover"
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
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>ອັບໂຫຼດຮູບຈາກເຄື່ອງ</span>
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
                  ຊື່ສິນຄ້າ (Product Name):
                </label>
                <input
                  type="text"
                  required
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
                    required
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
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  ຍົກເລີກ
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 text-white text-xs font-bold shadow-lg shadow-rose-500/20 cursor-pointer"
                >
                  ບັນທຶກສິນຄ້າ & ຮູບພາບ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
