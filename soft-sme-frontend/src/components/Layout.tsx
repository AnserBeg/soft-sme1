import React from 'react';
import { useNavigate, Outlet, useLocation } from 'react-router-dom';
import {
  AppBar,
  Box,
  Badge,
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
  AssignmentReturn as AssignmentReturnIcon,
  AssignmentTurnedIn as AssignmentTurnedInIcon,
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
  Event as CalendarIcon,
  ArrowBack as ArrowBackIcon,
  Backup as BackupIcon,
  LocalShipping as LocalShippingIcon,
  AccountBalance as AccountBalanceIcon,
  Person as PersonIcon,
  Email as EmailIcon,
  Description as DescriptionIcon,
  Chat as ChatIcon,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { Tooltip } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { getPendingCount } from '../services/offlineSync';
import { useMessaging } from '../contexts/MessagingContext';
import AssistantWidget from './AssistantWidget';

const drawerWidth = 240;
const defaultAssistantWidth = 360;
const assistantPanelRightOffset = 0;
const assistantDesktopTopOffset = 0;
const assistantDesktopBottomOffset = 0;
const assistantResizeHandleWidth = 12;
const minAssistantWidth = 280;
const maxAssistantWidth = 640;

const Layout: React.FC = () => {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const { unreadConversationCount } = useMessaging();
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantWidth, setAssistantWidth] = useState(defaultAssistantWidth);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const count = await getPendingCount();
        if (mounted) setPendingCount(count);
      } catch {
        /* noop */
      }
    };
    const id = setInterval(poll, 15000);
    poll();
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  type HeaderMenuEntry = { type: 'header'; text: string };
  type NavigationMenuEntry = { text: string; icon: React.ReactNode; path: string; showUnreadDot?: boolean };
  type MenuEntry = HeaderMenuEntry | NavigationMenuEntry;

  const isHeaderItem = (entry: MenuEntry): entry is HeaderMenuEntry =>
    'type' in entry && entry.type === 'header';

  const messageMenuItem = useMemo<MenuEntry>(
    () => ({
      text: 'Messages',
      icon: <ChatIcon />,
      path: '/messaging',
      showUnreadDot: unreadConversationCount > 0,
    }),
    [unreadConversationCount],
  );

  const resolveNavigationPath = (targetPath: string): string => targetPath;

  const menuItems = useMemo<MenuEntry[]>(
    () => [
      { type: 'header', text: 'Dashboard' },
      { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
      { text: 'Tasks', icon: <AssignmentTurnedInIcon />, path: '/tasks' },
      messageMenuItem,

      { type: 'header', text: 'Purchasing' },
      { text: 'Purchase Orders', icon: <AssignmentIcon />, path: '/open-purchase-orders' },
      { text: 'Return Orders', icon: <AssignmentReturnIcon />, path: '/return-orders' },
      { text: 'Parts to Order', icon: <InventoryIcon />, path: '/parts-to-order' },
      { text: 'Vendors', icon: <StoreIcon />, path: '/vendors' },

      { type: 'header', text: 'Sales' },
      { text: 'Quotes', icon: <ListAltIcon />, path: '/quotes' },
      { text: 'Sales Orders', icon: <ReceiptIcon />, path: '/open-sales-orders' },
      { text: 'Invoices', icon: <ReceiptIcon />, path: '/invoices' },
      { text: 'Customers', icon: <PeopleIcon />, path: '/customers' },

      { type: 'header', text: 'Products & Inventory' },
      { text: 'Products', icon: <LocalOfferIcon />, path: '/products' },
      { text: 'Stock', icon: <InventoryIcon />, path: '/inventory' },
      { text: 'Supply', icon: <InventoryIcon />, path: '/supply' },
      { text: 'Service', icon: <InventoryIcon />, path: '/service' },

      { type: 'header', text: 'Time Tracking' },
      { text: 'Attendance', icon: <TimelineIcon />, path: '/attendance' },
      { text: 'Time Tracking', icon: <TimelineIcon />, path: '/time-tracking' },
      { text: 'Time Tracking Reports', icon: <QueryStatsIcon />, path: '/time-tracking/reports' },

      { type: 'header', text: 'Human Resources' },
      { text: 'Employees', icon: <GroupIcon />, path: '/employees' },
      { text: 'Profile Documents', icon: <DescriptionIcon />, path: '/profile-documents' },
      { text: 'Leave Management', icon: <CalendarIcon />, path: '/leave-management' },
      { text: 'Mobile User Access', icon: <PeopleIcon />, path: '/mobile-user-access' },

      { type: 'header', text: 'Settings' },
      { text: 'Business Profile', icon: <BusinessIcon />, path: '/business-profile' },
      { text: 'Accounting', icon: <AttachMoneyIcon />, path: '/qbo-account-mapping' },
      { text: 'Global Variables', icon: <AttachMoneyIcon />, path: '/margin-schedule' },
      { text: 'Email Settings', icon: <EmailIcon />, path: '/email-settings' },
      { text: 'Backup Management', icon: <BackupIcon />, path: '/backup-management' },
    ],
    [messageMenuItem],
  );

  // Filter menu items for Time Tracking users
  const filteredMenuItems = React.useMemo<MenuEntry[]>(() => {
    if (user?.access_role === 'Time Tracking') {
      return [
        { type: 'header', text: 'Dashboard' },
        { text: 'Attendance', icon: <TimelineIcon />, path: '/attendance' },
        { text: 'Time Tracking', icon: <TimelineIcon />, path: '/time-tracking' },
        messageMenuItem,
        { type: 'header', text: 'Sales' },
        { text: 'Sales Orders', icon: <ReceiptIcon />, path: '/open-sales-orders' },
      ];
    }
    // Always show Dashboard at the top as a separate section
    const dashboardSection: MenuEntry[] = [
      { type: 'header', text: 'Main' },
      { text: 'Dashboard', icon: <DashboardIcon />, path: '/' },
      { text: 'Tasks', icon: <AssignmentTurnedInIcon />, path: '/tasks' },
      messageMenuItem,
    ];
    if (user?.access_role === 'Sales and Purchase') {
      return [
        ...dashboardSection,
        { type: 'header', text: 'Sales & Purchase' },
        { text: 'Sales Orders', icon: <ReceiptIcon />, path: '/open-sales-orders' },
        { text: 'Invoices', icon: <ReceiptIcon />, path: '/invoices' },
        { text: 'Purchase Orders', icon: <AssignmentIcon />, path: '/open-purchase-orders' },
        { text: 'Return Orders', icon: <AssignmentReturnIcon />, path: '/return-orders' },
        { text: 'Parts to Order', icon: <InventoryIcon />, path: '/parts-to-order' },
        { type: 'header', text: 'Inventory' },
        { text: 'Stock', icon: <InventoryIcon />, path: '/inventory' },
        { text: 'Supply', icon: <InventoryIcon />, path: '/supply' },
        { text: 'Service', icon: <InventoryIcon />, path: '/service' },
        { type: 'header', text: 'Settings' },
        { text: 'Email Settings', icon: <EmailIcon />, path: '/email-settings' },
      ];
    }
    return menuItems;
  }, [user, menuItems, messageMenuItem]);

  const drawer = (
    <div>
      <Toolbar />
      <List>
        {filteredMenuItems.map((item, idx) => {
          if (isHeaderItem(item)) {
            return (
              <ListSubheader
                key={`header-${item.text}-${idx}`}
                sx={{ bgcolor: 'inherit', color: 'text.secondary', fontWeight: 'bold', fontSize: 13, textAlign: 'left', pl: 2 }}
              >
                {item.text}
              </ListSubheader>
            );
          }
          const navItem = item as NavigationMenuEntry;
          return (
            <ListItem
              key={navItem.path || `${navItem.text}-${idx}`}
              onClick={() => {
                const destination = resolveNavigationPath(navItem.path);
                if (location.pathname !== destination) {
                  navigate(destination);
                }
                setMobileOpen(false);
              }}
              sx={{ cursor: 'pointer' }}
            >
              <ListItemIcon>
                {navItem.showUnreadDot ? (
                  <Badge color="error" variant="dot" overlap="circular">
                    {navItem.icon}
                  </Badge>
                ) : (
                  navItem.icon
                )}
              </ListItemIcon>
              <ListItemText
                primary={navItem.text}
                primaryTypographyProps={navItem.showUnreadDot ? { fontWeight: 600 } : undefined}
              />
            </ListItem>
          );
        })}
      </List>
    </div>
  );

  const assistantInset = assistantWidth + assistantPanelRightOffset + assistantResizeHandleWidth;
  const assistantInsetPx = `${assistantInset}px`;
  const mainWidth = assistantOpen
    ? `calc(100% - ${drawerWidth}px - ${assistantInset}px)`
    : `calc(100% - ${drawerWidth}px)`;

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        sx={{
          left: { xs: 0, sm: `${drawerWidth}px` },
          right: { xs: 0, sm: assistantOpen ? assistantInsetPx : 0 },
          width: { xs: '100%', sm: 'auto' },
          transition: 'right 0.2s ease',
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
            <Button color="inherit" onClick={handleLogout} startIcon={<LogoutIcon />}>Logout</Button>
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
          width: { xs: '100%', sm: mainWidth },
          transition: 'width 0.2s ease',
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>
      <AssistantWidget
        open={assistantOpen}
        onOpen={() => setAssistantOpen(true)}
        onClose={() => setAssistantOpen(false)}
        panelWidth={defaultAssistantWidth}
        rightOffset={assistantPanelRightOffset}
        desktopTopOffset={assistantDesktopTopOffset}
        desktopWidth={assistantWidth}
        onDesktopResize={(width) => setAssistantWidth(Math.min(Math.max(width, minAssistantWidth), maxAssistantWidth))}
        desktopMinWidth={minAssistantWidth}
        desktopMaxWidth={maxAssistantWidth}
        desktopHandleWidth={assistantResizeHandleWidth}
        desktopBottomOffset={assistantDesktopBottomOffset}
      />
    </Box>
  );
};

export default Layout;
