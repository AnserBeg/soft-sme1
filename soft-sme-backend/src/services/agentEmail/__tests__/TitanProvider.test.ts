import { TitanProvider, TitanProviderInternals } from '../providers/TitanProvider';
import type { AgentEmailDraftStore } from '../draftStore';

const mockFetchOne = jest.fn();
const mockSearch = jest.fn();
const mockMailboxOpen = jest.fn();
const mockLogout = jest.fn();
const mockConnect = jest.fn();
const mockClose = jest.fn();

const mockTransportSend = jest.fn();

jest.mock('imapflow', () => {
  return {
    ImapFlow: jest.fn().mockImplementation(() => ({
      connect: mockConnect.mockResolvedValue(undefined),
      mailboxOpen: mockMailboxOpen.mockResolvedValue(undefined),
      fetchOne: mockFetchOne,
      search: mockSearch,
      logout: mockLogout.mockResolvedValue(undefined),
      close: mockClose.mockResolvedValue(undefined),
    })),
  };
});

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockTransportSend.mockResolvedValue({ messageId: '<mocked>' }),
    verify: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('mailparser', () => ({
  simpleParser: jest.fn(async () => ({
    subject: 'Parsed Subject',
    text: 'Plain text body',
    html: '<div><script>alert(1)</script><p>Body</p></div>',
    attachments: [],
    headers: new Map([['thread-index', 'thread-1']]),
    from: { value: [{ address: 'sender@example.com', name: 'Sender' }] },
    to: { value: [{ address: 'user@example.com' }] },
    cc: { value: [] },
    bcc: { value: [] },
    messageId: '<message-1>',
  })),
}));

describe('TitanProvider', () => {
  const baseConfig = {
    hostImap: 'imap.titan.email',
    portImap: 993,
    hostSmtp: 'smtp.titan.email',
    portSmtp: 465,
    email: 'user@example.com',
    password: 'secret',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('translates search filters into IMAP criteria', () => {
    const { search } = TitanProviderInternals.parseQuery(
      'from:bob@example.com subject:"Quarterly" has:attachment after:2024-01-01 hello world'
    );

    expect(search.from).toBe('bob@example.com');
    expect(search.subject).toBe('Quarterly');
    expect(search.since).toBeInstanceOf(Date);
    expect(search.text).toContain('hello world');

    const headerTuples = Array.isArray(search.header)
      ? (search.header as Array<[string, string]>)
      : [];

    expect(headerTuples).toContainEqual(['Content-Type', 'multipart']);
  });

  it('sanitizes HTML when reading messages', async () => {
    mockFetchOne.mockResolvedValueOnce({
      source: Buffer.from(''),
      envelope: {
        from: [{ address: 'sender@example.com' }],
        to: [{ address: 'user@example.com' }],
        subject: 'Parsed Subject',
      },
      internalDate: new Date('2024-01-01T10:00:00Z'),
      flags: ['\\Seen'],
    });

    const draftStore = {
      createDraft: jest.fn(),
      verifyAndConsumeDraft: jest.fn(),
      getDraft: jest.fn(),
    } as unknown as AgentEmailDraftStore;

    const provider = new TitanProvider(42, baseConfig, draftStore);
    const message = await provider.emailRead('1');

    expect(message.htmlBody).toContain('<div>');
    expect(message.htmlBody).not.toContain('<script>');
    expect(message.from.address).toBe('sender@example.com');
    expect(message.to[0].address).toBe('user@example.com');
  });

  it('requires drafts for sending', async () => {
    const draftStore = {
      createDraft: jest.fn(),
      verifyAndConsumeDraft: jest.fn(),
      getDraft: jest.fn(),
    } as unknown as AgentEmailDraftStore;

    const provider = new TitanProvider(99, baseConfig, draftStore);
    await expect(
      provider.emailSend({
        confirmToken: 'abc123',
        payload: {
          to: ['recipient@example.com'],
          subject: 'Test',
        },
      })
    ).rejects.toThrow('Direct payload send is not supported for Titan without a stored draft.');
  });

  it('consumes draft and sends via SMTP when confirmation is provided', async () => {
    const draftStore = {
      createDraft: jest.fn(),
      verifyAndConsumeDraft: jest.fn().mockResolvedValue({
        payload: {
          to: ['recipient@example.com'],
          subject: 'Test',
          textBody: 'Body',
        },
      }),
      getDraft: jest.fn(),
    } as unknown as AgentEmailDraftStore;

    const provider = new TitanProvider(7, baseConfig, draftStore);
    const result = await provider.emailSend({ draftId: 'draft-1', confirmToken: 'token-123' });

    expect(draftStore.verifyAndConsumeDraft).toHaveBeenCalledWith(7, 'titan', 'draft-1', 'token-123');
    expect(mockTransportSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'recipient@example.com',
        subject: 'Test',
      })
    );
    expect(result.status).toBe('sent');
  });
});
