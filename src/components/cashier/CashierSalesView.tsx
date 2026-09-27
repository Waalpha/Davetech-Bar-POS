import React, { useEffect, useState } from 'react';
import { UserProfile, BusinessConfig, Sale } from '../../types';
import { db, DEFAULT_BUSINESS_ID } from '../../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { formatCurrency } from '../../lib/utils';
import { Receipt, Search, Calendar, DollarSign, User, ShoppingBag, Printer } from 'lucide-react';
import { ReceiptModal } from '../common/ReceiptModal';

interface CashierSalesViewProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
}

export function CashierSalesView({ user, businessConfig }: CashierSalesViewProps) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSaleForReceipt, setSelectedSaleForReceipt] = useState<Sale | null>(null);

  useEffect(() => {
    fetchSales();
  }, []);

  async function fetchSales() {
    const todayStr = new Date().toISOString().split('T')[0];

    // Load locally first for instant display
    try {
      const localSales: Sale[] = JSON.parse(localStorage.getItem('bar_pos_local_sales') || '[]');
      const todayLocal = localSales.filter(s =>
        s.date === todayStr && (s.cashierId === user.uid || user.role === 'admin')
      );
      if (todayLocal.length > 0) {
        todayLocal.sort((a, b) => b.createdAt - a.createdAt);
        setSales(todayLocal);
      }
    } catch (e) {
      // ignore
    }

    try {
      const salesRef = collection(db, 'businesses', DEFAULT_BUSINESS_ID, 'sales');
      // Show sales recorded by this cashier for today (or all sales if admin/cashier preference)
      const q = query(salesRef, where('date', '==', todayStr));
      const snap = await getDocs(q);
      const list: Sale[] = [];
      snap.forEach(d => {
        const sale = { id: d.id, ...d.data() } as Sale;
        // Filter for cashier's own transactions or all today depending on preference (Prompt says: Cashier can view today's sales)
        if (sale.cashierId === user.uid || user.role === 'admin') {
          list.push(sale);
        }
      });
      // Sort newest first
      list.sort((a, b) => b.createdAt - a.createdAt);
      if (list.length > 0) {
        setSales(list);
      }
    } catch (err) {
      console.warn("Offline: showing locally stored sales:", err);
      const localSales: Sale[] = JSON.parse(localStorage.getItem('bar_pos_local_sales') || '[]');
      const todayLocal = localSales.filter(s =>
        s.date === todayStr && (s.cashierId === user.uid || user.role === 'admin')
      );
      todayLocal.sort((a, b) => b.createdAt - a.createdAt);
      setSales(todayLocal);
    } finally {
      setLoading(false);
    }
  }

  const currency = businessConfig?.currency || 'KSh';

  const filteredSales = sales.filter(s =>
    s.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.paymentMethod.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.items.some(i => i.productName.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="h-full min-h-0 overflow-y-auto pr-1 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Today's Transactions</h2>
          <p className="text-sm text-gray-500">Sales recorded during your shift today</p>
        </div>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search receipt # or product..."
            className="w-full sm:w-72 rounded-xl border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/20"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading today's sales...</div>
      ) : filteredSales.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-gray-200 shadow-xs">
          <Receipt className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-gray-800">No Sales Recorded Today</h3>
          <p className="text-sm text-gray-500 mt-1">Transactions you record will appear here instantly.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSales.map(sale => (
            <div key={sale.id} className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center space-x-3">
                  <span className="font-mono text-xs font-bold bg-amber-50 text-amber-800 px-2.5 py-1 rounded-md border border-amber-200">
                    #{sale.id.slice(-8).toUpperCase()}
                  </span>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700">
                    {sale.paymentMethod}
                  </span>
                  <span className="text-xs text-gray-400 flex items-center space-x-1">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{sale.time}</span>
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {sale.items.map((item, idx) => (
                    <span key={idx} className="inline-flex items-center space-x-1 bg-gray-100 px-3 py-1 rounded-xl text-xs font-medium text-gray-800">
                      <ShoppingBag className="w-3 h-3 text-gray-500" />
                      <span>{item.productName} × {item.quantity}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="text-right border-t md:border-t-0 pt-3 md:pt-0 border-gray-100 flex md:flex-col justify-between items-center md:items-end gap-2">
                <div>
                  <span className="text-xs text-gray-500 block">Total Bill</span>
                  <span className="text-xl font-black text-amber-700">{formatCurrency(sale.totalAmount, currency)}</span>
                  {sale.paymentMethod === 'Cash' && sale.amountTendered && sale.amountTendered > sale.totalAmount && (
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      <span>Paid: {formatCurrency(sale.amountTendered, currency)}</span>
                      <span className="text-emerald-600 font-semibold ml-1">
                        (Change: {formatCurrency(sale.change, currency)})
                      </span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedSaleForReceipt(sale)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 text-xs font-bold transition-all shadow-xs cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Receipt</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedSaleForReceipt && (
        <ReceiptModal
          sale={selectedSaleForReceipt}
          businessConfig={businessConfig}
          onClose={() => setSelectedSaleForReceipt(null)}
        />
      )}
    </div>
  );
}
