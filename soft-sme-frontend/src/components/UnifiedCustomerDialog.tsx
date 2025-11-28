import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Grid, Typography, Box, Stack } from '@mui/material';
import { getBusinessProfileData } from '../services/businessProfileService';
import { useDebounce } from '../hooks/useDebounce';
import api from '../api/axios';
import {
  getCustomerContacts,
  addCustomerContactPerson,
  updateCustomerContactPerson,
  deleteCustomerContactPerson,
  addCustomerEmail,
  updateCustomerEmail,
  deleteCustomerEmail,
  addCustomerPhone,
  updateCustomerPhone,
  deleteCustomerPhone,
} from '../services/customerService';

export interface CustomerFormValues {
  customer_id: string;
  customer_name: string;
  contact_person: string;
  email: string;
  phone_number: string;
  street_address: string;
  city: string;
  province: string;
  country: string;
  postal_code: string;
  default_payment_terms_in_days?: number;
  website: string;
  general_notes: string;
}

interface UnifiedCustomerDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (customer: CustomerFormValues) => void;
  initialCustomer?: Partial<CustomerFormValues>;
  isEditMode?: boolean;
  loading?: boolean;
  onUseExisting?: (existing: { customer_id: number; customer_name: string }) => void;
}

const defaultCustomer: CustomerFormValues = {
  customer_id: '',
  customer_name: '',
  contact_person: '',
  email: '',
  phone_number: '',
  street_address: '',
  city: '',
  province: '',
  country: '',
  postal_code: '',
  default_payment_terms_in_days: 30,
  website: '',
  general_notes: '',
};

const UnifiedCustomerDialog: React.FC<UnifiedCustomerDialogProps> = ({
  open,
  onClose,
  onSave,
  initialCustomer,
  isEditMode = false,
  loading = false,
  onUseExisting,
}) => {
  const [customer, setCustomer] = useState<CustomerFormValues>(defaultCustomer);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof CustomerFormValues, string>>>({});
  const debouncedCustomer = useDebounce(customer, 300);
  const [existingCustomers, setExistingCustomers] = useState<Array<{ customer_id: number; customer_name: string }>>([]);
  const [duplicateCandidate, setDuplicateCandidate] = useState<{ customer_id: number; customer_name: string } | null>(null);
  const [contactPeople, setContactPeople] = useState<any[]>([]);
  const [contactEmails, setContactEmails] = useState<any[]>([]);
  const [contactPhones, setContactPhones] = useState<any[]>([]);
  const [newPerson, setNewPerson] = useState<string>('');
  const [newEmail, setNewEmail] = useState<string>('');
  const [newPhone, setNewPhone] = useState<string>('');
  const [newPhoneLabel, setNewPhoneLabel] = useState<string>('');

  const handleAutoFill = async () => {
    try {
      const businessData = await getBusinessProfileData();
      
      setCustomer(prev => ({
        ...prev,
        city: businessData.city,
        province: businessData.province,
        country: businessData.country,
      }));
    } catch (error) {
      console.error('Error autofilling from business profile:', error);
    }
  };

  useEffect(() => {
    if (open) {
      const newCustomer = { ...defaultCustomer, ...initialCustomer };
      setCustomer(newCustomer);
      setError(null);
      // Load existing customers for duplicate name checks
      (async () => {
        try {
          const res = await api.get('/api/customers');
          setExistingCustomers(res.data || []);
        } catch (e) {
          // non-blocking; ignore
        }
      })();
      
      // Auto-fill city, province, and country from business profile for new customers
      if (!isEditMode && (!initialCustomer?.city || initialCustomer.city === '') && (!initialCustomer?.province || initialCustomer.province === '') && (!initialCustomer?.country || initialCustomer.country === '')) {
        handleAutoFill();
      }

      // Load contacts when editing existing customer
      const cid = (initialCustomer as any)?.customer_id as number | undefined;
      if (isEditMode && cid) {
        (async () => {
          try {
            const data = await getCustomerContacts(cid);
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
  }, [open, initialCustomer, isEditMode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCustomer((prev) => ({ ...prev, [name]: value }));
    // Clear field-level error as user types
    if (fieldErrors[name as keyof CustomerFormValues]) {
      setFieldErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  const validate = () => {
    if (!customer.customer_name.trim()) {
      setError('Customer name is required');
      return false;
    }
    setError(null);
    return true;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave(customer);
  };

  // Utilities for duplicate guard
  const normalizeString = (value: string): string => {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  };

  // Simple Jaro-Winkler implementation for fuzzy similarity
  const jaroWinkler = (s1: string, s2: string): number => {
    const m = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    if (m < 0) return 0;
    const s1Matches: boolean[] = new Array(s1.length).fill(false);
    const s2Matches: boolean[] = new Array(s2.length).fill(false);
    let matches = 0;
    for (let i = 0; i < s1.length; i++) {
      const start = Math.max(0, i - m);
      const end = Math.min(i + m + 1, s2.length);
      for (let j = start; j < end; j++) {
        if (s2Matches[j]) continue;
        if (s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }
    if (matches === 0) return 0;
    const s1Matched: string[] = [];
    const s2Matched: string[] = [];
    for (let i = 0; i < s1.length; i++) if (s1Matches[i]) s1Matched.push(s1[i]);
    for (let j = 0; j < s2.length; j++) if (s2Matches[j]) s2Matched.push(s2[j]);
    let transpositions = 0;
    for (let i = 0; i < s1Matched.length; i++) if (s1Matched[i] !== s2Matched[i]) transpositions++;
    transpositions = Math.floor(transpositions / 2);
    const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions) / matches) / 3;
    // Winkler adjustment
    let prefix = 0;
    const maxPrefix = 4;
    for (let i = 0; i < Math.min(maxPrefix, s1.length, s2.length); i++) {
      if (s1[i] === s2[i]) prefix++;
      else break;
    }
    const p = 0.1;
    return jaro + prefix * p * (1 - jaro);
  };

  // Debounced side-effect validation (e.g., email format) and duplicate guard
  useEffect(() => {
    if (!open) return;
    const newFieldErrors: Partial<Record<keyof CustomerFormValues, string>> = {};
    if (debouncedCustomer.email && debouncedCustomer.email.trim().length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(debouncedCustomer.email.trim())) {
        newFieldErrors.email = 'Invalid email format';
      }
    }
    // Duplicate name check (normalized exact + fuzzy)
    let bestCandidate: { customer_id: number; customer_name: string } | null = null;
    let bestScore = 0;
    if (debouncedCustomer.customer_name && debouncedCustomer.customer_name.trim().length > 0) {
      const normalizedInput = normalizeString(debouncedCustomer.customer_name);
      const currentId = (initialCustomer?.customer_id ?? debouncedCustomer.customer_id) || '';
      for (const c of existingCustomers) {
        const sameRecord = String(c.customer_id) === String(currentId || '');
        if (sameRecord) continue;
        const normalizedExisting = normalizeString(c.customer_name || '');
        const exact = normalizedExisting === normalizedInput;
        const score = exact ? 1 : jaroWinkler(normalizedExisting, normalizedInput);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = c;
        }
      }
      // Threshold for warning
      if (bestScore >= 0.92) {
        newFieldErrors.customer_name = 'A similar customer already exists';
      }
    }
    setDuplicateCandidate(bestScore >= 0.92 && bestCandidate ? bestCandidate : null);
    setFieldErrors(prev => ({ ...prev, ...newFieldErrors }));
  }, [debouncedCustomer, open]);

  // Contact helpers
  const customerId = (initialCustomer as any)?.customer_id as number | undefined;
  const refreshContacts = async () => {
    if (!isEditMode || !customerId) return;
    try {
      const data = await getCustomerContacts(customerId);
      setContactPeople(data.people || []);
      setContactEmails(data.emails || []);
      setContactPhones(data.phones || []);
    } catch {}
  };

  const addPerson = async () => {
    if (!customerId || !newPerson.trim()) return;
    await addCustomerContactPerson(customerId, { name: newPerson.trim() });
    setNewPerson('');
    refreshContacts();
  };
  const makePreferredPerson = async (id: number) => {
    if (!customerId) return;
    await updateCustomerContactPerson(customerId, id, { is_preferred: true });
    refreshContacts();
  };
  const removePerson = async (id: number) => {
    if (!customerId) return;
    await deleteCustomerContactPerson(customerId, id);
    refreshContacts();
  };

  const addEmailLocal = async () => {
    if (!customerId || !newEmail.trim()) return;
    await addCustomerEmail(customerId, { email: newEmail.trim() });
    setNewEmail('');
    refreshContacts();
  };
  const makePreferredEmail = async (id: number) => {
    if (!customerId) return;
    await updateCustomerEmail(customerId, id, { is_preferred: true });
    refreshContacts();
  };
  const removeEmail = async (id: number) => {
    if (!customerId) return;
    await deleteCustomerEmail(customerId, id);
    refreshContacts();
  };

  const addPhoneLocal = async () => {
    if (!customerId || !newPhone.trim()) return;
    await addCustomerPhone(customerId, { phone: newPhone.trim(), label: newPhoneLabel.trim() || undefined });
    setNewPhone('');
    setNewPhoneLabel('');
    refreshContacts();
  };
  const makePreferredPhone = async (id: number) => {
    if (!customerId) return;
    await updateCustomerPhone(customerId, id, { is_preferred: true });
    refreshContacts();
  };
  const removePhone = async (id: number) => {
    if (!customerId) return;
    await deleteCustomerPhone(customerId, id);
    refreshContacts();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEditMode ? 'Edit Customer' : 'Add New Customer'}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12} sm={4}>
            <TextField name="customer_name" label="Customer Name" value={customer.customer_name} onChange={handleInputChange} fullWidth required error={!!fieldErrors.customer_name} helperText={fieldErrors.customer_name} autoFocus />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="contact_person" label="Contact Person" value={customer.contact_person} onChange={handleInputChange} fullWidth />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="email" label="Email" type="email" value={customer.email} onChange={handleInputChange} fullWidth error={!!fieldErrors.email} helperText={fieldErrors.email} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="phone_number" label="Phone Number" value={customer.phone_number} onChange={handleInputChange} fullWidth />
          </Grid>
          <Grid item xs={12}>
            <TextField name="street_address" label="Street Address" value={customer.street_address} onChange={handleInputChange} fullWidth />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="city" label="City" value={customer.city} onChange={handleInputChange} fullWidth />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="province" label="Province/State" value={customer.province} onChange={handleInputChange} fullWidth />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="country" label="Country" value={customer.country} onChange={handleInputChange} fullWidth />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField name="postal_code" label="Postal Code" value={customer.postal_code} onChange={handleInputChange} fullWidth />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              name="default_payment_terms_in_days"
              label="Payment Terms (days)"
              type="number"
              value={customer.default_payment_terms_in_days ?? ''}
              onChange={handleInputChange}
              fullWidth
            />
          </Grid>
          <Grid item xs={12}>
            <TextField name="website" label="Website" value={customer.website} onChange={handleInputChange} fullWidth />
          </Grid>
          <Grid item xs={12}>
            <TextField
              name="general_notes"
              label="General Notes"
              value={customer.general_notes}
              onChange={handleInputChange}
              fullWidth
              multiline
              minRows={4}
            />
          </Grid>

          {isEditMode && customerId && (
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
        {error && <div style={{ color: 'red', marginTop: 8 }}>{error}</div>}
        {duplicateCandidate && (
          <div style={{ marginTop: 12 }}>
            <div style={{ color: '#b26a00', marginBottom: 8 }}>
              Looks like "{duplicateCandidate.customer_name}" already exists.
            </div>
            {typeof (onUseExisting) === 'function' && (
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  onUseExisting(duplicateCandidate);
                }}
              >
                Use existing
              </Button>
            )}
          </div>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={loading}>
          {isEditMode ? 'Save Changes' : 'Add Customer'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UnifiedCustomerDialog; 
