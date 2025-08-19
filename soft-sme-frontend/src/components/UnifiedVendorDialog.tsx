import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Grid, IconButton, Tooltip, Typography, Box, Stack } from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { getBusinessProfileData } from '../services/businessProfileService';
import { useDebounce } from '../hooks/useDebounce';
import api from '../api/axios';
import { 
  getVendorContacts,
  addVendorContactPerson,
  updateVendorContactPerson,
  deleteVendorContactPerson,
  addVendorEmail,
  updateVendorEmail,
  deleteVendorEmail,
  addVendorPhone,
  updateVendorPhone,
  deleteVendorPhone,
} from '../services/vendorService';

export interface VendorFormValues {
  vendor_name: string;
  street_address: string;
  city: string;
  province: string;
  country: string;
  postal_code: string;
  contact_person: string;
  telephone_number: string;
  email: string;
  website: string;
}

interface UnifiedVendorDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (vendor: VendorFormValues) => void;
  initialVendor?: Partial<VendorFormValues>;
  isEditMode?: boolean;
  loading?: boolean;
}

const defaultVendor: VendorFormValues = {
  vendor_name: '',
  street_address: '',
  city: '',
  province: '',
  country: '',
  postal_code: '',
  contact_person: '',
  telephone_number: '',
  email: '',
  website: '',
};

const UnifiedVendorDialog: React.FC<UnifiedVendorDialogProps> = ({
  open,
  onClose,
  onSave,
  initialVendor,
  isEditMode = false,
  loading = false,
}) => {
  const [vendor, setVendor] = useState<VendorFormValues>(defaultVendor);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof VendorFormValues, string>>>({});
  const debouncedVendor = useDebounce(vendor, 300);
  const [existingVendors, setExistingVendors] = useState<Array<{ vendor_id: number; vendor_name: string }>>([]);
  const [contactPeople, setContactPeople] = useState<any[]>([]);
  const [contactEmails, setContactEmails] = useState<any[]>([]);
  const [contactPhones, setContactPhones] = useState<any[]>([]);
  const [newPerson, setNewPerson] = useState<string>('');
  const [newEmail, setNewEmail] = useState<string>('');
  const [newPhone, setNewPhone] = useState<string>('');
  const [newPhoneLabel, setNewPhoneLabel] = useState<string>('');

  useEffect(() => {
    if (open) {
      console.log('UnifiedVendorDialog: Setting vendor with initialVendor:', initialVendor);
      const newVendor = { ...defaultVendor, ...initialVendor };
      setVendor(newVendor);
      
      // Auto-fill city, province, and country from business profile for new vendors
      if (!isEditMode && !initialVendor?.city && !initialVendor?.province && !initialVendor?.country) {
        handleAutoFill();
      }

      // Load vendor list for duplicate name checks
      (async () => {
        try {
          const res = await api.get('/api/vendors');
          setExistingVendors(res.data || []);
        } catch (e) {
          // ignore
        }
      })();
      // Load contacts in edit mode
      const vid = (initialVendor as any)?.vendor_id as number | undefined;
      if (isEditMode && vid) {
        (async () => {
          try {
            const data = await getVendorContacts(vid);
            setContactPeople(data.people || []);
            setContactEmails(data.emails || []);
            setContactPhones(data.phones || []);
          } catch (e) {
            // ignore
          }
        })();
      } else {
        setContactPeople([]);
        setContactEmails([]);
        setContactPhones([]);
      }
    }
  }, [open, initialVendor, isEditMode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setVendor((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name as keyof VendorFormValues]) {
      setFieldErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSave = () => {
    onSave(vendor);
  };

  // Debounced side-effect validations
  useEffect(() => {
    if (!open) return;
    const updates: Partial<Record<keyof VendorFormValues, string>> = {};
    if (debouncedVendor.email && debouncedVendor.email.trim().length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(debouncedVendor.email.trim())) {
        updates.email = 'Invalid email format';
      }
    }
    if (debouncedVendor.vendor_name && debouncedVendor.vendor_name.trim().length > 0) {
      const nameLc = debouncedVendor.vendor_name.trim().toLowerCase();
      const isDuplicate = existingVendors.some((v: any) => (v.vendor_name || '').trim().toLowerCase() === nameLc);
      if (isDuplicate && !isEditMode) {
        updates.vendor_name = 'Vendor name already exists';
      }
    }
    setFieldErrors(prev => ({ ...prev, ...updates }));
  }, [debouncedVendor, open, isEditMode, existingVendors]);

  const handleAutoFill = async () => {
    try {
      const businessData = await getBusinessProfileData();
      setVendor(prev => ({
        ...prev,
        city: businessData.city,
        province: businessData.province,
        country: businessData.country,
      }));
      console.log('Autofilled vendor form with business profile data:', businessData);
    } catch (error) {
      console.error('Error autofilling from business profile:', error);
    }
  };

  // Contact handlers (edit mode only)
  const vendorId = (initialVendor as any)?.vendor_id as number | undefined;
  const refreshContacts = async () => {
    if (!isEditMode || !vendorId) return;
    try {
      const data = await getVendorContacts(vendorId);
      setContactPeople(data.people || []);
      setContactEmails(data.emails || []);
      setContactPhones(data.phones || []);
    } catch {}
  };

  const addPerson = async () => {
    if (!vendorId || !newPerson.trim()) return;
    await addVendorContactPerson(vendorId, { name: newPerson.trim() });
    setNewPerson('');
    refreshContacts();
  };
  const makePreferredPerson = async (id: number) => {
    if (!vendorId) return;
    await updateVendorContactPerson(vendorId, id, { is_preferred: true });
    refreshContacts();
  };
  const removePerson = async (id: number) => {
    if (!vendorId) return;
    await deleteVendorContactPerson(vendorId, id);
    refreshContacts();
  };

  const addEmailLocal = async () => {
    if (!vendorId || !newEmail.trim()) return;
    await addVendorEmail(vendorId, { email: newEmail.trim() });
    setNewEmail('');
    refreshContacts();
  };
  const makePreferredEmail = async (id: number) => {
    if (!vendorId) return;
    await updateVendorEmail(vendorId, id, { is_preferred: true });
    refreshContacts();
  };
  const removeEmail = async (id: number) => {
    if (!vendorId) return;
    await deleteVendorEmail(vendorId, id);
    refreshContacts();
  };

  const addPhoneLocal = async () => {
    if (!vendorId || !newPhone.trim()) return;
    await addVendorPhone(vendorId, { phone: newPhone.trim(), label: newPhoneLabel.trim() || undefined });
    setNewPhone('');
    setNewPhoneLabel('');
    refreshContacts();
  };
  const makePreferredPhone = async (id: number) => {
    if (!vendorId) return;
    await updateVendorPhone(vendorId, id, { is_preferred: true });
    refreshContacts();
  };
  const removePhone = async (id: number) => {
    if (!vendorId) return;
    await deleteVendorPhone(vendorId, id);
    refreshContacts();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth sx={{ zIndex: (theme) => theme.zIndex.modal + 5 }}>
      <DialogTitle>{isEditMode ? 'Edit Vendor' : 'Add New Vendor'}</DialogTitle>
      <DialogContent sx={{ form: { autoComplete: 'off' } }}>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12} sm={4}>
            <TextField name="vendor_name" label="Vendor Name" value={vendor.vendor_name} onChange={handleInputChange} fullWidth required error={!!fieldErrors.vendor_name} helperText={fieldErrors.vendor_name} autoComplete="new-password" inputProps={{ autoComplete: 'new-password' }} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="contact_person" label="Contact Person" value={vendor.contact_person} onChange={handleInputChange} fullWidth autoComplete="new-password" inputProps={{ autoComplete: 'new-password' }} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="email" label="Email" type="email" value={vendor.email} onChange={handleInputChange} fullWidth error={!!fieldErrors.email} helperText={fieldErrors.email} autoComplete="new-password" inputProps={{ autoComplete: 'new-password' }} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="telephone_number" label="Telephone" value={vendor.telephone_number} onChange={handleInputChange} fullWidth autoComplete="new-password" inputProps={{ autoComplete: 'new-password' }} />
          </Grid>
          <Grid item xs={12}>
            <TextField name="street_address" label="Street Address" value={vendor.street_address} onChange={handleInputChange} fullWidth autoComplete="new-password" inputProps={{ autoComplete: 'new-password' }} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="city" label="City" value={vendor.city} onChange={handleInputChange} fullWidth autoComplete="new-password" inputProps={{ autoComplete: 'new-password' }} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="province" label="Province/State" value={vendor.province} onChange={handleInputChange} fullWidth autoComplete="new-password" inputProps={{ autoComplete: 'new-password' }} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="country" label="Country" value={vendor.country} onChange={handleInputChange} fullWidth autoComplete="new-password" inputProps={{ autoComplete: 'new-password' }} />
          </Grid>

          <Grid item xs={12} sm={4}>
            <TextField name="postal_code" label="Postal Code" value={vendor.postal_code} onChange={handleInputChange} fullWidth autoComplete="new-password" inputProps={{ autoComplete: 'new-password' }} />
          </Grid>
          <Grid item xs={12}>
            <TextField name="website" label="Website" value={vendor.website} onChange={handleInputChange} fullWidth autoComplete="new-password" inputProps={{ autoComplete: 'new-password' }} />
          </Grid>

          {isEditMode && vendorId && (
            <Grid item xs={12}>
              <Box sx={{ mt: 2 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>Contacts</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>People</Typography>
                    <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                      <TextField size="small" label="Name" value={newPerson} onChange={(e) => setNewPerson(e.target.value)} fullWidth />
                      <Button variant="outlined" size="small" onClick={addPerson}>Add</Button>
                    </Stack>
                    <Stack spacing={1}>
                      {contactPeople.map((p) => (
                        <Stack key={p.id} direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" sx={{ flex: 1 }}>{p.name} {p.is_preferred ? '(Preferred)' : ''}</Typography>
                          {!p.is_preferred && <Button size="small" onClick={() => makePreferredPerson(p.id)}>Set Preferred</Button>}
                          <Button size="small" color="error" onClick={() => removePerson(p.id)}>Remove</Button>
                        </Stack>
                      ))}
                      {contactPeople.length === 0 && <Typography variant="body2" color="text.secondary">No people yet.</Typography>}
                    </Stack>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>Emails</Typography>
                    <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                      <TextField size="small" label="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} fullWidth />
                      <Button variant="outlined" size="small" onClick={addEmailLocal}>Add</Button>
                    </Stack>
                    <Stack spacing={1}>
                      {contactEmails.map((e) => (
                        <Stack key={e.id} direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" sx={{ flex: 1 }}>{e.email} {e.is_preferred ? '(Preferred)' : ''}</Typography>
                          {!e.is_preferred && <Button size="small" onClick={() => makePreferredEmail(e.id)}>Set Preferred</Button>}
                          <Button size="small" color="error" onClick={() => removeEmail(e.id)}>Remove</Button>
                        </Stack>
                      ))}
                      {contactEmails.length === 0 && <Typography variant="body2" color="text.secondary">No emails yet.</Typography>}
                    </Stack>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>Phones</Typography>
                    <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                      <TextField size="small" label="Phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} fullWidth />
                      <TextField size="small" label="Label" value={newPhoneLabel} onChange={(e) => setNewPhoneLabel(e.target.value)} sx={{ width: 120 }} />
                      <Button variant="outlined" size="small" onClick={addPhoneLocal}>Add</Button>
                    </Stack>
                    <Stack spacing={1}>
                      {contactPhones.map((ph) => (
                        <Stack key={ph.id} direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" sx={{ flex: 1 }}>{ph.phone}{ph.label ? ` (${ph.label})` : ''} {ph.is_preferred ? '(Preferred)' : ''}</Typography>
                          {!ph.is_preferred && <Button size="small" onClick={() => makePreferredPhone(ph.id)}>Set Preferred</Button>}
                          <Button size="small" color="error" onClick={() => removePhone(ph.id)}>Remove</Button>
                        </Stack>
                      ))}
                      {contactPhones.length === 0 && <Typography variant="body2" color="text.secondary">No phones yet.</Typography>}
                    </Stack>
                  </Grid>
                </Grid>
              </Box>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={loading}>
          {isEditMode ? 'Save Changes' : 'Add Vendor'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UnifiedVendorDialog; 