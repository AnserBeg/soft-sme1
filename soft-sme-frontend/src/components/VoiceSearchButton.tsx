import React, { useState, useRef } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Typography,
  Chip
} from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import voiceSearchService from '../services/voiceSearchService';
import { toast } from 'react-toastify';

// TypeScript declarations for Web Speech API and Electron
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
    process?: {
      type?: string;
    };
  }
}

interface VoiceSearchButtonProps {
  onSearchTerms: (terms: string[], strategy: {searchInPartNumbers: boolean, searchInDescriptions: boolean}) => void;
  disabled?: boolean;
}

const VoiceSearchButton: React.FC<VoiceSearchButtonProps> = ({
  onSearchTerms,
  disabled = false
}) => {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  
  // Speech recognition
  const recognitionRef = useRef<any | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const initializeSpeechRecognition = () => {
    const isElectron = typeof window !== 'undefined' && window.process && window.process.type;
    
    if (typeof window !== 'undefined' && 'webkitSpeechRecognition' in window && !recognitionRef.current) {
      const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false; // Single utterance
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';
      
      if (isElectron) {
        console.log('Running in Electron environment');
      }
      
      recognitionRef.current.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }
        
        setTranscript(finalTranscript + interimTranscript);
        
        // If we have a final result, process it
        if (finalTranscript.trim()) {
          processVoiceInput(finalTranscript.trim());
        }
      };
      
      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        
        if (event.error === 'network') {
          const isElectron = typeof window !== 'undefined' && window.process && window.process.type;
          if (isElectron) {
            toast.error('Voice recognition network error in Electron. Please try again or use text search.');
          } else {
            toast.error('Voice recognition requires internet connection. Please try again.');
          }
          setIsListening(false);
        } else if (event.error === 'not-allowed') {
          toast.error('Microphone access denied. Please allow microphone access.');
          setIsListening(false);
        } else if (event.error === 'no-speech') {
          toast.info('No speech detected. Please try again.');
          setIsListening(false);
        } else if (event.error === 'audio-capture') {
          toast.error('Audio capture error. Please check your microphone.');
          setIsListening(false);
        } else if (event.error === 'service-not-allowed') {
          toast.error('Voice recognition service not allowed. This is common in Electron apps.');
          setIsListening(false);
        } else {
          console.error('Speech recognition error:', event.error);
          toast.error(`Voice recognition error: ${event.error}. Please try again.`);
          setIsListening(false);
        }
      };
      
      recognitionRef.current.onend = () => {
        setIsListening(false);
        setTranscript('');
      };
    }
  };

  const startListening = () => {
    try {
      const isSpeechRecognitionAvailable = typeof window !== 'undefined' && 
        ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
      
      if (!isSpeechRecognitionAvailable) {
        toast.error('Voice recognition not available in this browser.');
        return;
      }

      const isElectron = typeof window !== 'undefined' && window.process && window.process.type;
      if (isElectron) {
        toast.info('Voice recognition in Electron may have limitations. If it doesn\'t work, please use text search.');
      }

      initializeSpeechRecognition();
      
      if (recognitionRef.current) {
        setIsListening(true);
        setTranscript('');
        recognitionRef.current.start();
        
        // Auto-stop after 8 seconds
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          if (isListening) {
            stopListening();
          }
        }, 8000);
      }
    } catch (error) {
      console.error('Error starting voice recognition:', error);
      toast.error('Failed to start voice recognition.');
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  };

  const processVoiceInput = async (userInput: string) => {
    try {
      setIsProcessing(true);
      setTranscript('');
      
      console.log('🎤 Processing voice input:', userInput);
      
      // Interpret the query using AI
      console.log('🤖 Calling AI interpretation service...');
      const interpretedQuery = await voiceSearchService.interpretTextQuery(userInput);
      
      console.log('✅ AI interpretation result:', interpretedQuery);
      
      if (!interpretedQuery.extractedTerms || interpretedQuery.extractedTerms.length === 0) {
        console.warn('⚠️ No extracted terms from AI, using fallback');
        // Fallback: use the original input but clean it up
        const cleanedTerms = userInput
          .replace(/^(i want|give me|need|looking for|search for)/i, '')
          .trim()
          .split(/\s+/)
          .filter(word => word.length > 1);
        
        interpretedQuery.extractedTerms = cleanedTerms;
        interpretedQuery.searchInPartNumbers = true;
        interpretedQuery.searchInDescriptions = true;
      }
      
      // Pass the search terms and strategy to parent component
      console.log('📤 Sending search terms to parent:', interpretedQuery.extractedTerms);
      onSearchTerms(interpretedQuery.extractedTerms, {
        searchInPartNumbers: interpretedQuery.searchInPartNumbers,
        searchInDescriptions: interpretedQuery.searchInDescriptions
      });
      
      toast.success(`Voice search: "${userInput}" → ${interpretedQuery.extractedTerms.join(', ')}`);
      
    } catch (error) {
      console.error('❌ Error processing voice input:', error);
      toast.error('Failed to process voice input. Please try again.');
      
      // Fallback: use cleaned original input
      const cleanedTerms = userInput
        .replace(/^(i want|give me|need|looking for|search for)/i, '')
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 1);
      
      console.log('🔄 Using fallback terms:', cleanedTerms);
      onSearchTerms(cleanedTerms, {
        searchInPartNumbers: true,
        searchInDescriptions: true
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <Box>
      <Button
        variant="contained"
        size="large"
        onClick={handleClick}
        disabled={disabled || isProcessing}
        startIcon={
          isProcessing ? (
            <CircularProgress size={20} color="inherit" />
          ) : isListening ? (
            <StopIcon />
          ) : (
            <MicIcon />
          )
        }
        sx={{
          backgroundColor: isListening ? 'error.main' : 'primary.main',
          color: 'white',
          '&:hover': {
            backgroundColor: isListening ? 'error.dark' : 'primary.dark',
          },
          minWidth: 120,
          height: 48
        }}
      >
        {isProcessing ? 'Processing...' : isListening ? 'Stop' : 'Voice Search'}
      </Button>
      
      {/* Voice Status */}
      {isListening && (
        <Box display="flex" alignItems="center" gap={1} mt={1}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: 'error.main',
              animation: 'pulse 1s infinite',
              '@keyframes pulse': {
                '0%': { opacity: 1 },
                '50%': { opacity: 0.3 },
                '100%': { opacity: 1 },
              },
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Listening... {transcript && `"${transcript}"`}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default VoiceSearchButton;
