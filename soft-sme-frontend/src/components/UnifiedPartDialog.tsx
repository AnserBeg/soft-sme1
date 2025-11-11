import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Stack,
  Grid,
  Typography,
  Alert,
  Box,
} from '@mui/material';
import { toast } from 'react-toastify';
import api from '../api/axios';
import { getPartVendors, getPartVendorsById, createPartVendor, createPartVendorById, updatePartVendor, updatePartVendorById, deletePartVendor, deletePartVendorById, InventoryVendorLink } from '../services/inventoryService';
import CategorySelect from './CategorySelect';
import { useAuth } from '../contexts/AuthContext';
// Removed debounced PN fetching for unsaved parts

export interface PartFormValues {
  part_id?: number;
  part_number: string;
  part_description: string;
  unit: string;
  last_unit_cost: string | number;
  quantity_on_hand: string | number;
  reorder_point: string | number;
  part_type: string;
  category: string;
}

interface UnifiedPartDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (part: PartFormValues) => Promise<void>;
  initialPart?: Partial<PartFormValues>;
  isEditMode?: boolean;
  title?: string;
}

const UNIT_OPTIONS = ['Each', 'cm', 'ft', 'ft^2', 'kg', 'pcs', 'L'];
const PART_TYPE_OPTIONS = ['stock', 'supply', 'service'];

interface Category {
  category_id: number;
  category_name: string;
  description?: string;
}

const UnifiedPartDialog: React.FC<UnifiedPartDialogProps> = ({
  open,
  onClose,
  onSave,
  initialPart,
  isEditMode = false,
  title,
}) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState<PartFormValues>({
    part_number: '',
    part_description: '',
    unit: UNIT_OPTIONS[0],
    last_unit_cost: '',
    quantity_on_hand: '',
    reorder_point: '',
    part_type: 'stock',
    category: 'Uncategorized',
    ...(initialPart || {}),
  });

  const [errors, setErrors] = useState<Partial<Record<keyof PartFormValues, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const partNumberRef = useRef<HTMLInputElement>(null);
  
  

  // Reset form when dialog opens or when a meaningful identifier of the initial part changes
  useEffect(() => {
    if (open) {
      setFormData({
        part_id: initialPart?.part_id,
        part_number: initialPart?.part_number || '',
        part_description: initialPart?.part_description || '',
        unit: initialPart?.unit || UNIT_OPTIONS[0],
        last_unit_cost: initialPart?.last_unit_cost || '',
        quantity_on_hand: initialPart?.quantity_on_hand || '',
        reorder_point: initialPart?.reorder_point || '',
        part_type: initialPart?.part_type || 'stock',
        category: initialPart?.category || 'Uncategorized',
      });
      setErrors({});
      setIsSubmitting(false);
    }
  }, [open, initialPart?.part_id, initialPart?.part_number]);

  // Focus part number field when dialog opens
  useEffect(() => {
    if (open && partNumberRef.current) {
      setTimeout(() => partNumberRef.current?.focus(), 100);
    }
  }, [open]);

  // Category options are provided by CategorySelect which loads them itself

  const handleFieldChange = (field: keyof PartFormValues, value: any) => {
    // Always uppercase part_number
    if (field === 'part_number') {
      value = value.toUpperCase();
    }
    
    // If part type is changed to supply, set quantity_on_hand to "NA"
    if (field === 'part_type' && (value === 'supply' || value === 'service')) {
      setFormData(prev => ({
        ...prev,
        [field]: value,
        quantity_on_hand: 'NA'
      }));
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
    }
    
    // Clear error for this field when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  // Removed live duplicate part number check. Duplicates are validated on save via backend response handling.

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof PartFormValues, string>> = {};

    if (!formData.part_number.trim()) {
      newErrors.part_number = 'Part Number is required';
    }

    // Rule: No spaces in part number
    if (formData.part_number && /\s/.test(formData.part_number)) {
      newErrors.part_number = 'Part Number cannot contain spaces';
    }

    // Rule: Only allow characters A-Z, 0-9, '-', '/', '(', ')'
    if (formData.part_number && !/^[A-Z0-9()\/-]+$/.test(formData.part_number)) {
      newErrors.part_number = 'Only letters/numbers and - / ( ) are allowed';
    }

    // Rule: If there is a '/', it must be enclosed within parentheses to indicate a fraction, e.g., (1/2)
    const pn = formData.part_number;
    if (pn && pn.includes('/')) {
      // Validate every '/' is inside a (...) group
      const isSlashInsideParens = (): boolean => {
        // Scan and ensure each '/' falls between a '(' and the next ')'
        const slashIndices: number[] = [];
        for (let i = 0; i < pn.length; i++) {
          if (pn[i] === '/') slashIndices.push(i);
        }
        if (slashIndices.length === 0) return true;
        // Precompute nearest previous '(' and next ')' for each index
        const prevOpen: number[] = new Array(pn.length).fill(-1);
        let lastOpen = -1;
        for (let i = 0; i < pn.length; i++) {
          if (pn[i] === '(') lastOpen = i;
          prevOpen[i] = lastOpen;
        }
        const nextClose: number[] = new Array(pn.length).fill(-1);
        let next = -1;
        for (let i = pn.length - 1; i >= 0; i--) {
          if (pn[i] === ')') next = i;
          nextClose[i] = next;
        }
        return slashIndices.every(idx => prevOpen[idx] !== -1 && nextClose[idx] !== -1 && prevOpen[idx] < idx && idx < nextClose[idx]);
      };
      if (!isSlashInsideParens()) {
        newErrors.part_number = 'Fractions must be enclosed in parentheses, e.g., (1/2)';
      }
    }

    if (!formData.part_description.trim()) {
      newErrors.part_description = 'Part Description is required';
    }

    if (!formData.unit) {
      newErrors.unit = 'Unit is required';
    }

    if (!formData.part_type) {
      newErrors.part_type = 'Part Type is required';
    }

    if (!['stock', 'supply', 'service'].includes(formData.part_type)) {
      newErrors.part_type = 'Part Type must be either "stock", "supply", or "service"';
    }

    if (!formData.category || formData.category.trim() === '') {
      newErrors.category = 'Category is required';
    }

    // Validate numeric fields
    if (formData.part_type === 'supply' || formData.part_type === 'service') {
      // For supply and service items, quantity_on_hand should be "NA" - no validation needed
    } else {
      const quantity = parseFloat(String(formData.quantity_on_hand));
      if (formData.quantity_on_hand !== '' && (isNaN(quantity) || quantity < 0)) {
        newErrors.quantity_on_hand = 'Quantity on Hand must be a valid number >= 0';
      }
    }

    const lastUnitCost = parseFloat(String(formData.last_unit_cost));
    if (formData.last_unit_cost !== '' && isNaN(lastUnitCost)) {
      newErrors.last_unit_cost = 'Last Unit Cost must be a valid number';
    }

    const reorderPoint = parseFloat(String(formData.reorder_point));
    if (formData.reorder_point !== '' && isNaN(reorderPoint)) {
      newErrors.reorder_point = 'Reorder Point must be a valid number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      toast.error('Please correct the errors before saving.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Prepare data for API
      const partData = {
        ...formData,
        part_number: formData.part_number.trim().toUpperCase(),
        part_description: formData.part_description.trim(),
        unit: formData.unit.trim(),
        last_unit_cost: formData.last_unit_cost === '' ? null : parseFloat(String(formData.last_unit_cost)),
        quantity_on_hand: (formData.part_type === 'supply' || formData.part_type === 'service')
          ? 'NA'
          : (formData.quantity_on_hand === '' ? 0 : parseFloat(String(formData.quantity_on_hand))),
        reorder_point: formData.reorder_point === '' ? null : parseFloat(String(formData.reorder_point)),
        part_type: formData.part_type.trim(),
        category: formData.category.trim(),
      };

      await onSave(partData);
      toast.success(`Part ${isEditMode ? 'updated' : 'added'} successfully!`);
      onClose();
    } catch (error: any) {
      console.error('Error saving part:', error);
      let errorMessage = `Failed to ${isEditMode ? 'update' : 'add'} part.`;
      
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      }

      // Check for duplicate part number error
      if (error.response?.status === 409 || 
          errorMessage.includes('Part number already exists') ||
          errorMessage.includes('duplicate key value') || 
          errorMessage.includes('already exists')) {
        setErrors(prev => ({ 
          ...prev, 
          part_number: 'Part number already exists. Please use a unique part number.' 
        }));
        toast.error('Part number already exists. Please use a unique part number.');
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onClose();
    }
  };

  const dialogTitle = title || (isEditMode ? 'Edit Part' : 'Add New Part');
  // Vendors management (edit-only or when part_number is present)
  const [vendorLinks, setVendorLinks] = useState<InventoryVendorLink[]>([]);
  const [vendorsList, setVendorsList] = useState<Array<{ vendor_id: number; vendor_name: string }>>([]);
  const [newVendorId, setNewVendorId] = useState<number | ''>('');
  const [newVendorPN, setNewVendorPN] = useState<string>('');
  const [newVendorDesc, setNewVendorDesc] = useState<string>('');
  const [newPreferred, setNewPreferred] = useState<boolean>(false);

  const canManageVendors = !!formData.part_id;

  useEffect(() => {
    if (!open) return;
    // Load vendors for dropdown
    (async () => {
      try {
        const res = await api.get('/api/vendors');
        setVendorsList(res.data || []);
      } catch {}
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const partId = formData.part_id;
    if (!partId) { setVendorLinks([]); return; }
    (async () => {
      try {
        const links = await getPartVendorsById(partId);
        setVendorLinks(links || []);
      } catch {
        setVendorLinks([]);
      }
    })();
  }, [open, formData.part_id]);

  const handleAddVendorLink = async () => {
    const pn = String(formData.part_number || '').trim().toUpperCase();
    if (!pn) return;
    if (!newVendorId || !newVendorPN.trim()) { toast.error('Select a vendor and enter vendor part number'); return; }
    try {
      const payload = {
        vendor_id: Number(newVendorId),
        vendor_part_number: newVendorPN.trim().toUpperCase(),
        vendor_part_description: newVendorDesc || undefined,
        preferred: newPreferred,
      };
      
      if (formData.part_id) {
        await createPartVendorById(formData.part_id, payload);
        const links = await getPartVendorsById(formData.part_id);
        setVendorLinks(links || []);
      } else {
        await createPartVendor(pn, payload);
        const links = await getPartVendors(pn);
        setVendorLinks(links || []);
      }
      
      setNewVendorId(''); setNewVendorPN(''); setNewVendorDesc(''); setNewPreferred(false);
      toast.success('Vendor mapping added');
    } catch (e:any) {
      toast.error(e?.response?.data?.error || 'Failed to add vendor mapping');
    }
  };

  const handleTogglePreferred = async (link: InventoryVendorLink) => {
    try {
      if (formData.part_id) {
        await updatePartVendorById(formData.part_id, link.id!, { preferred: !link.preferred });
        const links = await getPartVendorsById(formData.part_id);
        setVendorLinks(links || []);
      } else {
        await updatePartVendor(formData.part_number.toUpperCase(), link.id!, { preferred: !link.preferred });
        const links = await getPartVendors(formData.part_number.toUpperCase());
        setVendorLinks(links || []);
      }
    } catch { toast.error('Failed to update preferred'); }
  };

  const handleDeleteLink = async (link: InventoryVendorLink) => {
    if (!window.confirm('Remove this vendor mapping?')) return;
    try {
      if (formData.part_id) {
        await deletePartVendorById(formData.part_id, link.id!);
        const links = await getPartVendorsById(formData.part_id);
        setVendorLinks(links || []);
      } else {
        await deletePartVendor(formData.part_number.toUpperCase(), link.id!);
        const links = await getPartVendors(formData.part_number.toUpperCase());
        setVendorLinks(links || []);
      }
    } catch { toast.error('Failed to delete mapping'); }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>{dialogTitle}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Part Number"
                value={formData.part_number}
                onChange={(e) => handleFieldChange('part_number', e.target.value)}
                fullWidth
                required
                error={!!errors.part_number}
                helperText={errors.part_number}
                inputRef={partNumberRef}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Part Type"
                value={formData.part_type}
                onChange={(e) => handleFieldChange('part_type', e.target.value)}
                select
                fullWidth
                required
                error={!!errors.part_type}
                helperText={errors.part_type}
              >
                {PART_TYPE_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <CategorySelect
                label="Category"
                value={formData.category}
                onChange={(val) => handleFieldChange('category', val)}
                error={!!errors.category}
                errorMessage={errors.category}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Part Description"
                value={formData.part_description}
                onChange={(e) => handleFieldChange('part_description', e.target.value)}
                fullWidth
                required
                error={!!errors.part_description}
                helperText={errors.part_description}
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Unit"
                value={formData.unit}
                onChange={(e) => handleFieldChange('unit', e.target.value)}
                select
                fullWidth
                required
                error={!!errors.unit}
                helperText={errors.unit}
              >
                {UNIT_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Last Unit Cost"
                value={formData.last_unit_cost}
                onChange={(e) => handleFieldChange('last_unit_cost', e.target.value)}
                type="number"
                fullWidth
                error={!!errors.last_unit_cost}
                helperText={errors.last_unit_cost}
                inputProps={{ step: "0.01", min: "0" }}
              />
            </Grid>
            {formData.part_type === 'stock' && (
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Quantity on Hand"
                  value={formData.quantity_on_hand}
                  onChange={(e) => handleFieldChange('quantity_on_hand', e.target.value)}
                  type="number"
                  fullWidth
                  error={!!errors.quantity_on_hand}
                  helperText={errors.quantity_on_hand}
                  inputProps={{ step: "1", min: "0" }}
                  disabled={user?.access_role === 'Sales and Purchase'}
                />
              </Grid>
            )}
            <Grid item xs={12} sm={6}>
              <TextField
                label="Reorder Point"
                value={formData.reorder_point}
                onChange={(e) => handleFieldChange('reorder_point', e.target.value)}
                type="number"
                fullWidth
                error={!!errors.reorder_point}
                helperText={errors.reorder_point}
                inputProps={{ step: "1", min: "0" }}
              />
            </Grid>
          </Grid>

          {Object.keys(errors).length > 0 && (
            <Alert severity="error">
              <Typography variant="body2">
                Please correct the errors above before saving.
              </Typography>
            </Alert>
          )}
          {/* Vendors section */}
          <Box>
            <Typography variant="h6" sx={{ mb: 1 }}>Vendors</Typography>
            {!canManageVendors && (
              <Typography variant="body2" color="text.secondary">Save the part first to manage vendor mappings.</Typography>
            )}
            {canManageVendors && (
              <>
                <Grid container spacing={1} sx={{ mb: 1 }}>
                  <Grid item xs={12} sm={3}>
                    <TextField
                      label="Vendor"
                      select
                      value={newVendorId}
                      onChange={(e) => setNewVendorId(e.target.value === '' ? '' : Number(e.target.value))}
                      fullWidth
                      SelectProps={{ native: true }}
                    >
                      <option value=""></option>
                      {vendorsList.map(v => (
                        <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField label="Vendor Part #" value={newVendorPN} onChange={e => setNewVendorPN(e.target.value)} fullWidth />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField label="Vendor Part Description" value={newVendorDesc} onChange={e => setNewVendorDesc(e.target.value)} fullWidth />
                  </Grid>
                  <Grid item xs={12} sm={2}>
                    <Button variant="outlined" onClick={() => setNewPreferred(p => !p)} fullWidth>{newPreferred ? 'Preferred ✓' : 'Preferred'}</Button>
                  </Grid>
                  <Grid item xs={12}>
                    <Button variant="contained" onClick={handleAddVendorLink}>Add Vendor Mapping</Button>
                  </Grid>
                </Grid>
                {vendorLinks.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">No vendor mappings yet.</Typography>
                ) : (
                  <Grid container spacing={1}>
                    <Grid item xs={12}>
                      <Grid container spacing={1} sx={{ fontWeight: 600, mb: 1 }}>
                        <Grid item xs={12} sm={2.5}>Vendor</Grid>
                        <Grid item xs={12} sm={2.5}>Vendor Part #</Grid>
                        <Grid item xs={12} sm={3}>Description</Grid>
                        <Grid item xs={12} sm={1}>Pref</Grid>
                        <Grid item xs={12} sm={3}>Actions</Grid>
                      </Grid>
                    </Grid>
                    {vendorLinks.map(link => (
                      <Grid item xs={12} key={link.id}>
                        <Grid container spacing={1} alignItems="center" sx={{ py: 1, borderBottom: '1px solid #e0e0e0' }}>
                          <Grid item xs={12} sm={2.5}>
                            <Typography variant="body2" noWrap>{link.vendor_name || link.vendor_id}</Typography>
                          </Grid>
                          <Grid item xs={12} sm={2.5}>
                            <Typography variant="body2" noWrap>{link.vendor_part_number}</Typography>
                          </Grid>
                          <Grid item xs={12} sm={3}>
                            <Typography variant="body2" noWrap>{link.vendor_part_description || ''}</Typography>
                          </Grid>
                          <Grid item xs={12} sm={1} sx={{ textAlign: 'center' }}>
                            {link.preferred ? '✓' : ''}
                          </Grid>
                          <Grid item xs={12} sm={3}>
                            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                              <Button 
                                size="small" 
                                variant="outlined" 
                                onClick={() => handleTogglePreferred(link)}
                                sx={{ minWidth: 'fit-content' }}
                              >
                                {link.preferred ? 'Unset' : 'Set Preferred'}
                              </Button>
                              <Button 
                                size="small" 
                                color="error" 
                                variant="outlined" 
                                onClick={() => handleDeleteLink(link)}
                                sx={{ minWidth: 'fit-content' }}
                              >
                                Remove
                              </Button>
                            </Stack>
                          </Grid>
                        </Grid>
                      </Grid>
                    ))}
                  </Grid>
                )}
              </>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button 
          onClick={handleSave} 
          variant="contained" 
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Saving...' : (isEditMode ? 'Update Part' : 'Save Part')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UnifiedPartDialog; 
