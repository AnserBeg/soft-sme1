import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Button,
  Card,
  CardContent,
  CardActions,
  Grid,
  Box,
  Divider,
  Avatar,
  useTheme,
  Fade
} from "@mui/material";
import {
  Dashboard as DashboardIcon,
  Business as BusinessIcon,
  People as PeopleIcon,
  Inventory as InventoryIcon,
  AttachMoney as AttachMoneyIcon,
  Group as GroupIcon,
  ListAlt as ListAltIcon,
  Assignment as AssignmentIcon,
  Receipt as ReceiptIcon,
  Timeline as TimelineIcon,
  QueryStats as QueryStatsIcon,
  Store as StoreIcon,
  LocalOffer as LocalOfferIcon,
  LocalShipping as LocalShippingIcon,
    Backup as BackupIcon,
  Email as EmailIcon,
  Event as CalendarIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import TaskSummaryWidget from '../components/tasks/TaskSummaryWidget';
import { getTaskSummary } from '../services/taskService';
import { TaskSummary } from '../types/task';
import { ChatBoard } from '../components/ChatWindow';

const sectionIcons: Record<string, React.ReactNode> = {
  'Purchasing': <AssignmentIcon sx={{ color: 'primary.main' }} />,
  'Sales': <ReceiptIcon sx={{ color: 'primary.main' }} />,
  'Products & Inventory': <InventoryIcon sx={{ color: 'primary.main' }} />,
  'Time Tracking': <TimelineIcon sx={{ color: 'primary.main' }} />,
  'Human Resources': <PeopleIcon sx={{ color: 'primary.main' }} />,
  'Settings': <BusinessIcon sx={{ color: 'primary.main' }} />,
};

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const { user } = useAuth();
  const [taskSummary, setTaskSummary] = useState<TaskSummary | null>(null);
  const [taskSummaryLoading, setTaskSummaryLoading] = useState<boolean>(false);

  const loadTaskSummary = useCallback(async () => {
    setTaskSummaryLoading(true);
    try {
      const summary = await getTaskSummary();
      setTaskSummary(summary);
    } catch (error) {
      console.error('Failed to load task summary', error);
    } finally {
      setTaskSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTaskSummary();
  }, [loadTaskSummary]);

  console.log('[LandingPage] user:', user);

  const sections = [
    {
      title: "Purchasing",
      items: [
        { title: 'Purchase Orders', description: 'Manage purchase orders', icon: <AssignmentIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/open-purchase-orders' },
        { title: 'Parts to Order', description: 'Manage parts ordering', icon: <InventoryIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/parts-to-order' },
        { title: 'Vendors', description: 'Manage your vendors', icon: <StoreIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/vendors' }
      ]
    },
    {
      title: "Sales",
      items: [
        { title: 'Quotes', description: 'Manage and track quotes', icon: <ListAltIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/quotes' },
        { title: 'Sales Orders', description: 'Manage sales orders', icon: <ReceiptIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/open-sales-orders' },
        { title: 'Customers', description: 'Track and manage your customer relationships', icon: <PeopleIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/customers' }
      ]
    },
    {
      title: "Products & Inventory",
      items: [
        { title: 'Products', description: 'Manage your products', icon: <LocalOfferIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/products' },
        { title: 'Stock', description: 'Manage your product inventory and stock levels', icon: <InventoryIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/inventory' },
        { title: 'Supply', description: 'Manage supply and materials', icon: <InventoryIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/supply' }
      ]
    },
    {
      title: "Time Tracking",
      items: [
        { title: 'Attendance', description: 'View and manage attendance records', icon: <TimelineIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/attendance' },
        { title: 'Time Tracking', description: 'Track employee time and project hours', icon: <TimelineIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/time-tracking' },
        { title: 'Time Tracking Reports', description: 'View and export time tracking reports', icon: <QueryStatsIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/time-tracking/reports' }
      ]
    },
    {
      title: "Human Resources",
      items: [
        { title: 'Employees', description: 'Manage employee accounts and roles', icon: <GroupIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/employees' },
        { title: 'Profile Documents', description: 'Manage and track employee document access and read status', icon: <AssignmentIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/profile-documents' },
        { title: 'Leave Management', description: 'Manage employee leave requests and approvals', icon: <CalendarIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/leave-management' },
        { title: 'Mobile User Access', description: 'Manage mobile user access to profiles', icon: <PeopleIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/mobile-user-access' }
      ]
    },
    {
      title: "Settings",
            items: [
        { title: 'Business Profile', description: 'Manage your company information and settings', icon: <BusinessIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/business-profile' },
        { title: 'Accounting', description: 'Configure QuickBooks account mappings', icon: <AttachMoneyIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/qbo-account-mapping' },
        { title: 'Global Variables', description: 'Set and manage margin, labour, and overhead rates', icon: <AttachMoneyIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/margin-schedule' },
        { title: 'Email Settings', description: 'Configure system email settings', icon: <EmailIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/email-settings' },
        { title: 'Backup Management', description: 'Manage system backups and restores', icon: <BackupIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/backup-management' }
      ]
    }
  ];

  // Define allowed sections for Sales role
  let filteredSections = sections;
  if (user?.access_role === 'Sales and Purchase') {
    filteredSections = [
      {
        title: 'Sales & Purchase',
        items: [
          { title: 'Sales Orders', description: 'Manage sales orders', icon: <ReceiptIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/open-sales-orders' },
          { title: 'Purchase Orders', description: 'Manage purchase orders', icon: <AssignmentIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/open-purchase-orders' },
          { title: 'Parts to Order', description: 'View parts that need to be ordered', icon: <InventoryIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/parts-to-order' },
        ],
      },
      {
        title: 'Inventory',
        items: [
          { title: 'Stock', description: 'Manage your product inventory and stock levels', icon: <InventoryIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/inventory' },
          { title: 'Supply', description: 'Manage supply and materials', icon: <InventoryIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/supply' },
        ],
      },
      {
        title: 'Settings',
        items: [
          { title: 'Email Settings', description: 'Configure your email settings', icon: <EmailIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/email-settings' },
        ],
      },
    ];
  }

  if (user?.access_role === 'Quotes') {
    filteredSections = [
      {
        title: 'Quotes',
        items: [
          { title: 'Quotes', description: 'Manage and track quotes', icon: <ListAltIcon sx={{ fontSize: 40, color: 'primary.main' }} />, path: '/quotes' }
        ]
      }
    ];
  }

  console.log('[LandingPage] filteredSections:', filteredSections);

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {/* Welcome Banner */}
      <Box sx={{
        background: `linear-gradient(90deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
        borderRadius: 3,
        p: 4,
        mb: 6,
        color: theme.palette.primary.contrastText,
        boxShadow: 3,
        textAlign: 'center',
      }}>
        <Typography variant="h3" component="h1" gutterBottom sx={{ color: 'inherit' }}>
          Welcome to Soft SME
        </Typography>
        <Typography variant="h5" component="h2" gutterBottom sx={{ color: 'inherit', opacity: 0.85 }}>
          Your all-in-one business management solution
        </Typography>
      </Box>

      <Box sx={{ mb: 6 }}>
        <TaskSummaryWidget
          summary={taskSummary}
          loading={taskSummaryLoading}
          onRefresh={loadTaskSummary}
          onViewTasks={() => navigate('/tasks')}
        />
      </Box>

      <Box sx={{ mb: 6 }}>
        <Typography variant="h4" component="h2" sx={{ mb: 2, fontWeight: 600 }}>
          Workspace Copilot
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Get instant answers, summaries, and suggestions tailored to your current data without leaving the dashboard.
        </Typography>
        <ChatBoard variant="embedded" sx={{ maxWidth: '100%' }} />
      </Box>

      {filteredSections.map((section, sectionIndex) => (
        <Fade in timeout={700 + sectionIndex * 200} key={section.title}>
          <Box sx={{
            mt: 6,
            mb: 4,
            p: 3,
            borderRadius: 3,
            background: theme.palette.mode === 'light' ? theme.palette.grey[50] : theme.palette.grey[900],
            boxShadow: 1,
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Avatar sx={{ bgcolor: 'primary.main', mr: 2 }}>
                {sectionIcons[section.title as string] || <DashboardIcon sx={{ color: 'primary.main' }} />}
              </Avatar>
              <Typography variant="h4" component="h2" sx={{ color: 'primary.main', fontWeight: 600 }}>
                {section.title}
              </Typography>
            </Box>
            <Grid container spacing={4}>
              {section.items.map((feature, index) => (
                <Grid item xs={12} sm={6} md={3} key={index}>
                  <Fade in timeout={900 + index * 150}>
                    <Card
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: 2,
                        boxShadow: 2,
                        transition: 'transform 0.2s, box-shadow 0.2s',
                        '&:hover': {
                          transform: 'translateY(-6px) scale(1.03)',
                          boxShadow: 6,
                          cursor: 'pointer',
                        },
                        bgcolor: 'background.paper',
                      }}
                      onClick={() => navigate(feature.path)}
                      tabIndex={0}
                      role="button"
                      aria-label={feature.title}
                    >
                      <CardContent sx={{ flexGrow: 1, textAlign: 'center' }}>
                        {feature.icon}
                        <Typography gutterBottom variant="h5" component="h2">
                          {feature.title}
                        </Typography>
                        <Typography>
                          {feature.description}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Fade>
                </Grid>
              ))}
            </Grid>
            {sectionIndex < filteredSections.length - 1 && (
              <Divider sx={{ mt: 4, mb: 2 }} />
            )}
          </Box>
        </Fade>
      ))}
    </Container>
  );
};

export default LandingPage; 