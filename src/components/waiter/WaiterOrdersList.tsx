import React, { useState, useEffect } from 'react';
import { UserProfile, BusinessConfig, RestaurantOrder } from '../../types';
import { DEFAULT_BUSINESS_ID } from '../../lib/firebase';
import { subscribeOrders } from '../../lib/orderService';
import { formatCurrency } from '../../lib/utils';
import {
  Clock,
  Printer,
  CheckCircle2,
  AlertCircle,
  UtensilsCrossed,
  FileText,
  User,
  ExternalLink,
  DollarSign
} from 'lucide-react';
import { KotModal } from '../common/KotModal';

interface WaiterOrdersListProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
  filterMode?: 'pending' | 'completed';
  initialFilter?: 'pending' | 'completed';
  onNewOrderClick?: () => void;
}

export function WaiterOrdersList({
  user,
  businessConfig,
  filterMode = 'pending',
  initialFilter,
  onNewOrderClick
}: WaiterOrdersListProps) {
  const activeFilterMode = initialFilter || filterMode;
  const tenantId = user.businessId || DEFAULT_BUSINESS_ID;
  const currency = businessConfig?.currency || 'KSh';

  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [selectedOrderForKot, setSelectedOrderForKot] = useState<RestaurantOrder | null>(null);

  useEffect(() => {
    const unsub = subscribeOrders(tenantId, (loaded) => {
      // Filter orders submitted by this waiter
      const waiterOrders = loaded.filter(o => o.waiterId === user.uid);
      setOrders(waiterOrders);
    });
    return () => unsub();
  }, [tenantId, user.uid]);

  const completedOrders = orders.filter(o => o.orderStatus === 'completed');
  const pendingOrders = orders.filter(o => o.orderStatus !== 'completed' && o.orderStatus !== 'cancelled');
  const myTotalSoldToday = completedOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  const myPendingSalesToday = pendingOrders.reduce((sum, o) => sum + o.totalAmount, 0);

  const displayedOrders = orders.filter((o) => {
    if (activeFilterMode === 'pending') {
      return o.orderStatus !== 'completed' && o.orderStatus !== 'cancelled';
    } else {
      return o.orderStatus === 'completed';
    }
  });

  return (
    <div className="h-full flex flex-col min-h-0 space-y-3 overflow-hidden">
      {/* Waiter Sales Performance Card */}
      <div className="shrink-0 bg-white rounded-2xl border border-gray-200 p-3 sm:p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
              My Sales Today
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-lg sm:text-xl font-black text-emerald-700 font-mono">
                {formatCurrency(myTotalSoldToday, currency)}
              </span>
              <span className="text-xs text-gray-500 font-medium">
                ({completedOrders.length} orders completed)
              </span>
            </div>
          </div>
        </div>

        {myPendingSalesToday > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 self-start sm:self-auto">
            <span className="text-gray-500 text-xs mr-1">Pending at Cashier:</span>
            <strong className="text-amber-800 font-black text-xs font-mono">
              {formatCurrency(myPendingSalesToday, currency)}
            </strong>
            <span className="text-amber-700 text-[10px] ml-1">
              ({pendingOrders.length} orders)
            </span>
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            {activeFilterMode === 'pending' ? (
              <>
                <Clock className="w-4 h-4 text-amber-600" />
                <span>My Pending Orders ({displayedOrders.length})</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>My Completed Orders ({displayedOrders.length})</span>
              </>
            )}
          </h2>
          <p className="text-xs text-gray-500">
            {activeFilterMode === 'pending'
              ? 'Orders awaiting cashier payment or bar preparation'
              : 'Orders completed and paid at cashier'}
          </p>
        </div>

        {onNewOrderClick && (
          <button
            type="button"
            onClick={onNewOrderClick}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs sm:text-sm shadow-md shadow-amber-600/20 transition-all cursor-pointer active:scale-98 shrink-0"
          >
            <UtensilsCrossed className="w-3.5 h-3.5" />
            <span>Take Customer Order</span>
          </button>
        )}
      </div>

      {displayedOrders.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white rounded-2xl border border-gray-200 shadow-xs text-center">
          <UtensilsCrossed className="w-12 h-12 text-gray-300 mx-auto mb-2 opacity-50" />
          <p className="text-gray-600 font-semibold text-sm">
            {filterMode === 'pending'
              ? 'No pending orders right now'
              : 'No completed orders recorded yet'}
          </p>
          <p className="text-xs text-gray-400 mt-1">Ready to serve your next guest?</p>
          {onNewOrderClick && (
            <button
              type="button"
              onClick={onNewOrderClick}
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm shadow-md shadow-amber-600/30 transition-all cursor-pointer active:scale-98"
            >
              <UtensilsCrossed className="w-4 h-4" />
              <span>Take Customer Order</span>
            </button>
          )}
        </div>
      )}

      {displayedOrders.length > 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {displayedOrders.map((order) => (
          <div
            key={order.id}
            className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
          >
            <div>
              {/* Order Header */}
              <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-2.5 mb-2.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200">
                      #{order.orderNumber}
                    </span>
                    <span className="font-bold text-gray-900 text-sm uppercase">
                      {order.tableName}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {order.time} • {order.date}
                  </p>
                </div>

                {order.orderStatus === 'completed' ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    PAID
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                    <Clock className="w-3 h-3 text-amber-600" />
                    PENDING CASHIER
                  </span>
                )}
              </div>

              {/* Guest / Customer */}
              {order.customerName && (
                <div className="flex items-center gap-1 text-xs text-gray-600 mb-2">
                  <User className="w-3.5 h-3.5 text-gray-400" />
                  <span>Guest: <strong>{order.customerName}</strong></span>
                </div>
              )}

              {/* Items List */}
              <div className="space-y-1 my-2 divide-y divide-gray-50 text-xs">
                {order.items.map((item, i) => (
                  <div key={i} className="pt-1 first:pt-0 flex justify-between items-start">
                    <div>
                      <span className="font-bold text-gray-800">
                        {item.quantity} × {item.productName}
                      </span>
                      {item.notes && (
                        <p className="text-[10px] text-amber-800 italic bg-amber-50 px-1 rounded">
                          Note: {item.notes}
                        </p>
                      )}
                    </div>
                    <span className="text-gray-600 font-medium">
                      {formatCurrency(item.totalAmount, currency)}
                    </span>
                  </div>
                ))}
              </div>

              {order.notes && (
                <div className="bg-gray-50 rounded-xl p-2 text-xs text-gray-600 mt-2 border border-gray-100 flex items-start gap-1">
                  <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
                  <span className="italic">{order.notes}</span>
                </div>
              )}
            </div>

            {/* Bottom Meta & Actions */}
            <div className="pt-3 border-t border-gray-100 mt-3 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Total</span>
                <span className="text-base font-black text-gray-900">
                  {formatCurrency(order.totalAmount, currency)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedOrderForKot(order)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                  title="Print Bar Ticket (BOT)"
                >
                  <Printer className="w-3.5 h-3.5 text-amber-600" />
                  <span>Bar Ticket</span>
                </button>
              </div>
            </div>
          </div>
        ))}
          </div>
        </div>
      )}

      {/* KOT Modal */}
      {selectedOrderForKot && (
        <KotModal
          order={selectedOrderForKot}
          businessConfig={businessConfig}
          onClose={() => setSelectedOrderForKot(null)}
        />
      )}
    </div>
  );
}
