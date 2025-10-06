import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography,
  Box,
  Container,
  Paper,
  TextField,
  Button,
  Grid,
  Stack,
  Alert,
  CircularProgress
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, Save as SaveIcon } from '@mui/icons-material';
import { Customer } from '../types/customer';
import { getCustomer, createCustomer, updateCustomer } from '../services/customerService';
import { toast } from 'react-toastify';
import UnifiedCustomerDialog, { CustomerFormValues } from '../components/UnifiedCustomerDialog';

const CustomerDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNewCustomer = id === 'new';
  
  console.log('Debug - URL id parameter:', id);
  console.log('Debug - isNewCustomer calculated:', isNewCustomer);
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  
  const [customer, setCustomer] = useState<Partial<Customer>>({
    customer_name: '',
    email: '',
    phone_number: '',
    street_address: '',
    city: '',
    province: '',
    country: '',
    postal_code: '',
    contact_person: '',
    website: '',
    general_notes: ''
  });

  useEffect(() => {
    if (!isNewCustomer && id) {
      fetchCustomer();
    } else if (isNewCustomer) {
      // For new customers, open the dialog after component mounts
      setDialogOpen(true);
    }
  }, [id, isNewCustomer]);

  const fetchCustomer = async () => {
    setLoading(true);
    try {
      if (!id) {
        throw new Error('Customer ID is required');
      }
      const customerData = await getCustomer(id as string);
      setCustomer(customerData);
    } catch (error) {
      console.error('Error fetching customer:', error);
      setError('Failed to load customer data');
      toast.error('Failed to load customer data');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: keyof Customer) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setCustomer(prev => ({
      ...prev,
      [field]: event.target.value
    }));
  };

  const validateForm = (): boolean => {
    if (!customer.customer_name?.trim()) {
      setError('Customer name is required');
      return false;
    }
    setError(null);
    return true;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    console.log('Debug - id:', id);
    console.log('Debug - isNewCustomer:', isNewCustomer);
    console.log('Debug - customer data:', customer);

    setSaving(true);
    try {
      if (isNewCustomer) {
        console.log('Debug - Calling createCustomer');
        await createCustomer(customer as Omit<Customer, 'id' | 'created_at' | 'updated_at'>);
        toast.success('Customer created successfully');
      } else {
        console.log('Debug - Calling updateCustomer with id:', id);
        await updateCustomer(id!, customer as Customer);
        toast.success('Customer updated successfully');
      }
      navigate('/customers');
    } catch (error) {
      console.error('Error saving customer:', error);
      setError('Failed to save customer');
      toast.error('Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    navigate('/customers');
  };

  if (loading) {
    return (
      <Container maxWidth="md">
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="md">
      <Box sx={{ my: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={handleCancel}
            sx={{ mr: 2 }}
          >
            Back to Customers
          </Button>
          <Typography variant="h4" component="h1">
            {isNewCustomer ? 'Add New Customer' : 'Edit Customer'}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <UnifiedCustomerDialog
          open={dialogOpen}
          onClose={() => {
            setDialogOpen(false);
            handleCancel();
          }}
          onSave={async (customer: CustomerFormValues) => {
            setSaving(true);
            try {
              if (isNewCustomer) {
                await createCustomer(customer);
                toast.success('Customer created successfully');
              } else {
                await updateCustomer(id!, customer);
                toast.success('Customer updated successfully');
              }
              navigate('/customers');
            } catch (error) {
              toast.error('Failed to save customer');
            } finally {
              setSaving(false);
            }
          }}
          initialCustomer={isNewCustomer ? {} : customer}
          isEditMode={!isNewCustomer}
          loading={saving}
        />
      </Box>
    </Container>
  );
};

export default CustomerDetailPage; 