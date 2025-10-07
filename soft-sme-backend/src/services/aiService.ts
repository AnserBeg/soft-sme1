// Direct Gemini AI Service for NeuraTask
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// AI Configuration
const AI_CONFIG = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_API_URL: `https://generativelanguage.googleapis.com/v1beta/models/${process.env.AI_MODEL || 'gemini-2.5-flash'}:generateContent`,
  MAX_TOKENS: parseInt(process.env.AI_MAX_TOKENS || '1000'),
  TEMPERATURE: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
  MODEL: process.env.AI_MODEL || 'gemini-2.5-flash'
};

// System prompt for the AI assistant
const SYSTEM_PROMPT = "You are an expert AI assistant in inventory management in the NEURATASK application";

export class AIService {
  static async sendMessage(message: string, userId?: number): Promise<string> {
    if (!AI_CONFIG.GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    try {
      console.log(`[AI] User ${userId || 'unknown'} sent message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);

      // Prepare the request payload with system prompt
      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: `${SYSTEM_PROMPT}\n\nUser: ${message}\n\nAssistant:`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: AI_CONFIG.TEMPERATURE,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: AI_CONFIG.MAX_TOKENS,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          }
        ]
      };

      // Make the API call directly to Gemini
      const response = await fetch(`${AI_CONFIG.GEMINI_API_URL}?key=${AI_CONFIG.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AI] API request failed: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Extract the response text
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const responseText = data.candidates[0].content.parts[0].text;
        
        console.log(`[AI] Gemini response to user ${userId || 'unknown'}: "${responseText.substring(0, 50)}${responseText.length > 50 ? '...' : ''}"`);
        
        return responseText.trim();
      } else {
        console.error('[AI] Invalid response format:', data);
        throw new Error('Invalid response format from Gemini API');
      }

    } catch (error) {
      console.error('[AI] Error calling Gemini API:', error);
      throw error; // Re-throw the error to be handled by the route
    }
  }
} 