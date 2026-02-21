import { CommandRunner, DefaultCommandRunner } from './github-cli-service';
import { getLogger } from '../utils';

const logger = getLogger('claude-cli');

// ============================================================================
// Types
// ============================================================================

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod: string | null;
  apiProvider: string | null;
  email: string | null;
  orgId: string | null;
  orgName: string | null;
  subscriptionType: string | null;
}

export interface ClaudeCliInfo {
  installed: boolean;
  version: string | null;
  auth: ClaudeAuthStatus | null;
  error: string | null;
}

// ============================================================================
// Interface
// ============================================================================

export interface ClaudeCliService {
  getInfo(): Promise<ClaudeCliInfo>;
}

// ============================================================================
// Implementation
// ============================================================================

export class DefaultClaudeCliService implements ClaudeCliService {
  private readonly commandRunner: CommandRunner;

  constructor(commandRunner?: CommandRunner) {
    this.commandRunner = commandRunner || new DefaultCommandRunner();
  }

  async getInfo(): Promise<ClaudeCliInfo> {
    const version = await this.detectVersion();

    if (!version) {
      return { installed: false, version: null, auth: null, error: 'Claude CLI not found' };
    }

    const auth = await this.detectAuth();

    return { installed: true, version, auth, error: null };
  }

  private async detectVersion(): Promise<string | null> {
    try {
      const { stdout } = await this.commandRunner.exec('claude', ['--version']);
      const version = stdout.trim() || null;
      logger.info('Claude CLI version detected', { version });
      return version;
    } catch {
      logger.warn('Failed to detect Claude CLI version');
      return null;
    }
  }

  private async detectAuth(): Promise<ClaudeAuthStatus | null> {
    try {
      const { stdout } = await this.commandRunner.exec('claude', ['auth', 'status', '--json']);
      const auth = JSON.parse(stdout) as ClaudeAuthStatus;
      logger.info('Claude CLI auth detected', { loggedIn: auth.loggedIn, email: auth.email });
      return auth;
    } catch {
      logger.warn('Failed to detect Claude CLI auth status');
      return null;
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createClaudeCliService(commandRunner?: CommandRunner): ClaudeCliService {
  return new DefaultClaudeCliService(commandRunner);
}
