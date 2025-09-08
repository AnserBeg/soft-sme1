import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  Grid,
  Card,
  CardContent,
  LinearProgress,
  FormGroup,
  FormControlLabel,
  Checkbox
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Visibility as VisibilityIcon,
  Upload as UploadIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import api from '../api/axios';

interface Profile {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

interface ProfileDocument {
  id: number;
  filename: string;
  original_filename: string;
  file_size: number;
  mime_type: string;
  uploaded_by: number;
  uploaded_by_name: string;
  profile_name: string;
  read_count: number;
  created_at: string;
  visible_to_profiles: number[];
  profile_read_status: { [profileId: number]: boolean };
  // New fields for admin view
  profile_id?: number;
  has_read?: boolean;
  read_at?: string;
  profile_details?: Array<{
    profile_id: number;
    profile_name: string;
    has_read: boolean;
    read_at?: string;
  }>;
}

const ProfileDocumentsPage: React.FC = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<number | ''>('');
  const [documents, setDocuments] = useState<ProfileDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customName, setCustomName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<ProfileDocument | null>(null);
  const [documentStats, setDocumentStats] = useState<any[]>([]);
  const [selectedProfilesForUpload, setSelectedProfilesForUpload] = useState<number[]>([]);
  const [viewMode, setViewMode] = useState<'admin' | 'profile'>('admin');

  useEffect(() => {
    fetchProfiles();
  }, []);

  useEffect(() => {
    if (viewMode === 'admin') {
      fetchAllDocuments();
    } else if (selectedProfile) {
      fetchDocuments(selectedProfile);
    } else {
      setDocuments([]);
    }
  }, [selectedProfile, viewMode]);

  const fetchProfiles = async () => {
    try {
      const response = await api.get('/api/profile-documents/profiles');
      setProfiles(response.data);
    } catch (error: any) {
      console.error('Error fetching profiles:', error);
      toast.error('Failed to fetch profiles');
    }
  };

  const fetchDocuments = async (profileId: number) => {
    setLoading(true);
    try {
      const response = await api.get(`/api/profile-documents/profile/${profileId}`);
      setDocuments(response.data);
    } catch (error: any) {
      console.error('Error fetching documents:', error);
      toast.error('Failed to fetch documents');
    } finally {
      setLoading(false);
    }
  };

  const fetchAllDocuments = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/profile-documents/all');
      // Group document-profile combinations by document
      const groupedDocuments = response.data.reduce((acc: any, row: any) => {
        const docId = row.id;
        if (!acc[docId]) {
          acc[docId] = {
            id: row.id,
            filename: row.filename,
            original_filename: row.original_filename,
            file_size: row.file_size,
            mime_type: row.mime_type,
            uploaded_by: row.uploaded_by,
            uploaded_by_name: row.uploaded_by_name,
            created_at: row.created_at,
            visible_to_profiles: [],
            profile_read_status: {},
            profile_details: []
          };
        }
        acc[docId].visible_to_profiles.push(row.profile_id);
        acc[docId].profile_read_status[row.profile_id] = row.has_read;
        acc[docId].profile_details.push({
          profile_id: row.profile_id,
          profile_name: row.profile_name,
          has_read: row.has_read,
          read_at: row.read_at
        });
        return acc;
      }, {});
      
      const finalDocuments = Object.values(groupedDocuments);
      console.log('Grouped documents:', finalDocuments);
      setDocuments(finalDocuments);
    } catch (error: any) {
      console.error('Error fetching all documents:', error);
      toast.error('Failed to fetch documents');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!customName) {
        setCustomName(file.name);
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || selectedProfilesForUpload.length === 0) {
      toast.error('Please select a file and at least one profile');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('document', selectedFile);
      formData.append('customName', customName);
      formData.append('visibleToProfiles', JSON.stringify(selectedProfilesForUpload));

      const response = await api.post('/api/profile-documents/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.success) {
        toast.success('Document uploaded successfully');
        setUploadDialogOpen(false);
        setSelectedFile(null);
        setCustomName('');
        setSelectedProfilesForUpload([]);
        if (viewMode === 'admin') {
          fetchAllDocuments();
        } else if (selectedProfile) {
          fetchDocuments(selectedProfile);
        }
      }
    } catch (error: any) {
      console.error('Error uploading document:', error);
      toast.error(error.response?.data?.error || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (documentId: number) => {
    if (!window.confirm('Are you sure you want to delete this document?')) {
      return;
    }

    try {
      await api.delete(`/api/profile-documents/${documentId}`);
      toast.success('Document deleted successfully');
      if (viewMode === 'admin') {
        fetchAllDocuments();
      } else if (selectedProfile) {
        fetchDocuments(selectedProfile);
      }
    } catch (error: any) {
      console.error('Error deleting document:', error);
      toast.error('Failed to delete document');
    }
  };

  const handleViewStats = async (document: ProfileDocument) => {
    setSelectedDocument(document);
    setStatsDialogOpen(true);
    try {
      const response = await api.get(`/api/profile-documents/${document.id}/stats`);
      setDocumentStats(response.data);
    } catch (error: any) {
      console.error('Error fetching document stats:', error);
      toast.error('Failed to fetch document statistics');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <Box p={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Profile Documents Management
        </Typography>
        <Box display="flex" gap={2} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>View Mode</InputLabel>
            <Select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as 'admin' | 'profile')}
              label="View Mode"
            >
              <MenuItem value="admin">Admin View</MenuItem>
              <MenuItem value="profile">Profile View</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setUploadDialogOpen(true)}
            disabled={viewMode === 'profile' && !selectedProfile}
          >
            Upload Document
          </Button>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {viewMode === 'profile' && (
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Select Profile
                </Typography>
                <FormControl fullWidth>
                  <InputLabel>Profile</InputLabel>
                  <Select
                    value={selectedProfile}
                    onChange={(e) => setSelectedProfile(e.target.value as number)}
                    label="Profile"
                  >
                    {profiles.map((profile) => (
                      <MenuItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {selectedProfile && (
                  <Box mt={2}>
                    <Typography variant="body2" color="text.secondary">
                      {profiles.find(p => p.id === selectedProfile)?.email}
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        )}

        <Grid item xs={12} md={viewMode === 'profile' ? 8 : 12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Documents
                <Chip 
                  label={`${documents.length} documents`} 
                  size="small" 
                  sx={{ ml: 2 }}
                />
              </Typography>
              
              {viewMode === 'profile' && !selectedProfile ? (
                <Alert severity="info">
                  Please select a profile to view documents.
                </Alert>
              ) : loading ? (
                <Box display="flex" justifyContent="center" p={3}>
                  <CircularProgress />
                </Box>
              ) : documents.length === 0 ? (
                <Alert severity="info">
                  {viewMode === 'admin' ? 'No documents found.' : 'No documents found for this profile.'}
                </Alert>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Document Name</TableCell>
                        <TableCell align="center">Size</TableCell>
                        <TableCell align="center">Type</TableCell>
                        {viewMode === 'admin' ? (
                          <>
                            <TableCell align="center">Visible To</TableCell>
                            <TableCell align="center">Read Status</TableCell>
                          </>
                        ) : (
                          <TableCell align="center">Read Status</TableCell>
                        )}
                        <TableCell align="center">Uploaded</TableCell>
                        <TableCell align="center">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {documents.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell>
                            <Typography variant="body2" fontWeight="medium">
                              {doc.original_filename}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              by {doc.uploaded_by_name}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Typography variant="body2">
                              {formatFileSize(doc.file_size)}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Chip 
                              label={doc.mime_type.split('/')[1]?.toUpperCase() || 'FILE'} 
                              size="small" 
                              variant="outlined"
                            />
                          </TableCell>
                          {viewMode === 'admin' ? (
                            <>
                              <TableCell align="center">
                                <Box display="flex" flexWrap="wrap" gap={0.5} justifyContent="center">
                                  {doc.profile_details && doc.profile_details.length > 0 ? (
                                    doc.profile_details.map((profileDetail) => (
                                      <Chip 
                                        key={profileDetail.profile_id}
                                        label={profileDetail.profile_name} 
                                        size="small" 
                                        variant="outlined"
                                        color="primary"
                                      />
                                    ))
                                  ) : (
                                    doc.visible_to_profiles?.map((profileId) => {
                                      const profile = profiles.find(p => p.id === profileId);
                                      return profile ? (
                                        <Chip 
                                          key={profileId}
                                          label={profile.name} 
                                          size="small" 
                                          variant="outlined"
                                          color="primary"
                                        />
                                      ) : null;
                                    })
                                  )}
                                </Box>
                              </TableCell>
                              <TableCell align="center">
                                <Box display="flex" flexWrap="wrap" gap={0.5} justifyContent="center">
                                  {doc.profile_details && doc.profile_details.length > 0 ? (
                                    doc.profile_details.map((profileDetail) => (
                                      <Chip 
                                        key={profileDetail.profile_id}
                                        label={profileDetail.has_read ? "Read" : "Unread"} 
                                        size="small" 
                                        color={profileDetail.has_read ? "success" : "default"}
                                        icon={profileDetail.has_read ? <CheckCircleIcon /> : <CancelIcon />}
                                        title={`${profileDetail.profile_name}: ${profileDetail.has_read ? "Read" : "Unread"}`}
                                      />
                                    ))
                                  ) : (
                                    doc.visible_to_profiles?.map((profileId) => {
                                      const profile = profiles.find(p => p.id === profileId);
                                      const hasRead = doc.profile_read_status?.[profileId] || false;
                                      return profile ? (
                                        <Chip 
                                          key={profileId}
                                          label={hasRead ? "Read" : "Unread"} 
                                          size="small" 
                                          color={hasRead ? "success" : "default"}
                                          icon={hasRead ? <CheckCircleIcon /> : <CancelIcon />}
                                          title={`${profile.name}: ${hasRead ? "Read" : "Unread"}`}
                                        />
                                      ) : null;
                                    })
                                  )}
                                </Box>
                              </TableCell>
                            </>
                          ) : (
                            <TableCell align="center">
                              <Chip 
                                label={doc.profile_read_status?.[selectedProfile] ? "Read" : "Unread"} 
                                size="small" 
                                color={doc.profile_read_status?.[selectedProfile] ? "success" : "default"}
                                icon={doc.profile_read_status?.[selectedProfile] ? <CheckCircleIcon /> : <CancelIcon />}
                              />
                            </TableCell>
                          )}
                          <TableCell align="center">
                            <Typography variant="body2">
                              {formatDate(doc.created_at)}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">
                            <IconButton
                              size="small"
                              onClick={() => handleViewStats(doc)}
                              title="View Statistics"
                            >
                              <VisibilityIcon />
                            </IconButton>
                            <IconButton
                              size="small"
                              component="a"
                              href={`/api/profile-documents/file/${doc.id}`}
                              target="_blank"
                              title="Download"
                            >
                              <DownloadIcon />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => handleDelete(doc.id)}
                              title="Delete"
                              color="error"
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
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onClose={() => setUploadDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Document</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="h6" gutterBottom>
              Select Profiles
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Choose which profiles can see this document
            </Typography>
            <FormGroup>
              {profiles.map((profile) => (
                <FormControlLabel
                  key={profile.id}
                  control={
                    <Checkbox
                      checked={selectedProfilesForUpload.includes(profile.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedProfilesForUpload([...selectedProfilesForUpload, profile.id]);
                        } else {
                          setSelectedProfilesForUpload(selectedProfilesForUpload.filter(id => id !== profile.id));
                        }
                      }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{profile.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {profile.email}
                      </Typography>
                    </Box>
                  }
                />
              ))}
            </FormGroup>

            <TextField
              fullWidth
              label="Custom Document Name"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              sx={{ mb: 2, mt: 2 }}
              helperText="Leave empty to use original filename"
            />

            <Box sx={{ mb: 2 }}>
              <input
                type="file"
                id="file-upload"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.gif"
              />
              <label htmlFor="file-upload">
                <Button
                  variant="outlined"
                  component="span"
                  startIcon={<UploadIcon />}
                  fullWidth
                >
                  {selectedFile ? selectedFile.name : 'Select File'}
                </Button>
              </label>
            </Box>

            {selectedFile && (
              <Alert severity="info">
                Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadDialogOpen(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            variant="contained"
            disabled={!selectedFile || selectedProfilesForUpload.length === 0 || uploading}
            startIcon={uploading ? <CircularProgress size={20} /> : <UploadIcon />}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Statistics Dialog */}
      <Dialog open={statsDialogOpen} onClose={() => setStatsDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          Document Statistics: {selectedDocument?.original_filename}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="h6" gutterBottom>
              Profile Read Status
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              View which profiles can see this document and their read status:
            </Typography>
            
            {selectedDocument && (
              <TableContainer sx={{ mt: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Profile</TableCell>
                      <TableCell>Email</TableCell>
                      <TableCell align="center">Read Status</TableCell>
                      <TableCell align="center">Read At</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedDocument.visible_to_profiles?.map((profileId) => {
                      const profile = profiles.find(p => p.id === profileId);
                      const hasRead = selectedDocument.profile_read_status?.[profileId] || false;
                      const readStat = documentStats.find(stat => stat.profile_id === profileId);
                      
                      return profile ? (
                        <TableRow key={profileId}>
                          <TableCell>
                            <Typography variant="body2" fontWeight="medium">
                              {profile.name}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              {profile.email}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Chip 
                              label={hasRead ? "Read" : "Unread"} 
                              size="small" 
                              color={hasRead ? "success" : "default"}
                              icon={hasRead ? <CheckCircleIcon /> : <CancelIcon />}
                            />
                          </TableCell>
                          <TableCell align="center">
                            {readStat ? (
                              <Typography variant="body2">
                                {formatDate(readStat.read_at)}
                              </Typography>
                            ) : (
                              <Typography variant="body2" color="text.secondary">
                                -
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      ) : null;
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatsDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProfileDocumentsPage;
