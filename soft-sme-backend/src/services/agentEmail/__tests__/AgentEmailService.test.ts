import { AgentEmailService } from '../service';

const mockPolicyServiceInstance = {
  getPolicy: jest.fn(),
};

const mockConnectionServiceInstance = {
  getConnection: jest.fn(),
  saveConnection: jest.fn(),
  markValidated: jest.fn(),
  deleteConnection: jest.fn(),
};

const mockDraftStoreInstance = {
  createDraft: jest.fn(),
  verifyAndConsumeDraft: jest.fn(),
  getDraft: jest.fn(),
};

const mockProviderInstance = {
  emailSearch: jest.fn(),
  emailRead: jest.fn(),
  emailComposeDraft: jest.fn(),
  emailSend: jest.fn(),
  emailReply: jest.fn(),
};

const mockProviderFactoryInstance = {
  getProvider: jest.fn(),
};

jest.mock('../policyService', () => ({
  EmailPolicyService: jest.fn(() => mockPolicyServiceInstance),
}));

jest.mock('../connectionService', () => ({
  AgentEmailConnectionService: jest.fn(() => mockConnectionServiceInstance),
}));

jest.mock('../draftStore', () => ({
  AgentEmailDraftStore: jest.fn(() => mockDraftStoreInstance),
}));

jest.mock('../providerFactory', () => ({
  AgentEmailProviderFactory: jest.fn(() => mockProviderFactoryInstance),
}));

jest.mock('../crypto', () => ({
  EmailSecretBox: jest.fn(() => ({
    encrypt: jest.fn(async (value: string) => ({ nonce: 'nonce', ciphertext: Buffer.from(value).toString('base64') })),
    decrypt: jest.fn(async ({ ciphertext }: { ciphertext: string }) => Buffer.from(ciphertext, 'base64').toString('utf8')),
  })),
}));

describe('AgentEmailService', () => {
  const pool: any = { query: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPolicyServiceInstance.getPolicy.mockResolvedValue({
      emailEnabled: true,
      emailSendEnabled: true,
      allowExternal: false,
      attachmentMaxMb: 10,
    });
    mockConnectionServiceInstance.getConnection.mockResolvedValue({
      config: { email: 'agent@example.com' },
    });
    mockProviderFactoryInstance.getProvider.mockResolvedValue(mockProviderInstance);
    mockProviderInstance.emailSend.mockResolvedValue({ status: 'sent', messageId: '<mid>' });
  });

  it('rejects sending without confirmation token', async () => {
    const service = new AgentEmailService(pool);
    await expect(
      service.emailSend(1, { draftId: 'draft-1', confirmToken: '' })
    ).rejects.toThrow('confirm_token is required');
  });

  it('blocks external recipients when policy forbids them', async () => {
    const service = new AgentEmailService(pool);
    await expect(
      service.emailSend(1, {
        confirmToken: 'token',
        payload: {
          to: ['external@other.com'],
          subject: 'Hi',
        },
      })
    ).rejects.toThrow('Sending to external domains is disabled');
  });

  it('allows send when recipients are internal', async () => {
    const service = new AgentEmailService(pool);
    await service.emailSend(1, {
      confirmToken: 'token',
      payload: {
        to: ['user@example.com'],
        subject: 'Hello',
      },
    });

    expect(mockProviderInstance.emailSend).toHaveBeenCalledWith(
      expect.objectContaining({ confirmToken: 'token' })
    );
  });
});
