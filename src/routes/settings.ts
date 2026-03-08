import { Router, Request, Response } from 'express';
import { SettingsRepository, ClaudePermissions, PromptTemplate, McpServerConfig, SlackSettings, AgentProfile } from '../repositories';
import { DataWipeService } from '../services/data-wipe-service';
import { SlackService } from '../services/slack-service';
import { DockerSettings } from '../services/docker/types';
import { asyncHandler, ValidationError } from '../utils';
import { SUPPORTED_MODELS, MODEL_DISPLAY_NAMES } from '../config/models';

interface UpdateSettingsBody {
  maxConcurrentAgents?: number;
  claudePermissions?: Partial<ClaudePermissions>;
  agentPromptTemplate?: string;
  sendWithCtrlEnter?: boolean;
  historyLimit?: number;
  enableDesktopNotifications?: boolean;
  appendSystemPrompt?: string;
  promptTemplates?: PromptTemplate[];
  mcp?: {
    enabled?: boolean;
    servers?: McpServerConfig[];
  };
  slack?: Partial<SlackSettings>;
  chromeEnabled?: boolean;
  inventifyFolder?: string;
  docker?: Partial<DockerSettings>;
  agentProfiles?: AgentProfile[];
}

export interface SettingsChangeEvent {
  maxConcurrentAgents?: number;
  appendSystemPromptChanged?: boolean;
  mcpChanged?: boolean;
  slackChanged?: boolean;
}

export interface SettingsRouterDependencies {
  settingsRepository: SettingsRepository;
  dataWipeService: DataWipeService;
  slackService?: SlackService;
  onSettingsChange?: (event: SettingsChangeEvent) => void;
}

function validateMcpServers(servers: McpServerConfig[]): void {
  const ids = new Set<string>();

  for (const server of servers) {
    // Check unique IDs
    if (ids.has(server.id)) {
      throw new ValidationError('Duplicate server ID: ' + server.id);
    }
    ids.add(server.id);

    // Validate required fields
    if (!server.name || server.name.trim() === '') {
      throw new ValidationError('Server name is required');
    }

    // Type-specific validation
    if (server.type === 'stdio') {
      if (!server.command || server.command.trim() === '') {
        throw new ValidationError('Command is required for stdio servers');
      }
    } else if (server.type === 'http') {
      if (!server.url || server.url.trim() === '') {
        throw new ValidationError('URL is required for http servers');
      }
      // Validate URL format
      try {
        new URL(server.url);
      } catch {
        throw new ValidationError('Invalid URL: ' + server.url);
      }
    }
  }
}

export function createSettingsRouter(deps: SettingsRouterDependencies): Router {
  const router = Router();
  const { settingsRepository, dataWipeService, slackService, onSettingsChange } = deps;

  router.get('/', asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const settings = await settingsRepository.get();
    res.json(settings);
  }));

  // GET /api/settings/models - List available Claude models
  router.get('/models', (_req: Request, res: Response) => {
    const models = SUPPORTED_MODELS.map((modelId) => ({
      id: modelId,
      displayName: MODEL_DISPLAY_NAMES[modelId],
    }));
    res.json({ models });
  });

  // POST /api/settings/wipe-all-data - Delete all Claudito data (factory reset)
  router.post('/wipe-all-data', asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const summary = await dataWipeService.wipeAll();
    res.json(summary);
  }));

  router.put('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const body = req.body as UpdateSettingsBody;
    const { maxConcurrentAgents, claudePermissions, agentPromptTemplate, sendWithCtrlEnter, historyLimit, enableDesktopNotifications, appendSystemPrompt, promptTemplates, mcp, slack, chromeEnabled, inventifyFolder, docker, agentProfiles } = body;

    if (maxConcurrentAgents !== undefined && (typeof maxConcurrentAgents !== 'number' || maxConcurrentAgents < 1)) {
      throw new ValidationError('maxConcurrentAgents must be a positive number');
    }

    if (claudePermissions) {
      validatePermissionRules(claudePermissions.allowRules, 'allowRules');
      validatePermissionRules(claudePermissions.denyRules, 'denyRules');
      validatePermissionRules(claudePermissions.askRules, 'askRules');
    }

    if (promptTemplates !== undefined) {
      validatePromptTemplates(promptTemplates);
    }

    if (mcp?.servers) {
      validateMcpServers(mcp.servers);
    }

    if (docker) {
      validateDockerSettings(docker);
    }

    if (agentProfiles !== undefined) {
      validateAgentProfiles(agentProfiles);
    }

    if (slack?.botToken && slack.botToken.trim()) {
      if (!slackService) {
        throw new ValidationError('Slack service not available');
      }

      const validation = await slackService.validateBotToken(slack.botToken.trim());

      if (!validation.valid) {
        throw new ValidationError('Invalid bot token: ' + (validation.error ?? 'authentication failed'));
      }
    }

    // Trim Slack token values before saving
    const slackPayload = slack ? {
      ...slack,
      ...(slack.botToken !== undefined && { botToken: slack.botToken.trim() }),
      ...(slack.appToken !== undefined && { appToken: slack.appToken.trim() }),
    } : undefined;

    // Get current settings to detect changes
    const currentSettings = await settingsRepository.get();
    const appendSystemPromptChanged = appendSystemPrompt !== undefined &&
      appendSystemPrompt !== currentSettings.appendSystemPrompt;

    const mcpChanged = mcp !== undefined &&
      JSON.stringify(mcp) !== JSON.stringify(currentSettings.mcp);

    const slackChanged = slackPayload !== undefined &&
      JSON.stringify(slackPayload) !== JSON.stringify(currentSettings.slack);

    const updated = await settingsRepository.update({
      maxConcurrentAgents,
      claudePermissions,
      agentPromptTemplate,
      sendWithCtrlEnter,
      historyLimit,
      enableDesktopNotifications,
      appendSystemPrompt,
      promptTemplates,
      mcp,
      slack: slackPayload,
      chromeEnabled,
      inventifyFolder,
      docker,
      agentProfiles,
    });

    // Notify about settings changes
    if (onSettingsChange) {
      const changeEvent: SettingsChangeEvent = {};

      if (maxConcurrentAgents !== undefined) {
        changeEvent.maxConcurrentAgents = maxConcurrentAgents;
      }

      if (appendSystemPromptChanged) {
        changeEvent.appendSystemPromptChanged = true;
      }

      if (mcpChanged) {
        changeEvent.mcpChanged = true;
      }

      if (slackChanged) {
        changeEvent.slackChanged = true;
      }

      if (Object.keys(changeEvent).length > 0) {
        onSettingsChange(changeEvent);
      }
    }

    res.json(updated);
  }));

  return router;
}

function validatePermissionRules(rules: string[] | undefined, fieldName: string): void {
  if (!rules) return;

  if (!Array.isArray(rules)) {
    throw new ValidationError(`${fieldName} must be an array`);
  }

  for (const rule of rules) {
    if (typeof rule !== 'string') {
      throw new ValidationError(`${fieldName} must contain only strings`);
    }

    if (!isValidPermissionRule(rule)) {
      throw new ValidationError(`Invalid permission rule in ${fieldName}: "${rule}"`);
    }
  }
}

function isValidPermissionRule(rule: string): boolean {
  if (!rule || rule.length === 0) return false;

  // Valid formats: "Tool" or "Tool(specifier)"
  const simpleToolPattern = /^[A-Za-z][A-Za-z0-9_]*$/;
  const toolWithSpecifierPattern = /^[A-Za-z][A-Za-z0-9_]*\(.+\)$/;

  return simpleToolPattern.test(rule) || toolWithSpecifierPattern.test(rule);
}

function validatePromptTemplates(templates: unknown): void {
  if (!Array.isArray(templates)) {
    throw new ValidationError('promptTemplates must be an array');
  }

  const seenIds = new Set<string>();

  for (const template of templates) {
    if (typeof template !== 'object' || template === null) {
      throw new ValidationError('Each template must be an object');
    }

    const t = template as Record<string, unknown>;

    if (typeof t.id !== 'string' || t.id.trim().length === 0) {
      throw new ValidationError('Each template must have a non-empty id');
    }

    if (seenIds.has(t.id)) {
      throw new ValidationError(`Duplicate template id: ${t.id}`);
    }
    seenIds.add(t.id);

    if (typeof t.name !== 'string' || t.name.trim().length === 0) {
      throw new ValidationError('Each template must have a non-empty name');
    }

    if (typeof t.content !== 'string') {
      throw new ValidationError('Each template must have content');
    }

    if (t.description !== undefined && typeof t.description !== 'string') {
      throw new ValidationError('Template description must be a string');
    }
  }
}

const VALID_NETWORK_MODES = ['bridge', 'none'];

function validateDockerSettings(docker: Partial<DockerSettings>): void {
  if (docker.enabled !== undefined && typeof docker.enabled !== 'boolean') {
    throw new ValidationError('Docker enabled must be a boolean');
  }

  if (docker.baseImage !== undefined) {
    if (typeof docker.baseImage !== 'string' || docker.baseImage.trim() === '') {
      throw new ValidationError('Docker base image must be a non-empty string');
    }
  }

  if (docker.networkMode !== undefined && !VALID_NETWORK_MODES.includes(docker.networkMode)) {
    throw new ValidationError('Docker network mode must be "bridge" or "none"');
  }

  if (docker.resourceLimits) {
    validateDockerResourceLimits(docker.resourceLimits);
  }
}

const VALID_PROVIDERS = ['anthropic', 'opencode'];
const VALID_RUNTIMES = ['claude-binary', 'sdk'];
const VALID_AUTH_MODES = ['api-key', 'pro-plan'];

function validateAgentProfiles(profiles: unknown): void {
  if (!Array.isArray(profiles)) {
    throw new ValidationError('agentProfiles must be an array');
  }

  if (profiles.length === 0) {
    throw new ValidationError('At least one agent profile is required');
  }

  const seenIds = new Set<string>();
  let defaultCount = 0;

  for (const profile of profiles) {
    if (typeof profile !== 'object' || profile === null) {
      throw new ValidationError('Each profile must be an object');
    }

    const p = profile as Record<string, unknown>;

    if (typeof p.id !== 'string' || p.id.trim().length === 0) {
      throw new ValidationError('Each profile must have a non-empty id');
    }

    if (seenIds.has(p.id)) {
      throw new ValidationError(`Duplicate profile id: ${p.id}`);
    }
    seenIds.add(p.id);

    if (typeof p.name !== 'string' || p.name.trim().length === 0) {
      throw new ValidationError('Each profile must have a non-empty name');
    }

    if (!VALID_PROVIDERS.includes(p.provider as string)) {
      throw new ValidationError('Profile provider must be "anthropic" or "opencode"');
    }

    if (p.isDefault === true) {
      defaultCount++;
    }

    if (p.provider === 'anthropic') {
      validateAnthropicConfig(p.anthropicConfig);
    } else if (p.provider === 'opencode') {
      validateOpencodeConfig(p.opencodeConfig);
    }
  }

  if (defaultCount !== 1) {
    throw new ValidationError('Exactly one profile must be marked as default');
  }
}

function validateAnthropicConfig(config: unknown): void {
  if (typeof config !== 'object' || config === null) {
    throw new ValidationError('anthropicConfig is required');
  }

  const c = config as Record<string, unknown>;

  if (!VALID_RUNTIMES.includes(c.runtime as string)) {
    throw new ValidationError('anthropicConfig.runtime must be "claude-binary" or "sdk"');
  }

  if (c.runtime === 'sdk') {
    if (c.authMode !== undefined && !VALID_AUTH_MODES.includes(c.authMode as string)) {
      throw new ValidationError('anthropicConfig.authMode must be "api-key" or "pro-plan"');
    }

    if (c.authMode === 'api-key' && (typeof c.apiKey !== 'string' || c.apiKey.trim().length === 0)) {
      throw new ValidationError('API key is required when authMode is "api-key"');
    }
  }
}

function validateOpencodeConfig(config: unknown): void {
  if (config !== undefined && config !== null && typeof config !== 'object') {
    throw new ValidationError('opencodeConfig must be an object if provided');
  }

  if (config && typeof config === 'object') {
    const c = config as Record<string, unknown>;

    if (c.configPath !== undefined && typeof c.configPath !== 'string') {
      throw new ValidationError('opencodeConfig.configPath must be a string');
    }
  }
}

function validateDockerResourceLimits(limits: Partial<DockerSettings['resourceLimits']>): void {
  if (limits.cpus !== undefined) {
    if (typeof limits.cpus !== 'number' || limits.cpus <= 0) {
      throw new ValidationError('Docker CPU limit must be a positive number');
    }
  }

  if (limits.memoryMb !== undefined) {
    if (typeof limits.memoryMb !== 'number' || limits.memoryMb <= 0) {
      throw new ValidationError('Docker memory limit must be a positive number');
    }
  }
}
