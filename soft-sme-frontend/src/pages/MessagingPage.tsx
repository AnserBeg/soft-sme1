import React, { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { toast } from 'react-toastify';
import api from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { useMessaging } from '../contexts/MessagingContext';
import ConversationList from '../components/ConversationList';
import MessageThread from '../components/MessageThread';

interface EmployeeOption {
  id: number;
  username: string | null;
  email: string | null;
  access_role?: string;
}

const MessagingPage: React.FC = () => {
  const { user } = useAuth();
  const currentUserId = user ? Number(user.id) : null;

  const {
    conversations,
    isLoadingConversations,
    activeConversationId,
    selectConversation,
    messagesByConversation,
    isLoadingMessages,
    sendMessage,
    createConversation,
    loadMessages,
    deleteMessage,
  } = useMessaging();

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState<boolean>(false);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [selectedEmployees, setSelectedEmployees] = useState<EmployeeOption[]>([]);
  const [groupTitle, setGroupTitle] = useState<string>('');
  const [isCreatingConversation, setIsCreatingConversation] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchEmployees = async () => {
      try {
        setIsLoadingEmployees(true);
        const response = await api.get('/api/employees');
        if (!isMounted) {
          return;
        }
        const data = Array.isArray(response.data)
          ? response.data
          : [];
        const normalized = data
          .map((entry: any) => ({
            id: Number(entry.id),
            username: entry.username ?? null,
            email: entry.email ?? null,
            access_role: entry.access_role,
          }))
          .filter((employee: EmployeeOption) => employee.id !== currentUserId)
          .sort((a: EmployeeOption, b: EmployeeOption) => {
            const nameA = (a.username || a.email || '').toLowerCase();
            const nameB = (b.username || b.email || '').toLowerCase();
            return nameA.localeCompare(nameB);
          });
        setEmployees(normalized);
      } catch (error) {
        console.error('Failed to load employees', error);
        toast.error('Unable to load team members.');
      } finally {
        if (isMounted) {
          setIsLoadingEmployees(false);
        }
      }
    };

    fetchEmployees();
    return () => {
      isMounted = false;
    };
  }, [currentUserId]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId),
    [activeConversationId, conversations]
  );

  const activeMessages = activeConversationId ? messagesByConversation[activeConversationId] ?? [] : [];
  const messagesLoading = activeConversationId ? Boolean(isLoadingMessages[activeConversationId]) : false;

  const handleStartConversation = () => {
    setSelectedEmployees([]);
    setGroupTitle('');
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    if (isCreatingConversation) {
      return;
    }
    setDialogOpen(false);
  };

  const handleCreateConversation = async () => {
    if (selectedEmployees.length === 0) {
      toast.error('Select at least one teammate to start a conversation.');
      return;
    }

    const participantIds = selectedEmployees.map((employee) => employee.id);
    const type: 'direct' | 'group' = participantIds.length > 1 ? 'group' : 'direct';

    if (type === 'group' && !groupTitle.trim()) {
      toast.error('Enter a name for the group conversation.');
      return;
    }

    try {
      setIsCreatingConversation(true);
      const result = await createConversation({
        participantIds,
        title: type === 'group' ? groupTitle.trim() : undefined,
        type,
      });

      const { conversation, created } = result;
      toast.success(created ? 'Conversation created successfully.' : 'Conversation already existed. Opening chat.');
      setDialogOpen(false);
      setSelectedEmployees([]);
      setGroupTitle('');
      await loadMessages(conversation.id, { force: true });
    } catch (error) {
      console.error('Failed to create conversation', error);
      toast.error('Unable to start conversation. Please try again.');
    } finally {
      setIsCreatingConversation(false);
    }
  };

  const handleSendMessage = async (value: string) => {
    if (!activeConversationId) {
      toast.error('Select a conversation before sending a message.');
      return;
    }
    try {
      setIsSending(true);
      await sendMessage(activeConversationId, value);
    } catch (error) {
      console.error('Failed to send message', error);
      toast.error('Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteMessage = async (messageId: number) => {
    if (!activeConversationId) {
      toast.error('Select a conversation before deleting a message.');
      return;
    }

    try {
      await deleteMessage(activeConversationId, messageId);
      toast.info('Message deleted for you.');
    } catch (error) {
      console.error('Failed to delete message', error);
      toast.error('Unable to delete message. Please try again.');
    }
  };

  const autocompleteOptions = useMemo(() => employees, [employees]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: { xs: 2, md: 3 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1">
          Messaging
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Collaborate with your team using direct messages and group chats.
        </Typography>
      </Stack>

      <Box sx={{ flexGrow: 1, minHeight: 0 }}>
        <Grid container spacing={2} sx={{ height: '100%' }}>
          <Grid item xs={12} md={4} sx={{ height: { xs: 'auto', md: '100%' } }}>
            <Paper sx={{ height: { xs: 'auto', md: '100%' }, p: 2, display: 'flex', flexDirection: 'column' }}>
              <ConversationList
                conversations={conversations}
                activeConversationId={activeConversationId}
                onSelect={selectConversation}
                onStartConversation={handleStartConversation}
                isLoading={isLoadingConversations}
              />
            </Paper>
          </Grid>
          <Grid item xs={12} md={8} sx={{ height: { xs: '60vh', md: '100%' } }}>
            <MessageThread
              conversation={activeConversation}
              messages={activeMessages}
              currentUserId={currentUserId}
              isLoading={messagesLoading}
              isSending={isSending}
              onSendMessage={handleSendMessage}
              onDeleteMessage={handleDeleteMessage}
            />
          </Grid>
        </Grid>
      </Box>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} fullWidth maxWidth="sm">
        <DialogTitle>Start a Conversation</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Autocomplete
              multiple
              options={autocompleteOptions}
              value={selectedEmployees}
              onChange={(_, value) => setSelectedEmployees(value)}
              getOptionLabel={(option) => option.username || option.email || `User ${option.id}`}
              renderOption={(props, option) => (
                <li {...props} key={option.id}>
                  <Stack spacing={0.25}>
                    <Typography variant="body2">{option.username || option.email || `User ${option.id}`}</Typography>
                    {option.email && (
                      <Typography variant="caption" color="text.secondary">
                        {option.email}
                      </Typography>
                    )}
                  </Stack>
                </li>
              )}
              filterSelectedOptions
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Participants"
                  placeholder="Select team members"
                  helperText="Choose one teammate for a direct chat or multiple for a group conversation."
                />
              )}
              loading={isLoadingEmployees}
              loadingText="Loading team members..."
            />

            {selectedEmployees.length > 1 && (
              <TextField
                label="Group name"
                value={groupTitle}
                onChange={(event) => setGroupTitle(event.target.value)}
                placeholder="e.g., Operations Leads"
                inputProps={{ maxLength: 80 }}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={isCreatingConversation}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleCreateConversation}
            disabled={
              isCreatingConversation ||
              selectedEmployees.length === 0 ||
              (selectedEmployees.length > 1 && !groupTitle.trim())
            }
          >
            {isCreatingConversation ? 'Creating…' : 'Start'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MessagingPage;
