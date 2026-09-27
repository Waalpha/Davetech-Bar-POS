import React, { useState, useEffect, useMemo } from 'react';
import {
  UserProfile,
  BusinessConfig,
  RestaurantTable,
  Product,
  Category,
  OrderItem,
  RestaurantOrder
} from '../../types';
import { DEFAULT_BUSINESS_ID, db } from '../../lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import {
  subscribeTables,
  submitWaiterOrder
} from '../../lib/orderService';
import {
  getLocalCachedProducts,
  cacheLocalProducts,
  getLocalCachedCategories,
  cacheLocalCategories
} from '../../lib/offlineManager';
import { formatCurrency } from '../../lib/utils';
import {
  UtensilsCrossed,
  Search,
  Plus,
  Minus,
  Trash2,
  Send,
  Printer,
  FileText,
  User,
  CheckCircle2,
  AlertCircle,
  Wine,
  MessageSquare,
  X,
  ChevronRight,
  ShoppingCart
} from 'lucide-react';
import { KotModal } from '../common/KotModal';

interface WaiterOrderScreenProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
  initialTable?: RestaurantTable | null;
  onOrderSubmitted?: (order: RestaurantOrder) => void;
}

export function WaiterOrderScreen({
  user,
  businessConfig,
  initialTable,
  onOrderSubmitted
}: WaiterOrderScreenProps) {
  const tenantId = user.businessId || DEFAULT_BUSINESS_ID;
  const currency = businessConfig?.currency || 'KSh';

  // Data States
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [products, setProducts] = useState<Product[]>(() =>
    getLocalCachedProducts(tenantId).filter(p => p.status === 'active')
  );
  const [categories, setCategories] = useState<Category[]>(() => {
    const cached = getLocalCachedCategories();
    return (cached.length > 0 ? cached : []) as Category[];
  });

  // Selection States
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(initialTable || null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [orderNotes, setOrderNotes] = useState('');

  // Mobile View Switcher: 'menu' or 'cart'
  const [mobileTab, setMobileTab] = useState<'menu' | 'cart'>('menu');

  // Cart / Items
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [activeItemNoteModal, setActiveItemNoteModal] = useState<{ index: number; note: string } | null>(null);

  // Status & Modals
  const [submitting, setSubmitting] = useState(false);
  const [submittedOrder, setSubmittedOrder] = useState<RestaurantOrder | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Keep selectedTable in sync with initialTable if changed externally
  useEffect(() => {
    if (initialTable) {
      setSelectedTable(initialTable);
    }
  }, [initialTable]);

  // Load products, categories, tables
  useEffect(() => {
    // 1. Initial fast load from offline cache
    const loadedProducts = getLocalCachedProducts(tenantId).filter(p => p.status === 'active');
    setProducts(loadedProducts);
    setCategories(getLocalCachedCategories() as Category[]);

    // 2. Fetch fresh catalog from Firestore if online
    if (typeof navigator === 'undefined' || navigator.onLine) {
      const prodRef = collection(db, 'businesses', tenantId, 'products');
      getDocs(prodRef)
        .then(snap => {
          const prods: Product[] = [];
          snap.forEach(d => {
            prods.push({ id: d.id, ...d.data() } as Product);
          });
          if (prods.length > 0) {
            const activeProds = prods.filter(p => p.status === 'active');
            setProducts(activeProds);
            cacheLocalProducts(prods, tenantId);
          }
        })
        .catch(err => console.warn('Using local products:', err));

      const catRef = collection(db, 'businesses', tenantId, 'categories');
      getDocs(catRef)
        .then(snap => {
          const cats: { id: string; name: string }[] = [];
          snap.forEach(d => {
            cats.push({ id: d.id, name: d.data().name });
          });
          if (cats.length > 0) {
            setCategories(cats as Category[]);
            cacheLocalCategories(cats);
          }
        })
        .catch(err => console.warn('Using local categories:', err));
    }

    // 3. Realtime table subscription
    const unsubTables = subscribeTables(tenantId, (loaded) => {
      setTables(loaded);
      // Auto-select table if none selected yet
      setSelectedTable(prev => {
        if (prev) {
          return loaded.find(t => t.id === prev.id) || prev;
        }
        if (initialTable) {
          return loaded.find(t => t.id === initialTable.id) || initialTable;
        }
        // Default to first available table or first table
        return loaded.find(t => t.status === 'available') || loaded[0] || null;
      });
    });

    return () => unsubTables();
  }, [tenantId, initialTable]);

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory = selectedCategoryId === 'all' || p.categoryId === selectedCategoryId;
      const matchesSearch =
        searchQuery.trim() === '' ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.barcode && p.barcode.includes(searchQuery.trim()));
      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategoryId, searchQuery]);

  // Cart calculations
  const totalAmount = useMemo(() => {
    return orderItems.reduce((acc, item) => acc + item.totalAmount, 0);
  }, [orderItems]);

  const totalItemCount = useMemo(() => {
    return orderItems.reduce((acc, item) => acc + item.quantity, 0);
  }, [orderItems]);

  // Cart Actions
  const handleAddToCart = (product: Product) => {
    setErrorMessage('');
    setOrderItems((prev) => {
      const existingIdx = prev.findIndex(item => item.productId === product.id);
      if (existingIdx >= 0) {
        const next = [...prev];
        const updatedQty = next[existingIdx].quantity + 1;
        next[existingIdx] = {
          ...next[existingIdx],
          quantity: updatedQty,
          totalAmount: updatedQty * next[existingIdx].unitPrice
        };
        return next;
      } else {
        return [
          ...prev,
          {
            productId: product.id,
            productName: product.name,
            quantity: 1,
            unitPrice: product.sellingPrice,
            totalAmount: product.sellingPrice
          }
        ];
      }
    });
  };

  const handleUpdateQuantity = (index: number, delta: number) => {
    setOrderItems((prev) => {
      const next = [...prev];
      const newQty = next[index].quantity + delta;
      if (newQty <= 0) {
        return next.filter((_, i) => i !== index);
      }
      next[index] = {
        ...next[index],
        quantity: newQty,
        totalAmount: newQty * next[index].unitPrice
      };
      return next;
    });
  };

  const handleRemoveItem = (index: number) => {
    setOrderItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveItemNote = () => {
    if (!activeItemNoteModal) return;
    setOrderItems((prev) => {
      const next = [...prev];
      if (next[activeItemNoteModal.index]) {
        next[activeItemNoteModal.index] = {
          ...next[activeItemNoteModal.index],
          notes: activeItemNoteModal.note.trim() || undefined
        };
      }
      return next;
    });
    setActiveItemNoteModal(null);
  };

  const handleClearCart = () => {
    if (orderItems.length === 0) return;
    if (window.confirm('Clear all items from this customer order?')) {
      setOrderItems([]);
      setOrderNotes('');
      setCustomerName('');
      setErrorMessage('');
    }
  };

  // Submit Order to Cashier
  const handleSubmitOrder = async () => {
    if (!selectedTable) {
      setErrorMessage('Please select a Table or Bar Counter first (choose from the table bar).');
      return;
    }
    if (orderItems.length === 0) {
      setErrorMessage('Your order is empty. Tap items from the menu to add them.');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');
    try {
      const order = await submitWaiterOrder(
        {
          table: selectedTable,
          waiter: user,
          items: orderItems,
          customerName: customerName.trim() || undefined,
          notes: orderNotes.trim() || undefined
        },
        tenantId
      );

      setSubmittedOrder(order);
      setSuccessMessage(`Order #${order.orderNumber} sent to Cashier successfully!`);
      // Reset form
      setOrderItems([]);
      setOrderNotes('');
      setCustomerName('');
      setMobileTab('menu');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit order.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full w-full min-h-0 min-w-0 flex flex-col overflow-hidden">
      {/* Mobile-Only Tab Switcher (< md) */}
      <div className="md:hidden shrink-0 flex items-center bg-slate-200/90 p-1 rounded-xl mb-2 gap-1">
        <button
          type="button"
          onClick={() => setMobileTab('menu')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            mobileTab === 'menu'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Wine className="w-3.5 h-3.5" />
          <span>Menu Items ({filteredProducts.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('cart')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            mobileTab === 'cart'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          <span>
            Order Bill ({totalItemCount}) {totalAmount > 0 ? `· ${formatCurrency(totalAmount, currency)}` : ''}
          </span>
        </button>
      </div>

      {/* Main Two-Column Viewport: Left = Catalog, Right = Order Bill */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col md:flex-row gap-2.5 overflow-hidden">
        {/* ======================================================== */}
        {/* LEFT COLUMN: Table Strip, Search/Categories & Product Grid */}
        {/* ======================================================== */}
        <div
          className={`flex-1 min-w-0 min-h-0 flex flex-col h-full bg-white rounded-2xl border border-slate-200 shadow-2xs p-2 sm:p-2.5 overflow-hidden ${
            mobileTab === 'cart' ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* 1. Table Selection Bar (Compact) */}
          <div className="shrink-0 mb-2 pb-2 border-b border-slate-100 flex items-center gap-2 overflow-hidden">
            <div className="shrink-0 flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <UtensilsCrossed className="w-3.5 h-3.5 text-amber-600" />
              <span className="hidden sm:inline uppercase tracking-wider text-[11px] text-slate-500">Spot:</span>
            </div>

            {/* Scrollable Table Chips */}
            <div className="flex-1 flex items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-none">
              {tables.map((table) => {
                const isSelected = selectedTable?.id === table.id;
                const isOccupied = table.status !== 'available';
                return (
                  <button
                    key={table.id}
                    type="button"
                    onClick={() => {
                      setSelectedTable(table);
                      setErrorMessage('');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 shrink-0 ${
                      isSelected
                        ? 'bg-amber-600 text-white shadow-xs ring-2 ring-amber-400'
                        : isOccupied
                        ? 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                        : 'bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isSelected
                          ? 'bg-white'
                          : table.status === 'available'
                          ? 'bg-emerald-500'
                          : 'bg-amber-500'
                      }`}
                    />
                    <span>{table.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Active Selected Table Indicator */}
            {selectedTable ? (
              <div className="shrink-0 px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[11px] font-black border border-amber-300 truncate max-w-[120px]">
                {selectedTable.name}
              </div>
            ) : (
              <div className="shrink-0 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 text-[11px] font-bold border border-rose-200 animate-pulse">
                Select Table
              </div>
            )}
          </div>

          {/* 2. Search & Category Bar (Single Row) */}
          <div className="shrink-0 mb-2 flex items-center gap-2 overflow-hidden">
            {/* Search Input */}
            <div className="relative shrink-0 w-36 sm:w-48 lg:w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search menu..."
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

            {/* Category Filter Pills */}
            <div className="flex-1 flex items-center gap-1 overflow-x-auto py-0.5 scrollbar-none">
              <button
                type="button"
                onClick={() => setSelectedCategoryId('all')}
                className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-all shrink-0 ${
                  selectedCategoryId === 'all'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                All Menu
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-all shrink-0 ${
                    selectedCategoryId === cat.id
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Product Catalog Grid (Scrollable Inside Viewport) */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
              {filteredProducts.map((product) => {
                const inCart = orderItems.find(i => i.productId === product.id);
                return (
                  <div
                    key={product.id}
                    onClick={() => handleAddToCart(product)}
                    className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between cursor-pointer active:scale-97 select-none relative group ${
                      inCart
                        ? 'border-amber-500 bg-amber-50/50 shadow-xs ring-1 ring-amber-400'
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
                    <h4 className="text-xs sm:text-sm font-bold text-slate-900 leading-snug line-clamp-2 mb-2">
                      {product.name}
                    </h4>

                    {/* Bottom Row: Price & Touch Tap Target */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                      <span className="text-xs sm:text-sm font-black text-amber-700">
                        {formatCurrency(product.sellingPrice, currency)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToCart(product);
                        }}
                        className="w-6 h-6 rounded-lg bg-amber-50 text-amber-800 border border-amber-200/80 flex items-center justify-center font-bold hover:bg-amber-600 hover:text-white transition-colors cursor-pointer"
                        title="Add to order"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {filteredProducts.length === 0 && (
                <div className="col-span-full text-center py-12 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <Wine className="w-8 h-8 text-slate-300 mx-auto mb-1.5" />
                  <p className="text-xs text-slate-500 font-medium">No menu items match your search</p>
                </div>
              )}
            </div>
          </div>

          {/* Mobile Bottom Bar for Menu Tab (< md screen only) */}
          {mobileTab === 'menu' && totalItemCount > 0 && (
            <div className="md:hidden shrink-0 mt-2 p-2 rounded-xl bg-slate-900 text-white flex items-center justify-between shadow-lg">
              <div>
                <p className="text-[10px] text-amber-400 font-bold uppercase">
                  {selectedTable ? selectedTable.name : 'Table Not Set'}
                </p>
                <p className="text-xs font-black">
                  {totalItemCount} items · {formatCurrency(totalAmount, currency)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMobileTab('cart')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer"
              >
                <span>Review & Submit</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* ======================================================== */}
        {/* RIGHT COLUMN: Current Order Ticket & Big Pinned Submit Button */}
        {/* ======================================================== */}
        <div
          className={`w-full md:w-80 lg:w-88 xl:w-96 shrink-0 flex flex-col h-full bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden ${
            mobileTab === 'menu' ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* Ticket Header (Pinned Top) */}
          <div className="shrink-0 p-2.5 sm:p-3 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2 truncate">
              <UtensilsCrossed className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="truncate">
                <span className="text-[10px] uppercase text-slate-400 font-bold block">Current Order</span>
                <span className="font-black text-xs sm:text-sm uppercase tracking-wide text-amber-300 truncate">
                  {selectedTable ? selectedTable.name : '⚠️ NO TABLE SELECTED'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-amber-400 text-xs font-bold font-mono">
                {totalItemCount} items
              </span>
              {orderItems.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearCart}
                  className="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Clear order"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Guest Name & Table Note Inputs (Compact) */}
          <div className="shrink-0 px-2.5 py-1.5 bg-slate-50 border-b border-slate-200/80 flex items-center gap-2">
            <div className="relative flex-1">
              <User className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Guest name (opt)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full pl-6 pr-2 py-1 text-xs rounded-lg border border-slate-200 bg-white text-slate-900 focus:border-amber-600 focus:outline-none"
              />
            </div>
            <div className="relative flex-1">
              <FileText className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Note (e.g. VIP, ice)"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                className="w-full pl-6 pr-2 py-1 text-xs rounded-lg border border-slate-200 bg-white text-slate-900 focus:border-amber-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Cart Items List (Scrollable Middle Section) */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5 divide-y divide-slate-100">
            {orderItems.map((item, index) => (
              <div
                key={index}
                className="pt-1.5 first:pt-0 flex flex-col gap-1 text-xs"
              >
                <div className="flex items-start justify-between gap-1.5">
                  <div className="truncate flex-1">
                    <span className="font-bold text-slate-900 truncate block">
                      {item.productName}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {formatCurrency(item.unitPrice, currency)} each
                    </span>
                  </div>
                  <span className="font-black text-slate-900 shrink-0 font-mono">
                    {formatCurrency(item.totalAmount, currency)}
                  </span>
                </div>

                {/* Special Instruction Note */}
                {item.notes && (
                  <div className="text-[10px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/80 flex items-center justify-between">
                    <span>Note: <strong>{item.notes}</strong></span>
                    <button
                      type="button"
                      onClick={() => setActiveItemNoteModal({ index, note: item.notes || '' })}
                      className="text-amber-700 hover:underline cursor-pointer ml-1"
                    >
                      edit
                    </button>
                  </div>
                )}

                {/* Stepper Controls & Delete */}
                <div className="flex items-center justify-between pt-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveItemNoteModal({ index, note: item.notes || '' })}
                    className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-amber-700 font-medium cursor-pointer"
                  >
                    <MessageSquare className="w-2.5 h-2.5" />
                    <span>{item.notes ? 'Edit Note' : '+ Note'}</span>
                  </button>

                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => handleUpdateQuantity(index, -1)}
                      className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-700 cursor-pointer active:scale-90"
                    >
                      <Minus className="w-2.5 h-2.5" />
                    </button>
                    <span className="w-5 text-center font-bold text-slate-900 text-xs">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleUpdateQuantity(index, 1)}
                      className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-700 cursor-pointer active:scale-90"
                    >
                      <Plus className="w-2.5 h-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(index)}
                      className="w-5 h-5 rounded text-slate-400 hover:text-red-600 flex items-center justify-center ml-1 cursor-pointer"
                      title="Remove item"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {orderItems.length === 0 && (
              <div className="text-center py-10 px-4 text-slate-400">
                <ShoppingCart className="w-8 h-8 mx-auto mb-1.5 opacity-30 text-amber-600" />
                <p className="text-xs font-semibold text-slate-600">Your order is empty</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Tap products on the menu to add drinks or meals to this table.
                </p>
              </div>
            )}
          </div>

          {/* ======================================================== */}
          {/* TICKET BOTTOM ACTION AREA: ALWAYS PINNED, NEVER CUT OFF! */}
          {/* ======================================================== */}
          <div className="shrink-0 p-2.5 sm:p-3 bg-slate-50 border-t border-slate-200 space-y-2">
            {/* Total Row */}
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">
                Total Bill:
              </span>
              <span className="text-xl sm:text-2xl font-black text-amber-700 font-mono">
                {formatCurrency(totalAmount, currency)}
              </span>
            </div>

            {/* Error or Validation Banner */}
            {errorMessage && (
              <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-start gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Success Banner */}
            {successMessage && (
              <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            {/* The Critical Submit Button - 100% visible on screen at all times */}
            <button
              type="button"
              onClick={handleSubmitOrder}
              disabled={submitting || orderItems.length === 0}
              className={`w-full py-3 sm:py-3.5 rounded-xl font-black text-xs sm:text-sm tracking-wide uppercase flex items-center justify-center gap-2 shadow-md transition-all active:scale-98 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                submitting
                  ? 'bg-amber-400 text-slate-900 cursor-wait'
                  : orderItems.length === 0
                  ? 'bg-slate-200 text-slate-500 shadow-none'
                  : 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/30'
              }`}
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Submitting to Cashier...</span>
                </>
              ) : orderItems.length === 0 ? (
                <>
                  <UtensilsCrossed className="w-4 h-4 text-slate-400" />
                  <span>Add Items to Submit Order</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Take Customer Order (Submit to Cashier)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Item Note Modal */}
      {activeItemNoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 sm:p-5 shadow-2xl">
            <h4 className="font-bold text-slate-900 text-sm mb-1">
              Item Special Instruction
            </h4>
            <p className="text-xs text-slate-500 mb-3 font-semibold">
              {orderItems[activeItemNoteModal.index]?.productName}
            </p>
            <textarea
              rows={3}
              placeholder="e.g. Extra cold, no lemon, separate glass, well done"
              value={activeItemNoteModal.note}
              onChange={(e) =>
                setActiveItemNoteModal({ ...activeItemNoteModal, note: e.target.value })
              }
              className="w-full p-2.5 rounded-xl border border-slate-300 text-xs focus:border-amber-600 focus:outline-none mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveItemNoteModal(null)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveItemNote}
                className="px-4 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 shadow-sm"
              >
                Save Instruction
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-Submit KOT Modal */}
      {submittedOrder && (
        <KotModal
          order={submittedOrder}
          businessConfig={businessConfig}
          isNewSubmission={true}
          onClose={() => {
            const ord = submittedOrder;
            setSubmittedOrder(null);
            if (onOrderSubmitted) onOrderSubmitted(ord);
          }}
          onSentToCashier={() => {
            const ord = submittedOrder;
            setSubmittedOrder(null);
            if (onOrderSubmitted) onOrderSubmitted(ord);
          }}
        />
      )}
    </div>
  );
}
