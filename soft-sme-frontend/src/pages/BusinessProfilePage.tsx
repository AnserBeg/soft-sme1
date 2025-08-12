import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  TextField,
  Button,
  Paper,
  Stack,
  CircularProgress,
  Card,
  CardMedia,
  Grid,
  Divider,
  Alert,
  IconButton,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import EditIcon from '@mui/icons-material/Edit';
import api from "../api/axios";
import { BusinessProfile } from '../types/business';
import { toast } from 'react-toastify';
import { formatCurrency, getLogoUrl } from '../utils/formatters';
import { getApiConfig } from '../config/api';
import defaultLogo from '../assets/default-logo.png';

const BACKEND_URL = getApiConfig().baseURL;

const BusinessProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<BusinessProfile>({
    id: '',
    business_name: '',
    street_address: '',
    city: '',
    province: '',
    country: '',
    postal_code: '',
    telephone_number: '',
    email: '',
    business_number: '',
    website: '',
    logo_url: '',
    created_at: '',
    updated_at: '',
  });
  const [loading, setLoading] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Map backend keys to frontend state keys if needed
  const mapProfileFromBackend = (data: any): BusinessProfile => ({
    id: data.id || '',
    business_name: data.business_name || '',
    street_address: data.street_address || '',
    city: data.city || '',
    province: data.province || '',
    country: data.country || '',
    postal_code: data.postal_code || '',
    telephone_number: data.telephone_number || '',
    email: data.email || '',
    business_number: data.business_number || '',
    website: data.website || '',
    logo_url: data.logo_url || '',
    created_at: data.created_at || '',
    updated_at: data.updated_at || '',
  });

  useEffect(() => {
    fetchBusinessProfile();
  }, []);

  const fetchBusinessProfile = async () => {
    try {
      const response = await api.get('/api/business-profile');
      console.log('Business Profile API Response:', response.data);
      console.log('Logo URL from API:', response.data.logo_url);
      setProfile(mapProfileFromBackend(response.data));
    } catch (error: any) {
      if (error.response?.status === 404) {
        // No profile exists yet - switch to edit mode
        setIsEditing(true);
        return;
      }
      console.error('Error fetching business profile:', error);
      toast.error('Failed to load business profile');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setProfile(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setLogoFile(file);
      
      // Create preview URL
      const previewUrl = URL.createObjectURL(file);
      setLogoPreview(previewUrl);
    }
  };

  const handleDeleteLogo = async () => {
    if (!profile.logo_url) return;
    
    try {
      setLoading(true);
      await api.delete('/api/business-profile/logo');
      setProfile(prev => ({ ...prev, logo_url: '' }));
      toast.success('Logo deleted successfully');
    } catch (error) {
      console.error('Error deleting logo:', error);
      toast.error('Failed to delete logo');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const formData = new FormData();
      Object.entries(profile).forEach(([key, value]) => {
        // Convert frontend camelCase to backend snake_case for formData keys, if necessary
        let backendKey = key;
        switch (key) {
          case 'business_name':
            backendKey = 'business_name';
            break;
          case 'street_address':
            backendKey = 'street_address';
            break;
          case 'telephone_number':
            backendKey = 'telephone_number';
            break;
          case 'business_number':
            backendKey = 'business_number';
            break;
          case 'email':
            backendKey = 'email';
            break;
          case 'website':
            backendKey = 'website';
            break;
          case 'city':
            backendKey = 'city';
            break;
          case 'province':
            backendKey = 'province';
            break;
          case 'country':
            backendKey = 'country';
            break;
          case 'postal_code':
            backendKey = 'postal_code';
            break;
          // Do not append logo_url here, it's handled separately by logoFile
          case 'logo_url':
            return; // Skip appending logo_url from profile object
          case 'id':
          case 'created_at':
          case 'updated_at':
            return; // These fields are not sent in PUT requests for business profile
        }
        if (value !== undefined && value !== null) {
          formData.append(backendKey, value);
        }
      });
      if (logoFile) {
        formData.append('logo', logoFile);
      }

      // Debug: Log the form data being sent
      console.log('Form data being sent:');
      for (let [key, value] of formData.entries()) {
        console.log(`${key}:`, value);
      }

      await api.post('/api/business-profile', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      toast.success('Business profile updated successfully');
      setIsEditing(false);
      setLogoFile(null);
      setLogoPreview(null);
      fetchBusinessProfile();
    } catch (error: any) {
      console.error('Error updating business profile:', error);
      console.error('Error response:', error.response);
      console.error('Error message:', error.message);
      
      // Provide more specific error messages
      if (error.response?.status === 401) {
        toast.error('Authentication failed. Please log in again.');
      } else if (error.response?.status === 403) {
        toast.error('Access denied. You do not have permission to update the business profile.');
      } else if (error.response?.status === 404) {
        toast.error('Business profile endpoint not found. Please check your API configuration.');
      } else if (error.response?.status === 500) {
        toast.error('Server error. Please try again later.');
      } else if (error.code === 'NETWORK_ERROR') {
        toast.error('Network error. Please check your connection and try again.');
      } else if (error.message?.includes('timeout')) {
        toast.error('Request timed out. Please try again.');
      } else {
        toast.error(`Failed to update business profile: ${error.response?.data?.error || error.message || 'Unknown error'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setLogoFile(null);
    setLogoPreview(null);
    
    // If there's no existing profile, reset to empty state
    if (!profile.id) {
      setProfile({
        id: '',
        business_name: '',
        street_address: '',
        city: '',
        province: '',
        country: '',
        postal_code: '',
        telephone_number: '',
        email: '',
        business_number: '',
        logo_url: '',
        created_at: '',
        updated_at: '',
      });
    } else {
      // If there is an existing profile, fetch it to reset to original values
      fetchBusinessProfile();
    }
  };



  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <CircularProgress />
      </Box>
    );
  }

  const renderReadOnlyView = () => {
    // Check if profile exists (has an id)
    const hasProfile = !!profile.id;
    
    return (
      <Box display="flex" justifyContent="center" alignItems="flex-start" minHeight="70vh">
        <Paper
          sx={{
            p: { xs: 2, md: 4 },
            width: '100%',
            maxWidth: 650,
            borderRadius: 4,
            boxShadow: 6,
            bgcolor: 'background.paper',
          }}
          elevation={6}
        >
          <Stack spacing={4}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="h5" fontWeight={700} color="primary.main">
                {hasProfile ? 'Current Business Profile' : 'Business Profile'}
              </Typography>
              <Box>
                <Button
                  variant="contained"
                  startIcon={<EditIcon />}
                  onClick={() => setIsEditing(true)}
                  sx={{ borderRadius: 2, fontWeight: 600 }}
                >
                  {hasProfile ? 'Edit Profile' : 'Create Profile'}
                </Button>
              </Box>
            </Box>
            <Divider sx={{ bgcolor: 'primary.light', height: 3, borderRadius: 2 }} />

            {!hasProfile ? (
              // No profile exists - show message to create one
              <Box textAlign="center" py={4}>
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  No Business Profile Found
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                  Create your business profile to get started. This information will be used in your quotes, invoices, and other business documents.
                </Typography>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<EditIcon />}
                  onClick={() => setIsEditing(true)}
                  sx={{ borderRadius: 2, fontWeight: 600 }}
                >
                  Create Business Profile
                </Button>
              </Box>
            ) : (
              // Profile exists - show the profile data
              <>
                {/* Logo Display */}
                {profile.logo_url && (
                  <Box display="flex" flexDirection="column" alignItems="center" mb={2}>
                    <Typography variant="subtitle1" fontWeight={600} color="primary.dark" gutterBottom>
                      Business Logo
                    </Typography>
                    <Card
                      sx={{
                        maxWidth: 180,
                        borderRadius: 3,
                        boxShadow: 3,
                        border: '2px solid',
                        borderColor: 'primary.light',
                        p: 1,
                        mb: 1,
                        bgcolor: 'grey.50',
                      }}
                    >
                      <CardMedia
                        component="img"
                        image={profile.logo_url ? getLogoUrl(profile.logo_url) : defaultLogo}
                        onError={(e) => e.currentTarget.src = defaultLogo}
                        alt="Business Logo"
                        sx={{ height: 120, objectFit: 'contain', borderRadius: 2, bgcolor: 'white' }}
                      />
                    </Card>
                  </Box>
                )}

                {/* Business Information */}
                <Grid container spacing={3}>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="primary" fontWeight={600} gutterBottom sx={{ fontSize: '1rem' }}>
                      Business Name
                    </Typography>
                    <Typography variant="body1" fontWeight={500} mb={2} sx={{ fontSize: '1.1rem' }}>{profile.business_name}</Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="primary" fontWeight={600} gutterBottom sx={{ fontSize: '1rem' }}>
                      Business Number
                    </Typography>
                    <Typography variant="body1" fontWeight={500} mb={2} sx={{ fontSize: '1.1rem' }}>{profile.business_number}</Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="primary" fontWeight={600} gutterBottom sx={{ fontSize: '1rem' }}>
                      Address
                    </Typography>
                    <Typography variant="body1" fontWeight={500} mb={2} sx={{ fontSize: '1.1rem' }}>
                      {profile.street_address}<br />
                      {profile.city}, {profile.province}{profile.postal_code ? `, ${profile.postal_code}` : ''}<br />
                      {profile.country}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="primary" fontWeight={600} gutterBottom sx={{ fontSize: '1rem' }}>
                      Email
                    </Typography>
                    <Typography variant="body1" fontWeight={500} mb={2} sx={{ fontSize: '1.1rem' }}>{profile.email}</Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="primary" fontWeight={600} gutterBottom sx={{ fontSize: '1rem' }}>
                      Telephone
                    </Typography>
                    <Typography variant="body1" fontWeight={500} mb={2} sx={{ fontSize: '1.1rem' }}>{profile.telephone_number}</Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="primary" fontWeight={600} gutterBottom sx={{ fontSize: '1rem' }}>
                      Website
                    </Typography>
                    <Typography variant="body1" fontWeight={500} mb={2} sx={{ fontSize: '1.1rem' }}>
                      {profile.website ? (
                        <a href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`} 
                           target="_blank" 
                           rel="noopener noreferrer"
                           style={{ color: 'inherit', textDecoration: 'underline' }}>
                          {profile.website}
                        </a>
                      ) : (
                        'Not provided'
                      )}
                    </Typography>
                  </Grid>
                </Grid>
              </>
            )}
          </Stack>
        </Paper>
      </Box>
    );
  };

  const renderEditForm = () => (
    <Box display="flex" justifyContent="center" alignItems="flex-start" minHeight="70vh">
      <Paper
        sx={{
          p: { xs: 2, md: 4 },
          width: '100%',
          maxWidth: 650,
          borderRadius: 4,
          boxShadow: 6,
          bgcolor: 'background.paper',
        }}
        elevation={6}
        component="form"
        onSubmit={handleSubmit}
      >
        <Stack spacing={4}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="h5" fontWeight={700} color="primary.main">
              {profile.id ? 'Edit Business Profile' : 'Create Business Profile'}
            </Typography>
            <Box>
              <Button
                variant="outlined"
                onClick={handleCancel}
                sx={{ borderRadius: 2, fontWeight: 600, mr: 2 }}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                type="submit"
                disabled={loading}
                sx={{ borderRadius: 2, fontWeight: 600 }}
              >
                {loading ? <CircularProgress size={24} /> : (profile.id ? 'Save Changes' : 'Create Profile')}
              </Button>
            </Box>
          </Box>
          <Divider sx={{ bgcolor: 'primary.light', height: 3, borderRadius: 2 }} />

          <Grid container spacing={3}>
            <Grid item xs={12}>
              <TextField
                label="Business Name"
                name="business_name"
                value={profile.business_name}
                onChange={handleInputChange}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Business Number/GST-HST Registration Number"
                name="business_number"
                value={profile.business_number}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Street Address"
                name="street_address"
                value={profile.street_address}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="City"
                name="city"
                value={profile.city}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Province"
                name="province"
                value={profile.province}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Country"
                name="country"
                value={profile.country}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Postal Code"
                name="postal_code"
                value={profile.postal_code}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Telephone Number"
                name="telephone_number"
                value={profile.telephone_number}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Email"
                name="email"
                value={profile.email}
                onChange={handleInputChange}
                fullWidth
                type="email"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Website"
                name="website"
                value={profile.website}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>

            {/* Logo Upload */}
            <Grid item xs={12}>
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                Business Logo
              </Typography>
              {profile.logo_url && (
                <Box display="flex" flexDirection="column" alignItems="center" mb={2}>
                  <Card
                    sx={{
                      maxWidth: 180,
                      borderRadius: 3,
                      boxShadow: 3,
                      border: '2px solid',
                      borderColor: 'primary.light',
                      p: 1,
                      mb: 1,
                      bgcolor: 'grey.50',
                    }}
                  >
                    <CardMedia
                      component="img"
                      image={profile.logo_url ? getLogoUrl(profile.logo_url) : defaultLogo}
                      onError={(e) => e.currentTarget.src = defaultLogo}
                      alt="Business Logo"
                      sx={{ height: 120, objectFit: 'contain', borderRadius: 2, bgcolor: 'white' }}
                    />
                  </Card>
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteIcon />}
                    onClick={handleDeleteLogo}
                    sx={{ borderRadius: 2, fontWeight: 600 }}
                  >
                    Delete Current Logo
                  </Button>
                </Box>
              )}
              <Button
                variant="contained"
                component="label"
                startIcon={<CloudUploadIcon />}
                sx={{ borderRadius: 2, fontWeight: 600 }}
              >
                {profile.logo_url ? 'Change Logo' : 'Upload Logo'}
                <input type="file" hidden onChange={handleLogoChange} accept="image/*" />
              </Button>
              {logoPreview && (
                <Box mt={2} display="flex" flexDirection="column" alignItems="center">
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    New Logo Preview:
                  </Typography>
                  <img src={logoPreview} alt="Logo Preview" style={{ maxWidth: '100px', maxHeight: '100px' }} />
                </Box>
              )}
            </Grid>
          </Grid>
        </Stack>
      </Paper>
    </Box>
  );

  return <Container sx={{ mt: 4, mb: 4 }}>{isEditing ? renderEditForm() : renderReadOnlyView()}</Container>;
};

export default BusinessProfilePage; 