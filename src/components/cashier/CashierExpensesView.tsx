import React, { useState, useEffect } from 'react';
import { UserProfile, BusinessConfig, ExpenseRecord, ExpenseCategory } from '../../types';
import { DEFAULT_BUSINESS_ID } from '../../lib/firebase';
import { subscribeExpenses, deleteExpense } from '../../lib/expenseService';
import { RecordExpenseModal } from '../common/RecordExpenseModal';
import { formatCurrency } from '../../lib/utils';
import { 
  Wallet, 
  Plus, 
  Search, 
  Filter, 
  Printer, 
  Trash2, 
  FileText, 
  Calendar, 
  DollarSign, 
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Tag,
  ArrowUpDown
} from 'lucide-react';

interface CashierExpensesViewProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
}

export function CashierExpensesView({ user, businessConfig }: CashierExpensesViewProps) {
  const tenantId = user.businessId || DEFAULT_BUSINESS_ID;
  const currency = businessConfig?.currency || 'KSh';
  const todayStr = new Date().toISOString().split('T')[0];

  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeExpenses(tenantId, (allExpenses) => {
      setExpenses(allExpenses);
      setLoading(false);
    });
    return () => unsub();
  }, [tenantId]);

  // Filter for today's cashier expenses
  const todayExpenses = expenses.filter(e => e.date === todayStr);

  const filteredExpenses = todayExpenses.filter(e => {
    const matchesSearch = 
      e.reason.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.voucherNumber && e.voucherNumber.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (e.receiptNumber && e.receiptNumber.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = selectedCategory === 'all' || e.category === selectedCategory;
    const matchesSource = selectedSource === 'all' || e.paymentSource === selectedSource;

    return matchesSearch && matchesCategory && matchesSource;
  });

  // Calculate totals
  const totalAmount = todayExpenses.reduce((sum, e) => sum + e.amount, 0);
  const cashDrawerTotal = todayExpenses.filter(e => e.paymentSource === 'Cash Drawer').reduce((sum, e) => sum + e.amount, 0);
  const mpesaTotal = todayExpenses.filter(e => e.paymentSource === 'M-Pesa').reduce((sum, e) => sum + e.amount, 0);
  const otherTotal = todayExpenses.filter(e => e.paymentSource === 'Other').reduce((sum, e) => sum + e.amount, 0);

  const handleDeleteExpense = async (exp: ExpenseRecord) => {
    if (!window.confirm(`Are you sure you want to void this expense of ${currency} ${exp.amount.toLocaleString()} for "${exp.reason}"?`)) {
      return;
    }

    try {
      await deleteExpense(exp.id, tenantId, user, 'Voided by cashier on duty');
      setSuccessMessage('Expense entry successfully voided.');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      alert(err?.message || 'Failed to void expense');
    }
  };

  const handlePrintVoucher = (exp: ExpenseRecord) => {
    const printWindow = window.open('', '_blank', 'width=380,height=600');
    if (!printWindow) {
      window.print();
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Expense Voucher - ${exp.voucherNumber || exp.id}</title>
        <style>
          @page { size: 80mm auto; margin: 4mm; }
          body { font-family: 'Courier New', Courier, monospace; font-size: 13px; line-height: 1.35; padding: 8px; width: 72mm; margin: 0 auto; color: #000; }
          .text-center { text-align: center; }
          .bold { font-weight: bold; }
          .title { font-size: 16px; font-weight: bold; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }
          .double-divider { border-top: 2px solid #000; margin: 8px 0; }
          .amount-box { font-size: 18px; font-weight: bold; padding: 6px; border: 1px solid #000; text-align: center; margin: 8px 0; }
          .row { display: flex; justify-content: space-between; margin-bottom: 4px; }
          .sign-area { margin-top: 20px; }
          .sign-line { border-bottom: 1px solid #000; height: 25px; margin-bottom: 4px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <div class="title">${businessConfig?.name || 'CLUB PAXX'}</div>
          <div>${businessConfig?.location || 'BAR & RESTAURANT'}</div>
          <div class="bold" style="margin-top: 4px;">*** CASHIER EXPENSE VOUCHER ***</div>
        </div>
        <div class="double-divider"></div>
        <div class="row"><span>Voucher #:</span><span class="bold">${exp.voucherNumber || exp.id.slice(-8)}</span></div>
        <div class="row"><span>Date:</span><span>${exp.date} ${exp.time}</span></div>
        <div class="row"><span>Cashier:</span><span class="bold">${exp.cashierName}</span></div>
        <div class="row"><span>Payment Source:</span><span class="bold">${exp.paymentSource.toUpperCase()}</span></div>
        <div class="row"><span>Category:</span><span>${exp.category}</span></div>
        ${exp.receiptNumber ? `<div class="row"><span>Receipt / Ref #:</span><span>${exp.receiptNumber}</span></div>` : ''}
        <div class="amount-box">PAID OUT: ${currency} ${exp.amount.toLocaleString()}</div>
        <div class="divider"></div>
        <div class="bold">EXPLANATION ("WHAT FOR"):</div>
        <div style="margin-top: 4px; padding: 4px; background: #eee; font-style: italic;">${exp.reason}</div>
        ${exp.notes ? `<div style="margin-top: 6px;"><span class="bold">Notes:</span> ${exp.notes}</div>` : ''}
        <div class="divider"></div>
        <div class="sign-area">
          <div class="row">
            <div style="width: 48%;"><div class="sign-line"></div><div class="text-center" style="font-size: 11px;">Authorizer Signature</div></div>
            <div style="width: 48%;"><div class="sign-line"></div><div class="text-center" style="font-size: 11px;">Cashier Signature</div></div>
          </div>
        </div>
        <div class="double-divider"></div>
        <div class="text-center" style="font-size: 11px;">* KEEP THIS VOUCHER IN CASH DRAWER FOR TILL RECONCILIATION *</div>
        <script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 800); };</script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handlePrintShiftSummary = () => {
    const printWindow = window.open('', '_blank', 'width=420,height=700');
    if (!printWindow) {
      window.print();
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Shift Expense Summary - ${todayStr}</title>
        <style>
          @page { size: 80mm auto; margin: 4mm; }
          body { font-family: 'Courier New', Courier, monospace; font-size: 12px; line-height: 1.35; width: 72mm; margin: 0 auto; color: #000; }
          .text-center { text-align: center; }
          .bold { font-weight: bold; }
          .title { font-size: 15px; font-weight: bold; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }
          .double-divider { border-top: 2px solid #000; margin: 8px 0; }
          .row { display: flex; justify-content: space-between; margin-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 6px; }
          th { text-align: left; border-bottom: 1px solid #000; padding: 3px 0; font-size: 11px; }
          td { padding: 4px 0; font-size: 11px; vertical-align: top; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <div class="title">${businessConfig?.name || 'CLUB PAXX'}</div>
          <div class="bold">SHIFT EXPENSES REPORT</div>
          <div>Date: ${todayStr}</div>
          <div>Cashier on Duty: ${user.name}</div>
        </div>

        <div class="double-divider"></div>

        <div class="row"><span>Total Shift Expenses:</span><span class="bold">${currency} ${totalAmount.toLocaleString()}</span></div>
        <div class="row"><span>Cash Drawer (Petty Cash):</span><span class="bold">${currency} ${cashDrawerTotal.toLocaleString()}</span></div>
        <div class="row"><span>M-Pesa Outlays:</span><span>${currency} ${mpesaTotal.toLocaleString()}</span></div>
        <div class="row"><span>Other Outlays:</span><span>${currency} ${otherTotal.toLocaleString()}</span></div>
        <div class="row"><span>Total Expense Records:</span><span class="bold">${todayExpenses.length}</span></div>

        <div class="divider"></div>
        <div class="bold">EXPENSES BREAKDOWN:</div>

        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Category / What For</th>
              <th style="text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${todayExpenses.map(e => `
              <tr>
                <td>${e.time.slice(0, 5)}</td>
                <td>
                  <div class="bold">${e.category}</div>
                  <div style="font-size: 10px; color: #333;">${e.reason}</div>
                  <div style="font-size: 9px; color: #555;">${e.paymentSource} ${e.voucherNumber ? `• ${e.voucherNumber}` : ''}</div>
                </td>
                <td style="text-align: right;" class="bold">${currency} ${e.amount.toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="double-divider"></div>
        <div style="margin-top: 25px;">
          <div style="border-bottom: 1px solid #000; width: 60%; height: 20px;"></div>
          <div style="font-size: 11px; margin-top: 4px;">Cashier Signature: ${user.name}</div>
        </div>
        <script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 800); };</script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto pr-1 space-y-4">
      {/* Header and Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <Wallet className="w-5 h-5" />
            </div>
            <span>Cashier Shift Expenses</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Cashier on duty: <strong className="text-slate-800">{user.name}</strong> • Record operational & petty cash outlays with mandatory reason explanation
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          {todayExpenses.length > 0 && (
            <button
              onClick={handlePrintShiftSummary}
              className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold shadow-xs transition-all active:scale-95 cursor-pointer"
              title="Print shift expense sheet"
            >
              <Printer className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Print Shift Summary</span>
            </button>
          )}

          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-black shadow-lg shadow-amber-500/25 transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-5 h-5" />
            <span>Record Expense</span>
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center space-x-3 text-emerald-800 text-sm animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-semibold">{successMessage}</span>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Today */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>Today's Total Expenses</span>
            <Wallet className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {currency} {totalAmount.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-1 flex items-center space-x-1">
            <span className="font-semibold">{todayExpenses.length}</span>
            <span>recorded {todayExpenses.length === 1 ? 'outlay' : 'outlays'} today</span>
          </div>
          <div className="absolute -right-3 -bottom-3 w-16 h-16 bg-amber-500/5 rounded-full pointer-events-none" />
        </div>

        {/* Cash Drawer Paid */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between text-emerald-700 text-xs font-bold uppercase tracking-wider">
            <span>Deducted from Cash Drawer</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-2">
            {currency} {cashDrawerTotal.toLocaleString()}
          </div>
          <div className="text-xs text-emerald-600 mt-1">
            Auto-deducted in Daily Closing
          </div>
          <div className="absolute -right-3 -bottom-3 w-16 h-16 bg-emerald-500/5 rounded-full pointer-events-none" />
        </div>

        {/* M-Pesa Paid */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between text-blue-700 text-xs font-bold uppercase tracking-wider">
            <span>M-Pesa / Till Outlays</span>
            <Tag className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-blue-700 mt-2">
            {currency} {mpesaTotal.toLocaleString()}
          </div>
          <div className="text-xs text-blue-600 mt-1">
            Direct mobile payment outlays
          </div>
          <div className="absolute -right-3 -bottom-3 w-16 h-16 bg-blue-500/5 rounded-full pointer-events-none" />
        </div>

        {/* Other / Bank */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>Other Outlays</span>
            <FileText className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-black text-slate-800 mt-2">
            {currency} {otherTotal.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Bank transfers / invoice outlays
          </div>
          <div className="absolute -right-3 -bottom-3 w-16 h-16 bg-purple-500/5 rounded-full pointer-events-none" />
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search expense explanation (what for), category, or voucher #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-500 outline-hidden"
          />
        </div>

        <div className="flex items-center space-x-2 w-full md:w-auto">
          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm font-semibold text-slate-700 bg-white focus:border-amber-500 outline-hidden flex-1 md:flex-none"
          >
            <option value="all">All Categories</option>
            <option value="Ice & Garnishes">Ice & Garnishes</option>
            <option value="Bar Supplies">Bar Supplies</option>
            <option value="Cleaning & Sanitation">Cleaning & Sanitation</option>
            <option value="Kitchen Ingredients">Kitchen Ingredients</option>
            <option value="Transport & Errands">Transport & Errands</option>
            <option value="Casual Labor & Tips">Casual Labor & Tips</option>
            <option value="Repairs & Maintenance">Repairs & Maintenance</option>
            <option value="Utilities & Emergency">Utilities & Emergency</option>
            <option value="Other">Other</option>
          </select>

          {/* Source Filter */}
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm font-semibold text-slate-700 bg-white focus:border-amber-500 outline-hidden flex-1 md:flex-none"
          >
            <option value="all">All Payment Sources</option>
            <option value="Cash Drawer">Cash Drawer</option>
            <option value="M-Pesa">M-Pesa</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>

      {/* Expenses Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <span>Today's Recorded Expenses</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {filteredExpenses.length} entries
            </span>
          </div>
          <span className="text-xs text-slate-400">Date: {todayStr}</span>
        </div>

        {filteredExpenses.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-14 h-14 rounded-3xl bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto mb-3">
              <Wallet className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-slate-900">No shift expenses recorded today</h3>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mt-1 mb-5">
              When you purchase ice, bar lemons, cleaning supplies, or pay for errands from the register, click the button below to record the expense and explain what it was for.
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-bold shadow-md transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Record Expense Now</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase font-bold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="px-6 py-3.5">Time</th>
                  <th className="px-6 py-3.5">Category</th>
                  <th className="px-6 py-3.5">Explain What For (Reason)</th>
                  <th className="px-6 py-3.5">Source</th>
                  <th className="px-6 py-3.5">Voucher / Ref</th>
                  <th className="px-6 py-3.5 text-right">Amount</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filteredExpenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-amber-50/40 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-xs font-mono font-medium text-slate-500">
                      {exp.time}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-100/70 text-amber-900 border border-amber-200">
                        {exp.category}
                      </span>
                    </td>

                    <td className="px-6 py-4 max-w-sm">
                      <div className="font-semibold text-slate-900 leading-snug">
                        {exp.reason}
                      </div>
                      {exp.notes && (
                        <div className="text-xs text-slate-500 italic mt-0.5">
                          Note: {exp.notes}
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-bold ${
                        exp.paymentSource === 'Cash Drawer'
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                          : exp.paymentSource === 'M-Pesa'
                          ? 'bg-blue-100 text-blue-900 border border-blue-200'
                          : 'bg-slate-100 text-slate-800'
                      }`}>
                        {exp.paymentSource}
                      </span>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">
                      <div className="font-mono font-bold text-slate-700">{exp.voucherNumber || exp.id.slice(-6)}</div>
                      {exp.receiptNumber && (
                        <div className="text-[11px] text-slate-400">Ref: {exp.receiptNumber}</div>
                      )}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className="text-base font-black text-rose-600">
                        -{currency} {exp.amount.toLocaleString()}
                      </span>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap text-right space-x-1.5">
                      <button
                        onClick={() => handlePrintVoucher(exp)}
                        className="p-2 rounded-xl text-slate-600 hover:text-slate-950 hover:bg-slate-100 transition-all cursor-pointer"
                        title="Print Voucher Chit"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteExpense(exp)}
                        className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer"
                        title="Void Expense"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Expense Modal */}
      <RecordExpenseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        user={user}
        businessConfig={businessConfig}
        onExpenseRecorded={() => {
          setSuccessMessage('Expense recorded and updated in shift records.');
          setTimeout(() => setSuccessMessage(''), 3000);
        }}
      />
    </div>
  );
}
