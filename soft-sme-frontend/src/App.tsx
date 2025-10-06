import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { MessagingProvider } from './contexts/MessagingContext';
import theme from './theme';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import CompanyRegisterPage from './pages/CompanyRegisterPage';
import LandingPage from './pages/LandingPage';
import BusinessProfilePage from './pages/BusinessProfilePage';
import CustomerListPage from './pages/CustomerListPage';
import CustomerDetailPage from './pages/CustomerDetailPage';
import VendorListPage from './pages/VendorListPage';
import VendorDetailPage from './pages/VendorDetailPage';
import ProductDetailPage from './pages/ProductDetailPage';
import InventoryPage from './pages/InventoryPage';
import SupplyPage from './pages/SupplyPage';
import QuotePage from './pages/QuotePage';
import QuoteEditorPage from './pages/QuoteEditorPage';
import MessagingPage from './pages/MessagingPage';

// import SalesOrderPage from './pages/SalesOrderPage';

import EmployeeManagementPage from './pages/EmployeeManagementPage';
import ProfileDocumentsPage from './pages/ProfileDocumentsPage';
import MarginSchedulePage from './pages/MarginSchedulePage';
import OpenSalesOrdersPage from './pages/OpenSalesOrdersPage';
// import SalesOrderDetailPage from './pages/SalesOrderDetailPage';
import OpenSalesOrderDetailPage from './pages/OpenSalesOrderDetailPage';
import OpenPurchaseOrdersPage from './pages/OpenPurchaseOrdersPage';
import OpenPurchaseOrderDetailPage from './pages/OpenPurchaseOrderDetailPage';
import WokerSalesOrderPage from './pages/WokerSalesOrderPage';
import TimeTrackingPage from './pages/TimeTrackingPage';
import TimeTrackingReportsPage from './pages/TimeTrackingReportsPage';
import LeaveManagementPage from './pages/LeaveManagementPage';
import LeaveHistoryPage from './pages/LeaveHistoryPage';
import VacationDaysManagementPage from './pages/VacationDaysManagementPage';
import ProductsPage from './pages/ProductsPage';
import BackupManagementPage from './pages/BackupManagementPage';
import AttendancePage from './pages/AttendancePage';
import QBOAccountMappingPage from './pages/QBOAccountMappingPage';
import OverheadManagementPage from './pages/OverheadManagementPage';
import PartsToOrderPage from './pages/PartsToOrderPage';
import MobileUserAccessPage from './pages/MobileUserAccessPage';
import UserEmailSettingsPage from './pages/UserEmailSettingsPage';
import EmailTemplatesPage from './pages/EmailTemplatesPage';
import TaskDetailPage from './pages/TaskDetailPage';
import TasksDashboardPage from './pages/TasksDashboardPage';
import { useEffect, useState } from 'react';
import { syncPending, getPendingCount } from './services/offlineSync';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// Protected Route Component
const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  const path = location.pathname;
  
  if (!isAuthenticated) return <Navigate to="/login" replace />; // Redirect to login if not authenticated
  
  if (user?.access_role === 'Time Tracking') {
    // Redirect time tracking users to attendance if they try to access the landing page
    if (path === '/' || path === '/dashboard') {
      return <Navigate to="/attendance" replace />;
    }
    // Only allow /time-tracking, /attendance, /open-sales-orders, and /woker-sales-orders
    if (path !== '/time-tracking' && path !== '/attendance' && !path.startsWith('/open-sales-orders') && !path.startsWith('/woker-sales-orders')) {
      return <Navigate to="/attendance" replace />;
    }
  }
  
  if (user?.access_role === 'Sales and Purchase') {
    const allowed = [
      '/',
      '/open-sales-orders',
      '/open-purchase-orders',
      '/purchase-order',
      '/parts-to-order',
      '/inventory',
      '/supply',
      '/email-settings',
      '/tasks',
    ];
    // Allow paths that start with /open-sales-orders/, /open-purchase-orders/, /purchase-order/ (for detail pages)
    if (
      !allowed.includes(path) &&
      !path.startsWith('/open-sales-orders/') &&
      !path.startsWith('/open-purchase-orders/') &&
      !path.startsWith('/purchase-order/')
    ) {
      return <Navigate to="/" replace />;
    }
  }
  // Allow Admins to access all pages, including /employee-management
  // (No restriction block for Admin)
  if (user?.access_role === 'Quotes') {
    // Allow list and editor/detail routes under /quotes
    if (path !== '/quotes' && !path.startsWith('/quotes/')) {
      return <Navigate to="/quotes" replace />;
    }
  }
  return <>{children}</>;
};

const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<CompanyRegisterPage />} />

      {/* Protected Routes */}
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<LandingPage />} />
        <Route path="dashboard" element={<LandingPage />} />
        
        {/* Business Profile */}
        <Route path="business-profile" element={<BusinessProfilePage />} />
        <Route path="qbo-account-mapping" element={<QBOAccountMappingPage />} />
        
        {/* Customer Management */}
        <Route path="customers" element={<CustomerListPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        
        {/* Product Management */}
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/:id" element={<ProductDetailPage />} />
        
        {/* Purchase Management */}
        <Route path="purchase-order" element={<OpenPurchaseOrdersPage />} />
        <Route path="purchase-order/:id" element={<OpenPurchaseOrderDetailPage />} />
        <Route path="open-purchase-orders" element={<OpenPurchaseOrdersPage />} />
        <Route path="open-purchase-orders/:id" element={<OpenPurchaseOrderDetailPage />} />
        
        {/* Vendor Management */}
        <Route path="vendors" element={<VendorListPage />} />
        <Route path="vendors/:id" element={<VendorDetailPage />} />
        
        {/* Inventory */}
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="supply" element={<SupplyPage />} />
        
        {/* Employee Management */}
        <Route path="employees" element={<EmployeeManagementPage />} />
        <Route path="profile-documents" element={<ProfileDocumentsPage />} />
        
        {/* Time Tracking */}
        <Route path="time-tracking" element={<TimeTrackingPage />} />
        <Route path="attendance" element={<AttendancePage />} />
        <Route path="time-tracking/reports" element={<TimeTrackingReportsPage />} />
        
        {/* Leave Management */}
        <Route path="leave-management" element={<LeaveManagementPage />} />
        <Route path="leave-history" element={<LeaveHistoryPage />} />
        <Route path="vacation-days-management" element={<VacationDaysManagementPage />} />
        
        {/* Sales Management */}
        {/* Removed legacy SalesOrder create/detail routes in favor of OpenSalesOrderDetailPage */}
        {/* <Route path="sales-order" element={<SalesOrderPage />} /> */}
        {/* <Route path="sales-order/:id" element={<SalesOrderDetailPage />} /> */}
        <Route path="open-sales-orders" element={<OpenSalesOrdersPage />} />
        <Route path="open-sales-orders/:id" element={<OpenSalesOrderDetailPage />} />
        <Route path="woker-sales-orders" element={<WokerSalesOrderPage />} />
        <Route path="woker-sales-orders/:id" element={<WokerSalesOrderPage />} />
        
         {/* Quotes */}
         <Route path="quotes" element={<QuotePage />} />
         <Route path="quotes/new" element={<QuoteEditorPage />} />
         <Route path="quotes/:id" element={<QuoteEditorPage />} />

        
        {/* Margin Schedule */}
        <Route path="margin-schedule" element={<MarginSchedulePage />} />
        
        {/* Overhead Management */}
        <Route path="overhead-management" element={<OverheadManagementPage />} />
        
        {/* Parts to Order */}
        <Route path="parts-to-order" element={<PartsToOrderPage />} />

        {/* Tasks */}
        <Route path="tasks" element={<TasksDashboardPage />} />
        
        {/* System Management */}
        <Route path="backup-management" element={<BackupManagementPage />} />
        
        {/* Mobile User Access Management */}
        <Route path="mobile-user-access" element={<MobileUserAccessPage />} />
        
        {/* Email Settings */}
        <Route path="email-settings" element={<UserEmailSettingsPage />} />
        
        {/* Email Templates */}
        <Route path="email-templates" element={<EmailTemplatesPage />} />

        {/* Tasks */}
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        {/* Messaging */}
        <Route path="messaging" element={<MessagingPage />} />
      </Route>

      {/* Catch all route */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App: React.FC = () => {
  const [pending, setPending] = useState<number>(0);

  useEffect(() => {
    (window as any).__triggerSync = async () => {
      try {
        const count = await getPendingCount();
        if (count > 0 && !(window as any).__backendUnavailableSince) {
          await syncPending();
          setPending(await getPendingCount());
        }
      } catch { /* noop */ }
    };
    let mounted = true;
    const poll = async () => {
      try {
        const count = await getPendingCount();
        if (mounted) setPending(count);
        // Try to sync if backend is available
        if (!(window as any).__backendUnavailableSince && count > 0) {
          await syncPending();
          const after = await getPendingCount();
          if (mounted) setPending(after);
        }
      } catch {}
    };
    const id = setInterval(poll, 15000);
    poll();
    return () => { mounted = false; clearInterval(id); };
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <MessagingProvider>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <Router>
              <AppRoutes />
            </Router>
            <ToastContainer position="top-right" autoClose={3000} newestOnTop={false} closeOnClick pauseOnFocusLoss draggable pauseOnHover theme="colored" />
          </LocalizationProvider>
        </MessagingProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
