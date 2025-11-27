import React, { useState, useEffect } from 'react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { CheckCircle, Download, FileText, Clock, User, RefreshCw } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import api from '../../services/api';

interface Document {
  id: number;
  original_filename: string;
  file_size: number;
  mime_type: string;
  profile_name: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

const DocumentsScreen: React.FC = () => {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAsRead, setMarkingAsRead] = useState<number | null>(null);

  useEffect(() => {
    fetchDocuments();
    
    // Add event listener for when the app becomes visible again
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('App became visible, refreshing documents...');
        fetchDocuments();
      }
    };
    
    const handleFocus = () => {
      console.log('Window focused, refreshing documents...');
      fetchDocuments();
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const fetchDocuments = async () => {
    try {
      console.log('DocumentsScreen: Starting to fetch documents...');
      setLoading(true);
      // Add timestamp to prevent caching
      const timestamp = Date.now();
      const response = await api.get(`/profile-documents/user-documents?t=${timestamp}`);
      console.log('DocumentsScreen: API response:', response.data);
      setDocuments(response.data);
    } catch (error: any) {
      console.error('DocumentsScreen: Error fetching documents:', error);
      console.error('DocumentsScreen: Error details:', error.response?.data);
      alert('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    console.log('DocumentsScreen: Refresh button clicked');
    setRefreshing(true);
    await fetchDocuments();
    setRefreshing(false);
  };

  const handleMarkAsRead = async (documentId: number) => {
    try {
      setMarkingAsRead(documentId);
      await api.post(`/profile-documents/${documentId}/mark-read`);
      
      // Update local state
      setDocuments(prev => prev.map(doc => 
        doc.id === documentId 
          ? { ...doc, is_read: true, read_at: new Date().toISOString() }
          : doc
      ));
      
      alert('Document marked as read');
    } catch (error: any) {
      console.error('Error marking document as read:', error);
      alert('Failed to mark document as read');
    } finally {
      setMarkingAsRead(null);
    }
  };

  const handleDownload = async (documentId: number, filename: string) => {
    try {
      console.log(`Downloading document ${documentId}: ${filename}`);
      
      // Use axios to get the file with proper authorization
      const response = await api.get(`/profile-documents/file/${documentId}`, {
        responseType: 'blob'
      });
      
      console.log('Response headers:', response.headers);
      console.log('Response data type:', typeof response.data);
      console.log('Response data size:', response.data.size);
      
      // Get the content type from the response headers
      const contentType = response.headers['content-type'] || 'application/pdf';
      console.log('Content type:', contentType);
      
      // Create a blob with the correct content type
      const blob = new Blob([response.data], { type: contentType });
      console.log('Blob type:', blob.type);
      console.log('Blob size:', blob.size);
      
      // For mobile, create a download link instead of opening in new tab
      const url = window.URL.createObjectURL(blob);
      console.log('Created blob URL:', url);
      
      // Create a temporary anchor element for download
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      
      // Add to DOM, click, and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the blob URL after a delay
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 1000);
      
    } catch (error: any) {
      console.error('Error downloading document:', error);
      console.error('Error response:', error.response);
      
      // Try to read the error message from the response
      if (error.response?.data) {
        try {
          const errorText = await error.response.data.text();
          console.error('Error message:', errorText);
          alert(`Failed to download document: ${errorText}`);
        } catch (textError) {
          console.error('Could not read error message:', textError);
          alert('Failed to download document');
        }
      } else {
        alert('Failed to download document');
      }
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
      day: 'numeric'
    });
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('word')) return '📝';
    if (mimeType.includes('image')) return '🖼️';
    if (mimeType.includes('text')) return '📄';
    return '📁';
  };

  if (loading) {
    return (
      <div className="flex-1 flex justify-center items-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p className="mt-4 text-gray-600">Loading documents...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-gray-50">
      <div className="bg-white px-4 py-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
            <p className="text-gray-600 mt-1">
              {documents.length} document{documents.length !== 1 ? 's' : ''} available
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center"
          >
            <RefreshCw size={16} className={`mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 overflow-y-auto">
        {documents.length === 0 ? (
          <Card className="p-6 mt-4">
            <div className="text-center">
              <FileText size={48} className="mx-auto text-gray-400" />
              <h3 className="text-lg font-medium text-gray-900 mt-4">
                No Documents Available
              </h3>
              <p className="text-gray-600 mt-2">
                There are no documents available for your profile at this time.
              </p>
            </div>
          </Card>
        ) : (
          documents.map((doc) => (
            <Card key={doc.id} className="p-4 mb-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 mr-3">
                  <div className="flex items-center mb-2">
                    <span className="text-lg mr-2">{getFileIcon(doc.mime_type)}</span>
                    <h3 className="text-lg font-medium text-gray-900 flex-1">
                      {doc.original_filename}
                    </h3>
                  </div>
                  
                  <div className="flex items-center mb-2">
                    <Badge variant={doc.is_read ? "default" : "secondary"} className="mr-2">
                      {doc.is_read ? 'Read' : 'Unread'}
                    </Badge>
                    <span className="text-sm text-gray-500">
                      {formatFileSize(doc.file_size)}
                    </span>
                  </div>
                  
                  <div className="flex items-center">
                    <Clock size={14} className="text-gray-500" />
                    <span className="text-sm text-gray-500 ml-1">
                      Added {formatDate(doc.created_at)}
                    </span>
                  </div>
                  
                  {doc.is_read && doc.read_at && (
                    <div className="flex items-center mt-1">
                      <CheckCircle size={14} className="text-green-600" />
                      <span className="text-sm text-green-600 ml-1">
                        Read {formatDate(doc.read_at)}
                      </span>
                    </div>
                  )}
                </div>
                
                <div className="flex flex-col items-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownload(doc.id, doc.original_filename)}
                    className="mb-2"
                  >
                    <Download size={16} className="text-blue-600" />
                    <span className="text-blue-600 ml-1">View</span>
                  </Button>
                  
                  {!doc.is_read && (
                    <Button
                      size="sm"
                      onClick={() => handleMarkAsRead(doc.id)}
                      disabled={markingAsRead === doc.id}
                    >
                      {markingAsRead === doc.id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      ) : (
                        <CheckCircle size={16} className="text-white" />
                      )}
                      <span className="text-white ml-1">
                        {markingAsRead === doc.id ? 'Marking...' : 'Mark Read'}
                      </span>
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

export default DocumentsScreen;