import { WebClient, AuthTestResponse } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import { AppError } from '../utils/errors';
import { getLogger, Logger } from '../utils';

// ============================================================================
// Error
// ============================================================================

export class SlackError extends AppError {
  constructor(message: string) {
    super(message, 500, 'SLACK_ERROR');
  }
}

// ============================================================================
// Types
// ============================================================================

export interface SlackStatus {
  connected: boolean;
  workspaceName: string | null;
  botUserId: string | null;
  botUserName: string | null;
  error: string | null;
}

export interface SlackChannel {
  id: string;
  name: string;
  isMember: boolean;
}

export interface SlackValidationResult {
  valid: boolean;
  error: string | null;
  workspaceName: string | null;
  botUserId: string | null;
}

// ============================================================================
// WebClient factory (injectable for testing)
// ============================================================================

export interface SlackWebClientFactory {
  create(botToken: string): SlackWebClientAdapter;
}

export interface SlackChannelInfo {
  id: string;
  name: string;
}

export interface PostMessageOptions {
  channelId: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
}

export interface SlackWebClientAdapter {
  authTest(): Promise<AuthTestResponse>;
  postMessage(options: PostMessageOptions): Promise<{ ts?: string }>;
  conversationsList(): Promise<{ channels?: SlackChannelInfo[] }>;
  getUserInfo(userId: string): Promise<{ displayName?: string } | null>;
  updateMessage(options: { channel: string; ts: string; text: string; blocks?: unknown[] }): Promise<void>;
}

function wrapWebClient(client: WebClient): SlackWebClientAdapter {
  return {
    authTest: () => client.auth.test(),
    postMessage: ({ channelId, text, blocks, threadTs }) =>
      client.chat.postMessage({
        channel: channelId,
        text,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        blocks: blocks as any,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      }) as Promise<{ ts?: string }>,
    conversationsList: () =>
      client.conversations.list({ exclude_archived: true, limit: 200 }) as Promise<{ channels?: SlackChannelInfo[] }>,
    getUserInfo: async (userId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (client.users.info({ user: userId }) as Promise<any>);
      const profile = result?.user?.profile;
      if (!profile) return null;
      return { displayName: (profile.display_name as string) || (profile.real_name as string) || undefined };
    },
    updateMessage: async ({ channel, ts, text, blocks }) => {
      await client.chat.update({
        channel,
        ts,
        text,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        blocks: blocks as any,
      });
    },
  };
}

export const defaultSlackWebClientFactory: SlackWebClientFactory = {
  create: (botToken: string): SlackWebClientAdapter => wrapWebClient(new WebClient(botToken)),
};

// ============================================================================
// SlackService interface
// ============================================================================

export interface SlackService {
  getStatus(botToken: string | null): Promise<SlackStatus>;
  validateBotToken(botToken: string): Promise<SlackValidationResult>;
  sendMessage(botToken: string, channelId: string, text: string, blocks?: unknown[]): Promise<string | null>;
  replyInThread(botToken: string, channelId: string, threadTs: string, text: string, blocks?: unknown[]): Promise<string | undefined>;
  updateMessage(botToken: string, channelId: string, ts: string, text: string, blocks?: unknown[]): Promise<void>;
  listChannels(botToken: string): Promise<SlackChannel[]>;
  getUserName(botToken: string, userId: string): Promise<string | null>;
}

// ============================================================================
// Slash command types
// ============================================================================

export interface SlashCommandBody {
  command: string;
  text: string;
  user_id: string;
  channel_id: string;
  response_url: string;
  team_id?: string;
  trigger_id?: string;
}

export interface InteractiveActionBody {
  type: string;
  actions?: Array<{ action_id: string; value?: string; block_id?: string }>;
  response_url?: string;
  user?: { id: string };
  channel?: { id: string };
}

export type SlashCommandHandler = (body: SlashCommandBody, ack: () => Promise<void>) => Promise<void>;
export type InteractiveActionHandler = (body: InteractiveActionBody, ack: () => Promise<void>) => Promise<void>;

export interface SlackMessageEvent {
  type: string;
  text?: string;
  channel?: string;
  user?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  ts?: string;
}

export type MessageEventHandler = (event: SlackMessageEvent, ack: () => Promise<void>) => Promise<void>;

// ============================================================================
// SlackSocketService interface
// ============================================================================

export interface SlackSocketService {
  connect(appToken: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  onSlashCommand(handler: SlashCommandHandler): void;
  onInteractiveAction(handler: InteractiveActionHandler): void;
  onMessageEvent(handler: MessageEventHandler): void;
}

// ============================================================================
// DefaultSlackService
// ============================================================================

function buildDisconnectedStatus(error: string | null = null): SlackStatus {
  return {
    connected: false,
    workspaceName: null,
    botUserId: null,
    botUserName: null,
    error,
  };
}

function buildConnectedStatus(authResult: AuthTestResponse): SlackStatus {
  return {
    connected: true,
    workspaceName: (authResult.team as string | null) ?? null,
    botUserId: (authResult.user_id as string | null) ?? null,
    botUserName: (authResult.user as string | null) ?? null,
    error: null,
  };
}

export class DefaultSlackService implements SlackService {
  private readonly clientFactory: SlackWebClientFactory;
  private readonly logger: Logger;

  constructor(clientFactory: SlackWebClientFactory = defaultSlackWebClientFactory) {
    this.clientFactory = clientFactory;
    this.logger = getLogger('slack');
  }

  async getStatus(botToken: string | null): Promise<SlackStatus> {
    this.logger.debug('Checking Slack status');

    if (!botToken) {
      return buildDisconnectedStatus('No bot token configured');
    }

    try {
      const client = this.clientFactory.create(botToken);
      const result = await client.authTest();
      const status = buildConnectedStatus(result);
      this.logger.info('Slack connected', { workspace: status.workspaceName });
      return status;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('Slack disconnected', { error: message });
      return buildDisconnectedStatus(message);
    }
  }

  async validateBotToken(botToken: string): Promise<SlackValidationResult> {
    this.logger.debug('Validating bot token');

    if (!botToken || !botToken.trim()) {
      return { valid: false, error: 'Bot token is required', workspaceName: null, botUserId: null };
    }

    try {
      const client = this.clientFactory.create(botToken.trim());
      const result = await client.authTest();
      const workspaceName = (result.team as string | null) ?? null;
      const botUserId = (result.user_id as string | null) ?? null;
      this.logger.info('Bot token valid', { workspace: workspaceName, botUserId });
      return { valid: true, error: null, workspaceName, botUserId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('Bot token invalid', { error: message });
      return { valid: false, error: message, workspaceName: null, botUserId: null };
    }
  }

  async sendMessage(botToken: string, channelId: string, text: string, blocks?: unknown[]): Promise<string | null> {
    this.logger.debug('Sending Slack message', { channelId });

    try {
      const client = this.clientFactory.create(botToken);
      const result = await client.postMessage({ channelId, text, blocks });
      this.logger.info('Slack message sent', { channelId, ts: result.ts });
      return result.ts ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SlackError(`Failed to send message: ${message}`);
    }
  }

  async replyInThread(botToken: string, channelId: string, threadTs: string, text: string, blocks?: unknown[]): Promise<string | undefined> {
    this.logger.debug('Replying in Slack thread', { channelId, threadTs });

    try {
      const client = this.clientFactory.create(botToken);
      const result = await client.postMessage({ channelId, text, blocks, threadTs });
      this.logger.info('Thread reply sent', { channelId, ts: result.ts });
      return result.ts;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SlackError(`Failed to reply in thread: ${message}`);
    }
  }

  async updateMessage(botToken: string, channelId: string, ts: string, text: string, blocks?: unknown[]): Promise<void> {
    this.logger.debug('Updating Slack message', { channelId, ts });

    try {
      const client = this.clientFactory.create(botToken);
      await client.updateMessage({ channel: channelId, ts, text, blocks });
      this.logger.info('Slack message updated', { channelId, ts });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SlackError(`Failed to update message: ${message}`);
    }
  }

  async listChannels(botToken: string): Promise<SlackChannel[]> {
    this.logger.debug('Listing Slack channels');

    try {
      const client = this.clientFactory.create(botToken);
      const result = await client.conversationsList();
      const channels = (result.channels ?? []).map((ch) => ({
        id: ch.id,
        name: ch.name,
        isMember: false,
      }));
      this.logger.debug('Slack channels listed', { count: channels.length });
      return channels;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SlackError(`Failed to list channels: ${message}`);
    }
  }

  async getUserName(botToken: string, userId: string): Promise<string | null> {
    this.logger.debug('Looking up Slack user', { userId });

    try {
      const client = this.clientFactory.create(botToken);
      const info = await client.getUserInfo(userId);
      return info?.displayName ?? null;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// DefaultSlackSocketService
// ============================================================================

export class DefaultSlackSocketService implements SlackSocketService {
  private client: SocketModeClient | null = null;
  private slashCommandHandler: SlashCommandHandler | null = null;
  private interactiveActionHandler: InteractiveActionHandler | null = null;
  private messageHandler: MessageEventHandler | null = null;
  private readonly logger: Logger = getLogger('slack-socket');

  async connect(appToken: string): Promise<void> {
    this.logger.info('Connecting Slack Socket Mode');

    if (this.client) {
      await this.disconnect();
    }

    this.client = new SocketModeClient({ appToken });
    this.setupEventListeners();
    await this.client.start();
    this.logger.info('Slack Socket Mode connected');
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    this.logger.info('Disconnecting Slack Socket Mode');
    await this.client.disconnect();
    this.client = null;
    this.logger.info('Slack Socket Mode disconnected');
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  onSlashCommand(handler: SlashCommandHandler): void {
    this.slashCommandHandler = handler;
    this.logger.debug('Slash command handler registered');
  }

  onInteractiveAction(handler: InteractiveActionHandler): void {
    this.interactiveActionHandler = handler;
    this.logger.debug('Interactive action handler registered');
  }

  onMessageEvent(handler: MessageEventHandler): void {
    this.messageHandler = handler;
    this.logger.debug('Message event handler registered');
  }

  private setupEventListeners(): void {
    if (!this.client) return;

    this.client.on('slash_commands', async ({ body, ack }: { body: Record<string, unknown>; ack: () => Promise<void> }) => {
      this.logger.debug('Slash command event received via socket');

      if (this.slashCommandHandler) {
        await this.slashCommandHandler(body as unknown as SlashCommandBody, ack);
      } else {
        await ack();
      }
    });

    this.client.on('interactive', async ({ body, ack }: { body: Record<string, unknown>; ack: () => Promise<void> }) => {
      this.logger.debug('Interactive event received via socket');

      if (this.interactiveActionHandler) {
        await this.interactiveActionHandler(body as unknown as InteractiveActionBody, ack);
      } else {
        await ack();
      }
    });

    this.client.on('message', async ({ event, ack }: { event: Record<string, unknown>; ack: () => Promise<void> }) => {
      this.logger.debug('Message event received via socket');

      if (this.messageHandler) {
        await this.messageHandler(event as unknown as SlackMessageEvent, ack);
      } else {
        await ack();
      }
    });
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createSlackService(
  clientFactory: SlackWebClientFactory = defaultSlackWebClientFactory
): SlackService {
  return new DefaultSlackService(clientFactory);
}

export function createSlackSocketService(): SlackSocketService {
  return new DefaultSlackSocketService();
}
