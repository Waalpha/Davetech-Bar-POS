import React, { useState, useEffect } from 'react';
import { UserProfile, BusinessConfig, RestaurantTable } from '../../types';
import { DEFAULT_BUSINESS_ID } from '../../lib/firebase';
import {
  UtensilsCrossed,
  Clock,
  CheckCircle2,
  LogOut,
  Maximize2,
  Minimize2,
  Grid,
  Wine
} from 'lucide-react';
import { OfflineStatusIndicator } from '../common/OfflineStatusIndicator';
import { WaiterOrderScreen } from './WaiterOrderScreen';
import { WaiterOrdersList } from './WaiterOrdersList';
import { TablesView } from '../admin/TablesView';
import { subscribeOrders } from '../../lib/orderService';

type WaiterTab = 'new_order' | 'pending' | 'tables' | 'completed';

interface WaiterLayoutProps {
  user: UserProfile;
  businessConfig?: BusinessConfig | null;
  activeTab?: WaiterTab;
  setActiveTab?: (tab: WaiterTab) => void;
  pendingCount?: number;
  onLogout: () => void;
  children?: React.ReactNode;
}

export function WaiterLayout({
  user,
  businessConfig,
  activeTab: controlledActiveTab,
  setActiveTab: controlledSetActiveTab,
  pendingCount: controlledPendingCount,
  onLogout,
  children
}: WaiterLayoutProps) {
  const [internalTab, setInternalTab] = useState<WaiterTab>('new_order');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [livePendingCount, setLivePendingCount] = useState(0);
  const [selectedTableForOrder, setSelectedTableForOrder] = useState<RestaurantTable | null>(null);

  const activeTab = controlledActiveTab !== undefined ? controlledActiveTab : internalTab;
  const setActiveTab = controlledSetActiveTab || setInternalTab;

  useEffect(() => {
    const tenantId = user.businessId || DEFAULT_BUSINESS_ID;
    const unsub = subscribeOrders(tenantId, (orders) => {
      // Pending orders submitted by this waiter
      const myPending = orders.filter(
        (o) =>
          o.waiterId === user.uid &&
          o.orderStatus !== 'completed' &&
          o.orderStatus !== 'cancelled'
      );
      setLivePendingCount(myPending.length);
    });
    return () => unsub();
  }, [user.businessId, user.uid]);

  const pendingCount =
    controlledPendingCount !== undefined ? controlledPendingCount : livePendingCount;

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
      console.warn('Fullscreen request failed:', err);
      setIsFullscreen((prev) => !prev);
    }
  };

  const handleSignOut = () => {
    onLogout();
  };

  const navItems = [
    { id: 'new_order', label: 'Take Customer Order', icon: UtensilsCrossed, highlight: true },
    {
      id: 'pending',
      label: 'My Orders (Pending)',
      icon: Clock,
      badge: pendingCount
    },
    { id: 'tables', label: 'Table Status', icon: Grid },
    { id: 'completed', label: 'Completed Orders', icon: CheckCircle2 }
  ];

  return (
    <div className="h-screen h-[100dvh] w-full bg-slate-100 flex flex-col font-sans select-none overflow-hidden">
      {/* Sleek, Viewport-Optimized Header */}
      <header className="shrink-0 bg-slate-900 text-white shadow-md z-40">
        <div className="w-full px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2">
          {/* Brand & Server Info */}
          <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
              <Wine className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
            </div>
            <div className="truncate">
              <div className="flex items-center gap-1.5">
                <span className="text-xs sm:text-sm font-bold tracking-tight text-white truncate">
                  {businessConfig?.name || 'Club Paxx'}
                </span>
                <span className="hidden sm:inline-block text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                  Waiter POS
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
                Server: <strong className="text-amber-300 font-semibold">{user.name}</strong>
              </p>
            </div>
          </div>

          {/* Desktop/Tablet Navigation Tabs (Integrated directly in header row) */}
          <div className="hidden md:flex items-center space-x-1.5 overflow-x-auto py-1 scrollbar-none">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as WaiterTab)}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? item.highlight
                        ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                        : 'bg-slate-800 text-white border border-slate-700 shadow-xs'
                      : item.highlight
                      ? 'bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 border border-amber-500/30'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="ml-1 px-1.5 py-0.2 text-[10px] font-black rounded-full bg-amber-500 text-slate-950">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right Actions: Offline Status, Fullscreen, Logout */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
            <OfflineStatusIndicator />

            {/* Fullscreen Toggle */}
            <button
              onClick={toggleFullscreen}
              className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-amber-300 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden lg:inline text-[11px]">Window</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden lg:inline text-[11px]">Full Screen</span>
                </>
              )}
            </button>

            {/* Logout */}
            <button
              id="waiter-signout-btn"
              onClick={handleSignOut}
              title="Sign Out"
              className="flex items-center space-x-1 bg-slate-800 hover:bg-red-950/40 hover:text-red-300 text-slate-200 px-2.5 py-1.5 rounded-xl text-xs font-bold border border-slate-700 hover:border-red-500/40 transition-all cursor-pointer active:scale-95"
            >
              <LogOut className="w-3.5 h-3.5 text-red-400" />
              <span className="hidden sm:inline text-[11px]">Sign Out</span>
            </button>
          </div>
        </div>

        {/* Mobile Navigation Bar (visible only on < md screens) */}
        <div className="md:hidden bg-slate-800 border-t border-slate-700/80 px-2 py-1">
          <div className="flex items-center space-x-1 overflow-x-auto scrollbar-none">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as WaiterTab)}
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? item.highlight
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-700 text-white'
                      : 'text-slate-300 hover:bg-slate-700/50'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="ml-1 px-1.5 py-0.2 text-[9px] font-black rounded-full bg-amber-500 text-slate-950">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Main Viewport Content Area - 100% fits screen with zero outer scrollbar */}
      <main className="flex-1 w-full min-h-0 overflow-hidden p-2 sm:p-2.5">
        {children ? (
          children
        ) : (
          <>
            {activeTab === 'new_order' && (
              <WaiterOrderScreen
                user={user}
                businessConfig={businessConfig}
                initialTable={selectedTableForOrder}
                onOrderSubmitted={() => {
                  setSelectedTableForOrder(null);
                  setActiveTab('pending');
                }}
              />
            )}
            {activeTab === 'pending' && (
              <WaiterOrdersList
                user={user}
                businessConfig={businessConfig}
                initialFilter="pending"
                onNewOrderClick={() => {
                  setSelectedTableForOrder(null);
                  setActiveTab('new_order');
                }}
              />
            )}
            {activeTab === 'tables' && (
              <TablesView
                user={user}
                businessConfig={businessConfig}
                isWaiterMode={true}
                onSelectTableForOrder={(table) => {
                  setSelectedTableForOrder(table);
                  setActiveTab('new_order');
                }}
              />
            )}
            {activeTab === 'completed' && (
              <WaiterOrdersList
                user={user}
                businessConfig={businessConfig}
                initialFilter="completed"
                onNewOrderClick={() => {
                  setSelectedTableForOrder(null);
                  setActiveTab('new_order');
                }}
              />
            )}
          </>
        )}
      </main>

      {/* Ultra-Slim Davetech Solutions Footer */}
      <footer className="shrink-0 w-full py-1 px-4 bg-white/90 border-t border-slate-200 text-center select-none text-[11px] text-slate-400 font-medium">
        Copyright © {new Date().getFullYear()} Davetech Solutions
      </footer>
    </div>
  );
}
