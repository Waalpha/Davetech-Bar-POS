import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  UserProfile,
  BusinessConfig,
  RestaurantOrder,
  OrderItem,
  PaymentMethod,
  Sale,
  Product
} from '../../types';
import { DEFAULT_BUSINESS_ID } from '../../lib/firebase';
import {
  subscribeOrders,
  processWaiterOrderPayment,
  updateOrder
} from '../../lib/orderService';
import { getLocalCachedProducts } from '../../lib/offlineManager';
import { formatCurrency } from '../../lib/utils';
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  UtensilsCrossed,
  CreditCard,
  Banknote,
  Smartphone,
  CircleDollarSign,
  Printer,
  Edit2,
  Plus,
  Minus,
  Trash2,
  X,
  FileText,
  User,
  ArrowRight,
  Search
} from 'lucide-react';
import { ReceiptModal } from '../common/ReceiptModal';
import { KotModal } from '../common/KotModal';
import { WaiterOrderScreen } from '../waiter/WaiterOrderScreen';

interface WaiterOrdersViewProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
}

export function WaiterOrdersView({ user, businessConfig }: WaiterOrdersViewProps) {
  const tenantId = user.businessId || DEFAULT_BUSINESS_ID;
  const currency = businessConfig?.currency || 'KSh';

  // Live Orders
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'completed' | 'all'>('pending');

  // Active Processing / Editing Modal
  const [selectedOrder, setSelectedOrder] = useState<RestaurantOrder | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedItems, setEditedItems] = useState<OrderItem[]>([]);
  const [editedNotes, setEditedNotes] = useState('');

  // Payment State
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [amountTendered, setAmountTendered] = useState<string>('');
  const [referenceCode, setReferenceCode] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  // Modals after completion
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [viewingKotOrder, setViewingKotOrder] = useState<RestaurantOrder | null>(null);
  const [showTakeOrderModal, setShowTakeOrderModal] = useState(false);
  const [selectedWaiterFilter, setSelectedWaiterFilter] = useState<string>('all');

  // Available products for adding to order during review
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const selectedOrderRef = useRef<RestaurantOrder | null>(selectedOrder);
  selectedOrderRef.current = selectedOrder;
  const isEditingRef = useRef<boolean>(isEditing);
  isEditingRef.current = isEditing;

  useEffect(() => {
    setAllProducts(getLocalCachedProducts(tenantId).filter(p => p.status === 'active'));

    const unsub = subscribeOrders(tenantId, (loaded) => {
      setOrders(loaded);
      setLoading(false);

      // If current selected order was updated in real time, update it
      if (selectedOrderRef.current && !isEditingRef.current) {
        const fresh = loaded.find(o => o.id === selectedOrderRef.current?.id);
        if (fresh) {
          setSelectedOrder(fresh);
        }
      }
    });

    return () => unsub();
  }, [tenantId]);

  const pendingOrders = useMemo(() => {
    return orders.filter(o => o.orderStatus !== 'completed' && o.orderStatus !== 'cancelled');
  }, [orders]);

  const completedOrders = useMemo(() => {
    return orders.filter(o => o.orderStatus === 'completed');
  }, [orders]);

  // List of unique waiters from loaded orders
  const uniqueWaiters = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    orders.forEach(o => {
      if (o.waiterId) {
        map.set(o.waiterId, { id: o.waiterId, name: o.waiterName || 'Staff' });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);

  // Total sales sold by selected waiter or all waiters
  const waiterSalesSummary = useMemo(() => {
    const completedForWaiter = completedOrders.filter(
      o => selectedWaiterFilter === 'all' || o.waiterId === selectedWaiterFilter
    );
    const pendingForWaiter = pendingOrders.filter(
      o => selectedWaiterFilter === 'all' || o.waiterId === selectedWaiterFilter
    );
    const totalSoldAmount = completedForWaiter.reduce((sum, o) => sum + o.totalAmount, 0);
    const pendingSoldAmount = pendingForWaiter.reduce((sum, o) => sum + o.totalAmount, 0);

    return {
      completedCount: completedForWaiter.length,
      pendingCount: pendingForWaiter.length,
      totalSoldAmount,
      pendingSoldAmount
    };
  }, [completedOrders, pendingOrders, selectedWaiterFilter]);

  const displayedOrders = useMemo(() => {
    let list = orders;
    if (filter === 'pending') list = pendingOrders;
    else if (filter === 'completed') list = completedOrders;

    if (selectedWaiterFilter !== 'all') {
      list = list.filter(o => o.waiterId === selectedWaiterFilter);
    }
    return list;
  }, [filter, pendingOrders, completedOrders, orders, selectedWaiterFilter]);

  // Open Order for review and payment
  const handleOpenOrder = (order: RestaurantOrder) => {
    setSelectedOrder(order);
    setIsEditing(false);
    setEditedItems([...order.items]);
    setEditedNotes(order.notes || '');
    setPaymentMethod('Cash');
    setAmountTendered(order.totalAmount.toString());
    setReferenceCode('');
    setPaymentError('');
  };

  // Editing items
  const handleQtyChange = (index: number, delta: number) => {
    setEditedItems((prev) => {
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

  const handleRemoveEditedItem = (index: number) => {
    setEditedItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddProductToOrder = (prod: Product) => {
    setEditedItems((prev) => {
      const existingIdx = prev.findIndex(item => item.productId === prod.id);
      if (existingIdx >= 0) {
        const next = [...prev];
        const newQty = next[existingIdx].quantity + 1;
        next[existingIdx] = {
          ...next[existingIdx],
          quantity: newQty,
          totalAmount: newQty * next[existingIdx].unitPrice
        };
        return next;
      } else {
        return [
          ...prev,
          {
            productId: prod.id,
            productName: prod.name,
            quantity: 1,
            unitPrice: prod.sellingPrice,
            totalAmount: prod.sellingPrice
          }
        ];
      }
    });
    setShowAddProductModal(false);
  };

  const currentOrderTotal = useMemo(() => {
    if (!selectedOrder) return 0;
    const items = isEditing ? editedItems : selectedOrder.items;
    return items.reduce((sum, i) => sum + i.totalAmount, 0);
  }, [selectedOrder, isEditing, editedItems]);

  const handleSaveOrderEdits = async () => {
    if (!selectedOrder) return;
    if (editedItems.length === 0) {
      setPaymentError('Order must have at least 1 item.');
      return;
    }

    try {
      const subtotal = editedItems.reduce((sum, i) => sum + i.totalAmount, 0);
      await updateOrder(
        selectedOrder.id,
        {
          items: editedItems,
          subtotal,
          totalAmount: subtotal,
          notes: editedNotes.trim() || undefined
        },
        tenantId
      );

      const updated = {
        ...selectedOrder,
        items: editedItems,
        subtotal,
        totalAmount: subtotal,
        notes: editedNotes.trim() || undefined
      };
      setSelectedOrder(updated);
      setAmountTendered(subtotal.toString());
      setIsEditing(false);
    } catch (err: any) {
      setPaymentError('Failed to save order edits: ' + err.message);
    }
  };

  // Payment Confirmation
  const handleProcessPayment = async () => {
    if (!selectedOrder) return;

    const itemsToProcess = isEditing ? editedItems : selectedOrder.items;
    if (itemsToProcess.length === 0) {
      setPaymentError('Cannot checkout an empty order.');
      return;
    }

    const total = currentOrderTotal;
    const tendered = paymentMethod === 'Cash' ? parseFloat(amountTendered) || 0 : total;

    if (paymentMethod === 'Cash' && tendered < total) {
      setPaymentError(`Amount tendered (${formatCurrency(tendered, currency)}) is less than total (${formatCurrency(total, currency)})`);
      return;
    }

    setProcessing(true);
    setPaymentError('');

    try {
      // If user had edited items, save them first
      const orderToClose: RestaurantOrder = {
        ...selectedOrder,
        items: itemsToProcess,
        subtotal: total,
        totalAmount: total,
        notes: isEditing ? editedNotes.trim() || undefined : selectedOrder.notes
      };

      const change = paymentMethod === 'Cash' ? Math.max(0, tendered - total) : 0;

      const sale = await processWaiterOrderPayment(
        orderToClose,
        {
          paymentMethod,
          amountTendered: tendered,
          change,
          referenceCode: referenceCode.trim() || undefined
        },
        user,
        businessConfig,
        tenantId
      );

      setCompletedSale(sale);
      setSelectedOrder(null);
      setIsEditing(false);
    } catch (err: any) {
      setPaymentError(err.message || 'Payment processing failed.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto pr-1 space-y-4">
      {/* Header and Filter Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UtensilsCrossed className="w-6 h-6 text-amber-600" />
            <span>Waiter Orders</span>
            {pendingOrders.length > 0 && (
              <span className="ml-2 px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-500 text-slate-950 animate-pulse">
                {pendingOrders.length} New
              </span>
            )}
          </h2>
          <p className="text-sm text-gray-500">
            Real-time orders submitted by waiters. Review, modify, and process customer payments.
          </p>
        </div>

        {/* Filter Tabs & Take Order Action */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setShowTakeOrderModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-md shadow-amber-600/20 transition-all cursor-pointer active:scale-98"
          >
            <UtensilsCrossed className="w-4 h-4" />
            <span>Take Customer Order</span>
          </button>

          <div className="flex items-center gap-2 bg-white p-1 rounded-2xl border border-gray-200 shadow-xs">
            <button
              onClick={() => setFilter('pending')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                filter === 'pending'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Pending ({pendingOrders.length})</span>
            </button>
            <button
              onClick={() => setFilter('completed')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                filter === 'completed'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Paid / Completed ({completedOrders.length})</span>
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                filter === 'all'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              All ({orders.length})
            </button>
          </div>
        </div>
      </div>

      {/* Waiter Sales Filter & Performance Summary Strip */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
            <User className="w-4 h-4 text-amber-600" />
            <span>Filter by Waiter:</span>
          </div>
          <select
            value={selectedWaiterFilter}
            onChange={(e) => setSelectedWaiterFilter(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-900 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/20"
          >
            <option value="all">All Waiters / Staff ({orders.length} orders)</option>
            {uniqueWaiters.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {selectedWaiterFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setSelectedWaiterFilter('all')}
              className="text-xs text-amber-700 hover:text-amber-800 font-bold underline cursor-pointer"
            >
              Reset filter
            </button>
          )}
        </div>

        {/* Live Waiter Sales Metric */}
        <div className="flex items-center gap-4 flex-wrap text-xs">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5">
            <span className="text-gray-500 mr-1.5">
              {selectedWaiterFilter === 'all' ? 'All Waiters Sold:' : 'Waiter Total Sold:'}
            </span>
            <strong className="text-emerald-700 font-black text-sm">
              {formatCurrency(waiterSalesSummary.totalSoldAmount, currency)}
            </strong>
            <span className="text-emerald-600 text-[11px] ml-1">
              ({waiterSalesSummary.completedCount} paid)
            </span>
          </div>

          {waiterSalesSummary.pendingCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5">
              <span className="text-gray-500 mr-1.5">Pending Payment:</span>
              <strong className="text-amber-800 font-black text-sm">
                {formatCurrency(waiterSalesSummary.pendingSoldAmount, currency)}
              </strong>
              <span className="text-amber-700 text-[11px] ml-1">
                ({waiterSalesSummary.pendingCount} orders)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Orders Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {displayedOrders.map((order) => {
          const isPending = order.orderStatus !== 'completed';
          return (
            <div
              key={order.id}
              className={`rounded-2xl border bg-white p-5 shadow-xs transition-all flex flex-col justify-between ${
                isPending
                  ? 'border-amber-300 ring-1 ring-amber-200 hover:shadow-md'
                  : 'border-gray-200 opacity-90'
              }`}
            >
              <div>
                {/* Top Row: Order #, Table, Waiter */}
                <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200">
                        #{order.orderNumber}
                      </span>
                      <span className="font-black text-gray-900 text-base uppercase">
                        {order.tableName}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                      <span>Waiter:</span>
                      <strong className="text-gray-800 font-bold">{order.waiterName}</strong>
                      <span className="text-gray-400">• {order.time}</span>
                    </p>
                  </div>

                  {isPending ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      <Clock className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                      Pending
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Paid
                    </span>
                  )}
                </div>

                {/* Guest Name if present */}
                {order.customerName && (
                  <p className="text-xs text-gray-600 mb-2 flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-gray-400" />
                    <span>Guest: <strong>{order.customerName}</strong></span>
                  </p>
                )}

                {/* Items Summary */}
                <div className="space-y-1.5 my-3 divide-y divide-gray-50 text-xs">
                  {order.items.map((item, idx) => (
                    <div key={idx} className="pt-1.5 first:pt-0 flex justify-between items-start">
                      <div>
                        <span className="font-bold text-gray-900">
                          {item.quantity} × {item.productName}
                        </span>
                        {item.notes && (
                          <p className="text-[11px] text-amber-800 italic bg-amber-50 px-1 rounded mt-0.5">
                            Note: {item.notes}
                          </p>
                        )}
                      </div>
                      <span className="text-gray-600 font-semibold shrink-0">
                        {formatCurrency(item.totalAmount, currency)}
                      </span>
                    </div>
                  ))}
                </div>

                {order.notes && (
                  <div className="bg-gray-50 rounded-xl p-2.5 text-xs text-gray-600 mt-2 border border-gray-100 flex items-start gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
                    <span className="italic">{order.notes}</span>
                  </div>
                )}
              </div>

              {/* Bottom Actions */}
              <div className="pt-3 border-t border-gray-100 mt-4 flex items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Total</span>
                  <span className="text-lg font-black text-gray-900">
                    {formatCurrency(order.totalAmount, currency)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewingKotOrder(order)}
                    className="p-2 rounded-xl border border-gray-200 text-gray-600 hover:text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                    title="View / Print Bar Ticket"
                  >
                    <Printer className="w-4 h-4" />
                  </button>

                  {isPending ? (
                    <button
                      onClick={() => handleOpenOrder(order)}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-md shadow-amber-600/30 transition-all active:scale-95 cursor-pointer"
                    >
                      <span>Process Payment</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleOpenOrder(order)}
                      className="px-3 py-2 rounded-xl border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-100 cursor-pointer"
                    >
                      View Details
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {displayedOrders.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200 shadow-xs">
          <UtensilsCrossed className="w-12 h-12 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 font-medium">
            {filter === 'pending'
              ? 'No pending waiter orders right now'
              : 'No completed waiter orders recorded yet'}
          </p>
        </div>
      )}

      {/* Cashier Order Review & Payment Modal - ALWAYS VISIBLE BUTTONS */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl transition-all max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header (Pinned Top) */}
            <div className="shrink-0 p-3 sm:p-4 border-b border-gray-100 flex items-start justify-between bg-slate-50/90 rounded-t-2xl">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base font-black text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-lg border border-amber-200">
                    Order #{selectedOrder.orderNumber}
                  </span>
                  <span className="font-black text-gray-900 text-base sm:text-lg uppercase">
                    {selectedOrder.tableName}
                  </span>
                  {selectedOrder.orderStatus === 'completed' && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                      PAID
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Waiter: <strong>{selectedOrder.waiterName}</strong> • {selectedOrder.time} ({selectedOrder.date})
                </p>
              </div>

              <button
                onClick={() => {
                  setSelectedOrder(null);
                  setIsEditing(false);
                }}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Middle Body (Items + Payment Setup) */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3">
              {paymentError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                  <span>{paymentError}</span>
                </div>
              )}

              {/* Order Items Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                    Order Items ({isEditing ? editedItems.length : selectedOrder.items.length})
                  </h4>

                  {selectedOrder.orderStatus !== 'completed' && (
                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setShowAddProductModal(true)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-300 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add Item</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveOrderEdits}
                            className="text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 px-3 py-1 rounded-lg cursor-pointer shadow-xs"
                          >
                            Done Editing
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsEditing(true)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-amber-700 hover:bg-gray-100 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>Edit Order Items</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden bg-gray-50/50">
                  {(isEditing ? editedItems : selectedOrder.items).map((item, idx) => (
                    <div key={idx} className="p-2.5 sm:p-3 flex items-center justify-between text-xs bg-white">
                      <div className="flex-1 pr-2">
                        <div className="font-bold text-gray-900">{item.productName}</div>
                        <div className="text-gray-500 text-[11px]">
                          {formatCurrency(item.unitPrice, currency)} each
                        </div>
                        {item.notes && (
                          <div className="text-[10px] text-amber-800 italic mt-0.5">
                            Note: {item.notes}
                          </div>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <div className="flex items-center space-x-1">
                            <button
                              type="button"
                              onClick={() => handleQtyChange(idx, -1)}
                              className="w-6 h-6 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-7 text-center font-bold">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => handleQtyChange(idx, 1)}
                              className="w-6 h-6 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          <span className="w-16 text-right font-black text-gray-900">
                            {formatCurrency(item.totalAmount, currency)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveEditedItem(idx)}
                            className="text-gray-400 hover:text-red-600 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="text-right">
                          <span className="font-bold text-gray-700 mr-3">{item.quantity} ×</span>
                          <span className="font-black text-gray-900">
                            {formatCurrency(item.totalAmount, currency)}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Total Row */}
                <div className="flex justify-between items-center bg-gray-100 p-2.5 rounded-xl mt-2 font-black text-gray-900 text-sm">
                  <span>Total Amount Due:</span>
                  <span className="text-base sm:text-lg text-amber-700 font-mono">
                    {formatCurrency(currentOrderTotal, currency)}
                  </span>
                </div>
              </div>

              {/* Payment Section (for pending orders) */}
              {selectedOrder.orderStatus !== 'completed' && (
                <div className="border-t border-gray-100 pt-3 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                    Payment Method & Details
                  </h4>

                  {/* Payment Method Selector */}
                  <div className="grid grid-cols-4 gap-2">
                    {(['Cash', 'M-Pesa', 'Card', 'Other'] as PaymentMethod[]).map((method) => {
                      const isSelected = paymentMethod === method;
                      const Icon =
                        method === 'Cash'
                          ? Banknote
                          : method === 'M-Pesa'
                          ? Smartphone
                          : method === 'Card'
                          ? CreditCard
                          : CircleDollarSign;

                      return (
                        <button
                          key={method}
                          type="button"
                          onClick={() => {
                            setPaymentMethod(method);
                            if (method !== 'Cash') {
                              setAmountTendered(currentOrderTotal.toString());
                            }
                          }}
                          className={`p-2.5 sm:p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                            isSelected
                              ? 'border-amber-600 bg-amber-50 text-amber-900 font-bold shadow-xs ring-2 ring-amber-500/20'
                              : 'border-gray-200 hover:border-gray-300 text-gray-700'
                          }`}
                        >
                          <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                          <span className="text-xs">{method}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Cash Tendered Input & Presets */}
                  {paymentMethod === 'Cash' && (
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                        Amount Tendered ({currency})
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="0.00"
                        value={amountTendered}
                        onChange={(e) => setAmountTendered(e.target.value)}
                        className="w-full text-base sm:text-lg font-black p-2.5 rounded-xl border border-gray-300 focus:border-amber-600 focus:outline-none font-mono"
                      />

                      {/* Quick presets */}
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={() => setAmountTendered(currentOrderTotal.toString())}
                          className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-800"
                        >
                          Exact ({formatCurrency(currentOrderTotal, currency)})
                        </button>
                        {[100, 200, 500, 1000, 2000, 5000].map((amt) => {
                          if (amt < currentOrderTotal && amt * 2 < currentOrderTotal) return null;
                          return (
                            <button
                              key={amt}
                              type="button"
                              onClick={() => setAmountTendered(amt.toString())}
                              className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-800 font-mono"
                            >
                              {formatCurrency(amt, currency)}
                            </button>
                          );
                        })}
                      </div>

                      {parseFloat(amountTendered) > currentOrderTotal && (
                        <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex justify-between">
                          <span>Change Due:</span>
                          <span className="font-mono">{formatCurrency(parseFloat(amountTendered) - currentOrderTotal, currency)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Reference Code for M-Pesa */}
                  {paymentMethod === 'M-Pesa' && (
                    <div className="bg-emerald-50/80 border border-emerald-200 p-3 rounded-xl space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                          <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                          <span>M-Pesa Code or Customer Phone (Optional)</span>
                        </label>
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.2 rounded-md">
                          Optional
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder="e.g. QX94KD829L or 0712345678"
                        value={referenceCode}
                        onChange={(e) => setReferenceCode(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-emerald-300 bg-white text-xs font-bold text-gray-900 focus:border-emerald-600 focus:outline-none uppercase font-mono"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-gray-500 pt-0.5">
                        <span>
                          Till: <strong className="text-emerald-700 font-mono font-bold">{businessConfig?.tillNumber || '5849201'}</strong>
                        </span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setReferenceCode('CONFIRMED')}
                            className="px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-md font-bold text-[10px] cursor-pointer"
                          >
                            + Confirmed
                          </button>
                          <button
                            type="button"
                            onClick={() => setReferenceCode('TILL')}
                            className="px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-md font-bold text-[10px] cursor-pointer"
                          >
                            + Till
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Reference Code for Card / Other */}
                  {(paymentMethod === 'Card' || paymentMethod === 'Other') && (
                    <div className="bg-gray-50 border border-gray-200 p-3 rounded-xl space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                          {paymentMethod} Reference / Slip Code (Optional)
                        </label>
                        <span className="text-[10px] text-gray-400 font-medium">Optional</span>
                      </div>
                      <input
                        type="text"
                        placeholder="e.g. Slip #4829 or Approval Code"
                        value={referenceCode}
                        onChange={(e) => setReferenceCode(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-gray-300 bg-white text-xs focus:border-amber-600 focus:outline-none uppercase font-mono"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer (Pinned Bottom - ALWAYS 100% VISIBLE!) */}
            <div className="shrink-0 p-3 sm:p-4 border-t border-gray-200 bg-slate-900 text-white rounded-b-2xl flex items-center justify-between gap-3 shadow-lg">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Bill</span>
                <span className="text-base sm:text-xl font-black text-amber-400 font-mono">
                  {formatCurrency(currentOrderTotal, currency)}
                </span>
              </div>

              {selectedOrder.orderStatus !== 'completed' ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedOrder(null)}
                    className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs sm:text-sm font-semibold text-slate-300 cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={processing}
                    onClick={handleProcessPayment}
                    className="px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs sm:text-sm shadow-md shadow-emerald-500/20 flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer disabled:opacity-50 active:scale-98 uppercase tracking-wide"
                  >
                    <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span>
                      {processing
                        ? 'Completing Sale...'
                        : paymentMethod === 'M-Pesa'
                        ? `Complete M-Pesa Payment`
                        : `Complete Payment`}
                    </span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs sm:text-sm font-bold cursor-pointer"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Product Modal during Order Edit */}
      {showAddProductModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-3">
              <h4 className="font-bold text-gray-900 text-sm">Add Item to Order</h4>
              <button
                onClick={() => setShowAddProductModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative mb-3">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search products..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-gray-300 focus:border-amber-600 focus:outline-none"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 divide-y divide-gray-50">
              {allProducts
                .filter(p =>
                  productSearch.trim() === '' ||
                  p.name.toLowerCase().includes(productSearch.toLowerCase())
                )
                .map((prod) => (
                  <button
                    key={prod.id}
                    onClick={() => handleAddProductToOrder(prod)}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-amber-50 flex items-center justify-between text-xs transition-colors cursor-pointer group"
                  >
                    <div>
                      <span className="font-bold text-gray-900 group-hover:text-amber-800">
                        {prod.name}
                      </span>
                      <span className="text-[10px] text-gray-400 block">{prod.categoryName}</span>
                    </div>
                    <span className="font-black text-amber-700">
                      {formatCurrency(prod.sellingPrice, currency)}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Final Receipt Modal after payment */}
      {completedSale && (
        <ReceiptModal
          sale={completedSale}
          businessConfig={businessConfig}
          onClose={() => setCompletedSale(null)}
        />
      )}

      {/* KOT Modal */}
      {viewingKotOrder && (
        <KotModal
          order={viewingKotOrder}
          businessConfig={businessConfig}
          onClose={() => setViewingKotOrder(null)}
        />
      )}

      {/* Take Customer Order Modal */}
      {showTakeOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-5xl h-[92vh] max-h-[92vh] rounded-3xl bg-slate-100 p-3 sm:p-5 shadow-2xl flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between pb-2.5 border-b border-gray-200 mb-2">
              <div className="flex items-center gap-2">
                <UtensilsCrossed className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-gray-900 text-base">Take Customer Order</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowTakeOrderModal(false)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <WaiterOrderScreen
                user={user}
                businessConfig={businessConfig}
                onOrderSubmitted={() => {
                  setShowTakeOrderModal(false);
                  setFilter('pending');
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
