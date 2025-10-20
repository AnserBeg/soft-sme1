import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Container,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import SaveIcon from '@mui/icons-material/Save';
import DownloadIcon from '@mui/icons-material/Download';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { toast } from 'react-toastify';
import CircularProgress from '@mui/material/CircularProgress';
import {
  ReturnOrderDetail,
  ReturnOrderPayload,
  ReturnOrderStatus,
  createReturnOrder,
  downloadReturnOrderPdf,
  fetchReturnOrderDetail,
  fetchReturnableLineItems,
  fetchReturnOrdersForPurchase,
  updateReturnOrder,
} from '../services/returnOrderService';
import { getPurchaseOrders, PurchaseOrder } from '../services/purchaseOrderService';

interface PurchaseOption {
  label: string;
  purchase_id: number;
  purchase_number: string;
  vendor_name?: string;
}

interface ReturnFormLine {
  purchase_line_item_id: number;
  part_number: string;
  part_description?: string;
  unit?: string;
  quantityPurchased: number;
  returnable_quantity: number;
  already_requested: number;
  inputQuantity: string;
  reason: string;
  selected: boolean;
}

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

const ReturnOrderDetailPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const query = useQuery();
  const isCreationMode = !id || id === 'new';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purchaseOptions, setPurchaseOptions] = useState<PurchaseOption[]>([]);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseOption | null>(null);
  const [status, setStatus] = useState<ReturnOrderStatus>('Requested');
  const [requestedBy, setRequestedBy] = useState('');
  const [requestedAt, setRequestedAt] = useState<string | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [formLines, setFormLines] = useState<ReturnFormLine[]>([]);
  const [existingDetail, setExistingDetail] = useState<ReturnOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purchaseReturnSummaries, setPurchaseReturnSummaries] = useState<Record<number, { requested: number; returned: number }>>({});

  const loadPurchaseOrders = useCallback(async (): Promise<PurchaseOption[]> => {
    try {
      const data = await getPurchaseOrders({ status: 'all' });
      const mapped: PurchaseOption[] = data.map((po: PurchaseOrder) => ({
        label: `${po.purchase_number} • ${po.vendor_name ?? 'No Vendor'}`,
        purchase_id: po.purchase_id,
        purchase_number: po.purchase_number,
        vendor_name: po.vendor_name,
      }));
      setPurchaseOptions(mapped);
      return mapped;
    } catch (err) {
      console.error('Failed to load purchase orders', err);
      setPurchaseOptions([]);
      return [];
    }
  }, []);

  const loadReturnSummaryForPurchase = useCallback(async (purchaseId: number) => {
    try {
      const summaries = await fetchReturnOrdersForPurchase(purchaseId);
      const requested = summaries.filter((r) => r.status === 'Requested').length;
      const returned = summaries.filter((r) => r.status === 'Returned').length;
      setPurchaseReturnSummaries((prev) => ({
        ...prev,
        [purchaseId]: { requested, returned },
      }));
    } catch (err) {
      console.warn('Unable to load return summary for purchase', err);
    }
  }, []);

  const hydrateFormLines = useCallback(
    async (
      purchaseId: number,
      existingLines?: ReturnOrderDetail['line_items'],
      excludeReturnId?: number
    ) => {
      try {
        const available = await fetchReturnableLineItems(purchaseId, excludeReturnId);
        const mapped = available?.map((line) => {
          const match = existingLines?.find((l) => l.purchase_line_item_id === line.line_item_id);
          return {
            purchase_line_item_id: line.line_item_id,
            part_number: line.part_number,
            part_description: line.part_description,
            unit: line.unit,
            quantityPurchased: line.quantity,
            returnable_quantity: line.returnable_quantity,
            already_requested: line.already_requested,
            inputQuantity: match ? String(match.quantity) : '',
            reason: match?.reason ?? '',
            selected: Boolean(match),
          } as ReturnFormLine;
        });
        setFormLines(mapped ?? []);
      } catch (err) {
        console.error('Failed to load available return items', err);
        setFormLines([]);
      }
    },
    []
  );

  useEffect(() => {
    const initialize = async () => {
      const options = await loadPurchaseOrders();
      const presetPurchaseId = query.get('purchaseId');

      if (!isCreationMode && id) {
        try {
          const detail = await fetchReturnOrderDetail(Number(id));
          setExistingDetail(detail);
          setStatus(detail.status);
          setRequestedBy(detail.requested_by ?? '');
          setRequestedAt(detail.requested_at);
          setNotes(detail.notes ?? '');

          const purchaseOption: PurchaseOption = {
            label: `${detail.purchase_number || ''} • ${detail.vendor_name || 'No Vendor'}`,
            purchase_id: detail.purchase_id,
            purchase_number: detail.purchase_number || '',
            vendor_name: detail.vendor_name || undefined,
          };
          setSelectedPurchase(purchaseOption);
          await hydrateFormLines(detail.purchase_id, detail.line_items, detail.return_id);
          await loadReturnSummaryForPurchase(detail.purchase_id);
        } catch (err) {
          console.error('Failed to load return order detail', err);
          setError('Unable to load return order.');
        } finally {
          setLoading(false);
        }
        return;
      }

      if (presetPurchaseId) {
        const numericId = Number(presetPurchaseId);
        if (Number.isFinite(numericId)) {
          const optionSource = options.length ? options : purchaseOptions;
          const option = optionSource.find((opt) => opt.purchase_id === numericId);
          if (option) {
            setSelectedPurchase(option);
            await hydrateFormLines(numericId);
            await loadReturnSummaryForPurchase(numericId);
          }
        }
      }
      setLoading(false);
    };

    initialize();
  }, [hydrateFormLines, id, isCreationMode, loadPurchaseOrders, loadReturnSummaryForPurchase, query]);

  const handlePurchaseChange = async (_: any, option: PurchaseOption | null) => {
    setSelectedPurchase(option);
    if (option) {
      await hydrateFormLines(option.purchase_id, existingDetail?.line_items, existingDetail?.return_id ?? undefined);
      await loadReturnSummaryForPurchase(option.purchase_id);
    } else {
      setFormLines([]);
    }
  };

  const totalSelectedQuantity = useMemo(() => {
    return formLines.reduce((sum, line) => {
      if (!line.selected) {
        return sum;
      }
      const qty = parseFloat(line.inputQuantity || '0');
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);
  }, [formLines]);

  const hasReturnableLines = useMemo(() => formLines.some((line) => line.returnable_quantity > 0), [formLines]);
  const hasSelectedLines = useMemo(() => formLines.some((line) => line.selected), [formLines]);

  const handleSave = async () => {
    setError(null);
    if (!selectedPurchase) {
      setError('Select a purchase order before saving.');
      return;
    }

    const preparedLines = formLines
      .filter((line) => line.selected)
      .map((line) => ({
        purchase_line_item_id: line.purchase_line_item_id,
        quantity: parseFloat(line.inputQuantity || '0'),
        reason: line.reason?.trim() ? line.reason.trim() : undefined,
        maxQuantity: line.returnable_quantity,
        part_number: line.part_number,
      }))
      .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);

    if (preparedLines.length === 0) {
      setError('Select at least one part and enter a quantity to return.');
      return;
    }

    for (const line of preparedLines) {
      if (line.quantity > (line.maxQuantity ?? 0) + 1e-6) {
        setError(`Return quantity for part ${line.part_number} exceeds the available quantity.`);
        return;
      }
    }

    const payload: ReturnOrderPayload = {
      purchase_id: selectedPurchase.purchase_id,
      status,
      requested_by: requestedBy || undefined,
      requested_at: requestedAt,
      notes: notes || undefined,
      line_items: preparedLines.map(({ purchase_line_item_id, quantity, reason }) => ({
        purchase_line_item_id,
        quantity,
        reason,
      })),
    };

    try {
      setSaving(true);
      if (isCreationMode) {
        const created = await createReturnOrder(payload);
        toast.success(`Return order ${created.return_number} created.`);
      } else if (id) {
        await updateReturnOrder(Number(id), {
          status: payload.status,
          requested_by: payload.requested_by,
          requested_at: payload.requested_at,
          notes: payload.notes,
          line_items: payload.line_items,
        });
        toast.success('Return order updated.');
      }
      navigate('/return-orders');
    } catch (err: any) {
      console.error('Failed to save return order', err);
      const message = err?.response?.data?.error || 'Unable to save return order.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Stack spacing={3}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="h4" component="h1">
              {isCreationMode
                ? 'Create Return Order'
                : `Return Order ${existingDetail?.return_number ?? ''}`}
            </Typography>
            {selectedPurchase && (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Chip label={`Purchase: ${selectedPurchase.purchase_number}`} color="primary" variant="outlined" />
                <Chip
                  label={`Vendor: ${selectedPurchase.vendor_name ?? 'No Vendor'}`}
                  variant="outlined"
                  color="secondary"
                />
                {purchaseReturnSummaries[selectedPurchase.purchase_id] && (
                  <Chip
                    label={`Returns - Requested: ${purchaseReturnSummaries[selectedPurchase.purchase_id].requested} • Completed: ${purchaseReturnSummaries[selectedPurchase.purchase_id].returned}`}
                    color="default"
                    variant="outlined"
                  />
                )}
              </Stack>
            )}
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={() => navigate('/return-orders')}
            >
              Back to List
            </Button>
            {!isCreationMode && id && (
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={() => downloadReturnOrderPdf(Number(id))}
              >
                Download
              </Button>
            )}
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save & Close'}
            </Button>
          </Stack>
        </Stack>

        {error && <Alert severity="error">{error}</Alert>}

        <Paper sx={{ p: 3 }} elevation={1}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Autocomplete
                options={purchaseOptions}
                value={selectedPurchase}
                onChange={handlePurchaseChange}
                getOptionLabel={(option) => option.label}
                renderInput={(params) => (
                  <TextField {...params} label="Purchase Order" placeholder="Select purchase order" />
                )}
                disabled={!isCreationMode && Boolean(existingDetail)}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                select
                SelectProps={{ native: true }}
                label="Status"
                value={status}
                onChange={(event) => setStatus(event.target.value as ReturnOrderStatus)}
                fullWidth
              >
                <option value="Requested">Requested</option>
                <option value="Returned">Returned</option>
              </TextField>
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                label="Requested By"
                value={requestedBy}
                onChange={(event) => setRequestedBy(event.target.value)}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Requested At"
                type="datetime-local"
                fullWidth
                value={requestedAt ? dayjs(requestedAt).format('YYYY-MM-DDTHH:mm') : ''}
                onChange={(event) => setRequestedAt(event.target.value ? new Date(event.target.value).toISOString() : undefined)}
                helperText="Optional timestamp for when the return was requested"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                multiline
                rows={3}
                fullWidth
                placeholder="Add any notes for the vendor or internal team"
              />
            </Grid>
          </Grid>
        </Paper>

        <Paper sx={{ p: 3 }} elevation={1}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
              <Typography variant="h6">Return Line Items</Typography>
              <Typography variant="body2" color="text.secondary">
                Total Selected Quantity: {totalSelectedQuantity.toFixed(2)}
              </Typography>
            </Stack>
            {formLines.length > 0 && (
              <Typography variant="body2" color="text.secondary">
                Check the boxes to add parts to this return, then adjust the quantity being sent back.
              </Typography>
            )}
            {formLines.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Select a purchase order to view parts eligible for return.
              </Typography>
            ) : (
              <>
                {!hasReturnableLines && (
                  <Alert severity="info">
                    All parts on this purchase order have already been requested for return.
                  </Alert>
                )}
                <TableContainer sx={{ maxHeight: 420 }}>
                  <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">Select</TableCell>
                      <TableCell>Part Number</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell align="right">Purchased</TableCell>
                      <TableCell align="right">Available</TableCell>
                      <TableCell align="right">Qty to Return</TableCell>
                      <TableCell>Reason</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {formLines.map((line) => {
                      const disableSelection = line.returnable_quantity <= 0 && !line.selected;
                      return (
                        <TableRow
                          key={line.purchase_line_item_id}
                          hover
                          selected={line.selected}
                          sx={{ '&.Mui-selected': { backgroundColor: (theme) => theme.palette.action.hover } }}
                        >
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={line.selected}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setFormLines((prev) =>
                                  prev.map((prevLine) => {
                                    if (prevLine.purchase_line_item_id !== line.purchase_line_item_id) {
                                      return prevLine;
                                    }
                                    const defaultQuantity = prevLine.returnable_quantity > 0 ? String(prevLine.returnable_quantity) : '';
                                    return {
                                      ...prevLine,
                                      selected: checked,
                                      inputQuantity: checked
                                        ? prevLine.inputQuantity || defaultQuantity
                                        : '',
                                      reason: checked ? prevLine.reason : '',
                                    };
                                  })
                                );
                              }}
                              disabled={disableSelection}
                              inputProps={{ 'aria-label': `Select ${line.part_number}` }}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>
                              {line.part_number}
                            </Typography>
                            {line.unit && (
                              <Typography variant="caption" color="text.secondary" display="block">
                                Unit: {line.unit}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">{line.part_description || '-'}</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2">{line.quantityPurchased.toFixed(2)}</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2">{line.returnable_quantity.toFixed(2)}</Typography>
                            {line.already_requested > 0 && (
                              <Typography variant="caption" color="text.secondary" display="block">
                                Already requested: {line.already_requested.toFixed(2)}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right" sx={{ minWidth: 140 }}>
                            <TextField
                              type="number"
                              size="small"
                              value={line.inputQuantity}
                              onChange={(event) => {
                                const value = event.target.value;
                                setFormLines((prev) =>
                                  prev.map((prevLine) => {
                                    if (prevLine.purchase_line_item_id !== line.purchase_line_item_id) {
                                      return prevLine;
                                    }
                                    const numeric = parseFloat(value);
                                    const shouldSelect = !Number.isNaN(numeric) && numeric > 0;
                                    return {
                                      ...prevLine,
                                      inputQuantity: value,
                                      selected: shouldSelect ? true : value === '' ? false : prevLine.selected,
                                    };
                                  })
                                );
                              }}
                              inputProps={{ min: 0, step: 0.01, max: line.returnable_quantity }}
                              fullWidth
                              disabled={!line.selected}
                            />
                          </TableCell>
                          <TableCell sx={{ minWidth: 200 }}>
                            <TextField
                              size="small"
                              value={line.reason}
                              onChange={(event) => {
                                const value = event.target.value;
                                setFormLines((prev) =>
                                  prev.map((prevLine) =>
                                    prevLine.purchase_line_item_id === line.purchase_line_item_id
                                      ? { ...prevLine, reason: value }
                                      : prevLine
                                  )
                                );
                              }}
                              placeholder="Optional"
                              fullWidth
                              disabled={!line.selected}
                              multiline
                              minRows={1}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
            {formLines.length > 0 && !hasSelectedLines && hasReturnableLines && (
              <Alert severity="info">Select at least one part to include it in the return order.</Alert>
            )}
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
};

export default ReturnOrderDetailPage;
