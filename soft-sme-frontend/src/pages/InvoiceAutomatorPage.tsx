import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import LinkIcon from '@mui/icons-material/Link';
import SyncIcon from '@mui/icons-material/Sync';
import api from '../api/axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';

type TitanStatusResponse =
  | { success: true; connected: boolean; provider?: string; lastValidatedAt?: string | null }
  | { success: false; message: string };

type Ingestion = {
  id: number;
  status: string;
  subject?: string | null;
  from_address?: string | null;
  received_at?: string | null;
  attachment_filename?: string | null;
  attachment_content_type?: string | null;
  purchase_id?: number | null;
  ocr_normalized?: any;
  error?: string | null;
  created_at?: string;
};

const statusColor = (status: string): 'default' | 'success' | 'warning' | 'error' | 'info' => {
  switch (status) {
    case 'created_po':
      return 'success';
    case 'needs_review':
      return 'warning';
    case 'processing':
      return 'info';
    case 'error':
      return 'error';
    default:
      return 'default';
  }
};

const InvoiceAutomatorPage: React.FC = () => {
  const [titanConnected, setTitanConnected] = useState<boolean>(false);
  const [checkingStatus, setCheckingStatus] = useState<boolean>(true);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);

  const [titanEmail, setTitanEmail] = useState<string>('');
  const [titanPassword, setTitanPassword] = useState<string>('');
  const [hostImap, setHostImap] = useState<string>('imap.titan.email');
  const [portImap, setPortImap] = useState<number>(993);
  const [hostSmtp, setHostSmtp] = useState<string>('smtp.titan.email');
  const [portSmtp, setPortSmtp] = useState<number>(465);

  const [query, setQuery] = useState<string>(
    'unread:true has:attachment subject:invoice subject:inv subject:bill subject:billing subject:receipt subject:facture subject:"tax invoice" subject:"commercial invoice"'
  );
  const [maxMessages, setMaxMessages] = useState<number>(20);
  const [autoCreate, setAutoCreate] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);

  const [loadingIngestions, setLoadingIngestions] = useState<boolean>(true);
  const [ingestions, setIngestions] = useState<Ingestion[]>([]);
  const [showRejected, setShowRejected] = useState<boolean>(false);

  const refreshStatus = async () => {
    setCheckingStatus(true);
    try {
      const r = await api.get<TitanStatusResponse>('/api/email/titan/status');
      if ((r.data as any)?.success) {
        setTitanConnected(Boolean((r.data as any).connected));
      } else {
        setTitanConnected(false);
      }
    } catch (err) {
      setTitanConnected(false);
    } finally {
      setCheckingStatus(false);
    }
  };

  const refreshIngestions = async () => {
    setLoadingIngestions(true);
    try {
      const r = await api.get('/api/invoice-automator/ingestions?limit=50');
      setIngestions(Array.isArray(r.data?.ingestions) ? r.data.ingestions : []);
    } catch (err) {
      toast.error('Failed to load ingestions');
    } finally {
      setLoadingIngestions(false);
    }
  };

  useEffect(() => {
    refreshStatus().finally(() => refreshIngestions());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnectTitan = async () => {
    setConnecting(true);
    try {
      const payload = {
        email: titanEmail,
        password: titanPassword,
        hostImap,
        portImap,
        hostSmtp,
        portSmtp,
      };
      const r = await api.post('/api/email/connect/titan', payload);
      if (r.data?.success) {
        toast.success('Titan connected');
        setTitanPassword('');
        await refreshStatus();
      } else {
        toast.error(r.data?.message || 'Failed to connect Titan');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to connect Titan');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectTitan = async () => {
    setDisconnecting(true);
    try {
      const r = await api.post('/api/email/disconnect');
      if (r.data?.success) {
        toast.success('Disconnected');
        await refreshStatus();
      } else {
        toast.error(r.data?.message || 'Failed to disconnect');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await api.post('/api/invoice-automator/titan/sync', {
        query,
        maxMessages,
        autoCreatePurchaseOrders: autoCreate,
      });
      if (r.data?.success) {
        toast.success(
          `Synced: ${r.data.processedAttachments || 0} attachments, ${r.data.createdPurchaseOrders || 0} POs created`
        );
        await refreshIngestions();
      } else {
        toast.error(r.data?.message || 'Sync failed');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleCreatePo = async (ingestion: Ingestion) => {
    try {
      const r = await api.post(`/api/invoice-automator/ingestions/${ingestion.id}/create-po`, {});
      if (r.data?.success) {
        toast.success('Purchase order created');
        await refreshIngestions();
      } else {
        toast.error(r.data?.message || 'Failed to create purchase order');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to create purchase order');
    }
  };

  const rows = useMemo(() => {
    if (showRejected) {
      return ingestions;
    }
    return ingestions.filter((ingestion) => !String(ingestion.status || '').startsWith('rejected'));
  }, [ingestions, showRejected]);

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        Invoice Automator
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Connect a Titan mailbox, scan invoice attachments, run OCR, and create purchase orders automatically when the
        vendor can be matched.
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Titan Connection
              </Typography>

              <Alert
                severity={titanConnected ? 'success' : 'warning'}
                sx={{ mb: 2 }}
              >
                {checkingStatus ? 'Checking...' : titanConnected ? 'Connected' : 'Not connected'}
              </Alert>

              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField
                    label="Email"
                    value={titanEmail}
                    onChange={(e) => setTitanEmail(e.target.value)}
                    fullWidth
                    disabled={titanConnected}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    label="Password"
                    type="password"
                    value={titanPassword}
                    onChange={(e) => setTitanPassword(e.target.value)}
                    fullWidth
                    disabled={titanConnected}
                    helperText={titanConnected ? 'Disconnect to update credentials' : 'Your Titan mailbox password'}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="IMAP Host"
                    value={hostImap}
                    onChange={(e) => setHostImap(e.target.value)}
                    fullWidth
                    disabled={titanConnected}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="IMAP Port"
                    type="number"
                    value={portImap}
                    onChange={(e) => setPortImap(Number(e.target.value))}
                    fullWidth
                    disabled={titanConnected}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="SMTP Host"
                    value={hostSmtp}
                    onChange={(e) => setHostSmtp(e.target.value)}
                    fullWidth
                    disabled={titanConnected}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="SMTP Port"
                    type="number"
                    value={portSmtp}
                    onChange={(e) => setPortSmtp(Number(e.target.value))}
                    fullWidth
                    disabled={titanConnected}
                  />
                </Grid>
              </Grid>
            </CardContent>
            <CardActions>
              {!titanConnected ? (
                <Button
                  variant="contained"
                  startIcon={connecting ? <CircularProgress size={18} /> : <LinkIcon />}
                  onClick={handleConnectTitan}
                  disabled={connecting || !titanEmail || !titanPassword}
                >
                  {connecting ? 'Connecting...' : 'Connect Titan'}
                </Button>
              ) : (
                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={disconnecting ? <CircularProgress size={18} /> : <LinkIcon />}
                  onClick={handleDisconnectTitan}
                  disabled={disconnecting}
                >
                  {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                </Button>
              )}
            </CardActions>
          </Card>

          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Sync Settings
              </Typography>
              <TextField
                label="Titan Search Query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                fullWidth
                sx={{ mb: 2 }}
                helperText='Examples: `unread:true has:attachment subject:invoice`, `from:"billing@vendor.com" unread:true has:attachment subject:invoice`'
              />
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Max Messages"
                    type="number"
                    value={maxMessages}
                    onChange={(e) => setMaxMessages(Number(e.target.value))}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={autoCreate}
                        onChange={(e) => setAutoCreate(e.target.checked)}
                      />
                    }
                    label="Auto-create POs"
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={showRejected}
                        onChange={(e) => setShowRejected(e.target.checked)}
                      />
                    }
                    label="Show rejected statements"
                  />
                </Grid>
              </Grid>
              <Divider sx={{ my: 2 }} />
              <Button
                variant="contained"
                startIcon={syncing ? <CircularProgress size={18} /> : <SyncIcon />}
                onClick={handleSync}
                disabled={!titanConnected || syncing}
                fullWidth
              >
                {syncing ? 'Syncing...' : 'Sync Inbox'}
              </Button>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="h6">Recent Ingestions</Typography>
                <Button size="small" onClick={refreshIngestions} disabled={loadingIngestions}>
                  Refresh
                </Button>
              </Box>

              {loadingIngestions ? (
                <Box display="flex" justifyContent="center" py={4}>
                  <CircularProgress />
                </Box>
              ) : rows.length === 0 ? (
                <Alert severity="info">No ingestions yet. Connect Titan and run a sync.</Alert>
              ) : (
                <Box display="flex" flexDirection="column" gap={1}>
                  {rows.map((ingestion) => {
                    const normalized = ingestion.ocr_normalized as any;
                    const vendorName = normalized?.vendorName;
                    const billNumber = normalized?.billNumber;
                    const vendorId =
                      normalized?.vendorMatch?.status === 'existing' ? normalized?.vendorMatch?.vendorId : null;
                    const isInvoice = normalized?.documentType === 'invoice';

                    const canCreate =
                      isInvoice
                      && !ingestion.purchase_id
                      && (ingestion.status === 'needs_review' || ingestion.status === 'processed')
                      && vendorId;

                    return (
                      <Card key={ingestion.id} variant="outlined">
                        <CardContent sx={{ pb: 1 }}>
                          <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                              {ingestion.attachment_filename || 'attachment'}
                            </Typography>
                            <Chip
                              size="small"
                              label={ingestion.status}
                              color={statusColor(ingestion.status)}
                            />
                          </Box>
                          <Typography variant="body2" color="text.secondary">
                            {ingestion.subject || '(no subject)'} • {ingestion.from_address || 'unknown sender'}
                          </Typography>
                          <Typography variant="body2" sx={{ mt: 1 }}>
                            Vendor: {vendorName || '—'} • Bill: {billNumber || '—'}
                          </Typography>
                          {ingestion.error ? (
                            <Alert severity="error" sx={{ mt: 1 }}>
                              {ingestion.error}
                            </Alert>
                          ) : null}
                        </CardContent>
                        <CardActions sx={{ pt: 0 }}>
                          {ingestion.purchase_id ? (
                            <Button
                              size="small"
                              component={Link}
                              to={`/open-purchase-orders/${ingestion.purchase_id}`}
                              startIcon={<AutoAwesomeIcon />}
                            >
                              Open PO
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => handleCreatePo(ingestion)}
                              disabled={!canCreate}
                              startIcon={<AutoAwesomeIcon />}
                            >
                              Create PO
                            </Button>
                          )}
                          {!vendorId && isInvoice ? (
                            <Typography variant="caption" color="text.secondary">
                              Vendor not matched (add vendor, then re-sync)
                            </Typography>
                          ) : null}
                        </CardActions>
                      </Card>
                    );
                  })}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default InvoiceAutomatorPage;
