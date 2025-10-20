import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { Pool } from 'pg';
import { EmailSecretBox } from './crypto';
import { AgentEmailConnectionService } from './connectionService';
import { AgentEmailDraftStore } from './draftStore';
import { AgentEmailProviderFactory } from './providerFactory';
import { EmailPolicyService } from './policyService';
import type {
  ComposeEmailPayload,
  EmailPolicyConfig,
  EmailSummary,
  EmailMessageDetail,
  EmailProvider,
  EmailSendInput,
  ReplyInput,
  TitanConnectionConfig,
} from './types';

const clampPort = (port: number, fallback: number) => {
  if (!Number.isFinite(port) || port <= 0) {
    return fallback;
  }
  return port;
};

const sanitizeHost = (host: string, fallback: string): string => {
  const trimmed = host.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed;
};

export class AgentEmailService {
  private readonly crypto: EmailSecretBox;
  private readonly connectionService: AgentEmailConnectionService;
  private readonly draftStore: AgentEmailDraftStore;
  private readonly providerFactory: AgentEmailProviderFactory;
  private readonly policyService: EmailPolicyService;

  constructor(private readonly pool: Pool) {
    this.crypto = new EmailSecretBox(process.env.EMAIL_CONNECTION_SECRET);
    this.connectionService = new AgentEmailConnectionService(pool, this.crypto);
    this.draftStore = new AgentEmailDraftStore(pool, this.crypto);
    this.providerFactory = new AgentEmailProviderFactory(this.connectionService, this.draftStore);
    this.policyService = new EmailPolicyService(pool);
  }

  private async getProvider(userId: number): Promise<EmailProvider> {
    return this.providerFactory.getProvider(userId, 'titan');
  }

  private async ensurePolicy(allowsSend: boolean): Promise<EmailPolicyConfig> {
    const policy = await this.policyService.getPolicy();
    if (!policy.emailEnabled) {
      throw new Error('Titan email access is disabled by the organization administrator.');
    }
    if (allowsSend && !policy.emailSendEnabled) {
      throw new Error('Outbound Titan email is disabled by the organization administrator.');
    }
    return policy;
  }

  private enforceExternalPolicy(policy: EmailPolicyConfig, sender: string, recipients: string[]): void {
    if (policy.allowExternal) {
      return;
    }
    const senderDomain = sender.split('@')[1]?.toLowerCase();
    if (!senderDomain) {
      throw new Error('Unable to determine sender email domain for policy enforcement.');
    }
    for (const recipient of recipients) {
      const domain = recipient.split('@')[1]?.toLowerCase();
      if (!domain) {
        throw new Error(`Invalid recipient address: ${recipient}`);
      }
      if (domain !== senderDomain) {
        throw new Error('Sending to external domains is disabled by your organization.');
      }
    }
  }

  private enforceAttachmentPolicy(policy: EmailPolicyConfig, payload: ComposeEmailPayload): void {
    if (!Array.isArray(payload.attachments) || payload.attachments.length === 0) {
      return;
    }
    const totalBytes = payload.attachments.reduce((acc, attachment) => {
      if (!attachment.content) {
        return acc;
      }
      const encoding = attachment.encoding || 'utf8';
      return acc + Buffer.byteLength(attachment.content, encoding as BufferEncoding);
    }, 0);
    const limitBytes = policy.attachmentMaxMb * 1024 * 1024;
    if (totalBytes > limitBytes) {
      throw new Error(
        `Attachments exceed the configured limit of ${policy.attachmentMaxMb} MB. Please remove files or reduce their size.`
      );
    }
  }

  private normalizeConfig(config: Partial<TitanConnectionConfig> & Record<string, any>): TitanConnectionConfig {
    const defaultImapHost = process.env.TITAN_IMAP_HOST_DEFAULT?.trim() || 'imap.titan.email';
    const defaultSmtpHost = process.env.TITAN_SMTP_HOST_DEFAULT?.trim() || 'smtp.titan.email';
    const hostImap = sanitizeHost(config.hostImap || config.host_imap || defaultImapHost, defaultImapHost);
    const hostSmtp = sanitizeHost(config.hostSmtp || config.host_smtp || defaultSmtpHost, defaultSmtpHost);
    const portImap = clampPort(Number(config.portImap ?? config.port_imap ?? 993), 993);
    const portSmtp = clampPort(Number(config.portSmtp ?? config.port_smtp ?? 465), 465);
    const email = (config.email || '').trim();
    const password = (config.password || '').trim();

    if (!email || !password) {
      throw new Error('Titan email address and password are required.');
    }

    return {
      hostImap,
      hostSmtp,
      portImap,
      portSmtp,
      email,
      password,
    };
  }

  private async testTitanConnection(config: TitanConnectionConfig): Promise<void> {
    const imap = new ImapFlow({
      host: config.hostImap,
      port: config.portImap,
      secure: true,
      auth: {
        user: config.email,
        pass: config.password,
      },
      tls: {
        rejectUnauthorized: true,
      },
      logger: false,
    });

    try {
      await imap.connect();
      await imap.mailboxOpen('INBOX', { readOnly: true });
      await imap.logout();
    } catch (error: any) {
      try {
        await imap.close();
      } catch (closeError) {
        // ignore
      }
      const message = error?.message ?? 'Unknown IMAP error';
      throw new Error(`Failed to connect to Titan IMAP: ${message}`);
    }

    const transporter = nodemailer.createTransport({
      host: config.hostSmtp,
      port: config.portSmtp,
      secure: true,
      auth: {
        user: config.email,
        pass: config.password,
      },
      tls: {
        rejectUnauthorized: true,
      },
    });

    try {
      await transporter.verify();
    } catch (error: any) {
      const message = error?.message ?? 'Unknown SMTP error';
      throw new Error(`Failed to verify Titan SMTP connection: ${message}`);
    }
  }

  async connectTitan(userId: number, rawConfig: Partial<TitanConnectionConfig>) {
    const config = this.normalizeConfig(rawConfig);
    await this.testTitanConnection(config);
    const record = await this.connectionService.saveConnection(userId, 'titan', config);
    await this.connectionService.markValidated(userId, 'titan');
    return {
      provider: 'titan',
      email: config.email,
      hostImap: config.hostImap,
      hostSmtp: config.hostSmtp,
      validatedAt: record.lastValidatedAt,
    };
  }

  async disconnect(userId: number) {
    await this.connectionService.deleteConnection(userId, 'titan');
    return { provider: 'titan', disconnected: true };
  }

  async emailSearch(userId: number, query: string, max?: number): Promise<EmailSummary[]> {
    await this.ensurePolicy(false);
    const provider = await this.getProvider(userId);
    return provider.emailSearch(query, max);
  }

  async emailRead(userId: number, id: string): Promise<EmailMessageDetail> {
    await this.ensurePolicy(false);
    const provider = await this.getProvider(userId);
    return provider.emailRead(id);
  }

  async emailComposeDraft(userId: number, payload: ComposeEmailPayload) {
    const policy = await this.ensurePolicy(true);
    const provider = await this.getProvider(userId);
    this.enforceAttachmentPolicy(policy, payload);
    return provider.emailComposeDraft(payload);
  }

  async emailSend(userId: number, input: EmailSendInput) {
    const policy = await this.ensurePolicy(true);
    const provider = await this.getProvider(userId);
    const connection = await this.connectionService.getConnection(userId, 'titan');
    if (!connection) {
      throw new Error('Titan email connection not configured for this user.');
    }

    if (input.payload) {
      this.enforceAttachmentPolicy(policy, input.payload);
      const recipients = [
        ...(input.payload.to || []),
        ...(input.payload.cc || []),
        ...(input.payload.bcc || []),
      ];
      this.enforceExternalPolicy(policy, connection.config.email, recipients);
    }

    const result = await provider.emailSend(input);
    return result;
  }

  async emailReply(userId: number, input: ReplyInput) {
    const policy = await this.ensurePolicy(true);
    const provider = await this.getProvider(userId);
    const connection = await this.connectionService.getConnection(userId, 'titan');
    if (!connection) {
      throw new Error('Titan email connection not configured for this user.');
    }

    if (input.attachments && input.attachments.length) {
      this.enforceAttachmentPolicy(policy, {
        to: [],
        subject: 'reply',
        attachments: input.attachments,
      });
    }

    const result = await provider.emailReply(input);
    return result;
  }
}
