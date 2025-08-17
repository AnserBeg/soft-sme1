import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from '@mui/material';

interface UnsavedChangesGuardProps {
  when: boolean;
  onSave?: () => Promise<void> | void;
}

const UnsavedChangesGuard: React.FC<UnsavedChangesGuardProps> = ({ when, onSave }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const prevHashRef = useRef<string>('');
  const pendingHashRef = useRef<string | null>(null);
  const allowNextRef = useRef<boolean>(false);

  useEffect(() => {
    if (!when) return;
    prevHashRef.current = window.location.hash;
    const onHashChange = () => {
      if (!when) { prevHashRef.current = window.location.hash; return; }
      if (allowNextRef.current) {
        allowNextRef.current = false;
        prevHashRef.current = window.location.hash;
        return;
      }
      const next = window.location.hash;
      pendingHashRef.current = next;
      setOpen(true);
      setTimeout(() => {
        window.location.hash = prevHashRef.current || '#/';
      }, 0);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [when]);

  // Warn on browser/tab close or refresh
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!when) return;
      e.preventDefault();
      e.returnValue = '';
    };
    if (when) window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [when]);

  const handleStay = () => {
    setOpen(false);
  };

  const handleLeave = () => {
    setOpen(false);
    if (pendingHashRef.current) {
      allowNextRef.current = true;
      const target = pendingHashRef.current;
      pendingHashRef.current = null;
      if (window.location.hash !== target) {
        window.location.hash = target;
      }
    }
  };

  const handleSaveAndLeave = async () => {
    if (!onSave) { handleLeave(); return; }
    try {
      setSaving(true);
      await onSave();
      handleLeave();
    } catch {
      setSaving(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleStay} maxWidth="xs" fullWidth>
      <DialogTitle>Unsaved Changes</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          You have unsaved changes. Would you like to save before leaving this page?
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleStay}>Cancel</Button>
        <Button onClick={handleLeave} color="warning">Leave without saving</Button>
        <Button onClick={handleSaveAndLeave} variant="contained" disabled={saving}>
          {saving ? 'Saving…' : 'Save and leave'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UnsavedChangesGuard;


