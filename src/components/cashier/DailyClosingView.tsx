import React, { useEffect, useState } from 'react';
import { UserProfile, BusinessConfig, Product, Sale, DailyClosing, ClosingItem, ExpenseRecord } from '../../types';
import { db, DEFAULT_BUSINESS_ID } from '../../lib/firebase';
import { collection, getDocs, doc, setDoc, query, where, getDoc } from 'firebase/firestore';
import { formatCurrency, logAuditAction } from '../../lib/utils';
import { 
  CalendarCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Send, 
  Printer, 
  Sparkles, 
  RotateCcw, 
  DollarSign, 
  Layers, 
  Search,
  CheckCircle,
  Wallet,
  Plus,
  ShoppingCart,
  LayoutDashboard,
  ArrowRight
} from 'lucide-react';
import { getLocalCachedProducts, queueClosingForSync } from '../../lib/offlineManager';
import { subscribeExpenses, getLocalExpenses } from '../../lib/expenseService';
import { RecordExpenseModal } from '../common/RecordExpenseModal';

interface DailyClosingViewProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
  onNavigateToDashboard?: () => void;
  onNavigateToPOS?: () => void;
}

export function DailyClosingView({ user, businessConfig, onNavigateToDashboard, onNavigateToPOS }: DailyClosingViewProps) {
  const tenantId = user.businessId || DEFAULT_BUSINESS_ID;
  const todayStr = new Date().toISOString().split('T')[0];
  const closingDocId = `${todayStr}-${user.uid}`;

  const [products, setProducts] = useState<Product[]>(() => getLocalCachedProducts(tenantId));
  const [soldMap, setSoldMap] = useState<Record<string, number>>({});
  const [actualCounts, setActualCounts] = useState<Record<string, number>>({});
  const [salesSummary, setSalesSummary] = useState({
    totalSales: 0,
    cash: 0,
    mpesa: 0,
    card: 0,
    other: 0,
    transactions: 0,
    itemsSold: 0
  });

  // Physical cash drawer reconciliation & expenses
  const [shiftExpenses, setShiftExpenses] = useState<ExpenseRecord[]>(() => {
    try {
      return getLocalExpenses(tenantId).filter(e => e.date === todayStr);
    } catch (e) {
      return [];
    }
  });
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [declaredCash, setDeclaredCash] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [notes, setNotes] = useState('');
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [existingClosing, setExistingClosing] = useState<DailyClosing | null>(null);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetchClosingData();
  }, [tenantId]);

  useEffect(() => {
    const unsub = subscribeExpenses(tenantId, (all) => {
      const todayExp = all.filter(e => e.date === todayStr);
      setShiftExpenses(todayExp);
    });
    return () => unsub();
  }, [tenantId, todayStr]);

  function calculateExpectedStock(product: Product): number {
    const opening = product.openingStock || 0;
    const added = product.stockAdded || 0;
    const sold = soldMap[product.id] || 0;
    return Math.max(0, opening + added - sold);
  }

  function populateLocalData() {
    const prods = getLocalCachedProducts(tenantId);
    setProducts(prods);

    const localSales: Sale[] = JSON.parse(
      localStorage.getItem(`bar_pos_local_sales_${tenantId}`) || 
      localStorage.getItem('bar_pos_local_sales') || 
      '[]'
    );
    const todayLocal = localSales.filter(s => s.date === todayStr);
    
    let tSales = 0;
    let cash = 0;
    let mpesa = 0;
    let card = 0;
    let other = 0;
    let itemsCount = 0;
    const sMap: Record<string, number> = {};

    todayLocal.forEach(s => {
      tSales += s.totalAmount;
      if (s.paymentMethod === 'Cash') cash += s.totalAmount;
      if (s.paymentMethod === 'M-Pesa') mpesa += s.totalAmount;
      if (s.paymentMethod === 'Card') card += s.totalAmount;
      if (s.paymentMethod === 'Other') other += s.totalAmount;
      s.items.forEach(i => {
        itemsCount += i.quantity;
        sMap[i.productId] = (sMap[i.productId] || 0) + i.quantity;
      });
    });

    setSoldMap(sMap);
    setSalesSummary({
      totalSales: tSales,
      cash,
      mpesa,
      card,
      other,
      transactions: todayLocal.length,
      itemsSold: itemsCount
    });

    // Initialize counts with expected
    const initialCounts: Record<string, number> = {};
    prods.forEach(p => {
      const opening = p.openingStock || 0;
      const added = p.stockAdded || 0;
      const sold = sMap[p.id] || 0;
      initialCounts[p.id] = Math.max(0, opening + added - sold);
    });
    setActualCounts(initialCounts);
  }

  async function fetchClosingData() {
    setLoading(true);

    // 1. Check local storage for existing closing
    try {
      const localClosings: Record<string, DailyClosing> = JSON.parse(
        localStorage.getItem(`bar_pos_local_closings_${tenantId}`) || 
        localStorage.getItem('bar_pos_local_closings') || 
        '{}'
      );
      if (localClosings[closingDocId]) {
        setAlreadySubmitted(true);
        setExistingClosing(localClosings[closingDocId]);
        if (localClosings[closingDocId].cashierDeclaredCash !== undefined) {
          setDeclaredCash(String(localClosings[closingDocId].cashierDeclaredCash));
        }
      }
    } catch (e) {
      console.warn("Local closings parse error:", e);
    }

    // 2. Immediate local data population for instant UI render (0ms delay)
    populateLocalData();

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setLoading(false);
      return;
    }

    try {
      // Check remote doc
      const closingRef = doc(db, 'businesses', tenantId, 'dailyClosings', closingDocId);
      const closingSnap = await getDoc(closingRef);
      if (closingSnap.exists()) {
        const data = closingSnap.data() as DailyClosing;
        setAlreadySubmitted(true);
        setExistingClosing(data);
        if (data.notes) setNotes(data.notes);
        if (data.cashierDeclaredCash !== undefined) setDeclaredCash(String(data.cashierDeclaredCash));
        const remoteCounts: Record<string, number> = {};
        data.items.forEach(i => {
          remoteCounts[i.productId] = i.actual;
        });
        setActualCounts(remoteCounts);
      }

      // Fetch products
      const prodRef = collection(db, 'businesses', tenantId, 'products');
      const prodSnap = await getDocs(prodRef);
      const prods: Product[] = [];
      prodSnap.forEach(d => {
        prods.push({ id: d.id, ...d.data() } as Product);
      });
      setProducts(prods);

      // Fetch today's sales
      const salesRef = collection(db, 'businesses', tenantId, 'sales');
      const salesQuery = query(salesRef, where('date', '==', todayStr));
      const salesSnap = await getDocs(salesQuery);

      let tSales = 0;
      let cash = 0;
      let mpesa = 0;
      let card = 0;
      let other = 0;
      let itemsCount = 0;
      const sMap: Record<string, number> = {};

      salesSnap.forEach(d => {
        const sale = d.data() as Sale;
        tSales += sale.totalAmount;
        if (sale.paymentMethod === 'Cash') cash += sale.totalAmount;
        if (sale.paymentMethod === 'M-Pesa') mpesa += sale.totalAmount;
        if (sale.paymentMethod === 'Card') card += sale.totalAmount;
        if (sale.paymentMethod === 'Other') other += sale.totalAmount;

        sale.items.forEach(i => {
          itemsCount += i.quantity;
          sMap[i.productId] = (sMap[i.productId] || 0) + i.quantity;
        });
      });

      setSoldMap(sMap);
      setSalesSummary({
        totalSales: tSales,
        cash,
        mpesa,
        card,
        other,
        transactions: salesSnap.size,
        itemsSold: itemsCount
      });

      if (!closingSnap.exists()) {
        const initialCounts: Record<string, number> = {};
        prods.forEach(p => {
          const opening = p.openingStock || 0;
          const added = p.stockAdded || 0;
          const sold = sMap[p.id] || 0;
          initialCounts[p.id] = Math.max(0, opening + added - sold);
        });
        setActualCounts(initialCounts);
        setDeclaredCash(String(cash));
      }
    } catch (err) {
      console.warn("Working offline: calculating daily closing from local storage:", err);
      populateLocalData();
    } finally {
      setLoading(false);
    }
  }

  const handleActualChange = (productId: string, val: string) => {
    const num = parseInt(val, 10);
    setActualCounts(prev => ({
      ...prev,
      [productId]: isNaN(num) ? 0 : Math.max(0, num)
    }));
  };

  const adjustActual = (productId: string, delta: number) => {
    setActualCounts(prev => {
      const current = prev[productId] !== undefined ? prev[productId] : 0;
      return {
        ...prev,
        [productId]: Math.max(0, current + delta)
      };
    });
  };

  const handleQuickMatchAll = () => {
    const matched: Record<string, number> = {};
    products.forEach(p => {
      matched[p.id] = calculateExpectedStock(p);
    });
    setActualCounts(matched);
  };

  const categories = Array.from(new Set(products.map(p => p.categoryName || 'Other'))).filter(Boolean);

  const filteredProducts = products.filter(p => {
    const matchesSearch = searchQuery === '' || 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      p.categoryName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = selectedCategory === 'all' || p.categoryName === selectedCategory;
    return matchesSearch && matchesCat;
  });

  // Aggregate stats
  let totalExpectedUnits = 0;
  let totalActualUnits = 0;
  let totalDiscrepanciesCount = 0;
  let totalShortageUnits = 0;
  let totalOverageUnits = 0;

  products.forEach(p => {
    const exp = calculateExpectedStock(p);
    const act = actualCounts[p.id] !== undefined ? actualCounts[p.id] : exp;
    totalExpectedUnits += exp;
    totalActualUnits += act;
    const diff = act - exp;
    if (diff !== 0) {
      totalDiscrepanciesCount++;
      if (diff < 0) totalShortageUnits += Math.abs(diff);
      else totalOverageUnits += diff;
    }
  });

  const currency = businessConfig?.currency || 'KSh';

  // Expenses calculations for cash drawer reconciliation
  const drawerCashExpenses = shiftExpenses
    .filter(e => e.paymentSource === 'Cash Drawer')
    .reduce((sum, e) => sum + e.amount, 0);
  const otherExpenses = shiftExpenses
    .filter(e => e.paymentSource !== 'Cash Drawer')
    .reduce((sum, e) => sum + e.amount, 0);
  const totalShiftExpenses = drawerCashExpenses + otherExpenses;

  // Net Expected Drawer Cash = Gross Cash Sales - Drawer Cash Outlays
  const expectedDrawerCash = Math.max(0, salesSummary.cash - drawerCashExpenses);
  const cashDeclaredNum = declaredCash ? parseFloat(declaredCash) : expectedDrawerCash;
  const cashVariance = cashDeclaredNum - expectedDrawerCash;

  const handleSubmitClosing = async () => {
    if (!window.confirm("Submit today's end-of-day shift closing? Physical stock counts, cash drawer totals, and recorded expenses will be archived for administrative review.")) {
      return;
    }

    setSubmitting(true);
    try {
      const closingItems: ClosingItem[] = products.map(p => {
        const opening = p.openingStock || 0;
        const added = p.stockAdded || 0;
        const sold = soldMap[p.id] || 0;
        const expected = Math.max(0, opening + added - sold);
        const actual = actualCounts[p.id] !== undefined ? actualCounts[p.id] : expected;
        const variance = actual - expected;

        return {
          productId: p.id,
          productName: p.name,
          categoryName: p.categoryName,
          openingStock: opening,
          stockAdded: added,
          soldQuantity: sold,
          expected,
          actual,
          variance,
          buyingPrice: p.buyingPrice,
          sellingPrice: p.sellingPrice
        };
      });

      const dailyClosing: DailyClosing = {
        id: closingDocId,
        businessDayId: todayStr,
        date: todayStr,
        cashierId: user.uid,
        cashierName: user.name,
        items: closingItems,
        totalSales: salesSummary.totalSales,
        paymentTotals: {
          Cash: salesSummary.cash,
          'M-Pesa': salesSummary.mpesa,
          Card: salesSummary.card,
          Other: salesSummary.other
        },
        totalTransactions: salesSummary.transactions,
        totalItemsSold: salesSummary.itemsSold,
        totalExpenses: totalShiftExpenses,
        drawerCashExpenses: drawerCashExpenses,
        expectedDrawerCash: expectedDrawerCash,
        expensesList: shiftExpenses.map(e => ({
          id: e.id,
          amount: e.amount,
          category: e.category,
          reason: e.reason,
          paymentSource: e.paymentSource
        })),
        cashierDeclaredCash: cashDeclaredNum,
        cashVariance: cashVariance,
        notes: notes.trim() || undefined,
        submittedAt: Date.now(),
        status: 'submitted'
      };

      // 1. Save to local closings
      try {
        const localClosings: Record<string, DailyClosing> = JSON.parse(
          localStorage.getItem(`bar_pos_local_closings_${tenantId}`) || 
          localStorage.getItem('bar_pos_local_closings') || 
          '{}'
        );
        localClosings[closingDocId] = dailyClosing;
        localStorage.setItem(`bar_pos_local_closings_${tenantId}`, JSON.stringify(localClosings));
        localStorage.setItem('bar_pos_local_closings', JSON.stringify(localClosings));
      } catch (e) {
        console.warn("Could not save to local closings:", e);
      }

      // 2. Save to Firestore if online; queue for auto-sync if offline or on network error
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const closingRef = doc(db, 'businesses', tenantId, 'dailyClosings', closingDocId);
          await setDoc(closingRef, dailyClosing);
        } catch (dbErr) {
          console.warn("Online write deferred for closing, queued for auto-sync:", dbErr);
          queueClosingForSync(dailyClosing, tenantId);
        }
      } else {
        console.log("Device offline. Queued shift closing for automatic background sync when connection restores.");
        queueClosingForSync(dailyClosing, tenantId);
      }

      // 3. Audit log
      logAuditAction(
        user.uid,
        user.name,
        'CLOSING_STOCK_TAKEN',
        `Cashier ${user.name} submitted closing stock: ${totalActualUnits} bottles counted (variance: ${totalActualUnits - totalExpectedUnits}), Total Sales: ${formatCurrency(salesSummary.totalSales, currency)}`,
        closingDocId
      ).catch(() => {});

      setExistingClosing(dailyClosing);
      setAlreadySubmitted(true);
      setSuccess(true);
      setIsEditingExisting(false);
    } catch (err: any) {
      console.error("Error submitting closing:", err);
      alert("Submission error: " + (err.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrintClosingTicket = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500 space-y-3">
        <div className="w-10 h-10 border-4 border-amber-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium">Loading end-of-shift closing checklist...</p>
      </div>
    );
  }

  // Already submitted and not in edit mode
  if (alreadySubmitted && existingClosing && !isEditingExisting) {
    const hasDiscrepancy = existingClosing.items.some(i => i.variance !== 0);

    return (
      <div className="h-full min-h-0 overflow-y-auto pr-1 space-y-4 max-w-5xl mx-auto pb-8">
        {/* Banner */}
        <div className="rounded-3xl bg-slate-900 text-white p-6 sm:p-8 shadow-xl border border-slate-800">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex items-start space-x-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-inner ${hasDiscrepancy ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'}`}>
                {hasDiscrepancy ? <AlertTriangle className="w-8 h-8" /> : <CheckCircle2 className="w-8 h-8" />}
              </div>
              <div>
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-800 text-slate-300 text-xs font-bold uppercase tracking-wider mb-2">
                  <CalendarCheck className="w-3.5 h-3.5 text-amber-400" />
                  <span>Shift Closing Report Submitted</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight">Closing Stock Reconciled</h2>
                <p className="text-slate-400 text-sm mt-1">
                  Submitted by <strong>{existingClosing.cashierName}</strong> on <strong>{existingClosing.date}</strong> at{' '}
                  {new Date(existingClosing.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={handlePrintClosingTicket}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs sm:text-sm font-bold border border-slate-700 cursor-pointer shadow-sm transition-all"
              >
                <Printer className="w-4 h-4" />
                <span>Print Closing Slip</span>
              </button>
              <button
                type="button"
                onClick={() => setIsEditingExisting(true)}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-bold border border-white/20 cursor-pointer transition-all"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Adjust / Recount</span>
              </button>
              {onNavigateToPOS && (
                <button
                  type="button"
                  onClick={onNavigateToPOS}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs sm:text-sm font-black shadow-md cursor-pointer transition-all active:scale-95"
                >
                  <ShoppingCart className="w-4 h-4" />
                  <span>RECORD SALE (POS)</span>
                </button>
              )}
              {onNavigateToDashboard && (
                <button
                  type="button"
                  onClick={onNavigateToDashboard}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs sm:text-sm font-bold cursor-pointer transition-all border border-slate-700"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>Dashboard</span>
                </button>
              )}
            </div>
          </div>

          {/* Sales & Payment Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800 text-slate-300">
            <div>
              <p className="text-xs uppercase text-slate-400 font-semibold">Total Shift Sales</p>
              <p className="text-2xl font-black text-amber-400 mt-0.5">{formatCurrency(existingClosing.totalSales, currency)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400 font-semibold">Cash Tendered</p>
              <p className="text-xl font-black text-white mt-0.5">{formatCurrency(existingClosing.paymentTotals.Cash, currency)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400 font-semibold">M-Pesa Tendered</p>
              <p className="text-xl font-black text-emerald-400 mt-0.5">{formatCurrency(existingClosing.paymentTotals['M-Pesa'], currency)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400 font-semibold">Transactions</p>
              <p className="text-xl font-black text-white mt-0.5">{existingClosing.totalTransactions} txns ({existingClosing.totalItemsSold} items)</p>
            </div>
          </div>
        </div>

        {/* Physical Variance Table */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">Submitted Stock Count & Variances</h3>
            <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full">
              {existingClosing.items.length} Products Reconciled
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <th className="p-4">Product Name</th>
                  <th className="p-4 text-center">Expected</th>
                  <th className="p-4 text-center">Physical Count</th>
                  <th className="p-4 text-center">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {existingClosing.items.map((item, idx) => (
                  <tr key={idx} className={item.variance !== 0 ? 'bg-red-50/20' : 'hover:bg-slate-50/60'}>
                    <td className="p-4 font-bold text-slate-900">{item.productName}</td>
                    <td className="p-4 text-center text-slate-600 font-medium">{item.expected}</td>
                    <td className="p-4 text-center font-extrabold text-slate-900 text-base">{item.actual}</td>
                    <td className="p-4 text-center">
                      {item.variance === 0 ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Exact Match</span>
                        </span>
                      ) : item.variance < 0 ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Shortage: {Math.abs(item.variance)}</span>
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                          Overage: +{item.variance}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cash Drawer & Shift Expenses Reconciliation Summary */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2">
              <DollarSign className="w-5 h-5 text-emerald-600" />
              <h3 className="text-base font-bold text-slate-900">Submitted Cash Drawer & Expenses Reconciliation</h3>
            </div>
            {existingClosing.totalExpenses !== undefined && existingClosing.totalExpenses > 0 && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                Shift Expenses: -{formatCurrency(existingClosing.totalExpenses, currency)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <p className="text-xs uppercase font-bold text-slate-500">Gross Cash Tendered</p>
              <p className="text-lg font-black text-slate-900 mt-1">{formatCurrency(existingClosing.paymentTotals.Cash, currency)}</p>
            </div>
            <div className="p-4 rounded-2xl bg-rose-50/70 border border-rose-200">
              <p className="text-xs uppercase font-bold text-rose-600">Drawer Cash Outlays</p>
              <p className="text-lg font-black text-rose-600 mt-1">
                -{formatCurrency(existingClosing.drawerCashExpenses ?? 0, currency)}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
              <p className="text-xs uppercase font-bold text-emerald-800">Net Expected Drawer Cash</p>
              <p className="text-lg font-black text-emerald-700 mt-1">
                {formatCurrency(existingClosing.expectedDrawerCash ?? (existingClosing.paymentTotals.Cash - (existingClosing.drawerCashExpenses || 0)), currency)}
              </p>
            </div>
            <div className={`p-4 rounded-2xl border ${(existingClosing.cashVariance || 0) === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <p className="text-xs uppercase font-bold text-slate-600">Counted / Variance</p>
              <p className="text-lg font-black text-slate-900 mt-1">
                {formatCurrency(existingClosing.cashierDeclaredCash ?? 0, currency)}
              </p>
              <p className={`text-[11px] font-bold ${(existingClosing.cashVariance || 0) === 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                Variance: {(existingClosing.cashVariance || 0) === 0 ? 'Balanced (Exact)' : `${(existingClosing.cashVariance || 0) > 0 ? '+' : ''}${formatCurrency(existingClosing.cashVariance || 0, currency)}`}
              </p>
            </div>
          </div>

          {/* List of expenses if recorded */}
          {existingClosing.expensesList && existingClosing.expensesList.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2 mt-2">
              <div className="text-xs font-bold text-slate-700">
                Itemized Shift Outlays ({existingClosing.expensesList.length}):
              </div>
              <div className="divide-y divide-slate-200 max-h-40 overflow-y-auto pr-1">
                {existingClosing.expensesList.map((exp, idx) => (
                  <div key={idx} className="py-2 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-slate-900 mr-2">{exp.category}</span>
                      <span className="text-slate-600">What for: <strong>{exp.reason}</strong></span>
                      <span className="ml-2 text-[10px] text-slate-400">({exp.paymentSource})</span>
                    </div>
                    <span className="font-bold text-rose-600">-{formatCurrency(exp.amount, currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Active Take Closing Stock Form
  return (
    <div className="h-full min-h-0 overflow-y-auto pr-1 space-y-4 max-w-5xl mx-auto pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-900 text-amber-400 text-xs font-black uppercase tracking-wider mb-2">
            <CalendarCheck className="w-3.5 h-3.5" />
            <span>End-of-Shift Reconciliation</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Take Closing Stock
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Reconcile physical bottle counts with register sales to detect shortages or breakages before closing.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleQuickMatchAll}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold border border-slate-300/80 cursor-pointer transition-all active:scale-95"
          >
            <Sparkles className="w-4 h-4 text-amber-600" />
            <span>Match Actual = Expected</span>
          </button>
        </div>
      </div>

      {/* Sales Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Today's Sales</p>
          <p className="text-2xl font-black text-amber-700 mt-1">{formatCurrency(salesSummary.totalSales, currency)}</p>
          <p className="text-xs text-slate-400 mt-1">{salesSummary.transactions} transactions recorded</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Gross Cash Sales</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{formatCurrency(salesSummary.cash, currency)}</p>
          <p className="text-xs text-slate-400 mt-1">Total cash tendered</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">M-Pesa Received</p>
          <p className="text-2xl font-black text-emerald-700 mt-1">{formatCurrency(salesSummary.mpesa, currency)}</p>
          <p className="text-xs text-slate-400 mt-1">Till & Paybill transactions</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-rose-600">Shift Expenses</p>
          <p className="text-2xl font-black text-rose-600 mt-1">-{formatCurrency(totalShiftExpenses, currency)}</p>
          <p className="text-xs text-slate-400 mt-1">
            {drawerCashExpenses > 0 ? `${formatCurrency(drawerCashExpenses, currency)} from drawer` : 'No drawer outlays'}
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Units Sold</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{salesSummary.itemsSold} <span className="text-sm font-normal text-slate-400">bottles</span></p>
          <p className="text-xs text-slate-400 mt-1">Deducted from stock</p>
        </div>
      </div>

      {/* Discrepancy Overview Banner */}
      {totalDiscrepanciesCount > 0 ? (
        <div className="rounded-2xl bg-amber-50 p-4 border border-amber-200 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-6 h-6 text-amber-700 shrink-0" />
            <div>
              <h4 className="font-bold text-amber-900 text-sm">Discrepancies Detected ({totalDiscrepanciesCount} items)</h4>
              <p className="text-xs text-amber-700">
                {totalShortageUnits > 0 && <span>Missing: <strong>{totalShortageUnits} bottles</strong>. </span>}
                {totalOverageUnits > 0 && <span>Surplus: <strong>+{totalOverageUnits} bottles</strong>.</span>}
                Please review actual physical counts or explain in the notes.
              </p>
            </div>
          </div>
          <span className="text-xs font-black uppercase tracking-wider text-amber-800 bg-amber-200/70 px-3 py-1 rounded-full">
            Review Needed
          </span>
        </div>
      ) : (
        <div className="rounded-2xl bg-emerald-50 p-4 border border-emerald-200 flex items-center space-x-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
          <div>
            <h4 className="font-bold text-emerald-900 text-sm">Balanced Inventory</h4>
            <p className="text-xs text-emerald-700">All counted bottles match system expectations perfectly.</p>
          </div>
        </div>
      )}

      {/* Physical Stock Reconciliation Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Table Search & Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">Physical Stock Count Entry</h3>
            <p className="text-xs text-slate-500">Opening + Added - Sold = Expected Closing Count</p>
          </div>

          <div className="relative sm:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-3.5 h-3.5" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search product..."
              className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="p-4">Product</th>
                <th className="p-4 text-center">Opening</th>
                <th className="p-4 text-center">Added</th>
                <th className="p-4 text-center">Sold</th>
                <th className="p-4 text-center">Expected</th>
                <th className="p-4 text-center">Actual Physical Count</th>
                <th className="p-4 text-center">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.map(product => {
                const opening = product.openingStock || 0;
                const added = product.stockAdded || 0;
                const sold = soldMap[product.id] || 0;
                const expected = Math.max(0, opening + added - sold);
                const actual = actualCounts[product.id] !== undefined ? actualCounts[product.id] : expected;
                const variance = actual - expected;

                return (
                  <tr key={product.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-slate-900">{product.name}</div>
                      <span className="text-[11px] text-slate-400">{product.categoryName}</span>
                    </td>
                    <td className="p-4 text-center text-slate-600 font-medium">{opening}</td>
                    <td className="p-4 text-center text-blue-600 font-medium">{added > 0 ? `+${added}` : '0'}</td>
                    <td className="p-4 text-center text-amber-700 font-bold">{sold > 0 ? `-${sold}` : '0'}</td>
                    <td className="p-4 text-center font-black text-slate-900 bg-slate-50/50">{expected}</td>
                    
                    {/* Actual Count with Stepper */}
                    <td className="p-4 text-center">
                      <div className="inline-flex items-center space-x-1">
                        <button
                          type="button"
                          onClick={() => adjustActual(product.id, -1)}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm cursor-pointer"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={actual}
                          onChange={(e) => handleActualChange(product.id, e.target.value)}
                          className="w-16 h-8 text-center font-extrabold text-sm rounded-lg border-2 border-slate-300 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 text-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => adjustActual(product.id, 1)}
                          className="w-7 h-7 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-sm cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </td>

                    <td className="p-4 text-center">
                      {variance === 0 ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                          Match (0)
                        </span>
                      ) : variance < 0 ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Shortage: {variance}</span>
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                          +{variance} Extra
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

      {/* Cash Drawer Reconciliation */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Physical Cash Drawer Reconciliation</h3>
              <p className="text-xs text-slate-500">Gross sales minus operational petty cash expenses deducted from register</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowExpenseModal(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 transition-all cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5 text-rose-600" />
            <span>Record Missed Expense</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <p className="text-xs uppercase font-bold text-slate-500">Gross Cash Sales</p>
            <p className="text-xl font-black text-slate-900 mt-1">{formatCurrency(salesSummary.cash, currency)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Tendered at POS</p>
          </div>

          <div className="p-4 rounded-2xl bg-rose-50/80 border border-rose-200">
            <p className="text-xs uppercase font-bold text-rose-600">Less Drawer Outlays</p>
            <p className="text-xl font-black text-rose-600 mt-1">-{formatCurrency(drawerCashExpenses, currency)}</p>
            <p className="text-[11px] text-rose-500 mt-0.5">Paid from drawer float</p>
          </div>

          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
            <p className="text-xs uppercase font-bold text-emerald-800">Net Expected in Drawer</p>
            <p className="text-xl font-black text-emerald-700 mt-1">{formatCurrency(expectedDrawerCash, currency)}</p>
            <p className="text-[11px] text-emerald-600 mt-0.5">Target physical balance</p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
            <label className="block text-xs uppercase font-bold text-slate-700">Actual Counted Cash</label>
            <input
              type="number"
              value={declaredCash}
              onChange={(e) => setDeclaredCash(e.target.value)}
              placeholder="Counted cash notes in drawer"
              className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-sm font-bold text-slate-900 focus:border-amber-600 focus:outline-none"
            />
            <p className={`text-[11px] font-bold mt-1 ${cashVariance === 0 ? 'text-emerald-600' : cashVariance < 0 ? 'text-red-600' : 'text-blue-600'}`}>
              Variance: {cashVariance === 0 ? 'Balanced (Exact)' : `${cashVariance > 0 ? '+' : ''}${formatCurrency(cashVariance, currency)}`}
            </p>
          </div>
        </div>

        {/* Itemized Shift Expenses List */}
        {shiftExpenses.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="flex items-center space-x-1.5">
                <Wallet className="w-4 h-4 text-amber-600" />
                <span>Shift Expenses Recorded on Duty ({shiftExpenses.length}):</span>
              </span>
              <span className="text-rose-600 font-black">
                Total Outlays: -{formatCurrency(totalShiftExpenses, currency)}
              </span>
            </div>

            <div className="divide-y divide-slate-200 max-h-48 overflow-y-auto pr-1">
              {shiftExpenses.map((exp) => (
                <div key={exp.id} className="py-2.5 flex items-start justify-between text-xs gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-900">{exp.category}</span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        exp.paymentSource === 'Cash Drawer'
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                          : 'bg-blue-100 text-blue-900'
                      }`}>
                        {exp.paymentSource}
                      </span>
                      <span className="font-mono text-slate-400 text-[11px]">
                        {exp.voucherNumber || exp.id.slice(-6)}
                      </span>
                    </div>
                    <div className="text-slate-600 font-medium">
                      What for: <strong className="text-slate-800 font-semibold">{exp.reason}</strong>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-black text-rose-600 text-sm">
                      -{formatCurrency(exp.amount, currency)}
                    </span>
                    <div className="text-[10px] text-slate-400 font-mono">{exp.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Shift Closing Remarks */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-2">
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
          Shift Closing Remarks / Breakages & Spillages
        </label>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Explain any bottle shortages, accidental breakages, customer complaints, or handover remarks..."
          className="w-full rounded-2xl border border-slate-300 p-3.5 text-sm focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-slate-800 placeholder-slate-400"
        />
      </div>

      {/* Sticky Submit Footer - ALWAYS 100% VISIBLE */}
      <div className="sticky bottom-0 z-30 bg-slate-900/95 backdrop-blur-md rounded-2xl p-3 sm:p-3.5 text-white shadow-2xl border border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div>
          <p className="text-[10px] text-slate-400 uppercase font-semibold">End-of-Day Shift Submission</p>
          <p className="text-sm sm:text-base font-bold text-white">
            Counted <span className="text-amber-400 font-mono font-black">{totalActualUnits}</span> / {totalExpectedUnits} expected bottles
            {totalDiscrepanciesCount > 0 && (
              <span className="text-red-400 text-xs font-normal ml-2">({totalDiscrepanciesCount} items with variance)</span>
            )}
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
            onClick={handleSubmitClosing}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center space-x-2 px-6 py-2.5 sm:py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm tracking-wide shadow-lg cursor-pointer transition-all active:scale-95 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                <span>SUBMITTING CLOSING...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>SUBMIT DAILY CLOSING</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Record Expense Modal */}
      <RecordExpenseModal
        isOpen={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        user={user}
        businessConfig={businessConfig}
        onExpenseRecorded={() => fetchClosingData()}
      />
    </div>
  );
}
