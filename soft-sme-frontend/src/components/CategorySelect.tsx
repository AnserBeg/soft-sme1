import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogActions, DialogContent, DialogTitle, Button, MenuItem, Stack, TextField } from '@mui/material';
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
const DELETE_CURRENT_VALUE = '__DELETE_CURRENT_CATEGORY__';

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
    if (selected === DELETE_CURRENT_VALUE) {
      handleDeleteSelected();
      return;
    }
    onChange(selected);
  };

  const handleDeleteSelected = async () => {
    const selectedName = value?.trim();
    if (!selectedName) return;
    if (selectedName.toLowerCase() === 'uncategorized') {
      toast.warn('Cannot delete the default "Uncategorized" category');
      return;
    }
    if (user?.access_role !== 'Admin') {
      toast.error('Only Admin users can delete categories');
      return;
    }
    const target = categories.find(c => c.category_name.toLowerCase() === selectedName.toLowerCase());
    if (!target) {
      toast.error('Category not found');
      return;
    }
    const ok = window.confirm(`Delete category "${target.category_name}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await apiDeleteCategory(target.category_id);
      setCategories(prev => prev.filter(c => c.category_id !== target.category_id));
      // If current value was this category, reset to Uncategorized
      if (value && value.toLowerCase() === target.category_name.toLowerCase()) {
        onChange('Uncategorized');
      }
      toast.success('Category deleted');
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Failed to delete category';
      toast.error(msg);
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
        {categoryNames.map(name => (
          <MenuItem key={name} value={name}>
            {name}
          </MenuItem>
        ))}
        <MenuItem key={ADD_NEW_VALUE} value={ADD_NEW_VALUE}>
          + Add new category…
        </MenuItem>
        {user?.access_role === 'Admin' && value && value.toLowerCase() !== 'uncategorized' && (
          <MenuItem key={DELETE_CURRENT_VALUE} value={DELETE_CURRENT_VALUE} sx={{ color: 'error.main' }}>
            Delete "{value}"…
          </MenuItem>
        )}
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


