import { useState, useEffect, useCallback, useRef } from 'react';
import { ChatMessage } from '../components/ChatMessage';
import { chatService } from '../services/chatService';
import { toast } from 'react-toastify';
import { VoiceCallArtifact } from '../types/voice';

const STORAGE_KEY = 'chat_messages';

export const useChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const previousMessageCountRef = useRef(0);

  // Load messages from localStorage on mount
  useEffect(() => {
    const savedMessages = localStorage.getItem(STORAGE_KEY);
    if (savedMessages) {
      try {
        const parsedMessages = JSON.parse(savedMessages);
        // Convert timestamp strings back to Date objects
        const messagesWithDates = parsedMessages.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        }));
        setMessages(messagesWithDates);
      } catch (error) {
        console.error('Error loading chat messages:', error);
      }
    }
  }, []);

  // Save messages to localStorage whenever messages change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (messages.length > previousMessageCountRef.current) {
      const newMessages = messages.slice(previousMessageCountRef.current);
      const unreadMessages = newMessages.filter((msg) => msg.sender !== 'user');

      if (unreadMessages.length > 0) {
        if (!isOpen) {
          setUnreadCount((prev) => prev + unreadMessages.length);
          const label = unreadMessages.length > 1 ? `${unreadMessages.length} new replies` : 'Workspace Copilot replied';
          toast.info(label, { toastId: 'chat-unread' });
        } else {
          setUnreadCount(0);
        }
      }
    } else if (isOpen && unreadCount !== 0) {
      setUnreadCount(0);
    }

    previousMessageCountRef.current = messages.length;
  }, [messages, isOpen, unreadCount]);

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    // Add user message immediately
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text,
      sender: 'user',
      timestamp: new Date(),
    };
    
    addMessage(userMessage);
    setIsLoading(true);

    try {
      // Get AI response
      const aiResponse = await chatService.sendMessage(text);

      const { cleanedText, artifacts } = extractVoiceArtifacts(
        aiResponse.response || 'No response received',
        aiResponse.callArtifacts
      );

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: cleanedText,
        sender: 'ai',
        timestamp: new Date(),
        callArtifacts: artifacts,
      };
      
      addMessage(aiMessage);
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Add error message
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: 'Sorry, I encountered an error. Please try again.',
        sender: 'ai',
        timestamp: new Date(),
      };
      
      addMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [addMessage]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
    setUnreadCount(0);
  }, []);

  const toggleChat = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        setUnreadCount(0);
      }
      return next;
    });
  }, []);

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const openChat = useCallback(async () => {
    setIsOpen(true);
    setUnreadCount(0);
    // Test API connection when chat is opened
    const isConnected = await chatService.testConnection();
    console.log('API Connection Test:', isConnected ? 'SUCCESS' : 'FAILED');
  }, []);

  const acknowledgeMessages = useCallback(() => {
    setUnreadCount(0);
  }, []);

  return {
    messages,
    isLoading,
    isOpen,
    unreadCount,
    sendMessage,
    clearMessages,
    toggleChat,
    closeChat,
    openChat,
    acknowledgeMessages,
  };
};

const extractVoiceArtifacts = (text: string, provided?: VoiceCallArtifact[] | undefined) => {
  let cleanedText = text;
  let artifacts: VoiceCallArtifact[] | undefined = provided?.length ? provided : undefined;

  if (!artifacts) {
    const match = text.match(/\{\"type\":\"vendor_call_summary\"[\s\S]*\}$/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && parsed.type === 'vendor_call_summary') {
          artifacts = [parsed];
          cleanedText = text.replace(match[0], '').trim();
        }
      } catch (error) {
        console.warn('Failed to parse vendor call summary payload', error);
      }
    }
  }

  return { cleanedText, artifacts };
};
