import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../../db';

interface GeminiLiveResponse {
  audio?: string;
  functionCall?: {
    name: string;
    args: any;
  };
  transcript?: string;
}

export class GeminiLiveBridge {
  private sessionId: string;
  private genAI: GoogleGenerativeAI;
  private model: any;
  private conversation: any;
  private isConnected: boolean = false;
  private liveEnabled: boolean;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.liveEnabled = (process.env.GEMINI_LIVE_ENABLED || 'false').toLowerCase() === 'true';
    this.initializeGeminiLive();
  }

  private async initializeGeminiLive() {
    try {
      if (!this.liveEnabled) {
        // Run in no-op mode to keep call connected without Live API
        this.isConnected = true;
        console.log(`Gemini Live disabled. Running session ${this.sessionId} in passive mode.`);
        return;
      }
      // Initialize Gemini Live model
      this.model = this.genAI.getGenerativeModel({ 
        model: process.env.GEMINI_LIVE_MODEL || 'gemini-live-2.5-flash-preview' 
      });

      // Set up conversation with system prompt
      this.conversation = this.model.startChat({
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        },
        // Tools must be wrapped in functionDeclarations per Google SDK shape
        tools: [
          {
            functionDeclarations: this.getFunctionSchemas(),
          },
        ],
      });

      // Send initial system prompt
      await this.conversation.sendMessage(this.getSystemPrompt());
      this.isConnected = true;
      
      console.log(`Gemini Live initialized for session: ${this.sessionId}`);
    } catch (error) {
      console.error('Error initializing Gemini Live:', error);
      this.isConnected = false;
    }
  }

  private getSystemPrompt(): string {
    return `You are an AI agent calling vendors on behalf of a truck and trailer company. Your role is to:

1. Introduce yourself professionally as an agent from the company
2. Ask to speak with the appropriate person for parts/orders
3. Clearly state the Purchase Order number and what is being ordered
4. Ask for an email address to send the PO PDF
5. Be polite, professional, and concise
6. Use natural conversation flow
7. Extract key information using the available functions

Current context: You are calling about a Purchase Order. Be ready to use functions to capture:
- Vendor email address
- Any special order details
- Parts being ordered

Speak naturally and respond to the vendor's questions professionally.`;
  }

  private getFunctionSchemas() {
    return [
      {
        name: 'set_vendor_email',
        description: 'Capture the vendor\'s email address for sending the PO PDF',
        parameters: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              description: 'The vendor\'s email address'
            }
          },
          required: ['email']
        }
      },
      {
        name: 'order_part',
        description: 'Record details about parts being ordered during the call',
        parameters: {
          type: 'object',
          properties: {
            parts: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'List of parts being ordered'
            },
            details: {
              type: 'string',
              description: 'Additional order details or special instructions'
            }
          },
          required: ['parts']
        }
      },
      {
        name: 'send_po_pdf',
        description: 'Mark that the PO PDF should be sent to the vendor',
        parameters: {
          type: 'object',
          properties: {
            confirm: {
              type: 'boolean',
              description: 'Confirmation that PO PDF should be sent'
            }
          },
          required: ['confirm']
        }
      }
    ];
  }

  async processAudio(audioData: string): Promise<GeminiLiveResponse> {
    if (!this.isConnected) {
      return {};
    }
    if (!this.liveEnabled || !this.conversation) {
      // Passive mode: accept audio but do not process
      return {};
    }

    try {
      // Process audio through Gemini Live (use array form expected by SDK)
      const result = await this.conversation.sendMessage([
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: audioData,
              },
            },
          ],
        },
      ]);

      const response = result.response;
      
      // Check for function calls
      if (response.candidates && response.candidates[0].content.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.functionCall) {
            return {
              functionCall: {
                name: part.functionCall.name,
                args: part.functionCall.args
              }
            };
          }
        }
      }

      // Return audio response
      return {
        audio: response.text(),
        transcript: response.text()
      };
    } catch (error) {
      console.error('Error processing audio through Gemini Live:', error);
      throw error;
    }
  }

  async summarizeCall(): Promise<any> {
    try {
      // Use regular Gemini model for summarization
      const summaryModel = this.genAI.getGenerativeModel({ 
        model: process.env.GEMINI_SUMMARY_MODEL || 'gemini-2.5-flash' 
      });

      // Get call transcript from database
      const result = await pool.query(
        'SELECT transcript, structured_notes FROM vendor_call_sessions WHERE id = $1',
        [this.sessionId]
      );

      if (result.rows.length === 0) {
        throw new Error('Call session not found');
      }

      const { transcript, structured_notes } = result.rows[0];
      
      if (!transcript) {
        return { error: 'No transcript available for summarization' };
      }

      const prompt = `Summarize this vendor call transcript and extract key information:

Transcript: ${transcript}

Current structured notes: ${JSON.stringify(structured_notes || {})}

Please extract and structure the following information:
1. Vendor contact person name
2. Pickup time and location
3. Email address captured
4. Parts ordered
5. Special instructions or notes
6. Call outcome (successful, needs follow-up, etc.)

Return as JSON with these fields.`;

      const summaryResult = await summaryModel.generateContent(prompt);
      const summary = summaryResult.response.text();
      
      // Parse JSON from response
      try {
        const parsedSummary = JSON.parse(summary);
        
        // Update database with structured notes
        await pool.query(
          'UPDATE vendor_call_sessions SET structured_notes = $1, updated_at = NOW() WHERE id = $1',
          [JSON.stringify(parsedSummary), this.sessionId]
        );
        
        return parsedSummary;
      } catch (parseError) {
        console.error('Error parsing summary JSON:', parseError);
        return { summary: summary, error: 'Could not parse structured format' };
      }
    } catch (error) {
      console.error('Error summarizing call:', error);
      throw error;
    }
  }

  async cleanup() {
    try {
      if (this.conversation) {
        // Summarize the call before cleanup
        await this.summarizeCall();
      }
      this.isConnected = false;
      console.log(`Gemini Live cleaned up for session: ${this.sessionId}`);
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  isReady(): boolean {
    return this.isConnected;
  }
}


