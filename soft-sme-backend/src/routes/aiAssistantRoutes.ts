import express, { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import aiAssistantService from '../services/aiAssistantService';

const router = express.Router();

/**
 * Send message to AI assistant
 * POST /api/ai-assistant/chat
 */
router.post('/chat', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { message, conversationId } = req.body;
    const userId = req.user?.id;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Message is required and must be a string'
      });
    }

    if (message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message cannot be empty'
      });
    }

    // Send message to AI agent
            const aiResponse = await aiAssistantService.sendMessage(
          message,
          userId ? parseInt(userId.toString()) : undefined,
          conversationId
        );

    res.json({
      success: true,
      data: {
        response: aiResponse.response,
        sources: aiResponse.sources,
        confidence: aiResponse.confidence,
        toolUsed: aiResponse.tool_used,
        timestamp: new Date()
      }
    });

  } catch (error) {
    console.error('AI Assistant chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get response from AI assistant',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get AI assistant health status
 * GET /api/ai-assistant/health
 */
router.get('/health', authMiddleware, async (req: Request, res: Response) => {
  try {
    const healthStatus = await aiAssistantService.getHealthStatus();
    
    res.json({
      success: true,
      data: healthStatus
    });

  } catch (error) {
    console.error('AI Assistant health check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check AI assistant health',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Initialize AI assistant
 * POST /api/ai-assistant/initialize
 */
router.post('/initialize', authMiddleware, async (req: Request, res: Response) => {
  try {
    await aiAssistantService.initializeAI();
    
    res.json({
      success: true,
      message: 'AI assistant initialized successfully'
    });

  } catch (error) {
    console.error('AI Assistant initialization error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize AI assistant',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get conversation history
 * GET /api/ai-assistant/conversation/:conversationId
 */
router.get('/conversation/:conversationId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?.id;

    // TODO: Add authorization check to ensure user can access this conversation
    
    const messages = await aiAssistantService.getConversationHistory(conversationId);
    
    res.json({
      success: true,
      data: {
        conversationId,
        messages
      }
    });

  } catch (error) {
    console.error('Get conversation history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get conversation history',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Clear conversation history
 * DELETE /api/ai-assistant/conversation/:conversationId
 */
router.delete('/conversation/:conversationId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?.id;

    // TODO: Add authorization check to ensure user can clear this conversation
    
    await aiAssistantService.clearConversationHistory(conversationId);
    
    res.json({
      success: true,
      message: 'Conversation history cleared successfully'
    });

  } catch (error) {
    console.error('Clear conversation history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear conversation history',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get AI assistant statistics
 * GET /api/ai-assistant/stats
 */
router.get('/stats', authMiddleware, async (req: Request, res: Response) => {
  try {
    const stats = await aiAssistantService.getStatistics();
    
    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Get AI assistant stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get AI assistant statistics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Start AI assistant (admin only)
 * POST /api/ai-assistant/start
 */
router.post('/start', authMiddleware, async (req: Request, res: Response) => {
  try {
    // TODO: Add admin role check
    const user = req.user;
    if (!user) {
      return res.status(403).json({
        success: false,
        message: 'Authentication required'
      });
    }

    await aiAssistantService.startAIAgent();
    
    res.json({
      success: true,
      message: 'AI assistant started successfully'
    });

  } catch (error) {
    console.error('Start AI assistant error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start AI assistant',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Stop AI assistant (admin only)
 * POST /api/ai-assistant/stop
 */
router.post('/stop', authMiddleware, async (req: Request, res: Response) => {
  try {
    // TODO: Add admin role check
    const user = req.user;
    if (!user) {
      return res.status(403).json({
        success: false,
        message: 'Authentication required'
      });
    }

    await aiAssistantService.stopAIAgent();
    
    res.json({
      success: true,
      message: 'AI assistant stopped successfully'
    });

  } catch (error) {
    console.error('Stop AI assistant error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop AI assistant',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router; 