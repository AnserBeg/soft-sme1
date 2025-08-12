import React, { useState, useEffect } from 'react';
import { TextField, Button, Typography, Container, Box, Paper, Alert, List, ListItem, ListItemText, CircularProgress, IconButton, MenuItem, Select, InputLabel, FormControl, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { AxiosError } from 'axios';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { getEmployees } from '../services/employeeService';

interface Employee {
  id: number;
  username: string;
  email: string;
  role: string;
  force_password_change: boolean;
  access_role: string;
}

interface ApiError {
  message: string;
}

const ACCESS_ROLES = ['Admin', 'Sales and Purchase', 'Time Tracking', 'Mobile Time Tracker'];

const EmployeeManagementPage: React.FC = () => {
  const [username, setUsername] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [accessRole, setAccessRole] = useState<string>('Employee');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const navigate = useNavigate();

  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editedUsername, setEditedUsername] = useState<string>('');
  const [editedAccessRole, setEditedAccessRole] = useState<string>('');
  const [editedPassword, setEditedPassword] = useState<string>('');
  const [openEditDialog, setOpenEditDialog] = useState<boolean>(false);

  // Fetch employees
  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const response = await getEmployees();
      setEmployees(response);
    } catch (err) {
      setError('Failed to fetch employees.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterEmployee = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      const response = await api.post('/api/employees', {
        username,
        email,
        password,
        access_role: accessRole,
      });
      setSuccess(response.data.message);
      setUsername('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setAccessRole('Employee');
      fetchEmployees();
    } catch (err: unknown) {
      if (err instanceof AxiosError) {
        const error = err as AxiosError<ApiError>;
        setError(error.response?.data?.message || 'Employee registration failed');
      } else {
        setError('An unexpected error occurred');
      }
    }
  };

  const handleDeleteEmployee = async (employeeId: number) => {
    if (!window.confirm('Are you sure you want to delete this employee?')) {
      return;
    }
    try {
      await api.delete(`/api/employees/${employeeId}`);
      setSuccess('Employee deleted successfully');
      fetchEmployees();
    } catch (err: unknown) {
      console.error('Error deleting employee:', err);
      if (err instanceof AxiosError) {
        const error = err as AxiosError<ApiError>;
        setError(error.response?.data?.message || 'Failed to delete employee');
      } else {
        setError('An unexpected error occurred');
      }
    }
  };

  const handleOpenEditDialog = (employee: Employee) => {
    setEditingEmployee(employee);
    setEditedUsername(employee.username);
    setEditedAccessRole(employee.access_role);
    setEditedPassword('');
    setOpenEditDialog(true);
  };

  const handleCloseEditDialog = () => {
    setOpenEditDialog(false);
    setEditingEmployee(null);
    setError(null);
    setSuccess(null);
  };

  const handleUpdateEmployee = async () => {
    if (!editingEmployee) return;
    setError(null);
    setSuccess(null);
    try {
      const payload: any = {
        username: editedUsername,
        access_role: editedAccessRole,
      };
      if (editedPassword) payload.password = editedPassword;
      const response = await api.put(`/api/employees/${editingEmployee.id}`, payload);
      setSuccess(response.data.message || 'Employee updated successfully');
      fetchEmployees();
      handleCloseEditDialog();
    } catch (err: unknown) {
      console.error('Error updating employee:', err);
      if (err instanceof AxiosError) {
        const error = err as AxiosError<ApiError>;
        setError(error.response?.data?.message || 'Failed to update employee');
      } else {
        setError('An unexpected error occurred');
      }
    }
  };

  if (loading) {
    return (
      <Container component="main" maxWidth="md" sx={{ mt: 8, textAlign: 'center' }}>
        <CircularProgress />
        <Typography>Loading employees...</Typography>
      </Container>
    );
  }

  return (
    <Container component="main" maxWidth="md">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper elevation={6} sx={{ p: 4, width: '100%', borderRadius: 2, mb: 4 }}>
          <Typography component="h1" variant="h5" sx={{ mb: 3, textAlign: 'center' }}>
            Register New Employee
          </Typography>
          <Box component="form" onSubmit={handleRegisterEmployee} noValidate sx={{ mt: 1 }}>
            <TextField
              margin="normal"
              required
              fullWidth
              id="username"
              label="Username"
              name="username"
              autoComplete="new-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              id="email"
              label="Email Address"
              name="email"
              autoComplete="new-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              name="password"
              label="Initial Password"
              type="password"
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              name="confirmPassword"
              label="Confirm Initial Password"
              type="password"
              id="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <FormControl fullWidth margin="normal">
              <InputLabel id="access-role-label">Access Role</InputLabel>
              <Select
                labelId="access-role-label"
                id="access-role"
                value={accessRole}
                label="Access Role"
                onChange={(e) => setAccessRole(e.target.value as string)}
              >
                {ACCESS_ROLES.map((role) => (
                  <MenuItem key={role} value={role}>
                    {role}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
            >
              Register Employee
            </Button>
            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mt: 2 }}>{success}</Alert>}
          </Box>
        </Paper>

        <Paper elevation={6} sx={{ p: 4, width: '100%', borderRadius: 2 }}>
          <Typography component="h2" variant="h5" sx={{ mb: 3, textAlign: 'center' }}>
            Existing Employees
          </Typography>
          <List>
            {employees.map((employee) => (
              <ListItem
                key={employee.id}
                secondaryAction={
                  <Box>
                    <IconButton edge="end" aria-label="edit" onClick={() => handleOpenEditDialog(employee)} sx={{ mr: 1 }}>
                      <EditIcon />
                    </IconButton>
                    <IconButton edge="end" aria-label="delete" onClick={() => handleDeleteEmployee(employee.id)}>
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                }
              >
                <ListItemText primary={employee.username} secondary={`Email: ${employee.email} | Role: ${employee.role} | Access: ${employee.access_role}`} />
              </ListItem>
            ))}
          </List>
        </Paper>
      </Box>

      <Dialog open={openEditDialog} onClose={handleCloseEditDialog}>
        <DialogTitle>Edit Employee Roles</DialogTitle>
        <DialogContent>
          {editingEmployee && (
            <Box component="form" noValidate sx={{ mt: 1 }}>
              <TextField
                margin="normal"
                fullWidth
                id="edit-username"
                label="Username"
                value={editedUsername}
                onChange={e => setEditedUsername(e.target.value)}
                variant="standard"
              />
              <TextField
                margin="normal"
                fullWidth
                id="edit-email"
                label="Email"
                value={editingEmployee.email}
                InputProps={{ readOnly: true, disableUnderline: true }}
                variant="standard"
              />
              <TextField
                margin="normal"
                fullWidth
                id="edit-password"
                label="New Password (leave blank to keep current)"
                type="password"
                value={editedPassword}
                onChange={e => setEditedPassword(e.target.value)}
                variant="standard"
              />
              <FormControl fullWidth margin="normal">
                <InputLabel id="edit-access-role-label">Access Role</InputLabel>
                <Select
                  labelId="edit-access-role-label"
                  id="edit-access-role"
                  value={editedAccessRole}
                  label="Access Role"
                  onChange={(e) => setEditedAccessRole(e.target.value as string)}
                >
                  {ACCESS_ROLES.map((role) => (
                    <MenuItem key={role} value={role}>
                      {role}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          )}
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
          {success && <Alert severity="success" sx={{ mt: 2 }}>{success}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditDialog}>Cancel</Button>
          <Button onClick={handleUpdateEmployee} variant="contained" color="primary">Save Changes</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default EmployeeManagementPage; 