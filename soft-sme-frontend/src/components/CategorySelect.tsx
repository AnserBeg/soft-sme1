import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogActions, DialogContent, DialogTitle, Button, MenuItem, Stack, TextField, IconButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { toast } from 'react-toastify';
import { createCategory, getCategories, deleteCategory as apiDeleteCategory, type Category } from '../services/categoryService';
import { useAuth } from '../contexts/AuthContext';

interface CategorySelectProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: boolean;
  errorMessage?: string;
  fullWidth?: boolean;
  disabled?: boolean;
}

const ADD_NEW_VALUE = '__ADD_NEW_CATEGORY__';
// Removed legacy delete sentinel. We now render a per-item trash icon.

const CategorySelect: React.FC<CategorySelectProps> = ({
  value,
  onChange,
  label = 'Category',
  error,
  errorMessage,
  fullWidth = true,
  disabled,
}) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    let isMounted = true;
    const fetch = async () => {
      setLoading(true);
      try {
        const list = await getCategories();
        if (isMounted) setCategories(list);
      } catch (err) {
        console.error('CategorySelect: failed to load categories', err);
        toast.error('Failed to load categories');
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetch();
    return () => {
      isMounted = false;
    };
  }, []);

  const categoryNames = useMemo(() => {
    const names = categories.map(c => c.category_name);
    if (!names.some(n => n.toLowerCase() === 'uncategorized')) {
      names.unshift('Uncategorized');
    }
    return names.sort((a, b) => a.localeCompare(b));
  }, [categories]);

  const handleSelectChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.value;
    if (selected === ADD_NEW_VALUE) {
      setAddOpen(true);
      return;
    }
    onChange(selected);
  };

  const handleDeleteCategory = async (target: Category, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (target.category_name.toLowerCase() === 'uncategorized') {
      toast.warn('Cannot delete the default "Uncategorized" category');
      return;
    }
    if (user?.access_role !== 'Admin') {
      toast.error('Only Admin users can delete categories');
      return;
    }
    
    const ok = window.confirm(`Delete category "${target.category_name}"? This cannot be undone.`);
    if (!ok) return;
    
    try {
      await apiDeleteCategory(target.category_id);
      setCategories(prev => prev.filter(c => c.category_id !== target.category_id));
      if (value && value.toLowerCase() === target.category_name.toLowerCase()) {
        onChange('Uncategorized');
      }
      toast.success('Category deleted');
    } catch (err: any) {
      const response = err?.response?.data;
      if (response?.error === 'Cannot delete category' && response?.suggestion) {
        // Category is in use, offer to reassign items
        const reassignOk = window.confirm(
          `${response.details}\n\n${response.suggestion}\n\nWould you like to reassign all items to "Uncategorized" and delete the category?`
        );
        if (reassignOk) {
          try {
            await apiDeleteCategory(target.category_id, true); // Pass reassign=true
            setCategories(prev => prev.filter(c => c.category_id !== target.category_id));
            if (value && value.toLowerCase() === target.category_name.toLowerCase()) {
              onChange('Uncategorized');
            }
            toast.success(response.details ? `Category deleted. ${response.details}` : 'Category deleted');
          } catch (reassignErr: any) {
            const reassignMsg = reassignErr?.response?.data?.error || 'Failed to delete category';
            toast.error(reassignMsg);
          }
        }
      } else {
        const msg = response?.error || 'Failed to delete category';
        toast.error(msg);
      }
    }
  };

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      toast.warn('Please enter a category name');
      return;
    }
    if (categoryNames.some(n => n.toLowerCase() === name.toLowerCase())) {
      toast.warn('Category already exists');
      return;
    }
    setSaving(true);
    try {
      const description = newCategoryDescription.trim();
      const created = await createCategory({ category_name: name, description: description || undefined });
      setCategories(prev => [...prev, created]);
      setAddOpen(false);
      setNewCategoryName('');
      setNewCategoryDescription('');
      onChange(created.category_name);
      toast.success('Category added');
    } catch (err) {
      console.error('CategorySelect: failed to create category', err);
      toast.error('Failed to add category');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TextField
        label={label}
        value={value}
        onChange={handleSelectChange}
        select
        fullWidth={fullWidth}
        required
        error={!!error}
        helperText={errorMessage}
        disabled={disabled || loading}
      >
        {categories
          .slice()
          .sort((a, b) => a.category_name.localeCompare(b.category_name))
          .map(cat => (
            <MenuItem key={cat.category_id} value={cat.category_name} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{cat.category_name}</span>
              {user?.access_role === 'Admin' && cat.category_name.toLowerCase() !== 'uncategorized' && (
                <IconButton
                  aria-label={`Delete ${cat.category_name}`}
                  size="small"
                  edge="end"
                  onClick={(e) => handleDeleteCategory(cat, e)}
                  sx={{ ml: 2, color: 'error.main' }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              )}
            </MenuItem>
          ))}
        <MenuItem key={ADD_NEW_VALUE} value={ADD_NEW_VALUE}>
          + Add new category…
        </MenuItem>
      </TextField>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add New Category</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Category Name"
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              autoFocus
              fullWidth
            />
            <TextField
              label="Description (optional)"
              value={newCategoryDescription}
              onChange={e => setNewCategoryDescription(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleCreateCategory} variant="contained" disabled={saving}>Save</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default CategorySelect;


