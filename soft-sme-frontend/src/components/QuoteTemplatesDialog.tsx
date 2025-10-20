import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentPasteGoIcon from '@mui/icons-material/ContentPasteGo';
import TableChartIcon from '@mui/icons-material/TableChart';
import { AxiosError } from 'axios';
import api from '../api/axios';

export interface QuoteDescriptionTemplate {
  template_id: number;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
  created_by?: number | null;
}

interface QuoteTemplatesDialogProps {
  open: boolean;
  onClose: () => void;
  onTemplateSelected: (template: QuoteDescriptionTemplate) => void;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

interface TemplateFormState {
  name: string;
  content: string;
}

const emptyFormState: TemplateFormState = {
  name: '',
  content: '',
};

const monospaceInputSx = {
  '& textarea': {
    fontFamily: 'Roboto Mono, Consolas, Menlo, monospace',
    fontSize: 14,
    whiteSpace: 'pre',
  },
} as const;

const QuoteTemplatesDialog: React.FC<QuoteTemplatesDialogProps> = ({
  open,
  onClose,
  onTemplateSelected,
  onSuccess,
  onError,
}) => {
  const [templates, setTemplates] = useState<QuoteDescriptionTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formState, setFormState] = useState<TemplateFormState>(emptyFormState);
  const [formErrors, setFormErrors] = useState<{ name?: string; content?: string; submit?: string }>({});
  const [isSaving, setIsSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<QuoteDescriptionTemplate | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadTemplates();
  }, [open]);

  const loadTemplates = async () => {
    try {
      setIsLoading(true);
      setListError(null);
      const response = await api.get('/api/quote-templates');
      const fetched = Array.isArray(response.data?.templates)
        ? (response.data.templates as QuoteDescriptionTemplate[])
        : [];
      setTemplates(fetched);
    } catch (error) {
      console.error('Failed to load quote templates', error);
      const message = (error as AxiosError)?.response?.data &&
        typeof (error as AxiosError).response?.data === 'object' &&
        'message' in ((error as AxiosError).response?.data as any)
        ? (((error as AxiosError).response?.data as any).message as string)
        : 'Failed to load quote templates';
      setListError(message);
      onError?.(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenForm = (template?: QuoteDescriptionTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setFormState({ name: template.name, content: template.content });
    } else {
      setEditingTemplate(null);
      setFormState(emptyFormState);
    }
    setFormErrors({});
    setFormOpen(true);
  };

  const handleCloseForm = () => {
    if (isSaving) {
      return;
    }
    setFormOpen(false);
    setEditingTemplate(null);
    setFormState(emptyFormState);
    setFormErrors({});
  };

  const validateForm = (): boolean => {
    const errors: { name?: string; content?: string; submit?: string } = {};
    if (!formState.name.trim()) {
      errors.name = 'Template name is required';
    }
    if (!formState.content.trim()) {
      errors.content = 'Template content is required';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveTemplate = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setIsSaving(true);
      const payload = {
        name: formState.name.trim(),
        content: formState.content,
      };

      if (editingTemplate) {
        await api.put(`/api/quote-templates/${editingTemplate.template_id}`, payload);
        onSuccess?.('Template updated successfully');
      } else {
        await api.post('/api/quote-templates', payload);
        onSuccess?.('Template created successfully');
      }

      setFormOpen(false);
      setEditingTemplate(null);
      setFormState(emptyFormState);
      await loadTemplates();
    } catch (error) {
      console.error('Failed to save quote template', error);
      const axiosError = error as AxiosError;
      const message = axiosError.response?.data &&
        typeof axiosError.response.data === 'object' &&
        'message' in (axiosError.response.data as any)
        ? ((axiosError.response.data as any).message as string)
        : 'Failed to save quote template';
      setFormErrors((prev) => ({ ...prev, submit: message }));
      onError?.(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTemplate = async (template: QuoteDescriptionTemplate) => {
    const confirmed = window.confirm(`Delete template "${template.name}"?`);
    if (!confirmed) {
      return;
    }

    try {
      await api.delete(`/api/quote-templates/${template.template_id}`);
      onSuccess?.('Template deleted');
      await loadTemplates();
    } catch (error) {
      console.error('Failed to delete quote template', error);
      const axiosError = error as AxiosError;
      const message = axiosError.response?.data &&
        typeof axiosError.response.data === 'object' &&
        'message' in (axiosError.response.data as any)
        ? ((axiosError.response.data as any).message as string)
        : 'Failed to delete template';
      onError?.(message);
    }
  };

  const handleUseTemplate = (template: QuoteDescriptionTemplate) => {
    onTemplateSelected(template);
  };

  const renderedTemplates = useMemo(() => templates, [templates]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle display="flex" alignItems="center" gap={1}>
        <TableChartIcon color="primary" />
        Quote Description Templates
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ minHeight: 260 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Saved templates
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Create reusable descriptions, including ASCII or HTML tables, and insert them into your quotes.
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => handleOpenForm()}
              size="small"
            >
              New Template
            </Button>
          </Stack>

          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
              <CircularProgress size={32} />
            </Box>
          ) : listError ? (
            <Alert severity="error">{listError}</Alert>
          ) : renderedTemplates.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="body1" color="text.secondary">
                No templates yet. Create your first template to speed up quote creation.
              </Typography>
            </Box>
          ) : (
            <List sx={{ maxHeight: 360, overflowY: 'auto' }}>
              {renderedTemplates.map((template, index) => (
                <React.Fragment key={template.template_id}>
                  <ListItem alignItems="flex-start" sx={{ alignItems: 'flex-start', gap: 2 }}>
                    <ListItemText
                      primary={
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          {template.name}
                        </Typography>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary">
                          Updated {new Date(template.updated_at || template.created_at).toLocaleString()}
                        </Typography>
                      }
                    />
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" justifyContent="flex-end">
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<ContentPasteGoIcon />}
                        onClick={() => handleUseTemplate(template)}
                      >
                        Insert
                      </Button>
                      <Tooltip title="Edit template">
                        <span>
                          <IconButton onClick={() => handleOpenForm(template)} size="small">
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Delete template">
                        <span>
                          <IconButton onClick={() => handleDeleteTemplate(template)} size="small" color="error">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </ListItem>
                  {index < renderedTemplates.length - 1 && <Divider component="li" />}
                </React.Fragment>
              ))}
            </List>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      <Dialog open={formOpen} onClose={handleCloseForm} maxWidth="sm" fullWidth>
        <DialogTitle>{editingTemplate ? 'Edit Template' : 'New Template'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Template Name"
              value={formState.name}
              onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
              error={Boolean(formErrors.name)}
              helperText={formErrors.name}
              fullWidth
              autoFocus
            />
            <TextField
              label="Template Content"
              value={formState.content}
              onChange={(event) => setFormState((prev) => ({ ...prev, content: event.target.value }))}
              error={Boolean(formErrors.content)}
              helperText={formErrors.content || 'Supports multi-line descriptions and table layouts.'}
              fullWidth
              multiline
              minRows={8}
              InputProps={{ sx: monospaceInputSx }}
            />
            {formErrors.submit && <Alert severity="error">{formErrors.submit}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseForm} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSaveTemplate} variant="contained" disabled={isSaving}>
            {isSaving ? 'Saving…' : editingTemplate ? 'Update Template' : 'Create Template'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default QuoteTemplatesDialog;
