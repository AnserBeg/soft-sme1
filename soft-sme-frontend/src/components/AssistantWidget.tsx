import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Fab,
  Paper,
  IconButton,
  TextField,
  Typography,
  CircularProgress,
  Tooltip,
  Divider,
  Slide,
  useMediaQuery,
} from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { alpha, useTheme } from '@mui/material/styles';
import { askAssistant, AssistantReply } from '../services/assistantService';
import { useAuth } from '../contexts/AuthContext';

type Msg = { id: string; role: 'user' | 'assistant'; text: string; rows?: any[] | null };

const uid = () => Math.random().toString(36).slice(2);

type AssistantWidgetProps = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  panelWidth?: number;
  desktopWidth?: number;
  onDesktopResize?: (width: number) => void;
  desktopMinWidth?: number;
  desktopMaxWidth?: number;
};

const AssistantWidget: React.FC<AssistantWidgetProps> = ({
  open,
  onOpen,
  onClose,
  panelWidth = 360,
  desktopWidth,
  onDesktopResize,
  desktopMinWidth = 280,
  desktopMaxWidth = 640,
}) => {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('sm'));
  const [internalDesktopWidth, setInternalDesktopWidth] = useState(panelWidth);
  const effectiveDesktopWidth = Math.min(
    desktopMaxWidth,
    Math.max(desktopMinWidth, desktopWidth ?? internalDesktopWidth),
  );
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(effectiveDesktopWidth);

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

  useEffect(() => {
    if (typeof desktopWidth === 'number') {
      setInternalDesktopWidth(desktopWidth);
    }
  }, [desktopWidth]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const delta = resizeStartXRef.current - event.clientX;
      const nextWidth = Math.min(
        desktopMaxWidth,
        Math.max(desktopMinWidth, resizeStartWidthRef.current + delta),
      );
      if (onDesktopResize) {
        onDesktopResize(nextWidth);
      } else {
        setInternalDesktopWidth(nextWidth);
      }
    };

    const stopResizing = () => {
      setIsResizing(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResizing);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [desktopMaxWidth, desktopMinWidth, isResizing, onDesktopResize]);

  useEffect(() => {
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, []);

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

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      send();
    },
    [send],
  );

  if (!user) return null;

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      if (!isDesktop) return;
      event.preventDefault();
      resizeStartXRef.current = event.clientX;
      resizeStartWidthRef.current = effectiveDesktopWidth;
      setIsResizing(true);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    },
    [effectiveDesktopWidth, isDesktop],
  );

  const desktopHandleWidth = 12;

  if (!isDesktop) {
    return (
      <>
        {!open && (
          <Tooltip title="Ask Aiven Assistant">
            <Fab
              onClick={onOpen}
              sx={{
                position: 'fixed',
                bottom: 32,
                right: 32,
                zIndex: 1400,
                background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
                color: theme.palette.primary.contrastText,
                boxShadow: '0 18px 35px rgba(28, 97, 234, 0.35)',
                '&:hover': {
                  background: `linear-gradient(135deg, ${theme.palette.primary.dark}, ${theme.palette.primary.main})`,
                },
              }}
            >
              <ChatIcon />
            </Fab>
          </Tooltip>
        )}

        <Slide direction="left" in={open} mountOnEnter unmountOnExit>
          <Box
            sx={{
              position: 'fixed',
              top: 0,
              bottom: 0,
              right: 0,
              width: '100%',
              zIndex: 1500,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Paper
              elevation={12}
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                borderRadius: 0,
                border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                backgroundColor: alpha(theme.palette.background.paper, 0.96),
                backdropFilter: 'blur(10px)',
              }}
            >
              <Box
                sx={{
                  px: 2.5,
                  py: 1.75,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.95)}, ${alpha(
                    theme.palette.primary.dark,
                    0.9,
                  )})`,
                  color: theme.palette.primary.contrastText,
                }}
              >
                <Avatar sx={{ bgcolor: alpha('#ffffff', 0.2) }}>
                  <SmartToyIcon fontSize="small" />
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Aiven Assistant
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.85 }}>
                    Your workspace copilot for instant answers
                  </Typography>
                </Box>
                <IconButton size="small" onClick={onClose} sx={{ color: 'inherit' }}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>

              <Divider sx={{ borderColor: alpha('#fff', 0.18) }} />

              <Box
                ref={scrollRef}
                sx={{
                  flex: 1,
                  px: 2.5,
                  py: 2,
                  background: `radial-gradient(circle at top right, ${alpha(
                    theme.palette.primary.light,
                    0.14,
                  )} 0%, transparent 60%)`,
                  overflowY: 'auto',
                }}
              >
                {msgs.length === 0 && (
                  <Box
                    sx={{
                      textAlign: 'center',
                      py: 4,
                      px: 2,
                      color: 'text.secondary',
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      Welcome! Ask anything about your operations.
                    </Typography>
                    <Typography variant="body2">
                      Try “Show me overdue tasks for this week” or “How do I add a purchase order?”.
                      This chat clears automatically when you sign out.
                    </Typography>
                  </Box>
                )}
                {msgs.map((m) => {
                  const isUser = m.role === 'user';
                  return (
                    <Box
                      key={m.id}
                      sx={{
                        mb: 2,
                        display: 'flex',
                        justifyContent: isUser ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <Box
                        sx={{
                          maxWidth: '80%',
                          px: 1.75,
                          py: 1.25,
                          borderRadius: 3,
                          background: isUser
                            ? `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`
                            : alpha(theme.palette.background.paper, 0.95),
                          color: isUser ? theme.palette.primary.contrastText : theme.palette.text.primary,
                          boxShadow: isUser
                            ? '0 12px 25px rgba(28, 97, 234, 0.35)'
                            : `0 8px 16px ${alpha(theme.palette.common.black, 0.08)}`,
                          border: isUser
                            ? 'none'
                            : `1px solid ${alpha(theme.palette.primary.main, 0.15)}`,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        <Typography variant="body2">{m.text}</Typography>
                        {m.rows && Array.isArray(m.rows) && m.rows.length > 0 && (
                          <Box
                            sx={{
                              mt: 1.5,
                              borderRadius: 2,
                              border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                              backgroundColor: alpha(theme.palette.background.default, 0.95),
                              overflow: 'hidden',
                            }}
                          >
                            <Box
                              sx={{
                                px: 1,
                                py: 0.75,
                                borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
                                backgroundColor: alpha(theme.palette.primary.light, 0.1),
                              }}
                            >
                              <Typography variant="caption" sx={{ fontWeight: 600, letterSpacing: 0.5 }}>
                                Data preview
                              </Typography>
                            </Box>
                            <Box sx={{ maxHeight: 160, overflow: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                  <tr>
                                    {Object.keys(m.rows[0]).slice(0, 6).map((k) => (
                                      <th
                                        key={k}
                                        style={{
                                          textAlign: 'left',
                                          padding: '6px 8px',
                                          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
                                          fontWeight: 600,
                                        }}
                                      >
                                        {k}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {m.rows.slice(0, 10).map((r, idx) => (
                                    <tr key={idx}>
                                      {Object.keys(m.rows![0]).slice(0, 6).map((k) => (
                                        <td
                                          key={k}
                                          style={{
                                            padding: '6px 8px',
                                            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
                                          }}
                                        >
                                          {String(r[k])}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </Box>
                          </Box>
                        )}
                      </Box>
                    </Box>
                  );
                })}
                {sending && (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', color: 'text.secondary', mt: 1 }}>
                    <CircularProgress size={18} thickness={5} />
                    <Typography variant="body2">Aiven is thinking...</Typography>
                  </Box>
                )}
              </Box>

              <Divider />

              <Box
                component="form"
                onSubmit={handleSubmit}
                sx={{
                  p: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  backgroundColor: alpha(theme.palette.background.paper, 0.98),
                }}
              >
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Ask Aiven anything about your data or workflows..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  InputProps={{
                    sx: {
                      borderRadius: 3,
                      backgroundColor: alpha(theme.palette.background.default, 0.9),
                      boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.08)}`,
                    },
                  }}
                />
                <IconButton
                  type="submit"
                  color="primary"
                  disabled={sending || !input.trim()}
                  sx={{
                    bgcolor: sending || !input.trim() ? 'action.disabledBackground' : theme.palette.primary.main,
                    color: sending || !input.trim() ? 'text.disabled' : theme.palette.primary.contrastText,
                    '&:hover':
                      sending || !input.trim()
                        ? undefined
                        : { bgcolor: theme.palette.primary.dark, color: theme.palette.primary.contrastText },
                    transition: 'background-color 0.2s ease, transform 0.2s ease',
                    transform: sending || !input.trim() ? 'none' : 'translateY(0)',
                    boxShadow:
                      sending || !input.trim()
                        ? 'none'
                        : '0 12px 24px rgba(28, 97, 234, 0.3)',
                  }}
                >
                  <SendIcon />
                </IconButton>
              </Box>
            </Paper>
          </Box>
        </Slide>
      </>
    );
  }

  return (
    <Box
      sx={{
        display: { xs: 'none', sm: 'flex' },
        flexDirection: 'row',
        height: '100vh',
        position: 'relative',
      }}
    >
      {!open ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: 44 }}>
          <Box sx={{ ...theme.mixins.toolbar }} />
          <Box
            onClick={onOpen}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
              }
            }}
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <Box
              sx={{
                width: '100%',
                px: 1,
                py: 2,
                mr: -1,
                borderTopLeftRadius: 16,
                borderBottomLeftRadius: 16,
                background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
                boxShadow: '0 18px 35px rgba(28, 97, 234, 0.35)',
                color: theme.palette.primary.contrastText,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography
                variant="button"
                sx={{
                  writingMode: 'vertical-rl',
                  transform: 'rotate(180deg)',
                  letterSpacing: 1,
                  fontWeight: 600,
                }}
              >
                Aiven Assistant
              </Typography>
            </Box>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', height: '100vh' }}>
          <Box
            sx={{
              width: desktopHandleWidth,
              display: 'flex',
              flexDirection: 'column',
              borderLeft: `1px solid ${alpha(theme.palette.primary.main, 0.15)}`,
              backgroundColor: alpha(theme.palette.background.paper, 0.6),
            }}
          >
            <Box sx={{ ...theme.mixins.toolbar }} />
            <Box
              onMouseDown={handleResizeStart}
              role="presentation"
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'col-resize',
                transition: 'background-color 0.2s ease',
                bgcolor: isResizing ? alpha(theme.palette.primary.main, 0.12) : 'transparent',
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
              }}
            >
              <Box
                sx={{
                  width: 2,
                  height: 48,
                  borderRadius: 1,
                  backgroundColor: alpha(theme.palette.text.primary, 0.3),
                }}
              />
            </Box>
          </Box>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              height: '100vh',
              width: effectiveDesktopWidth,
              minWidth: effectiveDesktopWidth,
              maxWidth: effectiveDesktopWidth,
            }}
          >
            <Box sx={{ ...theme.mixins.toolbar }} />
            <Paper
              elevation={12}
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                borderRadius: '16px 0 0 16px',
                borderLeft: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                backgroundColor: alpha(theme.palette.background.paper, 0.96),
                backdropFilter: 'blur(10px)',
              }}
            >
              <Box
                sx={{
                  px: 2.5,
                  py: 1.75,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.95)}, ${alpha(
                    theme.palette.primary.dark,
                    0.9,
                  )})`,
                  color: theme.palette.primary.contrastText,
                }}
              >
                <Avatar sx={{ bgcolor: alpha('#ffffff', 0.2) }}>
                  <SmartToyIcon fontSize="small" />
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Aiven Assistant
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.85 }}>
                    Your workspace copilot for instant answers
                  </Typography>
                </Box>
                <IconButton size="small" onClick={onClose} sx={{ color: 'inherit' }}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>

              <Divider sx={{ borderColor: alpha('#fff', 0.18) }} />

              <Box
                ref={scrollRef}
                sx={{
                  flex: 1,
                  px: 2.5,
                  py: 2,
                  background: `radial-gradient(circle at top right, ${alpha(
                    theme.palette.primary.light,
                    0.14,
                  )} 0%, transparent 60%)`,
                  overflowY: 'auto',
                }}
              >
                {msgs.length === 0 && (
                  <Box
                    sx={{
                      textAlign: 'center',
                      py: 4,
                      px: 2,
                      color: 'text.secondary',
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      Welcome! Ask anything about your operations.
                    </Typography>
                    <Typography variant="body2">
                      Try “Show me overdue tasks for this week” or “How do I add a purchase order?”.
                      This chat clears automatically when you sign out.
                    </Typography>
                  </Box>
                )}
                {msgs.map((m) => {
                  const isUser = m.role === 'user';
                  return (
                    <Box
                      key={m.id}
                      sx={{
                        mb: 2,
                        display: 'flex',
                        justifyContent: isUser ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <Box
                        sx={{
                          maxWidth: '80%',
                          px: 1.75,
                          py: 1.25,
                          borderRadius: 3,
                          background: isUser
                            ? `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`
                            : alpha(theme.palette.background.paper, 0.95),
                          color: isUser ? theme.palette.primary.contrastText : theme.palette.text.primary,
                          boxShadow: isUser
                            ? '0 12px 25px rgba(28, 97, 234, 0.35)'
                            : `0 8px 16px ${alpha(theme.palette.common.black, 0.08)}`,
                          border: isUser
                            ? 'none'
                            : `1px solid ${alpha(theme.palette.primary.main, 0.15)}`,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        <Typography variant="body2">{m.text}</Typography>
                        {m.rows && Array.isArray(m.rows) && m.rows.length > 0 && (
                          <Box
                            sx={{
                              mt: 1.5,
                              borderRadius: 2,
                              border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                              backgroundColor: alpha(theme.palette.background.default, 0.95),
                              overflow: 'hidden',
                            }}
                          >
                            <Box
                              sx={{
                                px: 1,
                                py: 0.75,
                                borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
                                backgroundColor: alpha(theme.palette.primary.light, 0.1),
                              }}
                            >
                              <Typography variant="caption" sx={{ fontWeight: 600, letterSpacing: 0.5 }}>
                                Data preview
                              </Typography>
                            </Box>
                            <Box sx={{ maxHeight: 160, overflow: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                  <tr>
                                    {Object.keys(m.rows[0]).slice(0, 6).map((k) => (
                                      <th
                                        key={k}
                                        style={{
                                          textAlign: 'left',
                                          padding: '6px 8px',
                                          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
                                          fontWeight: 600,
                                        }}
                                      >
                                        {k}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {m.rows.slice(0, 10).map((r, idx) => (
                                    <tr key={idx}>
                                      {Object.keys(m.rows![0]).slice(0, 6).map((k) => (
                                        <td
                                          key={k}
                                          style={{
                                            padding: '6px 8px',
                                            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
                                          }}
                                        >
                                          {String(r[k])}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </Box>
                          </Box>
                        )}
                      </Box>
                    </Box>
                  );
                })}
                {sending && (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', color: 'text.secondary', mt: 1 }}>
                    <CircularProgress size={18} thickness={5} />
                    <Typography variant="body2">Aiven is thinking...</Typography>
                  </Box>
                )}
              </Box>

              <Divider />

              <Box
                component="form"
                onSubmit={handleSubmit}
                sx={{
                  p: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  backgroundColor: alpha(theme.palette.background.paper, 0.98),
                }}
              >
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Ask Aiven anything about your data or workflows..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  InputProps={{
                    sx: {
                      borderRadius: 3,
                      backgroundColor: alpha(theme.palette.background.default, 0.9),
                      boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.08)}`,
                    },
                  }}
                />
                <IconButton
                  type="submit"
                  color="primary"
                  disabled={sending || !input.trim()}
                  sx={{
                    bgcolor: sending || !input.trim() ? 'action.disabledBackground' : theme.palette.primary.main,
                    color: sending || !input.trim() ? 'text.disabled' : theme.palette.primary.contrastText,
                    '&:hover':
                      sending || !input.trim()
                        ? undefined
                        : { bgcolor: theme.palette.primary.dark, color: theme.palette.primary.contrastText },
                    transition: 'background-color 0.2s ease, transform 0.2s ease',
                    transform: sending || !input.trim() ? 'none' : 'translateY(0)',
                    boxShadow:
                      sending || !input.trim()
                        ? 'none'
                        : '0 12px 24px rgba(28, 97, 234, 0.3)',
                  }}
                >
                  <SendIcon />
                </IconButton>
              </Box>
            </Paper>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default AssistantWidget;

