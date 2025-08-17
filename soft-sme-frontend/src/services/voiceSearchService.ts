import api from '../api/axios';

export interface VoiceSearchResult {
  searchTerms: string[];
  confidence: number;
  originalQuery: string;
}

export interface PartSearchQuery {
  query: string;
  searchInPartNumbers: boolean;
  searchInDescriptions: boolean;
  extractedTerms: string[];
}

class VoiceSearchService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private stream: MediaStream | null = null;

  async startRecording(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000, // Lower sample rate for smaller file size
          channelCount: 1,   // Mono audio
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // Use compressed audio format
      const options = {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 16000 // Lower bitrate for smaller file
      };
      
      // Fallback to default if opus is not supported
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        delete options.mimeType;
      }
      
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.audioChunks = [];
      this.isRecording = true;

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(1000); // Collect data every second
    } catch (error) {
      console.error('Error starting voice recording:', error);
      throw new Error('Failed to start voice recording. Please check microphone permissions.');
    }
  }

  async stopRecording(): Promise<VoiceSearchResult> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || !this.isRecording) {
        reject(new Error('No active recording'));
        return;
      }

      this.mediaRecorder.onstop = async () => {
        try {
          this.isRecording = false;
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
          const result = await this.processAudioQuery(audioBlob);
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.cleanup();
        }
      };

      this.mediaRecorder.stop();
    });
  }

  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
  }

  private async processAudioQuery(audioBlob: Blob): Promise<VoiceSearchResult> {
    try {
      // Check file size (limit to 1MB)
      const maxSize = 1024 * 1024; // 1MB
      if (audioBlob.size > maxSize) {
        throw new Error(`Audio file too large (${(audioBlob.size / 1024 / 1024).toFixed(2)}MB). Please record a shorter message.`);
      }
      
      // Convert audio to base64
      const base64Audio = await this.blobToBase64(audioBlob);
      
      // Send to backend for Gemini Live processing
      const response = await api.post('/api/voice-search/search-parts', {
        audioData: base64Audio,
        audioFormat: audioBlob.type || 'audio/webm'
      });

      return response.data;
    } catch (error) {
      console.error('Error processing voice query:', error);
      if (error instanceof Error) {
        throw new Error(error.message);
      }
      throw new Error('Failed to process voice query. Please try again.');
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix to get just the base64 string
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async interpretTextQuery(textQuery: string): Promise<PartSearchQuery> {
    try {
          const response = await api.post('/api/voice-search/interpret-query', {
      query: textQuery
    });

      return response.data;
    } catch (error) {
      console.error('Error interpreting text query:', error);
      // Fallback: return the original query as search terms
      return {
        query: textQuery,
        searchInPartNumbers: true,
        searchInDescriptions: true,
        extractedTerms: [textQuery]
      };
    }
  }

  isRecordingActive(): boolean {
    return this.isRecording;
  }

  cancelRecording(): void {
    if (this.isRecording) {
      this.mediaRecorder?.stop();
      this.cleanup();
    }
  }
}

export default new VoiceSearchService();
