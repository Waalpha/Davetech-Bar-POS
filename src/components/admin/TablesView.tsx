import React, { useState, useEffect } from 'react';
import { UserProfile, RestaurantTable, TableStatus, BusinessConfig } from '../../types';
import { DEFAULT_BUSINESS_ID } from '../../lib/firebase';
import {
  subscribeTables,
  saveRestaurantTable,
  deleteRestaurantTable,
  updateTableStatus
} from '../../lib/orderService';
import { logAuditAction } from '../../lib/utils';
import {
  UtensilsCrossed,
  Plus,
  Trash2,
  Edit2,
  Users,
  CheckCircle2,
  Clock,
  RotateCcw,
  X,
  AlertCircle
} from 'lucide-react';

interface TablesViewProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
  isWaiterMode?: boolean;
  onSelectTableForOrder?: (table: RestaurantTable) => void;
}

export function TablesView({ user, businessConfig, isWaiterMode = false, onSelectTableForOrder }: TablesViewProps) {
  const tenantId = user.businessId || DEFAULT_BUSINESS_ID;
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | TableStatus>('all');

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [tableName, setTableName] = useState('');
  const [guestCount, setGuestCount] = useState(4);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    const unsub = subscribeTables(tenantId, (loaded) => {
      setTables(loaded);
      setLoading(false);
    });
    return () => unsub();
  }, [tenantId]);

  const openCreateModal = () => {
    setEditingTable(null);
    setTableName(`Table ${tables.length + 1}`);
    setGuestCount(4);
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (table: RestaurantTable) => {
    setEditingTable(table);
    setTableName(table.name);
    setGuestCount(table.guestCount || 4);
    setFormError('');
    setShowModal(true);
  };

  const handleSaveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableName.trim()) {
      setFormError('Table name is required.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      await saveRestaurantTable(
        {
          id: editingTable ? editingTable.id : undefined,
          name: tableName.trim(),
          guestCount: Number(guestCount) || 4,
          status: editingTable ? editingTable.status : 'available'
        },
        tenantId
      );

      await logAuditAction(
        user.uid,
        user.name,
        editingTable ? 'TABLE_UPDATED' : 'TABLE_CREATED',
        `${editingTable ? 'Updated' : 'Added'} restaurant table "${tableName.trim()}"`
      );

      setSuccessMsg(`Table "${tableName.trim()}" saved successfully.`);
      setTimeout(() => setSuccessMsg(''), 3000);
      setShowModal(false);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save table.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (table: RestaurantTable) => {
    if (!window.confirm(`Are you sure you want to delete "${table.name}"?`)) return;
    try {
      await deleteRestaurantTable(table.id, tenantId);
      await logAuditAction(
        user.uid,
        user.name,
        'TABLE_DELETED',
        `Deleted table "${table.name}"`
      );
      setSuccessMsg(`Table "${table.name}" deleted.`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: any) {
      alert('Failed to delete table: ' + err.message);
    }
  };

  const handleResetStatus = async (table: RestaurantTable) => {
    if (!window.confirm(`Reset "${table.name}" status back to Available?`)) return;
    try {
      await updateTableStatus(table.id, 'available', undefined, undefined, undefined, tenantId);
      await logAuditAction(
        user.uid,
        user.name,
        'TABLE_RESET',
        `Manually reset "${table.name}" to Available`
      );
    } catch (err: any) {
      alert('Failed to reset table: ' + err.message);
    }
  };

  const getStatusBadge = (status: TableStatus) => {
    switch (status) {
      case 'available':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Available
          </span>
        );
      case 'occupied':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Occupied
          </span>
        );
      case 'order_pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <Clock className="w-3 h-3 text-amber-600" />
            Order Pending
          </span>
        );
      case 'served':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">
            <CheckCircle2 className="w-3 h-3 text-purple-600" />
            Served
          </span>
        );
      case 'payment_pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Payment Pending
          </span>
        );
    }
  };

  const filteredTables = filter === 'all' ? tables : tables.filter(t => t.status === filter);

  return (
    <div className={`space-y-4 ${isWaiterMode ? 'h-full flex flex-col min-h-0 overflow-hidden' : ''}`}>
      {/* Top Header */}
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600" />
            <span>Table Management</span>
          </h2>
          <p className="text-xs sm:text-sm text-gray-500">
            {isWaiterMode
              ? 'Select an available or occupied table to take customer orders'
              : 'Configure bar counters, dining tables, and monitor live dining & order statuses'}
          </p>
        </div>

        {!isWaiterMode && (
          <button
            onClick={openCreateModal}
            className="inline-flex items-center space-x-2 rounded-2xl bg-amber-600 hover:bg-amber-700 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-amber-600/30 transition-all active:scale-95 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Table</span>
          </button>
        )}
      </div>

      {successMsg && (
        <div className="shrink-0 p-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs sm:text-sm font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="shrink-0 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setFilter('all')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
            filter === 'all'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          All ({tables.length})
        </button>
        <button
          onClick={() => setFilter('available')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
            filter === 'available'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
          }`}
        >
          Available ({tables.filter(t => t.status === 'available').length})
        </button>
        <button
          onClick={() => setFilter('order_pending')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
            filter === 'order_pending'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'bg-white text-amber-700 hover:bg-amber-50 border border-amber-200'
          }`}
        >
          Order Pending ({tables.filter(t => t.status === 'order_pending').length})
        </button>
        <button
          onClick={() => setFilter('occupied')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
            filter === 'occupied'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-white text-blue-700 hover:bg-blue-50 border border-blue-200'
          }`}
        >
          Occupied ({tables.filter(t => t.status === 'occupied').length})
        </button>
        <button
          onClick={() => setFilter('served')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
            filter === 'served'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'bg-white text-purple-700 hover:bg-purple-50 border border-purple-200'
          }`}
        >
          Served ({tables.filter(t => t.status === 'served').length})
        </button>
      </div>

      {/* Grid of Tables */}
      <div className={`${isWaiterMode ? 'flex-1 min-h-0 overflow-y-auto pr-1' : ''}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {filteredTables.map((table) => (
          <div
            key={table.id}
            className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-base font-bold text-gray-900">{table.name}</h3>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                    <Users className="w-3.5 h-3.5 text-gray-400" />
                    <span>Seats {table.guestCount || 4} guests</span>
                  </div>
                </div>
                {getStatusBadge(table.status)}
              </div>

              {table.currentWaiterName && (
                <div className="mb-3 rounded-xl bg-gray-50 p-2.5 text-xs text-gray-600 border border-gray-100">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Assigned Waiter:</span>
                    <span className="font-bold text-gray-900">{table.currentWaiterName}</span>
                  </div>
                  {table.currentOrderId && (
                    <div className="flex justify-between mt-0.5">
                      <span className="text-gray-500">Active Order:</span>
                      <span className="font-mono text-amber-700 font-bold">#{table.currentOrderId.slice(-6).toUpperCase()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Card Footer & Order Action */}
            <div className="pt-3 border-t border-gray-100 flex flex-col gap-2.5">
              {onSelectTableForOrder && (
                <button
                  type="button"
                  onClick={() => onSelectTableForOrder(table)}
                  className="w-full py-2.5 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-md shadow-amber-600/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-98"
                >
                  <UtensilsCrossed className="w-4 h-4" />
                  <span>
                    {table.status === 'available' ? 'Take Customer Order' : 'Take Order / Add Items'}
                  </span>
                </button>
              )}

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEditModal(table)}
                    className="p-1.5 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                    title="Edit Table"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(table)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    title="Delete Table"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {table.status !== 'available' && (
                  <button
                    type="button"
                    onClick={() => handleResetStatus(table)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600 hover:text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-md transition-colors cursor-pointer"
                    title="Reset to Available"
                  >
                    <RotateCcw className="w-3 h-3 text-emerald-600" />
                    <span>Free Table</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredTables.length === 0 && (
        <div className="text-center py-12 bg-white rounded-2xl border border-gray-200">
          <UtensilsCrossed className="w-12 h-12 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 font-medium">No tables found matching this filter</p>
        </div>
      )}
      </div>

      {/* Table Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl transition-all">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
              <h3 className="text-lg font-bold text-gray-900">
                {editingTable ? `Edit Table: ${editingTable.name}` : 'Add New Restaurant Table'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveTable} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Table Name / Code
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Table 5, VIP 2, Counter 1"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 p-3 text-sm focus:border-amber-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Seating Capacity (Guests)
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={guestCount}
                  onChange={(e) => setGuestCount(Number(e.target.value))}
                  className="w-full rounded-xl border border-gray-300 p-3 text-sm focus:border-amber-600 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-sm font-bold text-white shadow-md cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingTable ? 'Save Changes' : 'Create Table'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
