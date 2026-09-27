import React, { useState, useEffect } from 'react';
import { UserProfile, BusinessConfig, Product, SaleItem, Sale, PaymentMethod, RestaurantOrder } from '../../types';
import { DEFAULT_BUSINESS_ID } from '../../lib/firebase';
import { formatCurrency, logAuditAction } from '../../lib/utils';
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Banknote,
  Smartphone,
  CircleDollarSign,
  ArrowRight,
  UtensilsCrossed,
  X,
  Wallet
} from 'lucide-react';
import { ReceiptModal } from '../common/ReceiptModal';
import { RecordExpenseModal } from '../common/RecordExpenseModal';
import {
  saveSaleLocallyAndQueue,
  getLocalCachedProducts,
  getLocalCachedCategories,
  syncOfflineQueue
} from '../../lib/offlineManager';
import { loadProductsFast, loadCategoriesFast } from '../../lib/productService';
import { subscribeOrders } from '../../lib/orderService';

interface RecordSaleViewProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
  onNavigateToWaiterOrders?: () => void;
}

export function RecordSaleView({ user, businessConfig, onNavigateToWaiterOrders }: RecordSaleViewProps) {
  const tenantId = user.businessId || DEFAULT_BUSINESS_ID;
  const currency = businessConfig?.currency || 'KSh';

  const [products, setProducts] = useState<Product[]>(() => getLocalCachedProducts(tenantId));
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(() => getLocalCachedCategories());
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [pendingOrders, setPendingOrders] = useState<RestaurantOrder[]>([]);

  // Payment states
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [amountTendered, setAmountTendered] = useState<string>('');
  const [isCustomTendered, setIsCustomTendered] = useState<boolean>(false);
  const [referenceCode, setReferenceCode] = useState<string>('');
  const [mobileView, setMobileView] = useState<'catalog' | 'payment'>('catalog');

  // Custom item & Expense modal state
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [customQty, setCustomQty] = useState(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successSale, setSuccessSale] = useState<Sale | null>(null);

  useEffect(() => {
    fetchProductsAndCategories();
  }, [tenantId]);

  useEffect(() => {
    const unsub = subscribeOrders(tenantId, (orders) => {
      const pending = orders.filter(o => o.orderStatus !== 'completed' && o.orderStatus !== 'cancelled');
      setPendingOrders(pending);
    });
    return () => unsub();
  }, [tenantId]);

  async function fetchProductsAndCategories() {
    // 1. Instant load from offline cache scoped to tenant
    const cachedProds = getLocalCachedProducts(tenantId);
    if (cachedProds.length > 0) {
      setProducts(cachedProds);
    }
    const cachedCats = getLocalCachedCategories();
    if (cachedCats.length > 0) {
      setCategories(cachedCats);
    }

    // 2. Background non-blocking fresh update
    loadProductsFast(tenantId, (remoteProds) => {
      setProducts(remoteProds);
    }).then(prods => {
      if (prods && prods.length > 0) {
        setProducts(prods);
      }
    }).catch(() => {});

    loadCategoriesFast(tenantId, (remoteCats) => {
      setCategories(remoteCats);
    }).then(cats => {
      if (cats && cats.length > 0) {
        setCategories(cats);
      }
    }).catch(() => {});
  }

  const addToCart = (product: Product, delta: number = 1): boolean => {
    setError('');
    const existingIndex = cart.findIndex(item => item.productId === product.id);
    const currentQtyInCart = existingIndex >= 0 ? cart[existingIndex].quantity : 0;
    const requestedQty = currentQtyInCart + delta;

    // Check available stock (Default to true so sales are never blocked by stock levels)
    const allowNegative = businessConfig?.allowNegativeStock ?? true;
    if (delta > 0 && !allowNegative) {
      if (product.currentStock !== undefined && requestedQty > product.currentStock) {
        const msg = `Insufficient Stock: Only ${product.currentStock} ${product.unitType || 'unit'}(s) available for "${product.name}".`;
        setError(msg);
        return false;
      }
    }

    if (requestedQty <= 0) {
      if (existingIndex >= 0) {
        const newCart = [...cart];
        newCart.splice(existingIndex, 1);
        setCart(newCart);
      }
      return true;
    }

    if (existingIndex >= 0) {
      const newCart = [...cart];
      newCart[existingIndex].quantity = requestedQty;
      newCart[existingIndex].totalAmount = requestedQty * product.sellingPrice;
      setCart(newCart);
    } else {
      setCart([
        ...cart,
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: product.sellingPrice,
          totalAmount: product.sellingPrice
        }
      ]);
    }
    return true;
  };

  const updateCartQty = (productId: string, newQty: number) => {
    setError('');
    if (newQty <= 0) {
      setCart(cart.filter(item => item.productId !== productId));
      return;
    }

    setCart(cart.map(item => {
      if (item.productId === productId) {
        return {
          ...item,
          quantity: newQty,
          totalAmount: newQty * item.unitPrice
        };
      }
      return item;
    }));
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.productId !== productId));
  };

  const handleAddCustomItem = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(customPrice);
    if (!customName.trim() || isNaN(price) || price <= 0) {
      setError('Please provide a valid item name and price.');
      return;
    }

    const qty = customQty > 0 ? customQty : 1;
    const customItem: SaleItem = {
      productId: 'custom-' + Date.now(),
      productName: customName.trim(),
      quantity: qty,
      unitPrice: price,
      totalAmount: qty * price
    };

    setCart([...cart, customItem]);
    setShowCustomModal(false);
    setCustomName('');
    setCustomPrice('');
    setCustomQty(1);
    setError('');
  };

  const totalCartAmount = cart.reduce((sum, item) => sum + item.totalAmount, 0);

  // Keep amountTendered synchronized with totalCartAmount for Cash
  useEffect(() => {
    if (paymentMethod === 'Cash') {
      const currentTendered = parseFloat(amountTendered) || 0;
      if (!isCustomTendered || currentTendered < totalCartAmount || !amountTendered || amountTendered === '0') {
        if (totalCartAmount > 0) {
          setAmountTendered(totalCartAmount.toString());
        } else {
          setAmountTendered('');
        }
        setIsCustomTendered(false);
      }
    } else {
      setAmountTendered(totalCartAmount > 0 ? totalCartAmount.toString() : '');
      setIsCustomTendered(false);
    }
  }, [totalCartAmount, paymentMethod]);

  const handleRecordSale = () => {
    if (cart.length === 0) {
      setError('Cart is empty. Please select products to record sale.');
      return;
    }

    // Cash validation: prevent underpayment
    if (paymentMethod === 'Cash') {
      const tenderedNum = amountTendered ? parseFloat(amountTendered) : totalCartAmount;
      if (isNaN(tenderedNum) || tenderedNum < totalCartAmount) {
        setError(`Cannot record sale: Amount received (${formatCurrency(isNaN(tenderedNum) ? 0 : tenderedNum, currency)}) is less than total bill (${formatCurrency(totalCartAmount, currency)}).`);
        return;
      }
    }

    setLoading(true);
    setError('');

    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const now = new Date();
      const saleId = 'sale-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      const parsedTendered = paymentMethod === 'Cash' && amountTendered ? parseFloat(amountTendered) : totalCartAmount;
      const changeDue = Math.max(0, parsedTendered - totalCartAmount);

      const completedSale: Sale = {
        id: saleId,
        businessId: tenantId,
        items: [...cart],
        totalAmount: totalCartAmount,
        paymentMethod,
        amountTendered: parsedTendered,
        change: changeDue,
        referenceCode: referenceCode.trim() || undefined,
        tillNumber: businessConfig?.tillNumber || '5849201',
        cashierId: user.uid,
        cashierName: user.name,
        businessDayId: todayStr,
        date: todayStr,
        time: now.toTimeString().split(' ')[0],
        createdAt: now.getTime()
      };

      // 1. Instantly persist locally & queue for sync (100% offline-first)
      saveSaleLocallyAndQueue(completedSale, tenantId);

      // 2. Immediately update in-memory products state with deducted stock
      const updatedLocalProds = getLocalCachedProducts(tenantId);
      if (updatedLocalProds.length > 0) {
        setProducts(updatedLocalProds);
      }

      // 3. Immediately display receipt modal & reset cart - zero delay!
      setSuccessSale(completedSale);
      setCart([]);
      setAmountTendered('');
      setIsCustomTendered(false);
      setReferenceCode('');
      setMobileView('catalog');

      // 4. Background non-blocking audit log & Firestore sync if online
      logAuditAction(
        user.uid,
        user.name,
        'SALE_RECORDED',
        `Recorded sale of ${formatCurrency(totalCartAmount, currency)} via ${paymentMethod} (${cart.length} items)`,
        saleId
      ).catch(() => {});

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        syncOfflineQueue(tenantId).catch((syncErr) => {
          console.warn('Background sync deferred:', syncErr);
        });
      }
    } catch (err: any) {
      console.error("Sale recording failed:", err);
      setError(err.message || 'Failed to complete transaction.');
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(p => {
    const matchesCat = selectedCategory === 'all' || p.categoryId === selectedCategory;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q ||
      p.name.toLowerCase().includes(q) ||
      p.categoryName.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  const cartItemCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const parsedTendered = amountTendered ? (parseFloat(amountTendered) || 0) : totalCartAmount;
  const changeDue = Math.max(0, parsedTendered - totalCartAmount);
  const isUnderpaid = paymentMethod === 'Cash' && totalCartAmount > 0 && parsedTendered < totalCartAmount;
  const shortfall = Math.max(0, totalCartAmount - parsedTendered);

  // Dynamic smart cash note presets based on total bill
  const getSmartCashPresets = () => {
    if (totalCartAmount <= 0) return [500, 1000, 2000];
    const presets: number[] = [];
    const denominations = [500, 1000, 1500, 2000, 3000, 4000, 5000];
    for (const d of denominations) {
      if (d > totalCartAmount && !presets.includes(d)) {
        presets.push(d);
        if (presets.length >= 3) break;
      }
    }
    if (presets.length === 0) {
      const nextRound = Math.ceil((totalCartAmount + 1) / 1000) * 1000;
      presets.push(nextRound);
    }
    return presets;
  };

  return (
    <div className="h-full w-full min-h-0 min-w-0 flex flex-col overflow-hidden">
      {/* Pending Waiter Orders Notification Banner (Compact) */}
      {pendingOrders.length > 0 && onNavigateToWaiterOrders && (
        <div 
          onClick={onNavigateToWaiterOrders}
          className="shrink-0 mb-1.5 px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 flex items-center justify-between text-xs font-bold shadow-xs cursor-pointer transition-all border border-amber-500 active:scale-99"
        >
          <div className="flex items-center space-x-2 truncate">
            <UtensilsCrossed className="w-3.5 h-3.5 text-slate-950 shrink-0 animate-pulse" />
            <span className="truncate">
              {pendingOrders.length} Waiter Order{pendingOrders.length > 1 ? 's' : ''} Pending Cashier Payment (Latest: {pendingOrders[0].tableName} · {formatCurrency(pendingOrders[0].totalAmount, currency)})
            </span>
          </div>
          <div className="flex items-center space-x-1 shrink-0 bg-slate-950 text-white text-[10px] px-2 py-0.5 rounded-md">
            <span>Cash Out</span>
            <ArrowRight className="w-3 h-3 text-amber-400" />
          </div>
        </div>
      )}

      {/* Mobile Top Segment Switcher (< md) */}
      <div className="md:hidden shrink-0 flex items-center bg-slate-200/90 p-1 rounded-xl mb-1.5 gap-1">
        <button
          type="button"
          onClick={() => setMobileView('catalog')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            mobileView === 'catalog'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>📋 Catalog ({filteredProducts.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileView('payment')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            mobileView === 'payment'
              ? 'bg-amber-500 text-slate-950 shadow-xs ring-1 ring-amber-400'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>
            Cart & Pay ({cartItemCount}) {totalCartAmount > 0 ? `· ${formatCurrency(totalCartAmount, currency)}` : ''}
          </span>
        </button>
      </div>

      {/* Main Two-Column Viewport: Left = Catalog, Right = Cart & Payment */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col md:flex-row gap-2.5 overflow-hidden">
        {/* ======================================================== */}
        {/* LEFT COLUMN: Search, Categories, Quick Actions & Grid */}
        {/* ======================================================== */}
        <div
          className={`flex-1 min-w-0 min-h-0 flex flex-col h-full bg-white rounded-2xl border border-slate-200 shadow-2xs p-2 sm:p-2.5 overflow-hidden ${
            mobileView === 'payment' ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* Top Bar: Search, Quick Custom/Expense buttons & Categories */}
          <div className="shrink-0 mb-2 space-y-1.5">
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Search Input */}
              <div className="relative flex-1 min-w-[130px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search drinks / items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-6 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:border-amber-600 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Quick Action Buttons */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(true)}
                  className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 transition-all flex items-center gap-1 cursor-pointer shrink-0 shadow-2xs"
                  title="Add custom item"
                >
                  <Plus className="w-3 h-3" />
                  <span>Custom</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(true)}
                  className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-300 transition-all flex items-center gap-1 cursor-pointer shrink-0 shadow-2xs"
                  title="Record on-duty petty cash expense"
                >
                  <Wallet className="w-3 h-3 text-rose-600" />
                  <span>Expense</span>
                </button>
              </div>
            </div>

            {/* Category Pills Strip */}
            <div className="flex items-center gap-1 overflow-x-auto py-0.5 scrollbar-none">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-all shrink-0 ${
                  selectedCategory === 'all'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-all shrink-0 ${
                    selectedCategory === cat.id
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="shrink-0 mb-2 p-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          {/* Product Catalog Grid (Scrollable inside viewport) */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
              {filteredProducts.map(product => {
                const inCart = cart.find(i => i.productId === product.id);
                const isOutOfStock = product.currentStock <= 0;

                return (
                  <div
                    key={product.id}
                    onClick={() => addToCart(product, 1)}
                    className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between cursor-pointer active:scale-97 select-none relative group ${
                      inCart
                        ? 'border-amber-500 bg-amber-50/50 shadow-xs ring-1 ring-amber-400'
                        : isOutOfStock
                        ? 'border-amber-200 bg-amber-50/15'
                        : 'border-slate-200/90 bg-white hover:border-amber-400 hover:shadow-2xs'
                    }`}
                  >
                    {/* Top Row: Category & In-Cart Badge */}
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider truncate">
                        {product.categoryName || 'Item'}
                      </span>
                      {inCart && (
                        <span className="shrink-0 px-1.5 py-0.2 rounded-full bg-amber-600 text-white text-[10px] font-black shadow-xs">
                          {inCart.quantity}x
                        </span>
                      )}
                    </div>

                    {/* Middle: Product Name */}
                    <h4 className="text-xs sm:text-sm font-bold text-slate-900 leading-snug line-clamp-2 mb-1.5">
                      {product.name}
                    </h4>

                    {/* Available Stock Tag */}
                    <div className="text-[10px] mb-1">
                      <span className={`${isOutOfStock ? 'text-amber-800' : 'text-slate-500 font-medium'}`}>
                        {product.currentStock} {product.unitType || 'unit'}s in stock
                      </span>
                    </div>

                    {/* Bottom Row: Price & Stepper */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                      <span className="text-xs sm:text-sm font-black text-amber-700">
                        {formatCurrency(product.sellingPrice, currency)}
                      </span>

                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {inCart && (
                          <button
                            type="button"
                            onClick={() => addToCart(product, -1)}
                            className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-700 cursor-pointer active:scale-90"
                          >
                            <Minus className="w-2.5 h-2.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => addToCart(product, 1)}
                          className="w-6 h-6 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 flex items-center justify-center font-bold hover:bg-amber-600 hover:text-white transition-colors cursor-pointer"
                          title="Add to cart"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredProducts.length === 0 && (
                <div className="col-span-full text-center py-12 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <ShoppingCart className="w-8 h-8 text-slate-300 mx-auto mb-1.5" />
                  <p className="text-xs text-slate-500 font-medium">No catalog items match your search</p>
                </div>
              )}
            </div>
          </div>

          {/* Mobile Bottom Bar for Catalog Tab (< md screen only) */}
          {mobileView === 'catalog' && cartItemCount > 0 && (
            <div className="md:hidden shrink-0 mt-1.5 p-2 rounded-xl bg-slate-900 text-white flex items-center justify-between shadow-lg">
              <div>
                <p className="text-[10px] text-amber-400 font-bold uppercase">
                  {cartItemCount} item{cartItemCount === 1 ? '' : 's'} in cart
                </p>
                <p className="text-sm font-black text-amber-400">
                  {formatCurrency(totalCartAmount, currency)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMobileView('payment')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer uppercase"
              >
                <span>Checkout & Pay</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* ======================================================== */}
        {/* RIGHT COLUMN: Cart & Payment (ALWAYS VISIBLE & FIT TO SCREEN) */}
        {/* ======================================================== */}
        <div
          className={`w-full md:w-88 lg:w-96 xl:w-[410px] shrink-0 flex flex-col h-full bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden ${
            mobileView === 'catalog' ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* Header (Pinned Top) */}
          <div className="shrink-0 p-2.5 sm:p-3 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-amber-400" />
              <h3 className="font-black text-xs sm:text-sm uppercase tracking-wide text-amber-300">
                Current Bill
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-amber-400 text-xs font-bold font-mono">
                {cartItemCount} items
              </span>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Clear all items from current cart?')) {
                      setCart([]);
                      setError('');
                    }
                  }}
                  className="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Clear Cart"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Cart Items List (Scrollable Middle Section) */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 divide-y divide-slate-100">
            {cart.map((item) => (
              <div key={item.productId} className="pt-1.5 first:pt-0 flex items-center justify-between gap-1 text-xs">
                <div className="flex-1 truncate pr-1">
                  <span className="font-bold text-slate-900 truncate block">
                    {item.productName}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {formatCurrency(item.unitPrice, currency)} each
                  </span>
                </div>

                <div className="flex items-center space-x-1 shrink-0">
                  <div className="flex items-center border border-slate-200 rounded-md bg-white">
                    <button
                      type="button"
                      onClick={() => updateCartQty(item.productId, item.quantity - 1)}
                      className="w-5 h-5 flex items-center justify-center text-slate-600 hover:text-red-600 active:scale-90"
                    >
                      <Minus className="w-2.5 h-2.5" />
                    </button>
                    <span className="w-6 text-center font-bold text-xs text-slate-900">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateCartQty(item.productId, item.quantity + 1)}
                      className="w-5 h-5 flex items-center justify-center text-slate-600 hover:text-emerald-600 active:scale-90"
                    >
                      <Plus className="w-2.5 h-2.5" />
                    </button>
                  </div>

                  <span className="font-black text-xs text-slate-900 w-16 text-right font-mono">
                    {formatCurrency(item.totalAmount, currency)}
                  </span>

                  <button
                    type="button"
                    onClick={() => removeFromCart(item.productId)}
                    className="p-1 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}

            {cart.length === 0 && (
              <div className="text-center py-6 px-4 text-slate-400">
                <ShoppingCart className="w-7 h-7 mx-auto mb-1 opacity-30 text-amber-600" />
                <p className="text-xs font-semibold text-slate-600">Cart is empty</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Tap drinks on the left to add to bill
                </p>
              </div>
            )}
          </div>

          {/* ======================================================== */}
          {/* BOTTOM CHECKOUT BOX: ALWAYS PINNED & 100% VISIBLE */}
          {/* ======================================================== */}
          <div className="shrink-0 p-2.5 sm:p-3 bg-slate-900 text-white rounded-b-2xl border-t-2 border-amber-400 space-y-2">
            {/* Total Bill Row */}
            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                  Total to Collect:
                </span>
                <span className="text-xl sm:text-2xl font-black text-amber-400 font-mono">
                  {formatCurrency(totalCartAmount, currency)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-300 font-semibold">{cartItemCount} item{cartItemCount === 1 ? '' : 's'}</span>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className="grid grid-cols-4 gap-1">
              {[
                { id: 'Cash', label: 'Cash', icon: Banknote },
                { id: 'M-Pesa', label: 'M-Pesa', icon: Smartphone },
                { id: 'Card', label: 'Card', icon: CreditCard },
                { id: 'Other', label: 'Other', icon: CircleDollarSign }
              ].map(m => {
                const Icon = m.icon;
                const isSelected = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(m.id as PaymentMethod);
                      if (m.id === 'Cash') {
                        setAmountTendered(totalCartAmount > 0 ? totalCartAmount.toString() : '');
                        setIsCustomTendered(false);
                      }
                    }}
                    className={`flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500 border-amber-400 text-slate-950 shadow-xs ring-1 ring-amber-300'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Tender Amount / Status (Cash mode) */}
            {paymentMethod === 'Cash' && (
              <div className="space-y-1.5 pt-0.5">
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <span className="absolute inset-y-0 left-0 pl-2 flex items-center font-bold text-amber-400 text-xs">
                      {currency}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={amountTendered}
                      onChange={(e) => {
                        setAmountTendered(e.target.value);
                        setIsCustomTendered(true);
                        setError('');
                      }}
                      placeholder={totalCartAmount > 0 ? totalCartAmount.toString() : '0.00'}
                      className="w-full pl-9 pr-2 py-1 rounded-lg border border-amber-500 bg-slate-800 text-sm font-black text-white focus:outline-none focus:ring-1 focus:ring-amber-400 font-mono"
                    />
                  </div>

                  {/* Quick Preset Buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setAmountTendered(totalCartAmount.toString());
                        setIsCustomTendered(false);
                        setError('');
                      }}
                      className="px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold cursor-pointer"
                    >
                      Exact
                    </button>
                    {getSmartCashPresets().slice(0, 2).map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setAmountTendered(val.toString());
                          setIsCustomTendered(true);
                          setError('');
                        }}
                        className="px-1.5 py-1 rounded-lg bg-slate-800 text-white border border-slate-700 text-[10px] font-bold cursor-pointer font-mono"
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Change Due / Underpayment indicator */}
                {isUnderpaid ? (
                  <div className="text-[11px] font-bold text-red-400 bg-red-950/80 px-2 py-0.5 rounded border border-red-500/60">
                    Short by {formatCurrency(shortfall, currency)}
                  </div>
                ) : changeDue > 0 ? (
                  <div className="flex items-center justify-between text-[11px] font-bold text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/60">
                    <span>Change Due to Customer:</span>
                    <span className="font-mono text-xs text-emerald-400">{formatCurrency(changeDue, currency)}</span>
                  </div>
                ) : totalCartAmount > 0 ? (
                  <div className="text-[10px] text-emerald-400 font-semibold text-right">
                    ✓ Exact Tendered (No Change Needed)
                  </div>
                ) : null}
              </div>
            )}

            {/* M-Pesa Input */}
            {paymentMethod === 'M-Pesa' && (
              <div className="flex items-center gap-1.5 pt-0.5">
                <input
                  type="text"
                  value={referenceCode}
                  onChange={(e) => setReferenceCode(e.target.value)}
                  placeholder="M-Pesa Code / Phone"
                  className="flex-1 px-2.5 py-1 rounded-lg border border-emerald-500/80 bg-slate-800 text-xs font-bold text-white focus:outline-none uppercase placeholder:normal-case font-mono"
                />
                <button
                  type="button"
                  onClick={() => setReferenceCode('CONFIRMED')}
                  className="px-2 py-1 bg-emerald-900 text-emerald-300 border border-emerald-600/40 rounded text-[10px] font-bold cursor-pointer shrink-0"
                >
                  + Confirmed
                </button>
              </div>
            )}

            {/* Card / Other Input */}
            {(paymentMethod === 'Card' || paymentMethod === 'Other') && (
              <div className="pt-0.5">
                <input
                  type="text"
                  value={referenceCode}
                  onChange={(e) => setReferenceCode(e.target.value)}
                  placeholder="Slip Approval # / Ref (opt)"
                  className="w-full px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-white focus:outline-none uppercase font-mono"
                />
              </div>
            )}

            {/* Error Message Banner */}
            {error && (
              <div className="p-1.5 rounded-lg bg-red-950 text-red-300 border border-red-500 text-[11px] font-semibold flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400" />
                <span className="truncate">{error}</span>
              </div>
            )}

            {/* THE CRITICAL COMPLETE PAYMENT BUTTON: ALWAYS 100% VISIBLE */}
            <button
              type="button"
              onClick={handleRecordSale}
              disabled={loading || cart.length === 0 || isUnderpaid}
              className={`w-full py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm font-black shadow-md uppercase tracking-wide flex items-center justify-center gap-1.5 transition-all active:scale-98 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isUnderpaid
                  ? 'bg-red-950 text-red-300 border border-red-500'
                  : paymentMethod === 'M-Pesa'
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
              }`}
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Recording Sale...</span>
                </>
              ) : isUnderpaid ? (
                <span>SHORT BY {formatCurrency(shortfall, currency)}</span>
              ) : cart.length === 0 ? (
                <span>SELECT PRODUCTS TO SELL</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-slate-950" />
                  <span>
                    {paymentMethod === 'M-Pesa'
                      ? `COMPLETE M-PESA SALE (${formatCurrency(totalCartAmount, currency)})`
                      : changeDue > 0
                      ? `RECORD SALE (${formatCurrency(totalCartAmount, currency)} · CHANGE: ${formatCurrency(changeDue, currency)})`
                      : `RECORD FULL PAYMENT (${formatCurrency(totalCartAmount, currency)})`}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Custom Item Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 sm:p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h4 className="text-sm font-bold text-slate-900">Add Custom Drink / Item</h4>
              <button
                type="button"
                onClick={() => setShowCustomModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddCustomItem} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Item Description</label>
                <input
                  type="text"
                  required
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g. Special Cocktail, Shot, Snack"
                  className="w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-amber-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Price ({currency})</label>
                  <input
                    type="number"
                    step="any"
                    min="1"
                    required
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    placeholder="250"
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-amber-600 focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={customQty}
                    onChange={(e) => setCustomQty(parseInt(e.target.value) || 1)}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-amber-600 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex space-x-2">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-amber-600 hover:bg-amber-700 py-2.5 text-xs font-bold text-white shadow-sm transition-all uppercase cursor-pointer"
                >
                  Add to Cart
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="flex-1 rounded-xl border border-slate-300 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-all cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Success Receipt Modal */}
      {successSale && (
        <ReceiptModal
          sale={successSale}
          businessConfig={businessConfig}
          onClose={() => setSuccessSale(null)}
        />
      )}

      {/* Record Expense Modal */}
      <RecordExpenseModal
        isOpen={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        user={user}
        businessConfig={businessConfig}
      />
    </div>
  );
}
