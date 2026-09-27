import React, { useEffect, useState } from 'react';
import { UserProfile, BusinessConfig, Product, DailyOpening, OpeningItem } from '../../types';
import { db, DEFAULT_BUSINESS_ID } from '../../lib/firebase';
import { collection, getDocs, doc, setDoc, getDoc, writeBatch } from 'firebase/firestore';
import { logAuditAction } from '../../lib/utils';
import { 
  Sunrise, 
  CheckCircle2, 
  Search, 
  Printer, 
  RotateCcw, 
  Save, 
  Layers, 
  Wine, 
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { getLocalCachedProducts, cacheLocalProducts, queueOpeningForSync } from '../../lib/offlineManager';
import { loadProductsFast } from '../../lib/productService';

interface DailyOpeningViewProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
  onNavigateToPOS?: () => void;
  onComplete?: () => void;
}

export function DailyOpeningView({ user, businessConfig, onNavigateToPOS, onComplete }: DailyOpeningViewProps) {
  const tenantId = user.businessId || DEFAULT_BUSINESS_ID;
  const todayStr = new Date().toISOString().split('T')[0];
  const openingDocId = `${todayStr}-${user.uid}`;

  const [products, setProducts] = useState<Product[]>(() => getLocalCachedProducts(tenantId));
  const [openingCounts, setOpeningCounts] = useState<Record<string, number>>(() => {
    const cached = getLocalCachedProducts(tenantId);
    const initial: Record<string, number> = {};
    cached.forEach(p => {
      initial[p.id] = p.currentStock !== undefined ? p.currentStock : (p.openingStock || 0);
    });
    return initial;
  });
  const [existingOpening, setExistingOpening] = useState<DailyOpening | null>(() => {
    try {
      const localOpenings: Record<string, DailyOpening> = JSON.parse(
        localStorage.getItem(`bar_pos_local_openings_${tenantId}`) || 
        localStorage.getItem('bar_pos_local_openings') || 
        '{}'
      );
      return localOpenings[openingDocId] || null;
    } catch (e) {
      return null;
    }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isEditingExisting, setIsEditingExisting] = useState(false);

  useEffect(() => {
    loadOpeningData();
  }, [tenantId]);

  async function loadOpeningData() {
    // 1. Check local storage for existing opening today
    try {
      const localOpenings: Record<string, DailyOpening> = JSON.parse(
        localStorage.getItem(`bar_pos_local_openings_${tenantId}`) || 
        localStorage.getItem('bar_pos_local_openings') || 
        '{}'
      );
      if (localOpenings[openingDocId]) {
        setExistingOpening(localOpenings[openingDocId]);
        const existingCounts: Record<string, number> = {};
        localOpenings[openingDocId].items.forEach(item => {
          existingCounts[item.productId] = item.openingStock;
        });
        setOpeningCounts(existingCounts);
      }
    } catch (e) {
      console.warn("Could not read local openings:", e);
    }

    // 2. Load products from local cache first for instant render
    const cachedProds = getLocalCachedProducts(tenantId);
    if (cachedProds.length > 0) {
      setProducts(cachedProds);
      initCountsFromProducts(cachedProds);
    }

    // 3. Fetch from Firestore non-blockingly if online
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const openingRef = doc(db, 'businesses', tenantId, 'dailyOpenings', openingDocId);
        getDoc(openingRef).then(openingSnap => {
          if (openingSnap.exists()) {
            const data = openingSnap.data() as DailyOpening;
            setExistingOpening(data);
            if (data.notes) setNotes(data.notes);
            const existingCounts: Record<string, number> = {};
            data.items.forEach(item => {
              existingCounts[item.productId] = item.openingStock;
            });
            setOpeningCounts(existingCounts);
          }
        }).catch(() => {});

        loadProductsFast(tenantId, (remoteProds) => {
          setProducts(remoteProds);
        }).then(remoteProds => {
          if (remoteProds && remoteProds.length > 0) {
            setProducts(remoteProds);
          }
        }).catch(() => {});
      } catch (err) {
        console.warn("Working offline for opening stock:", err);
      }
    }
  }

  function initCountsFromProducts(prods: Product[]) {
    setOpeningCounts(prev => {
      // If already set by user, don't clobber
      if (Object.keys(prev).length > 0) return prev;
      const initial: Record<string, number> = {};
      prods.forEach(p => {
        // Default to currentStock or openingStock
        initial[p.id] = p.currentStock !== undefined ? p.currentStock : (p.openingStock || 0);
      });
      return initial;
    });
  }

  const handleCountChange = (productId: string, value: string) => {
    const val = parseInt(value, 10);
    setOpeningCounts(prev => ({
      ...prev,
      [productId]: isNaN(val) ? 0 : Math.max(0, val)
    }));
  };

  const adjustCount = (productId: string, delta: number) => {
    setOpeningCounts(prev => {
      const current = prev[productId] !== undefined ? prev[productId] : 0;
      return {
        ...prev,
        [productId]: Math.max(0, current + delta)
      };
    });
  };

  const handleQuickFillFromSystem = () => {
    const filled: Record<string, number> = {};
    products.forEach(p => {
      filled[p.id] = p.currentStock !== undefined ? p.currentStock : (p.openingStock || 0);
    });
    setOpeningCounts(filled);
  };

  const handleResetCounts = () => {
    if (window.confirm("Reset all opening counts to 0?")) {
      const zeros: Record<string, number> = {};
      products.forEach(p => {
        zeros[p.id] = 0;
      });
      setOpeningCounts(zeros);
    }
  };

  const categories = Array.from(new Set(products.map(p => p.categoryName || 'Other'))).filter(Boolean);

  const filteredProducts = products.filter(p => {
    const matchesSearch = searchQuery === '' || 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      p.categoryName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = selectedCategory === 'all' || p.categoryName === selectedCategory;
    return matchesSearch && matchesCat;
  });

  // Calculate totals
  const totalCountedUnits: number = Object.values(openingCounts).reduce<number>((acc: number, count: number) => acc + (Number(count) || 0), 0);
  const totalProductsCounted = products.filter(p => openingCounts[p.id] !== undefined).length;

  const handleSubmitOpening = async () => {
    if (totalCountedUnits === 0 && !window.confirm("Total counted opening stock is 0. Are you sure you want to proceed?")) {
      return;
    }

    setSubmitting(true);
    try {
      const items: OpeningItem[] = products.map(p => {
        const count = openingCounts[p.id] !== undefined ? openingCounts[p.id] : (p.currentStock || 0);
        const prev = p.currentStock !== undefined ? p.currentStock : (p.openingStock || 0);
        return {
          productId: p.id,
          productName: p.name,
          categoryName: p.categoryName,
          unitType: p.unitType,
          previousStock: prev,
          openingStock: count,
          variance: count - prev
        };
      });

      const dailyOpeningRecord: DailyOpening = {
        id: openingDocId,
        businessDayId: todayStr,
        date: todayStr,
        cashierId: user.uid,
        cashierName: user.name,
        items,
        totalOpeningUnits: totalCountedUnits,
        notes: notes.trim() || undefined,
        submittedAt: Date.now(),
        status: 'confirmed'
      };

      // 1. Save local record for instant offline-first resilience
      try {
        const localOpenings: Record<string, DailyOpening> = JSON.parse(
          localStorage.getItem(`bar_pos_local_openings_${tenantId}`) || 
          localStorage.getItem('bar_pos_local_openings') || 
          '{}'
        );
        localOpenings[openingDocId] = dailyOpeningRecord;
        localStorage.setItem(`bar_pos_local_openings_${tenantId}`, JSON.stringify(localOpenings));
        localStorage.setItem('bar_pos_local_openings', JSON.stringify(localOpenings));
      } catch (err) {
        console.warn("Could not save to local openings:", err);
      }

      // 2. Update local products with the new opening stock and current stock
      const updatedProducts = products.map(p => {
        const newCount = openingCounts[p.id] !== undefined ? openingCounts[p.id] : (p.currentStock || 0);
        return {
          ...p,
          openingStock: newCount,
          currentStock: newCount, // resetting baseline at opening
          stockAdded: 0 // fresh shift start
        };
      });
      setProducts(updatedProducts);
      cacheLocalProducts(updatedProducts, tenantId);

      // 3. Sync to Firestore if online; queue for auto-sync if offline or on network error
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          // Save opening record
          const openingRef = doc(db, 'businesses', tenantId, 'dailyOpenings', openingDocId);
          await setDoc(openingRef, dailyOpeningRecord);

          // Batch update products in Firestore
          const batch = writeBatch(db);
          updatedProducts.forEach(p => {
            const pRef = doc(db, 'businesses', tenantId, 'products', p.id);
            batch.update(pRef, {
              openingStock: p.openingStock,
              currentStock: p.currentStock,
              stockAdded: 0
            });
          });
          await batch.commit();
        } catch (dbErr) {
          console.warn("Could not commit batch to Firestore, queued for auto-sync:", dbErr);
          queueOpeningForSync(dailyOpeningRecord, updatedProducts, tenantId);
        }
      } else {
        console.log("Device offline. Queued shift opening for automatic background sync when connection restores.");
        queueOpeningForSync(dailyOpeningRecord, updatedProducts, tenantId);
      }

      // 4. Log audit action
      logAuditAction(
        user.uid,
        user.name,
        'OPENING_STOCK_TAKEN',
        `Cashier ${user.name} took shift opening stock: ${totalCountedUnits} bottles across ${items.length} products for ${todayStr}`,
        openingDocId
      ).catch(() => {});

      setExistingOpening(dailyOpeningRecord);
      setSuccess(true);
      setIsEditingExisting(false);
    } catch (err: any) {
      console.error("Error submitting opening stock:", err);
      alert("Failed to save opening stock: " + (err.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrintOpeningSlip = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500 space-y-3">
        <div className="w-10 h-10 border-4 border-amber-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium">Loading bar inventory checklist...</p>
      </div>
    );
  }

  // Already submitted and not actively editing
  if (existingOpening && !isEditingExisting) {
    return (
      <div className="h-full min-h-0 overflow-y-auto pr-1 space-y-4 max-w-5xl mx-auto pb-8">
        {/* Confirmed Banner */}
        <div className="rounded-3xl bg-emerald-900 text-white p-6 sm:p-8 shadow-xl border border-emerald-700/50">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex items-start space-x-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-800/80 border border-emerald-600/60 flex items-center justify-center shrink-0 shadow-inner">
                <CheckCircle2 className="w-8 h-8 text-emerald-300" />
              </div>
              <div>
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-800 text-emerald-200 text-xs font-bold uppercase tracking-wider mb-2">
                  <Sunrise className="w-3.5 h-3.5" />
                  <span>Opening Stock Confirmed</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight">Shift Stock is Active</h2>
                <p className="text-emerald-100 text-sm mt-1">
                  Recorded by <strong>{existingOpening.cashierName}</strong> on <strong>{existingOpening.date}</strong> at{' '}
                  {new Date(existingOpening.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={handlePrintOpeningSlip}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-emerald-800/80 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold border border-emerald-600 cursor-pointer shadow-sm transition-all"
              >
                <Printer className="w-4 h-4" />
                <span>Print Slip</span>
              </button>
              <button
                type="button"
                onClick={() => setIsEditingExisting(true)}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-bold border border-white/20 cursor-pointer transition-all"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Recount / Adjust</span>
              </button>
              {onNavigateToPOS && (
                <button
                  type="button"
                  onClick={onNavigateToPOS}
                  className="inline-flex items-center space-x-1.5 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs sm:text-sm font-black shadow-lg cursor-pointer transition-all active:scale-95"
                >
                  <span>RECORD SALE (POS)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
              {onComplete && (
                <button
                  type="button"
                  onClick={onComplete}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold cursor-pointer transition-all border border-emerald-600"
                >
                  <span>Dashboard</span>
                </button>
              )}
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-emerald-800/60 text-emerald-100">
            <div>
              <p className="text-xs uppercase text-emerald-300 font-semibold">Total Opening Units</p>
              <p className="text-2xl font-black text-white mt-0.5">{existingOpening.totalOpeningUnits} bottles</p>
            </div>
            <div>
              <p className="text-xs uppercase text-emerald-300 font-semibold">Products Counted</p>
              <p className="text-2xl font-black text-white mt-0.5">{existingOpening.items.length} items</p>
            </div>
            <div>
              <p className="text-xs uppercase text-emerald-300 font-semibold">Status</p>
              <p className="text-2xl font-black text-emerald-300 mt-0.5">Verified</p>
            </div>
            <div>
              <p className="text-xs uppercase text-emerald-300 font-semibold">Shift Notes</p>
              <p className="text-sm font-medium text-white truncate mt-1">
                {existingOpening.notes || 'No notes attached'}
              </p>
            </div>
          </div>
        </div>

        {/* Counted Breakdown Table */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">Recorded Opening Inventory Count</h3>
            <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full">
              {existingOpening.items.length} Products
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <th className="p-4">Product</th>
                  <th className="p-4">Category</th>
                  <th className="p-4 text-center">Previous Stock</th>
                  <th className="p-4 text-center">Opening Count</th>
                  <th className="p-4 text-center">Adjustment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {existingOpening.items.map((item, idx) => {
                  const variance = item.variance !== undefined ? item.variance : (item.openingStock - item.previousStock);
                  return (
                    <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-4 font-bold text-slate-900">{item.productName}</td>
                      <td className="p-4">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                          {item.categoryName || 'General'}
                        </span>
                      </td>
                      <td className="p-4 text-center text-slate-500 font-medium">{item.previousStock}</td>
                      <td className="p-4 text-center font-extrabold text-slate-900 text-base">{item.openingStock}</td>
                      <td className="p-4 text-center">
                        {variance === 0 ? (
                          <span className="text-xs font-bold text-slate-400">No Change</span>
                        ) : variance > 0 ? (
                          <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                            +{variance} extra
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                            {variance} shortage
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Active Count Entry Form
  return (
    <div className="h-full min-h-0 overflow-y-auto pr-1 space-y-4 max-w-5xl mx-auto pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-black uppercase tracking-wider mb-2">
            <Sunrise className="w-3.5 h-3.5 text-amber-700" />
            <span>Shift Opening Count</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Take Opening Stock
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Count physical bottles on shelves and counters before opening today's register.
          </p>
        </div>

        {/* Quick action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleQuickFillFromSystem}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold border border-slate-300/80 cursor-pointer transition-all active:scale-95"
          >
            <Sparkles className="w-4 h-4 text-amber-600" />
            <span>Pre-fill System Stock</span>
          </button>
          <button
            type="button"
            onClick={handleResetCounts}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-50 hover:bg-red-50 text-slate-600 hover:text-red-700 text-xs font-bold border border-slate-200 cursor-pointer transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-md">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-400">Total Counted Units</p>
          <p className="text-3xl font-black text-white mt-1">{totalCountedUnits} <span className="text-sm font-normal text-slate-400">bottles</span></p>
          <p className="text-xs text-slate-400 mt-1">Sum of all shelf inventory</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Products Catalog</p>
          <p className="text-3xl font-black text-slate-900 mt-1">{totalProductsCounted} / {products.length}</p>
          <p className="text-xs text-slate-500 mt-1">Catalog items accounted for</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Cashier on Duty</p>
          <p className="text-xl font-black text-slate-900 mt-1 truncate">{user.name}</p>
          <p className="text-xs text-emerald-600 font-semibold mt-1">Shift date: {todayStr}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search product by name or category..."
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/20"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
                selectedCategory === 'all'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All ({products.length})
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
                  selectedCategory === cat
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Product Counting List */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-amber-600" />
            <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider">Physical Bottle Count</h3>
          </div>
          <span className="text-xs text-slate-500 font-medium">Use + / - buttons or type count</span>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredProducts.map(product => {
            const currentCount = openingCounts[product.id] !== undefined ? openingCounts[product.id] : (product.currentStock || 0);
            const systemStock = product.currentStock !== undefined ? product.currentStock : (product.openingStock || 0);
            const diff = currentCount - systemStock;

            return (
              <div 
                key={product.id}
                className="p-4 sm:p-5 hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <h4 className="font-bold text-slate-900 text-base">{product.name}</h4>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700">
                      {product.categoryName}
                    </span>
                  </div>
                  <div className="flex items-center space-x-3 text-xs text-slate-500 mt-1">
                    <span>System Stock: <strong className="text-slate-700">{systemStock}</strong></span>
                    <span>•</span>
                    <span>Selling: <strong className="text-amber-800">{businessConfig?.currency || 'KSh'} {product.sellingPrice}</strong></span>
                    {diff !== 0 && (
                      <span className={`font-bold ${diff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        ({diff > 0 ? `+${diff}` : diff} vs system)
                      </span>
                    )}
                  </div>
                </div>

                {/* Counter Stepper Controls */}
                <div className="flex items-center space-x-2 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => adjustCount(product.id, -10)}
                    className="w-8 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center cursor-pointer transition-colors active:scale-95"
                    title="-10"
                  >
                    -10
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustCount(product.id, -1)}
                    className="w-9 h-9 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-900 text-base font-black flex items-center justify-center cursor-pointer transition-colors active:scale-95"
                    title="-1"
                  >
                    -
                  </button>
                  
                  <input
                    type="number"
                    min="0"
                    value={currentCount}
                    onChange={(e) => handleCountChange(product.id, e.target.value)}
                    className="w-20 h-10 text-center font-black text-lg rounded-xl border-2 border-slate-300 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-slate-900"
                  />

                  <button
                    type="button"
                    onClick={() => adjustCount(product.id, 1)}
                    className="w-9 h-9 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-base font-black flex items-center justify-center cursor-pointer transition-colors active:scale-95"
                    title="+1"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustCount(product.id, 10)}
                    className="w-8 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center cursor-pointer transition-colors active:scale-95"
                    title="+10"
                  >
                    +10
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Shift Notes Section */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-2">
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
          Handover / Opening Shift Notes (Optional)
        </label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Fridge #2 restocked from main store, 2 Tusker bottles broken found on counter..."
          className="w-full p-3.5 rounded-2xl border border-slate-300 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-sm text-slate-800 placeholder-slate-400"
        />
      </div>

      {/* Action Footer Bar - ALWAYS 100% VISIBLE */}
      <div className="sticky bottom-0 z-30 bg-slate-900/95 backdrop-blur-md rounded-2xl p-3 sm:p-3.5 text-white shadow-2xl border border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div>
          <p className="text-[10px] text-slate-400 uppercase font-semibold">Ready to Confirm Shift Start</p>
          <p className="text-sm sm:text-base font-bold text-white">
            <span className="text-amber-400 font-mono text-base sm:text-lg">{totalCountedUnits}</span> total units across{' '}
            <span className="text-amber-400 font-mono">{products.length}</span> products
          </p>
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          {isEditingExisting && (
            <button
              type="button"
              onClick={() => setIsEditingExisting(false)}
              className="flex-1 sm:flex-initial px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs sm:text-sm font-bold cursor-pointer transition-colors"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmitOpening}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center space-x-2 px-6 py-2.5 sm:py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm tracking-wide shadow-lg cursor-pointer transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                <span>SAVING OPENING STOCK...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>CONFIRM & LOCK OPENING STOCK</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
