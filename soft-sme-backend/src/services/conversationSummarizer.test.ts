import { ConversationSummarizer } from './conversationSummarizer';
import { ConversationMessage } from './aiConversationManager';

describe('ConversationSummarizer', () => {
  const buildMessage = (
    role: 'user' | 'assistant' | 'system',
    content: string,
    index: number
  ): ConversationMessage => ({
    id: `msg-${index}`,
    conversationId: 'conv-1',
    role,
    content,
    metadata: {},
    createdAt: new Date(1700000000000 + index * 1000)
  });

  test('summarizeMessages creates highlights from recent user inputs', () => {
    const messages: ConversationMessage[] = [
      buildMessage('user', 'First request about inventory levels.', 0),
      buildMessage('assistant', 'Acknowledged.', 1),
      buildMessage('user', 'Need pricing update for item A.', 2),
      buildMessage('assistant', 'Pricing update sent.', 3),
      buildMessage('user', 'Confirm if shipment has been scheduled.', 4),
      buildMessage('assistant', 'Shipment scheduled for tomorrow.', 5)
    ];

    const { highlights, resolution, summaryText } = ConversationSummarizer.summarizeMessages(messages);

    expect(highlights).toEqual([
      'First request about inventory levels.',
      'Need pricing update for item A.',
      'Confirm if shipment has been scheduled.'
    ]);
    expect(resolution).toBe('Shipment scheduled for tomorrow.');
    expect(summaryText).toContain('Key points:');
    expect(summaryText).toContain('Latest resolution: Shipment scheduled for tomorrow.');
  });

  test('summarizeMessages handles missing assistant responses', () => {
    const messages: ConversationMessage[] = [
      buildMessage('user', 'Please escalate this urgent outage to Tier 2.', 0),
      buildMessage('user', 'Customer is waiting for acknowledgement.', 1)
    ];

    const { highlights, resolution, summaryText } = ConversationSummarizer.summarizeMessages(messages);

    expect(highlights).toHaveLength(2);
    expect(resolution).toBeNull();
    expect(summaryText).toContain('Pending');
  });
});
