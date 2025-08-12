import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Button,
  Card,
  CardContent,
  CardActions,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  IconButton,
  Chip,
  Alert,
  Snackbar
} from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/axios';

interface EmailTemplate {
  id: number;
  name: string;
  type: 'purchase_order' | 'quote' | 'sales_order' | 'custom';
  subject: string;
  html_content: string;
  text_content?: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

const EmailTemplatesPage: React.FC = () => {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'purchase_order' as 'purchase_order' | 'quote' | 'sales_order' | 'custom',
    subject: '',
    html_content: '',
    text_content: '',
    is_default: false
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const response = await api.get('/api/email/templates');
      if (response.data.success) {
        setTemplates(response.data.templates);
      }
    } catch (error: any) {
      console.error('Error loading templates:', error);
      setError('Failed to load email templates');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (template?: EmailTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setFormData({
        name: template.name,
        type: template.type,
        subject: template.subject,
        html_content: template.html_content,
        text_content: template.text_content || '',
        is_default: template.is_default
      });
    } else {
      setEditingTemplate(null);
      setFormData({
        name: '',
        type: 'purchase_order',
        subject: '',
        html_content: '',
        text_content: '',
        is_default: false
      });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingTemplate(null);
    setFormData({
      name: '',
      type: 'purchase_order',
      subject: '',
      html_content: '',
      text_content: '',
      is_default: false
    });
  };

  const handleSubmit = async () => {
    try {
      if (editingTemplate) {
        await api.put(`/api/email/templates/${editingTemplate.id}`, formData);
        setSuccess('Email template updated successfully');
      } else {
        await api.post('/api/email/templates', formData);
        setSuccess('Email template created successfully');
      }
      handleCloseDialog();
      loadTemplates();
    } catch (error: any) {
      console.error('Error saving template:', error);
      setError(error.response?.data?.message || 'Failed to save template');
    }
  };

  const handleDelete = async (templateId: number) => {
    if (!window.confirm('Are you sure you want to delete this template?')) {
      return;
    }

    try {
      await api.delete(`/api/email/templates/${templateId}`);
      setSuccess('Email template deleted successfully');
      loadTemplates();
    } catch (error: any) {
      console.error('Error deleting template:', error);
      setError(error.response?.data?.message || 'Failed to delete template');
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'purchase_order':
        return 'primary';
      case 'sales_order':
        return 'success';
      case 'quote':
        return 'warning';
      case 'custom':
        return 'info';
      default:
        return 'default';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'purchase_order':
        return 'Purchase Order';
      case 'sales_order':
        return 'Sales Order';
      case 'quote':
        return 'Quote';
      case 'custom':
        return 'Custom';
      default:
        return type;
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg">
        <Typography variant="h4" gutterBottom>
          Loading...
        </Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          Email Templates
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          Create Template
        </Button>
      </Box>

      <Grid container spacing={3}>
        {templates.map((template) => (
          <Grid item xs={12} md={6} lg={4} key={template.id}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Typography variant="h6" component="div">
                    {template.name}
                  </Typography>
                  <Box>
                    <IconButton
                      size="small"
                      onClick={() => handleOpenDialog(template)}
                      color="primary"
                    >
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleDelete(template.id)}
                      color="error"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                </Box>
                
                <Chip
                  label={getTypeLabel(template.type)}
                  color={getTypeColor(template.type) as any}
                  size="small"
                  sx={{ mb: 1 }}
                />
                
                {template.is_default && (
                  <Chip
                    label="Default"
                    color="secondary"
                    size="small"
                    sx={{ ml: 1 }}
                  />
                )}
                
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  <strong>Subject:</strong> {template.subject}
                </Typography>
                
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  <strong>Created:</strong> {new Date(template.created_at).toLocaleDateString()}
                </Typography>
                
                <Typography variant="body2" color="text.secondary">
                  <strong>Updated:</strong> {new Date(template.updated_at).toLocaleDateString()}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {templates.length === 0 && (
        <Box sx={{ textAlign: 'center', mt: 4 }}>
          <Typography variant="h6" color="text.secondary">
            No email templates found
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Create your first email template to get started
          </Typography>
        </Box>
      )}

      {/* Template Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingTemplate ? 'Edit Email Template' : 'Create Email Template'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Template Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              fullWidth
              required
            />
            
            <FormControl fullWidth>
              <InputLabel>Template Type</InputLabel>
              <Select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                label="Template Type"
              >
                <MenuItem value="purchase_order">Purchase Order</MenuItem>
                <MenuItem value="sales_order">Sales Order</MenuItem>
                <MenuItem value="quote">Quote</MenuItem>
                <MenuItem value="custom">Custom</MenuItem>
              </Select>
            </FormControl>
            
            <TextField
              label="Subject"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              fullWidth
              required
            />
            
            <TextField
              label="HTML Content"
              value={formData.html_content}
              onChange={(e) => setFormData({ ...formData, html_content: e.target.value })}
              fullWidth
              multiline
              rows={8}
              required
              helperText="Use HTML formatting for rich email content"
            />
            
            <TextField
              label="Text Content (Optional)"
              value={formData.text_content}
              onChange={(e) => setFormData({ ...formData, text_content: e.target.value })}
              fullWidth
              multiline
              rows={4}
              helperText="Plain text version for email clients that don't support HTML"
            />
            
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_default}
                  onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                />
              }
              label="Set as default template for this type"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained">
            {editingTemplate ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Notifications */}
      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError('')}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setError('')} severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!success}
        autoHideDuration={6000}
        onClose={() => setSuccess('')}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setSuccess('')} severity="success" sx={{ width: '100%' }}>
          {success}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default EmailTemplatesPage; 