import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Fab, Paper, IconButton, TextField, Typography, CircularProgress, Tooltip } from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import { askAssistant, AssistantReply } from '../services/assistantService';
import { useAuth } from '../contexts/AuthContext';

type Msg = { id: string; role: 'user' | 'assistant'; text: string; rows?: any[] | null };

const uid = () => Math.random().toString(36).slice(2);

type AssistantWidgetProps = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  panelWidth?: number;
  rightOffset?: number;
  desktopTopOffset?: number;
};

const AssistantWidget: React.FC<AssistantWidgetProps> = ({
  open,
  onOpen,
  onClose,
  panelWidth = 360,
  rightOffset = 24,
  desktopTopOffset = 72,
}) => {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reset per user/session: clear conversation when user changes
  useEffect(() => {
    setMsgs([]);
    setInput('');
  }, [user?.id]);

  useEffect(() => {
    // auto scroll to bottom on message changes
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [msgs, open]);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    const m: Msg = { id: uid(), role: 'user', text: trimmed };
    setMsgs((prev) => [...prev, m]);
    setInput('');
    setSending(true);
    try {
      const res: AssistantReply = await askAssistant(trimmed);
      const reply: Msg = {
        id: uid(),
        role: 'assistant',
        text: res?.text || '',
        rows: res?.rows || undefined,
      };
      setMsgs((prev) => [...prev, reply]);
    } catch (e: any) {
      setMsgs((prev) => [...prev, { id: uid(), role: 'assistant', text: 'Error contacting assistant. Please try again.' }]);
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  if (!user) return null;

  return (
    <>
      {/* Floating bubble */}
      {!open && (
        <Tooltip title="Ask Aiven Assistant">
          <Fab
            color="primary"
            onClick={onOpen}
            sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1400 }}
          >
            <ChatIcon />
          </Fab>
        </Tooltip>
      )}

      {/* Panel */}
      {open && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            top: { xs: 0, sm: `${desktopTopOffset}px` },
            bottom: 0,
            right: { xs: 0, sm: `${rightOffset}px` },
            width: { xs: '100%', sm: `${panelWidth}px` },
            display: 'flex',
            flexDirection: 'column',
            borderRadius: { xs: 0, sm: '16px 0 0 0' },
            overflow: 'hidden',
            zIndex: 1500,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', p: 1, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
            <Typography sx={{ fontWeight: 600, flex: 1 }}>Aiven Assistant</Typography>
            <IconButton size="small" onClick={onClose} sx={{ color: 'primary.contrastText' }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          <Box ref={scrollRef} sx={{ flex: 1, p: 1.5, bgcolor: 'background.default', overflowY: 'auto' }}>
            {msgs.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Ask how to use the system or for analytics. This chat resets each session.
              </Typography>
            )}
            {msgs.map((m) => (
              <Box key={m.id} sx={{ mb: 1.25, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <Box
                  sx={{
                    maxWidth: '80%',
                    px: 1.25,
                    py: 0.75,
                    borderRadius: 1.5,
                    bgcolor: m.role === 'user' ? 'primary.light' : 'grey.100',
                    color: 'text.primary',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  <Typography variant="body2">{m.text}</Typography>
                  {m.rows && Array.isArray(m.rows) && m.rows.length > 0 && (
                    <Box sx={{ mt: 1, maxHeight: 140, overflow: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr>
                            {Object.keys(m.rows[0]).slice(0, 6).map((k) => (
                              <th key={k} style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid #ddd' }}>{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {m.rows.slice(0, 10).map((r, idx) => (
                            <tr key={idx}>
                              {Object.keys(m.rows![0]).slice(0, 6).map((k) => (
                                <td key={k} style={{ padding: '4px 6px', borderBottom: '1px solid #f0f0f0' }}>{String(r[k])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Box>
                  )}
                </Box>
              </Box>
            ))}
            {sending && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                <CircularProgress size={20} />
              </Box>
            )}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', p: 1, gap: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Type your question..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <IconButton color="primary" onClick={send} disabled={sending || !input.trim()}>
              <SendIcon />
            </IconButton>
          </Box>
        </Paper>
      )}
    </>
  );
};

export default AssistantWidget;

