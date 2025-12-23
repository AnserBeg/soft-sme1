import React, { useState, useEffect, useMemo } from 'react';
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
} from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import SearchIcon from '@mui/icons-material/Search';
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

interface AccountMapping {
  id: number;
  company_id: number;
  qbo_inventory_account_id: string;
  qbo_gst_account_id: string;
  qbo_ap_account_id: string;
  qbo_supply_expense_account_id?: string;
  qbo_sales_account_id?: string;
  qbo_labour_sales_account_id?: string;
  qbo_ar_account_id?: string;
  qbo_cogs_account_id?: string;
  qbo_cost_of_labour_account_id?: string;
  qbo_cost_of_materials_account_id?: string;
  qbo_labour_expense_reduction_account_id?: string;
  qbo_overhead_cogs_account_id?: string;
  created_at: string;
  updated_at: string;
}

interface QBOConnectionStatus {
  connected: boolean;
  message: string;
  realmId?: string;
  expiresAt?: string;
}

const QBOAccountMappingPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<QBOAccount[]>([]);
  const [accountTypes, setAccountTypes] = useState<any>({});
  const [mapping, setMapping] = useState<AccountMapping | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<QBOConnectionStatus | null>(null);
  const [selectedInventoryAccount, setSelectedInventoryAccount] = useState<string>('');
  const [selectedGSTAccount, setSelectedGSTAccount] = useState<string>('');
  const [selectedAPAccount, setSelectedAPAccount] = useState<string>('');
  const [selectedSupplyExpenseAccount, setSelectedSupplyExpenseAccount] = useState<string>('');
  const [selectedSalesAccount, setSelectedSalesAccount] = useState<string>('');
  const [selectedLabourSalesAccount, setSelectedLabourSalesAccount] = useState<string>('');
  const [selectedARAccount, setSelectedARAccount] = useState<string>('');
  const [selectedCOGSAccount, setSelectedCOGSAccount] = useState<string>('');
  const [selectedCostOfLabourAccount, setSelectedCostOfLabourAccount] = useState<string>('');
  const [selectedCostOfMaterialsAccount, setSelectedCostOfMaterialsAccount] = useState<string>('');
  const [selectedLabourExpenseReductionAccount, setSelectedLabourExpenseReductionAccount] = useState<string>('');
  const [selectedOverheadCOGSAccount, setSelectedOverheadCOGSAccount] = useState<string>('');
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [selectedAccountType, setSelectedAccountType] = useState<string>('');
  const [accountSearchTerm, setAccountSearchTerm] = useState<string>('');

  const companyIdOverride = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const raw = params.get('company_id') ?? params.get('companyId');
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : null;
  }, [location.search]);

  useEffect(() => {
    loadData();
  }, []);

  const handleConnectToQuickBooks = async () => {
    let companyId: string | number | undefined;
    try {
      const rawUser = localStorage.getItem('user');
      const user = rawUser ? JSON.parse(rawUser) : null;
      companyId = user?.company_id;
    } catch {
      companyId = undefined;
    }

    if (companyIdOverride) {
      companyId = companyIdOverride;
    }

    if (!companyId) {
      toast.error('Missing company context. Please sign in again.');
      return;
    }

    try {
      const response = await api.get('/api/qbo/auth-url', {
        params: { company_id: companyId },
      });
      const authUrl = response.data?.url;
      if (!authUrl) {
        throw new Error('Missing QuickBooks authorization URL');
      }
      // Redirect to Intuit OAuth endpoint
      window.location.href = authUrl;
    } catch (error: any) {
      console.error('Error starting QuickBooks connection:', error);
      const message = error?.response?.data?.error || 'Failed to start QuickBooks connection';
      toast.error(message);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const params = companyIdOverride ? { company_id: companyIdOverride } : undefined;
      // Check connection status
      const statusResponse = await api.get('/api/qbo-accounts/test-connection', { params });
      setConnectionStatus(statusResponse.data);

      if (statusResponse.data.connected) {
        // Load accounts
        const accountsResponse = await api.get('/api/qbo-accounts/accounts', { params });
        setAccounts(accountsResponse.data.accounts);
        setAccountTypes(accountsResponse.data.accountTypes);

        // Load current mapping
        const mappingResponse = await api.get('/api/qbo-accounts/mapping', { params });
        if (mappingResponse.data.mapping) {
          setMapping(mappingResponse.data.mapping);
          setSelectedInventoryAccount(mappingResponse.data.mapping.qbo_inventory_account_id);
          setSelectedGSTAccount(mappingResponse.data.mapping.qbo_gst_account_id);
          setSelectedAPAccount(mappingResponse.data.mapping.qbo_ap_account_id);
          setSelectedSupplyExpenseAccount(mappingResponse.data.mapping.qbo_supply_expense_account_id || '');
          setSelectedSalesAccount(mappingResponse.data.mapping.qbo_sales_account_id || '');
          setSelectedLabourSalesAccount(mappingResponse.data.mapping.qbo_labour_sales_account_id || '');
          setSelectedARAccount(mappingResponse.data.mapping.qbo_ar_account_id || '');
          setSelectedCOGSAccount(mappingResponse.data.mapping.qbo_cogs_account_id || '');
          setSelectedCostOfLabourAccount(mappingResponse.data.mapping.qbo_cost_of_labour_account_id || '');
          setSelectedCostOfMaterialsAccount(mappingResponse.data.mapping.qbo_cost_of_materials_account_id || '');
          setSelectedLabourExpenseReductionAccount(mappingResponse.data.mapping.qbo_labour_expense_reduction_account_id || '');
        setSelectedOverheadCOGSAccount(mappingResponse.data.mapping.qbo_overhead_cogs_account_id || '');
        }
      }
    } catch (error: any) {
      console.error('Error loading QBO data:', error);
      toast.error('Failed to load QuickBooks data');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMapping = async () => {
    if (!selectedInventoryAccount || !selectedGSTAccount || !selectedAPAccount) {
      toast.error('Please select all required accounts');
      return;
    }

    setSaving(true);
    try {
      const response = await api.post(
        '/api/qbo-accounts/mapping',
        {
          qbo_inventory_account_id: selectedInventoryAccount,
          qbo_gst_account_id: selectedGSTAccount,
          qbo_ap_account_id: selectedAPAccount,
          qbo_supply_expense_account_id: selectedSupplyExpenseAccount,
          qbo_sales_account_id: selectedSalesAccount,
          qbo_labour_sales_account_id: selectedLabourSalesAccount,
          qbo_ar_account_id: selectedARAccount,
          qbo_cogs_account_id: selectedCOGSAccount,
          qbo_cost_of_labour_account_id: selectedCostOfLabourAccount,
          qbo_cost_of_materials_account_id: selectedCostOfMaterialsAccount,
          qbo_labour_expense_reduction_account_id: selectedLabourExpenseReductionAccount,
          qbo_overhead_cogs_account_id: selectedOverheadCOGSAccount,
        },
        {
          params: companyIdOverride ? { company_id: companyIdOverride } : undefined,
        }
      );

      setMapping(response.data.mapping);
      toast.success('Account mapping saved successfully');
    } catch (error: any) {
      console.error('Error saving mapping:', error);
      toast.error('Failed to save account mapping');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnectQuickBooks = async () => {
    setDisconnecting(true);
    try {
      await api.post(
        '/api/qbo-accounts/disconnect',
        null,
        {
          params: companyIdOverride ? { company_id: companyIdOverride } : undefined,
        }
      );
      setConnectionStatus({ connected: false, message: 'QuickBooks disconnected' });
      setAccounts([]);
      setAccountTypes({});
      setMapping(null);
      setSelectedInventoryAccount('');
      setSelectedGSTAccount('');
      setSelectedAPAccount('');
      setSelectedSupplyExpenseAccount('');
      setSelectedSalesAccount('');
      setSelectedLabourSalesAccount('');
      setSelectedARAccount('');
      setSelectedCOGSAccount('');
      setSelectedCostOfLabourAccount('');
      setSelectedCostOfMaterialsAccount('');
      setSelectedLabourExpenseReductionAccount('');
      setSelectedOverheadCOGSAccount('');
      toast.success('QuickBooks disconnected');
      setShowDisconnectDialog(false);
    } catch (error: any) {
      console.error('Error disconnecting QuickBooks:', error);
      const message = error?.response?.data?.error || 'Failed to disconnect QuickBooks';
      toast.error(message);
    } finally {
      setDisconnecting(false);
    }
  };

  const getAccountDisplayName = (account: QBOAccount) => {
    const accountNumber = account.AccountNumber ? `#${account.AccountNumber}` : '';
    return `${account.Name} ${accountNumber} (${account.AccountType})`;
  };

  const getAccountOptions = (classification: string) => {
    let filteredAccounts = accounts.filter(acc => acc.Classification === classification);
    
    // Filter by search term if provided
    if (accountSearchTerm) {
      const searchLower = accountSearchTerm.toLowerCase();
      filteredAccounts = filteredAccounts.filter(acc => 
        acc.Name.toLowerCase().includes(searchLower) ||
        (acc.AccountNumber && acc.AccountNumber.includes(searchLower)) ||
        (acc.Description && acc.Description.toLowerCase().includes(searchLower))
      );
    }
    
    return filteredAccounts;
  };

  const renderAccountDialog = () => (
    <Dialog open={showAccountDialog} onClose={() => setShowAccountDialog(false)} maxWidth="md" fullWidth>
      <DialogTitle>
        QuickBooks Accounts - {selectedAccountType}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 2 }}>
                     {accountTypes[selectedAccountType]?.map((account: QBOAccount) => (
             <Card key={account.Id} sx={{ mb: 1, p: 2 }}>
               <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                 <Box>
                   <Typography variant="h6">{account.Name}</Typography>
                   <Typography variant="body2" color="text.secondary">
                     Type: {account.AccountType} | Subtype: {account.AccountSubType}
                   </Typography>
                   {account.AccountNumber && (
                     <Typography variant="body2" color="primary" fontWeight={500}>
                       Account #: {account.AccountNumber}
                     </Typography>
                   )}
                   {account.Description && (
                     <Typography variant="body2" color="text.secondary">
                       {account.Description}
                     </Typography>
                   )}
                 </Box>
                 <Chip 
                   label={account.AccountNumber || 'No Number'} 
                   size="small" 
                   color={account.AccountNumber ? "primary" : "default"}
                   variant="outlined"
                 />
               </Box>
             </Card>
           ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setShowAccountDialog(false)}>Close</Button>
      </DialogActions>
    </Dialog>
  );

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box display="flex" alignItems="center">
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/business-profile')}
            sx={{ mr: 2 }}
          >
            Back
          </Button>
          <Typography variant="h4" component="h1">
            QuickBooks Account Mapping
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            startIcon={<AccountBalanceIcon />}
            onClick={handleConnectToQuickBooks}
            sx={{ borderRadius: 2, fontWeight: 600 }}
          >
            Connect to QuickBooks
          </Button>
          {connectionStatus?.connected && (
            <Button
              variant="outlined"
              color="error"
              onClick={() => setShowDisconnectDialog(true)}
              sx={{ borderRadius: 2, fontWeight: 600 }}
            >
              Disconnect
            </Button>
          )}
        </Stack>
      </Box>

      {/* Connection Status */}
      {connectionStatus && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box display="flex" alignItems="center" gap={2}>
              {connectionStatus.connected ? (
                <CheckCircleIcon color="success" />
              ) : (
                <ErrorIcon color="error" />
              )}
              <Typography variant="h6">
                {connectionStatus.connected ? 'Connected to QuickBooks' : 'Not Connected'}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {connectionStatus.message}
            </Typography>
            {connectionStatus.connected && connectionStatus.realmId && (
              <Typography variant="body2" color="text.secondary">
                Realm ID: {connectionStatus.realmId}
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {!connectionStatus?.connected ? (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Please connect your QuickBooks account first in the Business Profile page.
        </Alert>
      ) : (
        <>
          {/* Account Statistics */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            {Object.entries(accountTypes).map(([classification, accounts]) => (
              <Grid item xs={12} sm={6} md={4} key={classification}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      {classification}
                    </Typography>
                    <Typography variant="h4" color="primary">
                      {(accounts as QBOAccount[]).length}
                    </Typography>
                    <Button
                      size="small"
                      onClick={() => {
                        setSelectedAccountType(classification);
                        setShowAccountDialog(true);
                      }}
                      sx={{ mt: 1 }}
                    >
                      View Accounts
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {/* Account Mapping Form */}
          <Paper sx={{ p: 3 }}>
                         <Typography variant="h5" gutterBottom>
               Map QuickBooks Accounts
             </Typography>
             <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
               Select the QuickBooks accounts that correspond to your business accounts. Different companies use different account names, so choose the accounts that make sense for your business.
             </Typography>
             
             <Alert severity="info" sx={{ mb: 3 }}>
               <Typography variant="body2">
                 <strong>How this works:</strong> Configure your QuickBooks accounts to map to your business transactions. Accounts used by both purchase orders and sales orders are shown at the top.
               </Typography>
               <Typography variant="body2" sx={{ mt: 1 }}>
                 <strong>Purchase Orders:</strong> Stock items → Inventory Account, Supply items → Supply Expense Account, GST → GST Account, Total → Accounts Payable.
               </Typography>
               <Typography variant="body2" sx={{ mt: 1 }}>
                 <strong>Sales Orders:</strong> Materials → Sales Account, Labour → Labour Sales Account, GST → GST Account, Total → Accounts Receivable, Costs → COGS Account.
               </Typography>
             </Alert>

             {/* Search Box */}
             <Box sx={{ mb: 3 }}>
               <TextField
                 fullWidth
                 label="Search accounts by name, number, or description"
                 value={accountSearchTerm}
                 onChange={(e) => setAccountSearchTerm(e.target.value)}
                 placeholder="e.g., 1200, Inventory, GST..."
                 size="small"
                 InputProps={{
                   startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
                 }}
               />
             </Box>

             {/* Shared Accounts (Used by both Purchase Orders and Sales Orders) */}
             <Typography variant="h6" sx={{ mt: 4, mb: 2, color: 'primary.main' }}>
               Shared Accounts (Purchase Orders & Sales Orders)
             </Typography>
             <Grid container spacing={3}>
               {/* GST/Tax Account */}
               <Grid item xs={12} md={6}>
                 <FormControl fullWidth>
                   <InputLabel>GST/Tax Account</InputLabel>
                   <Select
                     value={selectedGSTAccount}
                     onChange={(e) => setSelectedGSTAccount(e.target.value)}
                     label="GST/Tax Account"
                   >
                     {getAccountOptions('Liability').map((account) => (
                       <MenuItem key={account.Id} value={account.Id}>
                         {getAccountDisplayName(account)}
                       </MenuItem>
                     ))}
                   </Select>
                 </FormControl>
                 <Typography variant="caption" color="text.secondary">
                   Account for GST/HST/tax tracking (used by both purchase orders and sales orders)
                 </Typography>
               </Grid>

               {/* Inventory Account */}
               <Grid item xs={12} md={6}>
                 <FormControl fullWidth>
                   <InputLabel>Inventory Account</InputLabel>
                   <Select
                     value={selectedInventoryAccount}
                     onChange={(e) => setSelectedInventoryAccount(e.target.value)}
                     label="Inventory Account"
                   >
                     {getAccountOptions('Asset').map((account) => (
                       <MenuItem key={account.Id} value={account.Id}>
                         {getAccountDisplayName(account)}
                       </MenuItem>
                     ))}
                   </Select>
                 </FormControl>
                 <Typography variant="caption" color="text.secondary">
                   Account for tracking inventory (stock purchases and sales cost reduction)
                 </Typography>
               </Grid>
             </Grid>

             {/* Purchase Order Account Mapping */}
             <Typography variant="h6" sx={{ mt: 4, mb: 2 }}>
               Purchase Order Account Mapping
             </Typography>
             
             <Grid container spacing={3}>
               {/* Supply Expense Account */}
               <Grid item xs={12} md={6}>
                 <FormControl fullWidth>
                   <InputLabel>Supply Expense Account</InputLabel>
                   <Select
                     value={selectedSupplyExpenseAccount}
                     onChange={(e) => setSelectedSupplyExpenseAccount(e.target.value)}
                     label="Supply Expense Account"
                   >
                     <MenuItem value="">
                       <em>Optional - Select an expense account</em>
                     </MenuItem>
                     {getAccountOptions('Expense').map((account) => (
                       <MenuItem key={account.Id} value={account.Id}>
                         {getAccountDisplayName(account)}
                       </MenuItem>
                     ))}
                   </Select>
                 </FormControl>
                 <Typography variant="caption" color="text.secondary">
                   Account for supply items (e.g., Office Supplies, Tools, etc.) - Optional
                 </Typography>
               </Grid>

               {/* AP Account */}
               <Grid item xs={12} md={6}>
                 <FormControl fullWidth>
                   <InputLabel>Accounts Payable</InputLabel>
                   <Select
                     value={selectedAPAccount}
                     onChange={(e) => setSelectedAPAccount(e.target.value)}
                     label="Accounts Payable"
                   >
                     {getAccountOptions('Liability').map((account) => (
                       <MenuItem key={account.Id} value={account.Id}>
                         {getAccountDisplayName(account)}
                       </MenuItem>
                     ))}
                   </Select>
                 </FormControl>
                 <Typography variant="caption" color="text.secondary">
                   Account for tracking vendor payables (usually "Accounts Payable")
                 </Typography>
               </Grid>
             </Grid>

                           {/* Sales Order Account Mapping */}
              <Typography variant="h6" sx={{ mt: 4, mb: 2 }}>
                Sales Order Account Mapping
              </Typography>
              
              <Grid container spacing={3}>
                {/* Sales Account */}
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Sales Account</InputLabel>
                    <Select
                      value={selectedSalesAccount}
                      onChange={(e) => setSelectedSalesAccount(e.target.value)}
                      label="Sales Account"
                    >
                      {getAccountOptions('Revenue').map((account) => (
                        <MenuItem key={account.Id} value={account.Id}>
                          {getAccountDisplayName(account)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Typography variant="caption" color="text.secondary">
                    Revenue account for sales (e.g., Sales, Revenue, etc.) - Used for invoice creation
                  </Typography>
                </Grid>

                {/* Accounts Receivable */}
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Accounts Receivable</InputLabel>
                    <Select
                      value={selectedARAccount}
                      onChange={(e) => setSelectedARAccount(e.target.value)}
                      label="Accounts Receivable"
                    >
                      {getAccountOptions('Asset').map((account) => (
                        <MenuItem key={account.Id} value={account.Id}>
                          {getAccountDisplayName(account)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Typography variant="caption" color="text.secondary">
                    Account for tracking customer receivables (usually "Accounts Receivable") - Used for invoice total amount
                  </Typography>
                </Grid>
              </Grid>

                           {/* Cost Accounts */}
              <Typography variant="h6" sx={{ mt: 4, mb: 2 }}>
                Cost Accounts (Journal Entries)
              </Typography>
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Cost of Materials</InputLabel>
                    <Select
                      value={selectedCostOfMaterialsAccount}
                      onChange={(e) => setSelectedCostOfMaterialsAccount(e.target.value)}
                      label="Cost of Materials"
                    >
                      <MenuItem value="">
                        <em>Optional - Select an expense account</em>
                      </MenuItem>
                      {getAccountOptions('Expense').map((account) => (
                        <MenuItem key={account.Id} value={account.Id}>
                          {getAccountDisplayName(account)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Typography variant="caption" color="text.secondary">
                    Expense account for tracking cost of materials sold - Used for COGS journal entries - Optional
                  </Typography>
                </Grid>

                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Cost of Labour</InputLabel>
                    <Select
                      value={selectedCostOfLabourAccount}
                      onChange={(e) => setSelectedCostOfLabourAccount(e.target.value)}
                      label="Cost of Labour"
                    >
                      <MenuItem value="">
                        <em>Optional - Select an expense account</em>
                      </MenuItem>
                      {getAccountOptions('Expense').map((account) => (
                        <MenuItem key={account.Id} value={account.Id}>
                          {getAccountDisplayName(account)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Typography variant="caption" color="text.secondary">
                    Expense account for tracking cost of labour sold - Used for COGS journal entries - Optional
                  </Typography>
                </Grid>



                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Labour Expense Reduction Account</InputLabel>
                    <Select
                      value={selectedLabourExpenseReductionAccount}
                      onChange={(e) => setSelectedLabourExpenseReductionAccount(e.target.value)}
                      label="Labour Expense Reduction Account"
                    >
                      <MenuItem value="">
                        <em>Optional - Select an expense account</em>
                      </MenuItem>
                      {getAccountOptions('Expense').map((account) => (
                        <MenuItem key={account.Id} value={account.Id}>
                          {getAccountDisplayName(account)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Typography variant="caption" color="text.secondary">
                    Expense account for reducing labour costs when sold (e.g., Labour Expense, Wages Expense) - Used for COGS journal entries - Optional
                  </Typography>
                </Grid>

                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Overhead COGS Account</InputLabel>
                    <Select
                      value={selectedOverheadCOGSAccount}
                      onChange={(e) => setSelectedOverheadCOGSAccount(e.target.value)}
                      label="Overhead COGS Account"
                    >
                      <MenuItem value="">
                        <em>Optional - Select an expense account</em>
                      </MenuItem>
                      {getAccountOptions('Expense').map((account) => (
                        <MenuItem key={account.Id} value={account.Id}>
                          {getAccountDisplayName(account)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Typography variant="caption" color="text.secondary">
                    Expense account for tracking overhead costs when sold - Used for COGS journal entries - Optional
                  </Typography>
                </Grid>
              </Grid>

              {/* Overhead Management Button */}
              <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
                <Button
                  variant="outlined"
                  onClick={() => navigate('/overhead-management')}
                  sx={{ 
                    width: '100%', 
                    maxWidth: '600px', // Match the width of the account mapping fields
                    borderRadius: 2, 
                    fontWeight: 600,
                    py: 1.5,
                    fontSize: '1.1rem'
                  }}
                >
                  Manage Overhead Settings
                </Button>
              </Box>

            <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSaveMapping}
                disabled={saving || !selectedInventoryAccount || !selectedGSTAccount || !selectedAPAccount}
              >
                {saving ? 'Saving...' : 'Save Mapping'}
              </Button>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={loadData}
                disabled={loading}
              >
                Refresh
              </Button>
            </Box>

            {/* Current Mapping Display */}
            {mapping && (
              <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="h6" gutterBottom>
                  Current Mapping
                </Typography>
                
                {/* Shared Accounts */}
                <Typography variant="subtitle2" color="primary" sx={{ mt: 2, mb: 1 }}>
                  Shared Accounts (Purchase Orders & Sales Orders)
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">
                      GST/Tax: {(() => {
                        const account = accounts.find(a => a.Id === mapping.qbo_gst_account_id);
                        return account ? `${account.Name}${account.AccountNumber ? ` (#${account.AccountNumber})` : ''}` : 'Not configured';
                      })()}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">
                      Inventory: {(() => {
                        const account = accounts.find(a => a.Id === mapping.qbo_inventory_account_id);
                        return account ? `${account.Name}${account.AccountNumber ? ` (#${account.AccountNumber})` : ''}` : 'Not configured';
                      })()}
                    </Typography>
                  </Grid>
                </Grid>

                {/* Purchase Order Accounts */}
                <Typography variant="subtitle2" color="primary" sx={{ mt: 2, mb: 1 }}>
                  Purchase Order Accounts
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">
                      Supply Expense: {(() => {
                        const account = accounts.find(a => a.Id === mapping.qbo_supply_expense_account_id);
                        return account ? `${account.Name}${account.AccountNumber ? ` (#${account.AccountNumber})` : ''}` : 'Not configured';
                      })()}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">
                      Accounts Payable: {(() => {
                        const account = accounts.find(a => a.Id === mapping.qbo_ap_account_id);
                        return account ? `${account.Name}${account.AccountNumber ? ` (#${account.AccountNumber})` : ''}` : 'Not configured';
                      })()}
                    </Typography>
                  </Grid>
                </Grid>

                                 {/* Sales Order Accounts */}
                 <Typography variant="subtitle2" color="primary" sx={{ mt: 2, mb: 1 }}>
                   Sales Order Accounts
                 </Typography>
                 <Grid container spacing={2}>
                   <Grid item xs={12} md={6}>
                     <Typography variant="body2" color="text.secondary">
                       Sales: {(() => {
                         const account = accounts.find(a => a.Id === mapping.qbo_sales_account_id);
                         return account ? `${account.Name}${account.AccountNumber ? ` (#${account.AccountNumber})` : ''}` : 'Not configured';
                       })()}
                     </Typography>
                   </Grid>
                   <Grid item xs={12} md={6}>
                     <Typography variant="body2" color="text.secondary">
                       Accounts Receivable: {(() => {
                         const account = accounts.find(a => a.Id === mapping.qbo_ar_account_id);
                         return account ? `${account.Name}${account.AccountNumber ? ` (#${account.AccountNumber})` : ''}` : 'Not configured';
                       })()}
                     </Typography>
                   </Grid>
                 </Grid>

                 {/* Cost Accounts */}
                 <Typography variant="subtitle2" color="primary" sx={{ mt: 2, mb: 1 }}>
                   Cost Accounts
                 </Typography>
                 <Grid container spacing={2}>
                   <Grid item xs={12} md={6}>
                     <Typography variant="body2" color="text.secondary">
                       Cost of Materials: {(() => {
                         const account = accounts.find(a => a.Id === mapping.qbo_cost_of_materials_account_id);
                         return account ? `${account.Name}${account.AccountNumber ? ` (#${account.AccountNumber})` : ''}` : 'Not configured';
                       })()}
                     </Typography>
                   </Grid>
                   <Grid item xs={12} md={6}>
                     <Typography variant="body2" color="text.secondary">
                       Cost of Labour: {(() => {
                         const account = accounts.find(a => a.Id === mapping.qbo_cost_of_labour_account_id);
                         return account ? `${account.Name}${account.AccountNumber ? ` (#${account.AccountNumber})` : ''}` : 'Not configured';
                       })()}
                     </Typography>
                   </Grid>

                   <Grid item xs={12} md={6}>
                     <Typography variant="body2" color="text.secondary">
                       Labour Expense Reduction: {(() => {
                         const account = accounts.find(a => a.Id === mapping.qbo_labour_expense_reduction_account_id);
                         return account ? `${account.Name}${account.AccountNumber ? ` (#${account.AccountNumber})` : ''}` : 'Not configured';
                       })()}
                     </Typography>
                   </Grid>
                   <Grid item xs={12} md={6}>
                     <Typography variant="body2" color="text.secondary">
                       Overhead COGS: {(() => {
                         const account = accounts.find(a => a.Id === mapping.qbo_overhead_cogs_account_id);
                         return account ? `${account.Name}${account.AccountNumber ? ` (#${account.AccountNumber})` : ''}` : 'Not configured';
                       })()}
                     </Typography>
                   </Grid>
                 </Grid>
              </Box>
            )}
          </Paper>
        </>
      )}

      {renderAccountDialog()}
      <Dialog open={showDisconnectDialog} onClose={() => setShowDisconnectDialog(false)}>
        <DialogTitle>Disconnect QuickBooks?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This will remove the current QuickBooks connection for your company. You'll need
            to reconnect and review account mappings for the new company.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDisconnectDialog(false)} disabled={disconnecting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDisconnectQuickBooks}
            disabled={disconnecting}
          >
            {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default QBOAccountMappingPage; 
