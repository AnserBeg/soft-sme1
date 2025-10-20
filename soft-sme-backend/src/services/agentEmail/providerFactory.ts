import { TitanProvider } from './providers/TitanProvider';
import { AgentEmailConnectionService } from './connectionService';
import { AgentEmailDraftStore } from './draftStore';
import type { EmailProvider, ProviderKey } from './types';

export class AgentEmailProviderFactory {
  constructor(
    private readonly connectionService: AgentEmailConnectionService,
    private readonly draftStore: AgentEmailDraftStore
  ) {}

  async getProvider(userId: number, provider: ProviderKey): Promise<EmailProvider> {
    switch (provider) {
      case 'titan': {
        const record = await this.connectionService.getConnection(userId, 'titan');
        if (!record) {
          throw new Error('Titan email connection not configured for this user.');
        }
        return new TitanProvider(userId, record.config, this.draftStore);
      }
      default:
        throw new Error(`Unsupported email provider: ${provider}`);
    }
  }
}
