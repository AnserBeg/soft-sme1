import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Chip
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/axios';
import { toast } from 'react-toastify';

interface EmailTemplate {
  id: number;
  name: string;
  type: string;
  subject: string;
  html_content: string;
  text_content?: string;
  is_default: boolean;
}

interface EmailModalProps {
  open: boolean;
  onClose: () => void;
  type: 'custom' | 'purchase-order' | 'sales-order' | 'quote';
  recordId?: number;
  defaultTo?: string;
  defaultSubject?: string;
  defaultMessage?: string;
  allowMessageEdit?: boolean;
}

const EmailModal: React.FC<EmailModalProps> = ({
  open,
  onClose,
  type,
  recordId,
  defaultTo,
  defaultSubject,
  defaultMessage,
  allowMessageEdit = true
}) => {
  const { user } = useAuth();
  const [to, setTo] = useState(defaultTo || '');
  const [subject, setSubject] = useState(defaultSubject || '');
  const [message, setMessage] = useState(defaultMessage || '');
  const [customMessage, setCustomMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<number | ''>('');

  // Ensure the "To" field auto-fills when the modal opens or when defaultTo arrives later
  useEffect(() => {
    console.log('EmailModal useEffect: open =', open, 'defaultTo =', defaultTo, 'current to =', to);
    if (open && defaultTo) {
      console.log('Setting to field to:', defaultTo);
      setTo(defaultTo);
    }
  }, [open, defaultTo]);

  useEffect(() => {
    if (open) {
      loadTemplates();
    }
  }, [open, type]);

  const loadTemplates = async () => {
    try {
      const response = await api.get('/api/email/templates');
      if (response.data.success) {
        const filteredTemplates = response.data.templates.filter(
          (template: EmailTemplate) => template.type === type
        );
        setTemplates(filteredTemplates);
        
        // Auto-select default template if available
        const defaultTemplate = filteredTemplates.find(t => t.is_default);
        if (defaultTemplate) {
          setSelectedTemplate(defaultTemplate.id);
          setSubject(defaultTemplate.subject);
          setMessage(defaultTemplate.html_content);
        } else if (filteredTemplates.length === 0) {
          // Provide default content when no templates exist
          if (type === 'quote') {
            setSubject('Quote Information');
            setMessage('Please find attached the quote details.');
          } else if (type === 'purchase-order') {
            setSubject('Purchase Order Information');
            setMessage('Please find attached the purchase order details.');
          } else if (type === 'sales-order') {
            setSubject('Sales Order Information');
            setMessage('Please find attached the sales order details.');
          }
        }
      }
    } catch (error) {
      console.error('Error loading templates:', error);
      // Provide default content on error
      if (type === 'quote') {
        setSubject('Quote Information');
        setMessage('Please find attached the quote details.');
      } else if (type === 'purchase-order') {
        setSubject('Purchase Order Information');
        setMessage('Please find attached the purchase order details.');
      } else if (type === 'sales-order') {
        setSubject('Sales Order Information');
        setMessage('Please find attached the sales order details.');
      }
    }
  };

  const handleTemplateChange = (templateId: number | '') => {
    setSelectedTemplate(templateId);
    if (templateId !== '') {
      const template = templates.find(t => t.id === templateId);
      if (template) {
        setSubject(template.subject);
        setMessage(template.html_content);
      }
    }
  };

  const handleSend = async () => {
    // For purchase-order, sales-order, and quote types, only 'to' is required
    // For custom emails, all fields are required
    if (type === 'custom') {
      if (!to || !subject || !message) {
        setError('Please fill in all required fields');
        return;
      }
    } else {
      if (!to) {
        setError('Please enter a recipient email address');
        return;
      }
    }

    setLoading(true);
    setError('');

    try {
      let endpoint = '/api/email/send';
      let payload: any = { to, subject, message };

      // Use specific endpoints for different types
      if (type !== 'custom' && recordId) {
        endpoint = `/api/email/${type.replace('-', '-')}/${recordId}`;
        payload = { 
          to,
          ...(customMessage && { customMessage })
        };
      }

      const response = await api.post(endpoint, payload);

      if (response.data.success) {
        toast.success('Email sent successfully!');
        onClose();
        // Reset form
        setTo('');
        setSubject('');
        setMessage('');
        setCustomMessage('');
        setSelectedTemplate('');
      } else {
        setError(response.data.message || 'Failed to send email');
      }
    } catch (error: any) {
      console.error('Error sending email:', error);
      setError(error.response?.data?.message || 'Failed to send email');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
      setError('');
    }
  };

  const getTitle = () => {
    switch (type) {
      case 'sales-order':
        return 'Send Sales Order Email';
      case 'purchase-order':
        return 'Send Purchase Order Email';
      case 'quote':
        return 'Send Quote Email';
      default:
        return 'Send Email';
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>{getTitle()}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {type !== 'custom' && templates.length > 0 && (
            <FormControl fullWidth>
              <InputLabel>Email Template</InputLabel>
              <Select
                value={selectedTemplate}
                onChange={(e) => handleTemplateChange(e.target.value as number | '')}
                label="Email Template"
              >
                <MenuItem value="">
                  <em>Use default template</em>
                </MenuItem>
                {templates.map((template) => (
                  <MenuItem key={template.id} value={template.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {template.name}
                      {template.is_default && (
                        <Chip label="Default" size="small" color="secondary" />
                      )}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <TextField
            label="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            fullWidth
            required
            type="email"
          />

          {type === 'custom' && (
            <>
              <TextField
                label="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                fullWidth
                required
              />
              <TextField
                label="Message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                fullWidth
                multiline
                rows={6}
                required
              />
            </>
          )}

          {type !== 'custom' && allowMessageEdit && (
            <TextField
              label="Additional Message (Optional)"
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              fullWidth
              multiline
              rows={4}
              helperText="Add a custom message to include with the email"
            />
          )}

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button 
          onClick={handleSend} 
          variant="contained" 
          disabled={loading}
          startIcon={loading ? <CircularProgress size={20} /> : undefined}
        >
          {loading ? 'Sending...' : 'Send Email'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EmailModal; 