import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Box,
  Button,
  Grid,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Card,
  CardContent,
  Divider,
  Stack,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import PersonIcon from '@mui/icons-material/Person';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import api from '../api/axios';
import { toast } from 'react-toastify';

interface User {
  id: number;
  email: string;
  access_role: string;
  created_at: string;
}

interface Profile {
  id: number;
  name: string;
  email: string;
}

interface UserProfileAccess {
  id: number;
  user_id: number;
  user_email: string;
  user_role: string;
  profile_id: number;
  profile_name: string;
  profile_email: string;
  granted_by: number;
  granted_by_email: string;
  granted_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const MobileUserAccessPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [accessList, setAccessList] = useState<UserProfileAccess[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<number | ''>('');
  const [selectedProfile, setSelectedProfile] = useState<number | ''>('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersRes, profilesRes, accessRes] = await Promise.all([
        api.get('/api/time-tracking/admin/available-users'),
        api.get('/api/time-tracking/profiles'),
        api.get('/api/time-tracking/admin/user-profile-access'),
      ]);

      setUsers(usersRes.data || []);
      setProfiles(profilesRes.data || []);
      setAccessList(accessRes.data || []);
    } catch (error: any) {
      console.error('Error loading data:', error);
      toast.error('Failed to load mobile user access data');
    } finally {
      setLoading(false);
    }
  };

  const handleGrantAccess = async () => {
    if (!selectedUser || !selectedProfile) {
      toast.error('Please select both a user and a profile');
      return;
    }

    setSaving(true);
    try {
      await api.post('/api/time-tracking/admin/user-profile-access', {
        user_id: selectedUser,
        profile_id: selectedProfile,
      });
      
      toast.success('Profile access granted successfully');
      setOpenDialog(false);
      setSelectedUser('');
      setSelectedProfile('');
      loadData();
    } catch (error: any) {
      console.error('Error granting access:', error);
      toast.error(error.response?.data?.error || 'Failed to grant access');
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeAccess = async (accessId: number) => {
    if (!window.confirm('Are you sure you want to revoke this profile access?')) {
      return;
    }

    try {
      await api.delete(`/api/time-tracking/admin/user-profile-access/${accessId}`);
      toast.success('Profile access revoked successfully');
      loadData();
    } catch (error: any) {
      console.error('Error revoking access:', error);
      toast.error(error.response?.data?.error || 'Failed to revoke access');
    }
  };

  const activeAccess = accessList.filter(access => access.is_active);
  const inactiveAccess = accessList.filter(access => !access.is_active);

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton onClick={() => navigate(-1)}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h4" gutterBottom>
            Mobile User Access Management
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button
            variant="contained"
            onClick={() => setOpenDialog(true)}
            startIcon={<AddIcon />}
          >
            Grant Access
          </Button>
          <Button
            variant="outlined"
            onClick={loadData}
            startIcon={<RefreshIcon />}
          >
            Refresh
          </Button>
        </Stack>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Mobile Users
              </Typography>
              <Typography variant="h4">
                {users.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Available Profiles
              </Typography>
              <Typography variant="h4">
                {profiles.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Active Access
              </Typography>
              <Typography variant="h4" color="success.main">
                {activeAccess.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Revoked Access
              </Typography>
              <Typography variant="h4" color="text.secondary">
                {inactiveAccess.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {loading ? (
        <Box display="flex" justifyContent="center" p={3}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {/* Active Access Table */}
          <Paper sx={{ width: '100%', overflow: 'hidden', mb: 3 }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Active Profile Access
              </Typography>
              {activeAccess.length === 0 ? (
                <Alert severity="info">
                  No active profile access assignments. Click "Grant Access" to get started.
                </Alert>
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Mobile User</TableCell>
                        <TableCell>Profile</TableCell>
                        <TableCell>Granted By</TableCell>
                        <TableCell>Granted At</TableCell>
                        <TableCell>Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {activeAccess.map((access) => (
                        <TableRow key={access.id}>
                          <TableCell>
                            <Box>
                              <Typography variant="body2" fontWeight="bold">
                                {access.user_email}
                              </Typography>
                              <Chip 
                                label={access.user_role} 
                                size="small" 
                                color="primary" 
                                variant="outlined"
                              />
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Box>
                              <Typography variant="body2" fontWeight="bold">
                                {access.profile_name}
                              </Typography>
                              <Typography variant="caption" color="textSecondary">
                                {access.profile_email}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {access.granted_by_email || 'System'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {new Date(access.granted_at).toLocaleDateString()}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <IconButton
                              color="error"
                              onClick={() => handleRevokeAccess(access.id)}
                              title="Revoke Access"
                            >
                              <DeleteIcon />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>
          </Paper>

          {/* Inactive Access Table */}
          {inactiveAccess.length > 0 && (
            <Paper sx={{ width: '100%', overflow: 'hidden' }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Revoked Profile Access
                </Typography>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Mobile User</TableCell>
                        <TableCell>Profile</TableCell>
                        <TableCell>Revoked At</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {inactiveAccess.map((access) => (
                        <TableRow key={access.id}>
                          <TableCell>
                            <Box>
                              <Typography variant="body2" fontWeight="bold">
                                {access.user_email}
                              </Typography>
                              <Chip 
                                label={access.user_role} 
                                size="small" 
                                color="default" 
                                variant="outlined"
                              />
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Box>
                              <Typography variant="body2" fontWeight="bold">
                                {access.profile_name}
                              </Typography>
                              <Typography variant="caption" color="textSecondary">
                                {access.profile_email}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {new Date(access.updated_at).toLocaleDateString()}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Paper>
          )}
        </>
      )}

      {/* Grant Access Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <AddIcon />
            Grant Profile Access
          </Box>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Mobile User</InputLabel>
              <Select
                value={selectedUser}
                onChange={(e) => setSelectedUser(Number(e.target.value))}
                label="Mobile User"
              >
                {users.map((user) => (
                  <MenuItem key={user.id} value={user.id}>
                    <Box>
                      <Typography variant="body2" fontWeight="bold">
                        {user.email}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {user.access_role}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Profile</InputLabel>
              <Select
                value={selectedProfile}
                onChange={(e) => setSelectedProfile(Number(e.target.value))}
                label="Profile"
              >
                {profiles.map((profile) => (
                  <MenuItem key={profile.id} value={profile.id}>
                    <Box>
                      <Typography variant="body2" fontWeight="bold">
                        {profile.name}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {profile.email}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button
            onClick={handleGrantAccess}
            variant="contained"
            disabled={saving || !selectedUser || !selectedProfile}
            startIcon={saving ? <CircularProgress size={20} /> : <CheckCircleIcon />}
          >
            {saving ? 'Granting...' : 'Grant Access'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default MobileUserAccessPage; 