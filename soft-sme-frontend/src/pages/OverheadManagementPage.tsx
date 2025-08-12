import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Box,
  Button,
  Grid,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Card,
  CardContent,
  Divider,
  Stack,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Autocomplete,
  IconButton,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../api/axios';
import { toast } from 'react-toastify';

interface QBOAccount {
  Id: string;
  Name: string;
  AccountType: string;
  Classification: string;
  AccountSubType: string;
  Description?: string;
  AccountNumber?: string;
}

interface OverheadDistribution {
  id: number;
  company_id: number;
  expense_account_id: string;
  percentage: number;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface QBOConnectionStatus {
  connected: boolean;
  message: string;
  realmId?: string;
  expiresAt?: string;
}

const OverheadManagementPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<QBOAccount[]>([]);
  const [accountTypes, setAccountTypes] = useState<any>({});
  const [distributions, setDistributions] = useState<OverheadDistribution[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<QBOConnectionStatus | null>(null);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [selectedAccountType, setSelectedAccountType] = useState<string>('');
  const [accountSearchTerm, setAccountSearchTerm] = useState<string>('');
  const [openDistributionDialog, setOpenDistributionDialog] = useState(false);
  const [editingDistribution, setEditingDistribution] = useState<OverheadDistribution | null>(null);
  const [distributionForm, setDistributionForm] = useState({
    expense_account_id: '',
    percentage: '',
    description: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [accountsRes, distributionsRes] = await Promise.all([
        api.get('/api/qbo-accounts/accounts'),
        api.get('/api/overhead/distribution')
      ]);

      setAccounts(accountsRes.data.accounts || []);
      setAccountTypes(accountsRes.data.accountTypes || {});
      setDistributions(distributionsRes.data || []);
      setConnectionStatus({
        connected: true,
        message: 'Connected to QuickBooks'
      });
    } catch (error: any) {
      console.error('Error loading data:', error);
      setConnectionStatus({
        connected: false,
        message: error.response?.data?.error || 'Failed to connect to QuickBooks'
      });
      toast.error('Failed to load overhead management data');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDistribution = async () => {
    if (!distributionForm.expense_account_id || !distributionForm.percentage) {
      toast.error('Please fill in all required fields');
      return;
    }

    const percentage = parseFloat(distributionForm.percentage);
    if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
      toast.error('Percentage must be between 0 and 100');
      return;
    }

    // Check if total percentage would exceed 100%
    const currentTotal = distributions
      .filter(d => d.id !== editingDistribution?.id)
      .reduce((sum, d) => sum + d.percentage, 0);
    
    if (currentTotal + percentage > 100) {
      toast.error(`Total percentage would exceed 100%. Current total: ${currentTotal}%, adding: ${percentage}%`);
      return;
    }

    setSaving(true);
    try {
      if (editingDistribution) {
        await api.put(`/api/overhead/distribution/${editingDistribution.id}`, {
          expense_account_id: distributionForm.expense_account_id,
          percentage: percentage,
          description: distributionForm.description
        });
        toast.success('Distribution updated successfully');
      } else {
        await api.post('/api/overhead/distribution', {
          expense_account_id: distributionForm.expense_account_id,
          percentage: percentage,
          description: distributionForm.description
        });
        toast.success('Distribution added successfully');
      }
      
      setOpenDistributionDialog(false);
      setEditingDistribution(null);
      setDistributionForm({ expense_account_id: '', percentage: '', description: '' });
      loadData();
    } catch (error: any) {
      console.error('Error saving distribution:', error);
      toast.error(error.response?.data?.error || 'Failed to save distribution');
    } finally {
      setSaving(false);
    }
  };

  const handleEditDistribution = (distribution: OverheadDistribution) => {
    setEditingDistribution(distribution);
    setDistributionForm({
      expense_account_id: distribution.expense_account_id,
      percentage: distribution.percentage.toString(),
      description: distribution.description
    });
    setOpenDistributionDialog(true);
  };

  const handleDeleteDistribution = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this distribution?')) {
      return;
    }

    try {
      await api.delete(`/api/overhead/distribution/${id}`);
      toast.success('Distribution deleted successfully');
      loadData();
    } catch (error: any) {
      console.error('Error deleting distribution:', error);
      toast.error(error.response?.data?.error || 'Failed to delete distribution');
    }
  };

  const handleAddDistribution = () => {
    setEditingDistribution(null);
    setDistributionForm({ expense_account_id: '', percentage: '', description: '' });
    setOpenDistributionDialog(true);
  };

  const getAccountDisplayName = (account: QBOAccount) => {
    return `${account.Name} (${account.AccountType})`;
  };

  const getAccountOptions = (classification: string) => {
    return (accountTypes[classification] || [])
      .filter((acc: QBOAccount) => acc.Classification === classification)
      .map((acc: QBOAccount) => ({
        label: getAccountDisplayName(acc),
        value: acc.Id,
        account: acc
      }));
  };

  const renderAccountDialog = () => (
    <Dialog open={showAccountDialog} onClose={() => setShowAccountDialog(false)} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <AccountBalanceIcon />
          QuickBooks Accounts
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box mb={2}>
          <TextField
            fullWidth
            label="Search accounts"
            value={accountSearchTerm}
            onChange={(e) => setAccountSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: <SearchIcon />
            }}
          />
        </Box>
        
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Account Type</InputLabel>
          <Select
            value={selectedAccountType}
            onChange={(e) => setSelectedAccountType(e.target.value)}
            label="Account Type"
          >
            <MenuItem value="">All Types</MenuItem>
            <MenuItem value="Asset">Asset</MenuItem>
            <MenuItem value="Liability">Liability</MenuItem>
            <MenuItem value="Equity">Equity</MenuItem>
            <MenuItem value="Revenue">Revenue</MenuItem>
            <MenuItem value="Expense">Expense</MenuItem>
          </Select>
        </FormControl>

        <Box maxHeight={400} overflow="auto">
          {Object.entries(accountTypes).map(([classification, accounts]: [string, any]) => {
            if (selectedAccountType && classification !== selectedAccountType) return null;
            
            const filteredAccounts = accounts.filter((acc: QBOAccount) =>
              acc.Name.toLowerCase().includes(accountSearchTerm.toLowerCase()) ||
              acc.AccountType.toLowerCase().includes(accountSearchTerm.toLowerCase())
            );

            if (filteredAccounts.length === 0) return null;

            return (
              <Box key={classification} mb={3}>
                <Typography variant="h6" gutterBottom>
                  {classification} Accounts ({filteredAccounts.length})
                </Typography>
                <Grid container spacing={1}>
                  {filteredAccounts.map((account: QBOAccount) => (
                    <Grid item xs={12} sm={6} md={4} key={account.Id}>
                      <Card variant="outlined" sx={{ p: 1 }}>
                        <Typography variant="body2" fontWeight="bold">
                          {account.Name}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {account.AccountType}
                        </Typography>
                        {account.AccountNumber && (
                          <Typography variant="caption" display="block" color="textSecondary">
                            #{account.AccountNumber}
                          </Typography>
                        )}
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setShowAccountDialog(false)}>Close</Button>
      </DialogActions>
    </Dialog>
  );

  const totalPercentage = distributions.reduce((sum, d) => sum + d.percentage, 0);

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton onClick={() => navigate(-1)}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h4" gutterBottom>
            Overhead Management
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            onClick={() => setShowAccountDialog(true)}
            startIcon={<AccountBalanceIcon />}
          >
            View QBO Accounts
          </Button>
          <Button
            variant="contained"
            onClick={handleAddDistribution}
            startIcon={<AddIcon />}
          >
            Add Distribution
          </Button>
          <Button
            variant="outlined"
            onClick={loadData}
            startIcon={<RefreshIcon />}
          >
            Refresh
          </Button>
        </Stack>
      </Box>

      {/* Connection Status */}
      {connectionStatus && (
        <Alert
          severity={connectionStatus.connected ? 'success' : 'error'}
          icon={connectionStatus.connected ? <CheckCircleIcon /> : <ErrorIcon />}
          sx={{ mb: 3 }}
        >
          {connectionStatus.message}
        </Alert>
      )}

      {/* Summary Card */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Distribution Summary
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Total Distributions
                </Typography>
                <Typography variant="h4">
                  {distributions.length}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Total Percentage
                </Typography>
                <Typography variant="h4" color={totalPercentage === 100 ? 'success.main' : 'warning.main'}>
                  {totalPercentage.toFixed(1)}%
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Remaining
                </Typography>
                <Typography variant="h4" color={totalPercentage > 100 ? 'error.main' : 'text.primary'}>
                  {(100 - totalPercentage).toFixed(1)}%
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Status
                </Typography>
                <Chip
                  label={totalPercentage === 100 ? 'Complete' : totalPercentage > 100 ? 'Over 100%' : 'Incomplete'}
                  color={totalPercentage === 100 ? 'success' : totalPercentage > 100 ? 'error' : 'warning'}
                />
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Paper>

      {/* Distributions List */}
      <Paper sx={{ width: '100%', overflow: 'hidden' }}>
        <Box sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Expense Distributions
          </Typography>
          {loading ? (
            <Box display="flex" justifyContent="center" p={3}>
              <CircularProgress />
            </Box>
          ) : distributions.length === 0 ? (
            <Alert severity="info">
              No expense distributions configured. Click "Add Distribution" to get started.
            </Alert>
          ) : (
            <Grid container spacing={2}>
              {distributions.map((distribution) => {
                const account = accounts.find(acc => acc.Id === distribution.expense_account_id);
                return (
                  <Grid item xs={12} sm={6} md={4} key={distribution.id}>
                    <Card>
                      <CardContent>
                        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                          <Box flex={1}>
                            <Typography variant="h6" gutterBottom>
                              {distribution.description || account?.Name || 'Unknown Account'}
                            </Typography>
                            <Typography variant="body2" color="textSecondary" gutterBottom>
                              {account?.Name} ({account?.AccountType})
                            </Typography>
                            <Chip
                              label={`${distribution.percentage}%`}
                              color="primary"
                              size="small"
                            />
                          </Box>
                          <Box>
                            <IconButton
                              size="small"
                              onClick={() => handleEditDistribution(distribution)}
                            >
                              <EditIcon />
                            </IconButton>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleDeleteDistribution(distribution.id)}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}
        </Box>
      </Paper>

      {/* Add/Edit Distribution Dialog */}
      <Dialog open={openDistributionDialog} onClose={() => setOpenDistributionDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingDistribution ? 'Edit Distribution' : 'Add Distribution'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Expense Account</InputLabel>
              <Select
                value={distributionForm.expense_account_id}
                onChange={(e) => setDistributionForm(prev => ({ ...prev, expense_account_id: e.target.value }))}
                label="Expense Account"
              >
                {getAccountOptions('Expense').map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Percentage"
              type="number"
              value={distributionForm.percentage}
              onChange={(e) => setDistributionForm(prev => ({ ...prev, percentage: e.target.value }))}
              inputProps={{ min: 0, max: 100, step: 0.01 }}
              helperText={`Current total: ${totalPercentage}%${editingDistribution ? ` (excluding this item: ${(totalPercentage - editingDistribution.percentage).toFixed(1)}%)` : ''}`}
            />

            <TextField
              label="Description (Optional)"
              value={distributionForm.description}
              onChange={(e) => setDistributionForm(prev => ({ ...prev, description: e.target.value }))}
              helperText="A description to help identify this distribution"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDistributionDialog(false)}>Cancel</Button>
          <Button
            onClick={handleSaveDistribution}
            variant="contained"
            disabled={saving || !distributionForm.expense_account_id || !distributionForm.percentage}
            startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {renderAccountDialog()}
    </Container>
  );
};

export default OverheadManagementPage; 