import React from 'react';
import { useNavigate, Outlet } from 'react-router-dom';
import {
  AppBar,
  Box,
  Button,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Toolbar,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  Business as BusinessIcon,
  Assignment as AssignmentIcon,
  ListAlt as ListAltIcon,
  AttachMoney as AttachMoneyIcon,
  People as PeopleIcon,
  LocalOffer as LocalOfferIcon,
  Inventory as InventoryIcon,
  Group as GroupIcon,
  Logout as LogoutIcon,
  Receipt as ReceiptIcon,
  QueryStats as QueryStatsIcon,
  Store as StoreIcon,
  Timeline as TimelineIcon,
  ArrowBack as ArrowBackIcon,
  Backup as BackupIcon,
  LocalShipping as LocalShippingIcon,
  AccountBalance as AccountBalanceIcon,
  Person as PersonIcon,
  Email as EmailIcon,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import ChatBubble from './ChatBubble';
import ChatWindow from './ChatWindow';
import { useChat } from '../hooks/useChat';
import { Alert, Tooltip } from '@mui/material';
import { useEffect, useState } from 'react';
import { getPendingCount, syncPending } from '../services/offlineSync';

const drawerWidth = 240;

const Layout: React.FC = () => {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { isOpen, toggleChat, closeChat } = useChat();
  const [pendingCount, setPendingCount] = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const count = await getPendingCount();
        if (mounted) setPendingCount(count);
      } catch { /* noop */ }
    };
    const id = setInterval(poll, 15000);
    poll();
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const menuItems = [
    { type: 'header', text: 'Dashboard' },
    { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },

    { type: 'header', text: 'Purchasing' },
    { text: 'Purchase Orders', icon: <AssignmentIcon />, path: '/open-purchase-orders' },
    { text: 'Parts to Order', icon: <InventoryIcon />, path: '/parts-to-order' },
    { text: 'Vendors', icon: <StoreIcon />, path: '/vendors' },

    { type: 'header', text: 'Sales' },
    { text: 'Quotes', icon: <ListAltIcon />, path: '/quotes' },
    { text: 'Sales Orders', icon: <ReceiptIcon />, path: '/open-sales-orders' },
    { text: 'Customers', icon: <PeopleIcon />, path: '/customers' },

    { type: 'header', text: 'Products & Inventory' },
    { text: 'Products', icon: <LocalOfferIcon />, path: '/products' },
    { text: 'Stock', icon: <InventoryIcon />, path: '/inventory' },
    { text: 'Supply', icon: <InventoryIcon />, path: '/supply' },

    { type: 'header', text: 'Time Tracking' },
    { text: 'Attendance', icon: <TimelineIcon />, path: '/attendance' },
    { text: 'Time Tracking', icon: <TimelineIcon />, path: '/time-tracking' },
    { text: 'Time Tracking Reports', icon: <QueryStatsIcon />, path: '/time-tracking/reports' },

    { type: 'header', text: 'Settings' },
    { text: 'Business Profile', icon: <BusinessIcon />, path: '/business-profile' },
    { text: 'Employees', icon: <GroupIcon />, path: '/employees' },
    { text: 'Accounting', icon: <AttachMoneyIcon />, path: '/qbo-account-mapping' },
    { text: 'Global Variables', icon: <AttachMoneyIcon />, path: '/margin-schedule' },
    { text: 'Email Settings', icon: <EmailIcon />, path: '/email-settings' },
    { text: 'Mobile User Access', icon: <PeopleIcon />, path: '/mobile-user-access' },
    { text: 'Backup Management', icon: <BackupIcon />, path: '/backup-management' },
  ];

  // Filter menu items for Time Tracking users
  const filteredMenuItems = React.useMemo(() => {
    if (user?.access_role === 'Time Tracking') {
      return [
        { text: 'Attendance', icon: <TimelineIcon />, path: '/attendance' },
        { text: 'Time Tracking', icon: <TimelineIcon />, path: '/time-tracking' },
        { text: 'Sales Orders', icon: <ReceiptIcon />, path: '/open-sales-orders' },
      ];
    }
    // Always show Dashboard at the top as a separate section
    const dashboardSection = [
      { type: 'header', text: 'Main' },
      { text: 'Dashboard', icon: <DashboardIcon />, path: '/' },
    ];
    if (user?.access_role === 'Sales and Purchase') {
      return [
        ...dashboardSection,
        { type: 'header', text: 'Sales & Purchase' },
        { text: 'Sales Orders', icon: <ReceiptIcon />, path: '/open-sales-orders' },
        { text: 'Purchase Orders', icon: <AssignmentIcon />, path: '/open-purchase-orders' },
        { text: 'Parts to Order', icon: <InventoryIcon />, path: '/parts-to-order' },
        { type: 'header', text: 'Inventory' },
        { text: 'Stock', icon: <InventoryIcon />, path: '/inventory' },
        { text: 'Supply', icon: <InventoryIcon />, path: '/supply' },
        { type: 'header', text: 'Settings' },
        { text: 'Email Settings', icon: <EmailIcon />, path: '/email-settings' },
      ];
    }
    return menuItems;
  }, [user, menuItems]);

  const drawer = (
    <div>
      <Toolbar />
      <List>
        {filteredMenuItems.map((item, idx) =>
          item.type === 'header' ? (
            <ListSubheader key={`header-${item.text}-${idx}`} sx={{ bgcolor: 'inherit', color: 'text.secondary', fontWeight: 'bold', fontSize: 13, textAlign: 'left', pl: 2 }}>
              {item.text}
            </ListSubheader>
          ) : (
          <ListItem
            key={item.path || `${item.text}-${idx}`}
            onClick={() => {
              navigate(item.path);
              setMobileOpen(false);
            }}
            sx={{ cursor: 'pointer' }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.text} />
          </ListItem>
        ))}
      </List>
    </div>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
        }}
      >
        <Toolbar>
          <Button color="inherit" startIcon={<ArrowBackIcon />} onClick={() => navigate(-1 as number)} sx={{ mr: 2, display: { xs: 'none', sm: 'inline-flex' } }}>
            Back
          </Button>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Box sx={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
            {Boolean((window as any).__backendUnavailableSince) && (
              <Tooltip title="Backend unavailable; pending events will sync automatically when online.">
                <Box sx={{ bgcolor: 'orange', color: 'black', px: 1.5, py: 0.5, borderRadius: 1, fontSize: 12 }}>
                  Offline{pendingCount ? ` • Pending: ${pendingCount}` : ''}
                </Box>
              </Tooltip>
            )}
            {/* Autosync handled globally; no manual button */}
            <Button color="inherit" onClick={handleLogout} startIcon={<LogoutIcon />}>
            Logout
            </Button>
          </Box>
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>
      
      {/* Chat Components */}
      <ChatBubble onClick={toggleChat} isOpen={isOpen} />
      <ChatWindow isOpen={isOpen} onClose={closeChat} />
    </Box>
  );
};

export default Layout; 