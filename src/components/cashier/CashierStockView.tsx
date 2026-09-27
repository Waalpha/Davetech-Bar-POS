import React, { useEffect, useState } from 'react';
import { UserProfile, BusinessConfig, Product, Sale } from '../../types';
import { db, DEFAULT_BUSINESS_ID } from '../../lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Package, Search, AlertTriangle, CheckCircle, XCircle, Sunrise, CalendarCheck, ArrowRight } from 'lucide-react';
import { getLocalCachedProducts, cacheLocalProducts } from '../../lib/offlineManager';

interface CashierStockViewProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
  onNavigateToOpening?: () => void;
  onNavigateToClosing?: () => void;
}

export function CashierStockView({ user, businessConfig, onNavigateToOpening, onNavigateToClosing }: CashierStockViewProps) {
  const tenantId = user.businessId || DEFAULT_BUSINESS_ID;
  const [products, setProducts] = useState<Product[]>(() => getLocalCachedProducts(tenantId));
  const [soldMap, setSoldMap] = useState<Record<string, number>>(() => {
    try {
      const localSales: Sale[] = JSON.parse(localStorage.getItem(`bar_pos_local_sales_${tenantId}`) || localStorage.getItem('bar_pos_local_sales') || '[]');
      const todayStr = new Date().toISOString().split('T')[0];
      const sMap: Record<string, number> = {};
      localSales.filter(s => s.date === todayStr).forEach(sale => {
        sale.items.forEach(item => {
          sMap[item.productId] = (sMap[item.productId] || 0) + item.quantity;
        });
      });
      return sMap;
    } catch (e) {
      return {};
    }
  });
  const [loading, setLoading] = useState<boolean>(() => getLocalCachedProducts(tenantId).length === 0);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 400);
    fetchStockData();
    return () => clearTimeout(timer);
  }, [tenantId]);

  async function fetchStockData() {
    // Load local stock first for instant display
    const cachedProds = getLocalCachedProducts(tenantId);
    if (cachedProds.length > 0) {
      setProducts(cachedProds);
      setLoading(false);
      // Calculate sold map from local sales
      try {
        const localSales: Sale[] = JSON.parse(localStorage.getItem(`bar_pos_local_sales_${tenantId}`) || localStorage.getItem('bar_pos_local_sales') || '[]');
        const todayStr = new Date().toISOString().split('T')[0];
        const sMap: Record<string, number> = {};
        localSales.filter(s => s.date === todayStr).forEach(sale => {
          sale.items.forEach(item => {
            sMap[item.productId] = (sMap[item.productId] || 0) + item.quantity;
          });
        });
        setSoldMap(sMap);
      } catch (e) {
        // ignore
      }
    }

    try {
      // 1. Fetch products
      const prodRef = collection(db, 'businesses', tenantId, 'products');
      const prodSnap = await getDocs(prodRef);
      const prods: Product[] = [];
      prodSnap.forEach(d => {
        prods.push({ id: d.id, ...d.data() } as Product);
      });

      // 2. Calculate sold quantities for today from sales
      const todayStr = new Date().toISOString().split('T')[0];
      const salesRef = collection(db, 'businesses', tenantId, 'sales');
      const salesQuery = query(salesRef, where('date', '==', todayStr));
      const salesSnap = await getDocs(salesQuery);

      const sMap: Record<string, number> = {};
      salesSnap.forEach(d => {
        const sale = d.data() as Sale;
        sale.items.forEach(item => {
          sMap[item.productId] = (sMap[item.productId] || 0) + item.quantity;
        });
      });

      if (prods.length > 0) {
        setProducts(prods);
        cacheLocalProducts(prods, tenantId);
      }
      setSoldMap(sMap);
    } catch (err) {
      console.warn("Working offline: showing local cached stock data:", err);
      const localProds = getLocalCachedProducts(tenantId);
      setProducts(localProds);
      try {
        const localSales: Sale[] = JSON.parse(localStorage.getItem(`bar_pos_local_sales_${tenantId}`) || localStorage.getItem('bar_pos_local_sales') || '[]');
        const todayStr = new Date().toISOString().split('T')[0];
        const sMap: Record<string, number> = {};
        localSales.filter(s => s.date === todayStr).forEach(sale => {
          sale.items.forEach(item => {
            sMap[item.productId] = (sMap[item.productId] || 0) + item.quantity;
          });
        });
        setSoldMap(sMap);
      } catch (e) {
        // ignore
      }
    } finally {
      setLoading(false);
    }
  }

  const filteredProducts = products.filter(p => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.categoryName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="h-full min-h-0 overflow-y-auto pr-1 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Bar Stock Status</h2>
          <p className="text-sm text-gray-500">Live inventory tracking for today's shift</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2.5">
          {onNavigateToOpening && (
            <button
              type="button"
              onClick={onNavigateToOpening}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-all active:scale-95"
            >
              <Sunrise className="w-4 h-4 text-amber-200" />
              <span>Take Opening Stock</span>
            </button>
          )}

          {onNavigateToClosing && (
            <button
              type="button"
              onClick={onNavigateToClosing}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs cursor-pointer transition-all active:scale-95"
            >
              <CalendarCheck className="w-4 h-4 text-amber-400" />
              <span>Take Closing Stock</span>
            </button>
          )}

          <div className="relative flex-1 sm:w-64">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products..."
              className="w-full rounded-xl border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/20"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading stock status...</div>
      ) : (
        <div className="bg-white rounded-3xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-xs font-bold uppercase tracking-wider text-gray-500">
                  <th className="p-4">Product Name</th>
                  <th className="p-4">Category</th>
                  <th className="p-4 text-center">Opening Stock</th>
                  <th className="p-4 text-center">Stock Added</th>
                  <th className="p-4 text-center">Sold</th>
                  <th className="p-4 text-center">Remaining</th>
                  <th className="p-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {filteredProducts.map(product => {
                  const sold = soldMap[product.id] || 0;
                  const added = product.stockAdded || 0;
                  const remaining = product.currentStock; // currentStock is updated upon sale
                  const isOut = remaining <= 0;
                  const isLow = !isOut && remaining <= product.minStockLevel;

                  return (
                    <tr key={product.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="p-4">
                        <div className="font-bold text-gray-900">{product.name}</div>
                      </td>
                      <td className="p-4">
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                          {product.categoryName}
                        </span>
                      </td>
                      <td className="p-4 text-center font-medium text-gray-700">{product.openingStock}</td>
                      <td className="p-4 text-center font-medium text-blue-600">+{added}</td>
                      <td className="p-4 text-center font-medium text-amber-600">-{sold}</td>
                      <td className="p-4 text-center font-extrabold text-gray-900">{remaining}</td>
                      <td className="p-4 text-center">
                        {isOut ? (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Out of Stock</span>
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Low Stock</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>Normal</span>
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
      )}
    </div>
  );
}
