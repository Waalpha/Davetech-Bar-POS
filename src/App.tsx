import React, { useEffect, useState, useRef, useCallback } from 'react';
import { auth, db, DEFAULT_BUSINESS_ID } from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { UserProfile, BusinessConfig } from './types';
import { initializeDatabase } from './lib/dbSeeder';
import { logAuditAction } from './lib/utils';

import { Login } from './components/auth/Login';
import { CashierLayout } from './components/cashier/CashierLayout';
import { CashierDashboard } from './components/cashier/CashierDashboard';
import { RecordSaleView } from './components/cashier/RecordSaleView';
import { CashierSalesView } from './components/cashier/CashierSalesView';
import { CashierStockView } from './components/cashier/CashierStockView';
import { DailyOpeningView } from './components/cashier/DailyOpeningView';
import { DailyClosingView } from './components/cashier/DailyClosingView';
import { WaiterOrdersView } from './components/cashier/WaiterOrdersView';
import { CashierExpensesView } from './components/cashier/CashierExpensesView';

import { WaiterLayout } from './components/waiter/WaiterLayout';

import { AdminLayout } from './components/admin/AdminLayout';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { ProductsView } from './components/admin/ProductsView';
import { StockView } from './components/admin/StockView';
import { SalesReportsView } from './components/admin/SalesReportsView';
import { AdminExpensesView } from './components/admin/AdminExpensesView';
import { ClosingsView } from './components/admin/ClosingsView';
import { CashiersView } from './components/admin/CashiersView';
import { AuditLogsView } from './components/admin/AuditLogsView';
import { SettingsView } from './components/admin/SettingsView';
import { PrinterSettingsView } from './components/admin/PrinterSettingsView';
import { TablesView } from './components/admin/TablesView';
import { WaiterPerformanceView } from './components/admin/WaiterPerformanceView';

const DEFAULT_BIZ_CONFIG: BusinessConfig = {
  id: DEFAULT_BUSINESS_ID,
  name: "Club Paxx",
  phone: "+254 712 345 678",
  tillNumber: "5849201",
  location: "Nairobi CBD",
  address: "Tom Mboya Street, Nairobi",
  currency: "KSh",
  openingTime: "10:00",
  closingTime: "23:59",
  lowStockThreshold: 10,
  receiptHeader: "CLUB PAXX\nOfficial Bar & Restaurant",
  receiptFooter: "Thank you! Please drink responsibly.\nPowered by Davetech Solutions"
};

export default function App() {
  // Try to load cached user synchronously to avoid even 1 frame of blank/loading state
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => {
    try {
      const localUserStr = localStorage.getItem('bar_pos_local_user');
      if (localUserStr) {
        const parsed = JSON.parse(localUserStr);
        if (parsed && parsed.uid && parsed.role && parsed.uid !== 'local-user-cashier' && parsed.email !== 'cashier@barpos.com') {
          return parsed;
        }
      }
    } catch (e) {
      // ignore
    }
    return null;
  });

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(() => {
    if (userProfile) {
      return { uid: userProfile.uid, email: userProfile.email } as any;
    }
    return null;
  });

  const [businessConfig, setBusinessConfig] = useState<BusinessConfig>(() => {
    try {
      const localBiz = localStorage.getItem('bar_pos_business_config');
      if (localBiz) return JSON.parse(localBiz);
    } catch (e) {
      // ignore
    }
    return DEFAULT_BIZ_CONFIG;
  });

  // If we already have a user in localStorage, loading is false instantly (0ms delay)
  const [loading, setLoading] = useState<boolean>(() => {
    try {
      const localUserStr = localStorage.getItem('bar_pos_local_user');
      if (localUserStr) {
        const parsed = JSON.parse(localUserStr);
        if (parsed?.uid && parsed?.role && parsed.uid !== 'local-user-cashier') {
          return false;
        }
      }
    } catch (e) {
      // ignore
    }
    return true;
  });

  // Navigation tab states
  const [cashierTab, setCashierTab] = useState<'dashboard' | 'sell' | 'waiter_orders' | 'opening_stock' | 'stock' | 'closing' | 'sales' | 'expenses'>('dashboard');
  const [adminTab, setAdminTab] = useState<string>('dashboard');

  const isLoggingOutRef = useRef<boolean>(false);

  // Centralized, bulletproof logout handler
  const handleLogout = useCallback(() => {
    isLoggingOutRef.current = true;

    // 1. Immediately wipe all local user credentials so onAuthStateChanged/page reloads never auto-restore
    try {
      localStorage.removeItem('bar_pos_local_user');
      sessionStorage.removeItem('bar_pos_local_user');
    } catch (e) {
      console.warn('Failed clearing user from storage:', e);
    }

    // 2. Fire audit log in background (non-blocking, never awaits so it never delays UI)
    const currentUser = userProfile;
    if (currentUser) {
      logAuditAction(
        currentUser.uid,
        currentUser.name,
        'LOGOUT',
        `${currentUser.name} (${currentUser.role}) logged out`
      ).catch(() => {});
    }

    // 3. Immediately reset state to render Login screen synchronously
    setFirebaseUser(null);
    setUserProfile(null);
    setCashierTab('dashboard');
    setAdminTab('dashboard');

    // 4. Trigger Firebase auth signOut safely
    auth.signOut().catch((err) => {
      console.warn('Firebase signOut non-critical error:', err);
    }).finally(() => {
      // Release logout lock after debounce
      setTimeout(() => {
        isLoggingOutRef.current = false;
      }, 500);
    });
  }, [userProfile]);

  useEffect(() => {
    // 1. Strict safety watchdog: never allow the loading screen to linger for more than 600ms
    const safetyWatchdog = setTimeout(() => {
      setLoading(false);
    }, 600);

    // 2. Fetch business config in background non-blocking
    getDoc(doc(db, 'businesses', DEFAULT_BUSINESS_ID)).then(bizSnap => {
      if (bizSnap.exists()) {
        const data = bizSnap.data() as BusinessConfig;
        setBusinessConfig(data);
        try {
          localStorage.setItem('bar_pos_business_config', JSON.stringify(data));
        } catch (e) {}
      }
    }).catch(() => {});

    // 3. Fast non-blocking Firebase Auth check
    const unsubscribe = onAuthStateChanged(auth, (fUser) => {
      clearTimeout(safetyWatchdog);

      // If user is intentionally logging out, do not restore state
      if (isLoggingOutRef.current) {
        setFirebaseUser(null);
        setUserProfile(null);
        setLoading(false);
        return;
      }

      if (fUser) {
        setFirebaseUser(fUser);
        initializeDatabase(fUser).catch(() => {});

        // If we already had a userProfile from cache, keep it active and don't block
        setUserProfile((prev) => {
          if (prev) return prev;
          const email = fUser.email || '';
          const role = email.includes('cashier') ? 'cashier' : email.includes('waiter') ? 'waiter' : 'admin';
          return {
            uid: fUser.uid,
            email: email,
            name: fUser.displayName || (role === 'admin' ? 'Master Admin' : 'Staff'),
            role: role,
            businessId: DEFAULT_BUSINESS_ID,
            status: 'active',
            createdAt: new Date().toISOString()
          };
        });

        // Background update profile without delaying the UI
        getDoc(doc(db, 'users', fUser.uid)).then((userSnap) => {
          if (userSnap.exists()) {
            const freshUser = userSnap.data() as UserProfile;
            setUserProfile(freshUser);
            try {
              localStorage.setItem('bar_pos_local_user', JSON.stringify(freshUser));
            } catch (e) {}
          }
        }).catch(() => {});

        setLoading(false);
      } else {
        if (isLoggingOutRef.current) {
          setFirebaseUser(null);
          setUserProfile(null);
          setLoading(false);
          return;
        }

        // Not logged in with Firebase Auth; check if local user exists
        try {
          const localStr = localStorage.getItem('bar_pos_local_user');
          if (localStr) {
            const local = JSON.parse(localStr);
            if (local && local.uid && local.uid !== 'local-user-cashier' && local.email !== 'cashier@barpos.com') {
              setUserProfile(local);
              setFirebaseUser({ uid: local.uid, email: local.email } as any);
              setLoading(false);
              return;
            }
          }
        } catch (e) {}

        setFirebaseUser(null);
        setUserProfile(null);
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(safetyWatchdog);
      unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="text-center space-y-4 max-w-sm px-6">
          <div className="w-10 h-10 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <div>
            <h3 className="text-base font-bold text-slate-100">Club Paxx POS</h3>
            <p className="text-xs text-slate-400 mt-1">Starting up fast & offline-ready...</p>
          </div>
          <button
            onClick={() => setLoading(false)}
            className="text-xs text-amber-400 hover:text-amber-300 font-medium underline cursor-pointer pt-2"
          >
            Skip to Login
          </button>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !userProfile) {
    return (
      <Login
        onLoginSuccess={(user) => {
          setUserProfile(user);
          setFirebaseUser({ uid: user.uid, email: user.email } as any);
          if (!businessConfig) {
            getDoc(doc(db, 'businesses', DEFAULT_BUSINESS_ID)).then((bizSnap) => {
              if (bizSnap.exists()) {
                setBusinessConfig(bizSnap.data() as BusinessConfig);
              }
            }).catch(() => {});
          }
        }}
      />
    );
  }

  // Render Waiter Interface
  if (userProfile.role === 'waiter') {
    return (
      <WaiterLayout
        user={userProfile}
        businessConfig={businessConfig}
        onLogout={handleLogout}
      />
    );
  }

  // Render Cashier Interface
  if (userProfile.role === 'cashier') {
    return (
      <CashierLayout
        user={userProfile}
        businessConfig={businessConfig}
        activeTab={cashierTab}
        setActiveTab={setCashierTab}
        onLogout={handleLogout}
      >
        {cashierTab === 'dashboard' && (
          <CashierDashboard
            user={userProfile}
            businessConfig={businessConfig}
            setActiveTab={setCashierTab}
          />
        )}
        {cashierTab === 'sell' && (
          <RecordSaleView
            user={userProfile}
            businessConfig={businessConfig}
            onNavigateToWaiterOrders={() => setCashierTab('waiter_orders')}
          />
        )}
        {cashierTab === 'waiter_orders' && (
          <WaiterOrdersView
            user={userProfile}
            businessConfig={businessConfig}
          />
        )}
        {cashierTab === 'opening_stock' && (
          <DailyOpeningView
            user={userProfile}
            businessConfig={businessConfig}
            onComplete={() => setCashierTab('dashboard')}
            onNavigateToPOS={() => setCashierTab('sell')}
          />
        )}
        {cashierTab === 'stock' && (
          <CashierStockView
            user={userProfile}
            businessConfig={businessConfig}
            onNavigateToOpening={() => setCashierTab('opening_stock')}
            onNavigateToClosing={() => setCashierTab('closing')}
          />
        )}
        {cashierTab === 'closing' && (
          <DailyClosingView
            user={userProfile}
            businessConfig={businessConfig}
            onNavigateToDashboard={() => setCashierTab('dashboard')}
            onNavigateToPOS={() => setCashierTab('sell')}
          />
        )}
        {cashierTab === 'sales' && (
          <CashierSalesView
            user={userProfile}
            businessConfig={businessConfig}
          />
        )}
        {cashierTab === 'expenses' && (
          <CashierExpensesView
            user={userProfile}
            businessConfig={businessConfig}
          />
        )}
      </CashierLayout>
    );
  }

  // Render Admin Interface
  return (
    <AdminLayout
      user={userProfile}
      businessConfig={businessConfig}
      activeTab={adminTab}
      setActiveTab={setAdminTab}
      onLogout={handleLogout}
    >
      {adminTab === 'dashboard' && (
        <AdminDashboard
          user={userProfile}
          businessConfig={businessConfig}
          onNavigate={(tab) => setAdminTab(tab)}
        />
      )}
      {adminTab === 'pos' && (
        <RecordSaleView
          user={userProfile}
          businessConfig={businessConfig}
          onNavigateToWaiterOrders={() => setAdminTab('waiter_orders')}
        />
      )}
      {adminTab === 'waiter_orders' && (
        <WaiterOrdersView
          user={userProfile}
          businessConfig={businessConfig}
        />
      )}
      {adminTab === 'tables' && (
        <TablesView
          user={userProfile}
          businessConfig={businessConfig}
          onSelectTableForOrder={(table) => {
            setAdminTab('waiter_orders');
          }}
        />
      )}
      {adminTab === 'waiter_performance' && (
        <WaiterPerformanceView
          user={userProfile}
          businessConfig={businessConfig}
        />
      )}
      {adminTab === 'products' && (
        <ProductsView
          user={userProfile}
          businessConfig={businessConfig}
        />
      )}
      {adminTab === 'stock' && (
        <StockView
          user={userProfile}
          businessConfig={businessConfig}
        />
      )}
      {adminTab === 'sales' && (
        <SalesReportsView
          user={userProfile}
          businessConfig={businessConfig}
        />
      )}
      {adminTab === 'expenses' && (
        <AdminExpensesView
          user={userProfile}
          businessConfig={businessConfig}
        />
      )}
      {adminTab === 'closings' && (
        <ClosingsView
          user={userProfile}
          businessConfig={businessConfig}
        />
      )}
      {adminTab === 'cashiers' && (
        <CashiersView
          user={userProfile}
          businessConfig={businessConfig}
        />
      )}
      {adminTab === 'audit' && (
        <AuditLogsView
          user={userProfile}
          businessConfig={businessConfig}
        />
      )}
      {adminTab === 'printer' && (
        <PrinterSettingsView
          user={userProfile}
          businessConfig={businessConfig}
          onConfigUpdated={(newCfg) => setBusinessConfig(newCfg)}
        />
      )}
      {adminTab === 'settings' && (
        <SettingsView
          user={userProfile}
          businessConfig={businessConfig}
          onConfigUpdated={(newCfg) => setBusinessConfig(newCfg)}
        />
      )}
    </AdminLayout>
  );
}
