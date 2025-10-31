import express, { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { AIService } from '../services/aiService';

const router = express.Router();

// Send message directly to Gemini (requires authentication)
router.post('/send', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    const userId = req.user?.id;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ 
        message: 'Message is required and must be a string' 
      });
    }

    if (message.trim().length === 0) {
      return res.status(400).json({ 
        message: 'Message cannot be empty' 
      });
    }

    // Get direct Gemini response
    const aiResponse = await AIService.sendMessage(message, userId ? parseInt(userId.toString()) : undefined);

    res.json({
      message: aiResponse,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chat route error:', error);
    
    // Handle specific error cases
    if (error instanceof Error) {
      if (error.message.includes('API key not configured')) {
        return res.status(500).json({ 
          message: 'AI service not configured. Please check your Gemini API key.' 
        });
      }
      if (error.message.includes('API request failed')) {
        return res.status(500).json({ 
          message: 'Unable to connect to AI service. Please try again later.' 
        });
      }
    }
    
    res.status(500).json({ 
      message: 'Server error while processing chat message' 
    });
  }
});

// Health check for Gemini service
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Test the Gemini service with a simple message
    const testResponse = await AIService.sendMessage('Hello');
    
    res.json({
      status: 'OK',
      message: 'Gemini service is working',
      testResponse: testResponse.substring(0, 50) + '...',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Gemini health check failed:', error);
    
    let errorMessage = 'AI service is not working';
    if (error instanceof Error) {
      if (error.message.includes('API key not configured')) {
        errorMessage = 'Gemini API key not configured';
      } else if (error.message.includes('API request failed')) {
        errorMessage = 'Unable to connect to Gemini API';
      }
    }
    
    res.status(500).json({
      status: 'ERROR',
      message: errorMessage,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Get AI configuration (read-only, no sensitive data)
router.get('/config', authMiddleware, async (req: Request, res: Response) => {
  try {
    res.json({
      model: process.env.AI_MODEL || 'gemini-1.5-flash',
      maxTokens: parseInt(process.env.AI_MAX_TOKENS || '1000'),
      temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('AI config endpoint error:', error);
    res.status(500).json({
      message: 'Error retrieving AI configuration'
    });
  }
});

export default router; 