import React, { useState, useEffect } from 'react';
import { UserProfile, BusinessConfig } from '../../types';
import { DEFAULT_BUSINESS_ID } from '../../lib/firebase';
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Package,
  CalendarCheck,
  LogOut,
  Wine,
  Maximize2,
  Minimize2,
  UtensilsCrossed,
  Sunrise,
  Wallet
} from 'lucide-react';
import { OfflineStatusIndicator } from '../common/OfflineStatusIndicator';
import { subscribeOrders } from '../../lib/orderService';

export type CashierTab = 'dashboard' | 'sell' | 'waiter_orders' | 'opening_stock' | 'stock' | 'closing' | 'sales' | 'expenses';

interface CashierLayoutProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
  activeTab: CashierTab;
  setActiveTab: (tab: CashierTab) => void;
  onLogout: () => void;
  children?: React.ReactNode;
}

export function CashierLayout({
  user,
  businessConfig,
  activeTab,
  setActiveTab,
  onLogout,
  children
}: CashierLayoutProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);

  useEffect(() => {
    const tenantId = user.businessId || DEFAULT_BUSINESS_ID;
    const unsub = subscribeOrders(tenantId, (orders) => {
      const pending = orders.filter(
        o => o.orderStatus !== 'completed' && o.orderStatus !== 'cancelled'
      ).length;
      setPendingOrdersCount(pending);
    });
    return () => unsub();
  }, [user.businessId]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen?.();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.warn('Fullscreen request failed or restricted:', err);
      setIsFullscreen(prev => !prev);
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', shortLabel: 'Dashboard', icon: LayoutDashboard },
    { id: 'sell', label: 'POS (Record Sale)', shortLabel: 'POS (Sell)', icon: ShoppingCart, highlight: true },
    {
      id: 'waiter_orders',
      label: 'Waiter Orders',
      shortLabel: 'Waiter Orders',
      icon: UtensilsCrossed,
      badge: pendingOrdersCount > 0 ? pendingOrdersCount : undefined,
      badgeColor: 'bg-amber-400 text-slate-950 font-black animate-pulse'
    },
    { id: 'expenses', label: 'Expenses', shortLabel: 'Expenses', icon: Wallet },
    { id: 'opening_stock', label: 'Opening Stock', shortLabel: 'Opening', icon: Sunrise },
    { id: 'stock', label: 'Stock Status', shortLabel: 'Stock', icon: Package },
    { id: 'closing', label: 'Closing Stock', shortLabel: 'Closing', icon: CalendarCheck },
    { id: 'sales', label: "Today's Sales", shortLabel: 'Sales', icon: Receipt },
  ];

  return (
    <div className="h-screen h-[100dvh] w-full bg-slate-100 flex flex-col font-sans select-none overflow-hidden">
      {/* Sleek, Viewport-Optimized Header */}
      <header className="shrink-0 bg-slate-900 text-white shadow-md z-40">
        {/* Top Tier: Brand, Server info, Offline status, Fullscreen, Logout */}
        <div className="w-full px-2.5 sm:px-4 h-11 sm:h-12 flex items-center justify-between gap-2 border-b border-slate-800">
          <div className="flex items-center space-x-2 sm:space-x-3 shrink-0 min-w-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
              <Wine className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" />
            </div>
            <div className="truncate min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs sm:text-sm font-bold tracking-tight text-white truncate">
                  {businessConfig?.name || 'Club Paxx'}
                </span>
                <span className="text-[10px] font-bold text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded-md border border-amber-500/25 shrink-0">
                  Cashier POS
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
                Cashier: <strong className="text-slate-200">{user.name}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
            <OfflineStatusIndicator />

            <div className="hidden md:block text-right pr-1">
              <span className="text-[10px] text-slate-400">Cur: </span>
              <strong className="text-xs font-bold text-amber-400 font-mono">
                {businessConfig?.currency || 'KSh'}
              </strong>
            </div>

            {/* Full Screen Toggle Button */}
            <button
              onClick={toggleFullscreen}
              className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-amber-300 p-1.5 sm:px-2.5 sm:py-1 rounded-xl text-xs font-semibold border border-slate-700 transition-all cursor-pointer active:scale-95 shadow-xs"
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              id="cashier-fullscreen-toggle"
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden xl:inline text-[11px]">Window</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden xl:inline text-[11px]">Full Screen</span>
                </>
              )}
            </button>

            {/* Sign Out Button */}
            <button
              id="cashier-signout-btn"
              onClick={onLogout}
              title="Sign Out"
              className="flex items-center space-x-1 bg-slate-800 hover:bg-red-950/40 hover:text-red-300 text-slate-200 px-2 sm:px-2.5 py-1 rounded-xl text-xs font-bold border border-slate-700 hover:border-red-500/40 transition-all active:scale-95 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 text-red-400" />
              <span className="hidden sm:inline text-[11px]">Sign Out</span>
            </button>
          </div>
        </div>

        {/* Second Tier: Navigation Tabs Bar - 100% VISIBLE ON ONE PAGE WITH ZERO HIDDEN BUTTONS! */}
        <div className="bg-slate-800/95 px-1.5 sm:px-2 py-1">
          {/* Responsive Grid: 4 cols on mobile/tablet (2 rows x 4), 8 cols on desktop (1 row x 8) */}
          <div className="w-full grid grid-cols-4 lg:grid-cols-8 gap-1 sm:gap-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`cashier-nav-${item.id}`}
                  onClick={() => setActiveTab(item.id as CashierTab)}
                  className={`flex items-center justify-center space-x-1 sm:space-x-1.5 px-1.5 sm:px-2 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition-all cursor-pointer relative ${
                    isActive
                      ? item.highlight
                        ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 ring-1 ring-amber-400'
                        : 'bg-slate-700 text-white shadow-xs ring-1 ring-slate-500'
                      : item.highlight
                      ? 'bg-amber-600/20 text-amber-300 hover:bg-amber-600/35 border border-amber-500/30'
                      : 'text-slate-300 hover:bg-slate-700/70 hover:text-white bg-slate-900/40'
                  }`}
                  title={item.label}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    <span className="hidden xl:inline">{item.label}</span>
                    <span className="xl:hidden">{item.shortLabel}</span>
                  </span>
                  {item.badge !== undefined && (
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black shrink-0 ${item.badgeColor || 'bg-amber-400 text-slate-950'}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Main Content Area - 100% fits screen with zero outer scrollbar */}
      <main className="flex-1 w-full min-h-0 overflow-hidden p-2 sm:p-2.5">
        {children}
      </main>

      {/* Ultra-Slim Davetech Solutions Footer */}
      <footer className="shrink-0 w-full py-1 px-4 bg-white/90 border-t border-slate-200 text-center select-none text-[11px] text-slate-400 font-medium">
        Copyright © {new Date().getFullYear()} Davetech Solutions
      </footer>
    </div>
  );
}
