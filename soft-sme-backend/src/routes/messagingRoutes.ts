import express, { Request, Response } from 'express';
import { messagingService } from '../services/messagingService';

const router = express.Router();

router.post('/conversations', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const userId = Number(req.user.id);
    const companyId = Number(req.user.company_id);

    if (!Number.isInteger(userId) || !Number.isInteger(companyId)) {
      return res.status(400).json({ message: 'Invalid user context' });
    }

    const { participantIds, title, type } = req.body ?? {};
    const participantsArray = Array.isArray(participantIds)
      ? participantIds
          .map((id: any) => Number(id))
          .filter((id: number) => Number.isInteger(id) && id > 0)
      : [];

    const normalizedType = type === 'group' || type === 'direct' ? type : undefined;

    const result = await messagingService.createConversation({
      companyId,
      createdBy: userId,
      participantIds: participantsArray,
      title: typeof title === 'string' ? title : undefined,
      type: normalizedType,
    });

    const status = result.created ? 201 : 200;
    return res.status(status).json({ conversation: result.conversation, created: result.created });
  } catch (error) {
    console.error('Failed to create conversation', error);
    const status = (error as any)?.status ?? 500;
    const message = (error as Error).message || 'Unable to create conversation';
    return res.status(status).json({ message });
  }
});

router.get('/conversations', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const userId = Number(req.user.id);
    const companyId = Number(req.user.company_id);

    if (!Number.isInteger(userId) || !Number.isInteger(companyId)) {
      return res.status(400).json({ message: 'Invalid user context' });
    }

    const conversations = await messagingService.getUserConversations(userId, companyId);
    return res.json({ conversations });
  } catch (error) {
    console.error('Failed to list conversations', error);
    return res.status(500).json({ message: 'Unable to fetch conversations' });
  }
});

router.post('/conversations/:conversationId/messages', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const conversationId = Number(req.params.conversationId);
    const userId = Number(req.user.id);

    if (!Number.isInteger(conversationId)) {
      return res.status(400).json({ message: 'Invalid conversation id' });
    }

    if (!Number.isInteger(userId)) {
      return res.status(400).json({ message: 'Invalid user context' });
    }

    const { content } = req.body ?? {};
    if (typeof content !== 'string') {
      return res.status(400).json({ message: 'Message content is required' });
    }

    const message = await messagingService.appendMessage(conversationId, userId, content);
    return res.status(201).json({ message });
  } catch (error) {
    console.error('Failed to send message', error);
    const status = (error as any)?.status ?? 500;
    const message = (error as Error).message || 'Unable to send message';
    return res.status(status).json({ message });
  }
});

router.get('/conversations/:conversationId/messages', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const conversationId = Number(req.params.conversationId);
    const userId = Number(req.user.id);

    if (!Number.isInteger(conversationId)) {
      return res.status(400).json({ message: 'Invalid conversation id' });
    }

    if (!Number.isInteger(userId)) {
      return res.status(400).json({ message: 'Invalid user context' });
    }

    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;

    const messages = await messagingService.getConversationMessages(conversationId, userId, { limit, before });
    return res.json({ messages });
  } catch (error) {
    console.error('Failed to fetch messages', error);
    const status = (error as any)?.status ?? 500;
    const message = (error as Error).message || 'Unable to fetch messages';
    return res.status(status).json({ message });
  }
});

export default router;
