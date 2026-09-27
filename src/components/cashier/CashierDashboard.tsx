import React, { useEffect, useState } from 'react';
import { UserProfile, BusinessConfig, Sale, Product, DailyOpening, ExpenseRecord } from '../../types';
import { db, DEFAULT_BUSINESS_ID } from '../../lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { formatCurrency } from '../../lib/utils';
import { 
  ShoppingCart, Receipt, Package, CalendarCheck, TrendingUp, DollarSign, 
  Layers, UtensilsCrossed, Sunrise, CheckCircle2, ArrowRight, Wallet, Plus 
} from 'lucide-react';
import { subscribeOrders } from '../../lib/orderService';
import { getLocalCachedProducts } from '../../lib/offlineManager';
import { subscribeExpenses, getLocalExpenses } from '../../lib/expenseService';
import { RecordExpenseModal } from '../common/RecordExpenseModal';

interface CashierDashboardProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
  setActiveTab: (tab: 'dashboard' | 'sell' | 'waiter_orders' | 'opening_stock' | 'stock' | 'closing' | 'sales' | 'expenses') => void;
}

export function CashierDashboard({ user, businessConfig, setActiveTab }: CashierDashboardProps) {
  const tenantId = user.businessId || DEFAULT_BUSINESS_ID;
  const todayStr = new Date().toISOString().split('T')[0];
  const currency = businessConfig?.currency || 'KSh';

  const [todaySalesTotal, setTodaySalesTotal] = useState<number>(() => {
    try {
      const localSales = JSON.parse(localStorage.getItem(`bar_pos_local_sales_${tenantId}`) || localStorage.getItem('bar_pos_local_sales') || '[]');
      return localSales.filter((s: Sale) => s.date === todayStr).reduce((acc: number, s: Sale) => acc + s.totalAmount, 0);
    } catch (e) {
      return 0;
    }
  });
  const [todayCashSalesTotal, setTodayCashSalesTotal] = useState<number>(() => {
    try {
      const localSales = JSON.parse(localStorage.getItem(`bar_pos_local_sales_${tenantId}`) || localStorage.getItem('bar_pos_local_sales') || '[]');
      return localSales.filter((s: Sale) => s.date === todayStr && s.paymentMethod === 'Cash').reduce((acc: number, s: Sale) => acc + s.totalAmount, 0);
    } catch (e) {
      return 0;
    }
  });
  const [todayExpensesTotal, setTodayExpensesTotal] = useState<number>(() => {
    try {
      const localExpenses = getLocalExpenses(tenantId);
      return localExpenses.filter(e => e.date === todayStr).reduce((sum, e) => sum + e.amount, 0);
    } catch (e) {
      return 0;
    }
  });
  const [todayDrawerExpensesTotal, setTodayDrawerExpensesTotal] = useState<number>(() => {
    try {
      const localExpenses = getLocalExpenses(tenantId);
      return localExpenses.filter(e => e.date === todayStr && e.paymentSource === 'Cash Drawer').reduce((sum, e) => sum + e.amount, 0);
    } catch (e) {
      return 0;
    }
  });
  const [todayItemsSold, setTodayItemsSold] = useState<number>(() => {
    try {
      const localSales = JSON.parse(localStorage.getItem(`bar_pos_local_sales_${tenantId}`) || localStorage.getItem('bar_pos_local_sales') || '[]');
      return localSales
        .filter((s: Sale) => s.date === todayStr)
        .reduce((acc: number, s: Sale) => acc + s.items.reduce((sum: number, i: any) => sum + i.quantity, 0), 0);
    } catch (e) {
      return 0;
    }
  });
  const [todayTransactionsCount, setTodayTransactionsCount] = useState<number>(() => {
    try {
      const localSales = JSON.parse(localStorage.getItem(`bar_pos_local_sales_${tenantId}`) || localStorage.getItem('bar_pos_local_sales') || '[]');
      return localSales.filter((s: Sale) => s.date === todayStr).length;
    } catch (e) {
      return 0;
    }
  });
  const [availableStockTotal, setAvailableStockTotal] = useState<number>(() => {
    const cached = getLocalCachedProducts(tenantId);
    return cached.reduce((sum, p) => sum + (p.currentStock !== undefined ? p.currentStock : (p.openingStock || 0)), 0);
  });
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [openingStockRecord, setOpeningStockRecord] = useState<DailyOpening | null>(() => {
    try {
      const localOpenings = JSON.parse(
        localStorage.getItem(`bar_pos_local_openings_${tenantId}`) || 
        localStorage.getItem('bar_pos_local_openings') || 
        '{}'
      );
      return localOpenings[`${todayStr}-${user.uid}`] || null;
    } catch (e) {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  // Subscribe to live expenses
  useEffect(() => {
    const unsub = subscribeExpenses(tenantId, (all) => {
      const todayList = all.filter(e => e.date === todayStr);
      const totalExp = todayList.reduce((sum, e) => sum + e.amount, 0);
      const drawerExp = todayList.filter(e => e.paymentSource === 'Cash Drawer').reduce((sum, e) => sum + e.amount, 0);
      setTodayExpensesTotal(totalExp);
      setTodayDrawerExpensesTotal(drawerExp);
    });
    return () => unsub();
  }, [tenantId, todayStr]);

  useEffect(() => {
    const unsub = subscribeOrders(tenantId, (orders) => {
      const pending = orders.filter(o => o.orderStatus !== 'completed' && o.orderStatus !== 'cancelled').length;
      setPendingOrdersCount(pending);
    });
    return () => unsub();
  }, [tenantId]);

  useEffect(() => {
    async function fetchStats() {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        
        // 1. Check if opening stock is recorded today
        try {
          const localOpenings = JSON.parse(
            localStorage.getItem(`bar_pos_local_openings_${tenantId}`) || 
            localStorage.getItem('bar_pos_local_openings') || 
            '{}'
          );
          if (localOpenings[`${todayStr}-${user.uid}`]) {
            setOpeningStockRecord(localOpenings[`${todayStr}-${user.uid}`]);
          }
        } catch (e) {
          // ignore
        }

        if (typeof navigator !== 'undefined' && navigator.onLine) {
          try {
            const opRef = doc(db, 'businesses', tenantId, 'dailyOpenings', `${todayStr}-${user.uid}`);
            const opSnap = await getDoc(opRef);
            if (opSnap.exists()) {
              setOpeningStockRecord(opSnap.data() as DailyOpening);
            }
          } catch (err) {
            console.warn("Could not check online opening stock:", err);
          }
        }
        
        // 2. Fetch today's sales
        const salesRef = collection(db, 'businesses', tenantId, 'sales');
        const qSales = query(salesRef, where('date', '==', todayStr));
        const salesSnap = await getDocs(qSales);
        
        let totalCash = 0;
        let totalQty = 0;
        salesSnap.forEach(docSnap => {
          const data = docSnap.data() as Sale;
          totalCash += data.totalAmount;
          data.items.forEach(item => {
            totalQty += item.quantity;
          });
        });

        setTodaySalesTotal(totalCash);
        setTodayItemsSold(totalQty);
        setTodayTransactionsCount(salesSnap.size);

        // 3. Fetch products current stock
        const prodRef = collection(db, 'businesses', tenantId, 'products');
        const prodSnap = await getDocs(prodRef);
        let stockSum = 0;
        prodSnap.forEach(docSnap => {
          const prod = docSnap.data() as Product;
          stockSum += (prod.currentStock || 0);
        });
        setAvailableStockTotal(stockSum);
      } catch (err) {
        console.warn("Using local fallback stats:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [tenantId, user.uid]);

  return (
    <div className="h-full w-full min-h-0 flex flex-col justify-between overflow-y-auto pr-0.5 space-y-2 sm:space-y-2.5">
      {/* 1. Top Bar: Greeting, Shift Status, & Direct Actions (Ultra-compact & high-density) */}
      <div className="shrink-0 bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-2 sm:p-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs sm:text-sm font-black text-slate-900">
              Welcome back, <span className="text-amber-700">{user.name}</span>!
            </span>
          </div>

          {/* Shift Opening Status Indicator */}
          {!openingStockRecord ? (
            <button
              type="button"
              onClick={() => setActiveTab('opening_stock')}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100/90 hover:bg-amber-200 text-amber-950 border border-amber-300 text-[11px] font-bold transition-all cursor-pointer animate-pulse"
              title="Click to take opening stock"
            >
              <Sunrise className="w-3.5 h-3.5 text-amber-700" />
              <span>Shift Opening Stock Pending</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Opening Stock Verified ({openingStockRecord.totalOpeningUnits} units)</span>
            </span>
          )}
        </div>

        {/* Quick Launch Direct POS & Record Expense Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsExpenseModalOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-900 text-xs font-bold border border-rose-200/90 transition-all cursor-pointer active:scale-95 shadow-xs"
          >
            <Wallet className="w-3.5 h-3.5 text-rose-600" />
            <span>+ Record Expense</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('sell')}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black tracking-wide shadow-md shadow-amber-600/30 transition-all cursor-pointer active:scale-95"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>OPEN POS (SELL)</span>
          </button>
        </div>
      </div>

      {/* 2. KPI Metrics Strip (Compact 5-Card Row) */}
      <div className="shrink-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5 sm:gap-2">
        {/* Today's Sales */}
        <div 
          onClick={() => setActiveTab('sales')}
          className="rounded-xl bg-white p-2 sm:p-2.5 shadow-2xs border border-slate-200/90 flex items-center justify-between cursor-pointer hover:border-amber-400 transition-all group"
        >
          <div className="truncate min-w-0 pr-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block truncate">Today's Sales</span>
            <p className="text-sm sm:text-base font-black text-slate-900 font-mono mt-0.5 truncate">
              {loading ? '...' : formatCurrency(todaySalesTotal, currency)}
            </p>
            <p className="text-[10px] text-slate-400 truncate">{todayTransactionsCount} transactions</p>
          </div>
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </div>
        </div>

        {/* Today's Expenses */}
        <div 
          onClick={() => setActiveTab('expenses')}
          className="rounded-xl bg-white p-2 sm:p-2.5 shadow-2xs border border-slate-200/90 flex items-center justify-between cursor-pointer hover:border-rose-400 transition-all group"
        >
          <div className="truncate min-w-0 pr-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 block truncate">Today's Expenses</span>
            <p className="text-sm sm:text-base font-black text-rose-600 font-mono mt-0.5 truncate">
              -{loading ? '...' : formatCurrency(todayExpensesTotal, currency)}
            </p>
            <p className="text-[10px] text-slate-400 group-hover:text-amber-600 transition-colors truncate">View vouchers →</p>
          </div>
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </div>
        </div>

        {/* Expected Net Drawer Cash */}
        <div className="rounded-xl bg-white p-2 sm:p-2.5 shadow-2xs border border-slate-200/90 flex items-center justify-between">
          <div className="truncate min-w-0 pr-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block truncate">Net Drawer Cash</span>
            <p className="text-sm sm:text-base font-black text-emerald-700 font-mono mt-0.5 truncate">
              {loading ? '...' : formatCurrency(Math.max(0, todayCashSalesTotal - todayDrawerExpensesTotal), currency)}
            </p>
            <p className="text-[10px] text-slate-400 truncate">Cash - Outlays</p>
          </div>
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
            <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </div>
        </div>

        {/* Items Sold */}
        <div className="rounded-xl bg-white p-2 sm:p-2.5 shadow-2xs border border-slate-200/90 flex items-center justify-between">
          <div className="truncate min-w-0 pr-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block truncate">Items Sold</span>
            <p className="text-sm sm:text-base font-black text-slate-900 font-mono mt-0.5 truncate">
              {loading ? '...' : todayItemsSold.toLocaleString()}
            </p>
            <p className="text-[10px] text-slate-400 truncate">Drinks sold</p>
          </div>
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </div>
        </div>

        {/* Current Stock */}
        <div 
          onClick={() => setActiveTab('stock')}
          className="rounded-xl bg-white p-2 sm:p-2.5 shadow-2xs border border-slate-200/90 flex items-center justify-between cursor-pointer hover:border-purple-400 transition-all group"
        >
          <div className="truncate min-w-0 pr-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block truncate">Current Stock</span>
            <p className="text-sm sm:text-base font-black text-slate-900 font-mono mt-0.5 truncate">
              {loading ? '...' : availableStockTotal.toLocaleString()}
            </p>
            <p className="text-[10px] text-slate-400 group-hover:text-purple-600 transition-colors truncate">Inventory →</p>
          </div>
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </div>
        </div>
      </div>

      {/* 3. The 7 Quick POS Action Buttons (100% VISIBLE & FITS ON SCREEN) */}
      <div className="flex-1 min-h-0 flex flex-col justify-between space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <span>⚡ Quick POS Actions</span>
            <span className="text-[10px] font-normal text-slate-400 normal-case hidden sm:inline">(Tap any action button)</span>
          </h3>
        </div>

        {/* 7 Action Cards - 7 columns on md/lg, 4 on sm, 2 on xs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-1.5 sm:gap-2">
          {/* Action 1: Waiter Orders */}
          <button
            type="button"
            onClick={() => setActiveTab('waiter_orders')}
            className="relative flex flex-col items-center justify-center p-2 sm:p-2.5 rounded-2xl bg-amber-600 text-white shadow-md shadow-amber-600/30 hover:bg-amber-700 active:scale-95 transition-all text-center cursor-pointer group border border-amber-500 min-h-[68px] sm:min-h-[76px] lg:min-h-[82px]"
          >
            {pendingOrdersCount > 0 && (
              <span className="absolute -top-1.5 -right-1 px-1.5 py-0.2 rounded-full text-[9px] font-black bg-white text-slate-950 shadow-md ring-2 ring-amber-500 animate-bounce">
                {pendingOrdersCount} NEW
              </span>
            )}
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-white/20 flex items-center justify-center mb-1 group-hover:scale-110 transition-transform shrink-0">
              <UtensilsCrossed className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
            </div>
            <span className="text-[11px] sm:text-xs font-black tracking-wide leading-tight">WAITER ORDERS</span>
            <span className="text-[9px] sm:text-[10px] text-amber-100 mt-0.5 truncate max-w-full">
              {pendingOrdersCount > 0 ? `${pendingOrdersCount} pending` : 'Settle bills'}
            </span>
          </button>

          {/* Action 2: Direct Sale (POS) */}
          <button
            type="button"
            onClick={() => setActiveTab('sell')}
            className="flex flex-col items-center justify-center p-2 sm:p-2.5 rounded-2xl bg-slate-900 text-white shadow-md hover:bg-slate-800 active:scale-95 transition-all text-center cursor-pointer group border border-slate-700 min-h-[68px] sm:min-h-[76px] lg:min-h-[82px]"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-white/10 flex items-center justify-center mb-1 group-hover:scale-110 transition-transform shrink-0">
              <ShoppingCart className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" />
            </div>
            <span className="text-[11px] sm:text-xs font-black tracking-wide leading-tight text-white">DIRECT SALE</span>
            <span className="text-[9px] sm:text-[10px] text-slate-300 mt-0.5 truncate max-w-full">Counter POS sell</span>
          </button>

          {/* Action 3: Record Expense */}
          <button
            type="button"
            onClick={() => setIsExpenseModalOpen(true)}
            className="flex flex-col items-center justify-center p-2 sm:p-2.5 rounded-2xl bg-rose-50 border-2 border-rose-300/90 text-rose-950 shadow-2xs hover:border-rose-500 hover:bg-rose-100/70 active:scale-95 transition-all text-center cursor-pointer group min-h-[68px] sm:min-h-[76px] lg:min-h-[82px]"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-rose-200/80 flex items-center justify-center mb-1 text-rose-800 group-hover:scale-110 transition-transform shrink-0">
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <span className="text-[11px] sm:text-xs font-black tracking-wide leading-tight">EXPENSE</span>
            <span className="text-[9px] sm:text-[10px] text-rose-800 mt-0.5 truncate max-w-full">Petty cash outlay</span>
          </button>

          {/* Action 4: Opening Stock */}
          <button
            type="button"
            onClick={() => setActiveTab('opening_stock')}
            className="flex flex-col items-center justify-center p-2 sm:p-2.5 rounded-2xl bg-amber-50 border-2 border-amber-300/90 text-amber-950 shadow-2xs hover:border-amber-500 hover:bg-amber-100/70 active:scale-95 transition-all text-center cursor-pointer group min-h-[68px] sm:min-h-[76px] lg:min-h-[82px]"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-amber-200/80 flex items-center justify-center mb-1 text-amber-800 group-hover:scale-110 transition-transform shrink-0">
              <Sunrise className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <span className="text-[11px] sm:text-xs font-black tracking-wide leading-tight">OPENING STOCK</span>
            <span className="text-[9px] sm:text-[10px] text-amber-800 mt-0.5 truncate max-w-full">Shift baseline</span>
          </button>

          {/* Action 5: Stock Status */}
          <button
            type="button"
            onClick={() => setActiveTab('stock')}
            className="flex flex-col items-center justify-center p-2 sm:p-2.5 rounded-2xl bg-white border border-slate-200 text-slate-900 shadow-2xs hover:border-purple-400 hover:shadow-xs active:scale-95 transition-all text-center cursor-pointer group min-h-[68px] sm:min-h-[76px] lg:min-h-[82px]"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-purple-50 flex items-center justify-center mb-1 text-purple-600 group-hover:scale-110 transition-transform shrink-0">
              <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <span className="text-[11px] sm:text-xs font-black tracking-wide leading-tight">STOCK STATUS</span>
            <span className="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 truncate max-w-full">Live inventory</span>
          </button>

          {/* Action 6: Closing Stock */}
          <button
            type="button"
            onClick={() => setActiveTab('closing')}
            className="flex flex-col items-center justify-center p-2 sm:p-2.5 rounded-2xl bg-white border border-slate-200 text-slate-900 shadow-2xs hover:border-emerald-400 hover:shadow-xs active:scale-95 transition-all text-center cursor-pointer group min-h-[68px] sm:min-h-[76px] lg:min-h-[82px]"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-emerald-50 flex items-center justify-center mb-1 text-emerald-600 group-hover:scale-110 transition-transform shrink-0">
              <CalendarCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <span className="text-[11px] sm:text-xs font-black tracking-wide leading-tight">CLOSING STOCK</span>
            <span className="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 truncate max-w-full">Shift balance</span>
          </button>

          {/* Action 7: Today's Sales */}
          <button
            type="button"
            onClick={() => setActiveTab('sales')}
            className="flex flex-col items-center justify-center p-2 sm:p-2.5 rounded-2xl bg-white border border-slate-200 text-slate-900 shadow-2xs hover:border-blue-400 hover:shadow-xs active:scale-95 transition-all text-center cursor-pointer group min-h-[68px] sm:min-h-[76px] lg:min-h-[82px]"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-blue-50 flex items-center justify-center mb-1 text-blue-600 group-hover:scale-110 transition-transform shrink-0">
              <Receipt className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <span className="text-[11px] sm:text-xs font-black tracking-wide leading-tight">TODAY'S SALES</span>
            <span className="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 truncate max-w-full">Receipts & audit</span>
          </button>
        </div>
      </div>

      {/* Record Expense Modal */}
      <RecordExpenseModal
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        user={user}
        businessConfig={businessConfig}
      />
    </div>
  );
}
