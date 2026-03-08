import { AgentManager } from '../agents';
import { RalphLoopService, RalphLoopFinalStatus } from './ralph-loop/types';
import { SlackService } from './slack-service';
import { SlackThreadTracker } from './slack-thread-tracker';
import { SettingsRepository } from '../repositories/settings';
import { ProjectRepository, SlackNotificationConfig, SlackNotificationEvent } from '../repositories/project';
import { WaitingStatus, AgentStatus } from '../agents/agent';
import { MilestoneRef } from '../agents/autonomous-loop-orchestrator';
import { getLogger, Logger } from '../utils';

// ============================================================================
// Types
// ============================================================================

export interface SlackNotificationServiceDeps {
  agentManager: AgentManager;
  slackService: SlackService;
  settingsRepository: SettingsRepository;
  projectRepository: ProjectRepository;
  ralphLoopService?: RalphLoopService | null;
  threadTracker?: SlackThreadTracker;
}

export interface SlackNotificationService {
  start(): void;
  stop(): void;
}

// ============================================================================
// Block Kit helpers
// ============================================================================

function buildHeader(text: string): object {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
}

function buildSection(text: string): object {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function buildButton(text: string, actionId: string, value: string, style?: 'primary' | 'danger'): object {
  return {
    type: 'button',
    text: { type: 'plain_text', text, emoji: true },
    action_id: actionId,
    value,
    ...(style ? { style } : {}),
  };
}

function buildActions(elements: object[]): object {
  return { type: 'actions', elements };
}

function eventEmoji(event: SlackNotificationEvent): string {
  switch (event) {
    case 'agent_completed': return '✅';
    case 'agent_failed': return '❌';
    case 'agent_waiting': return '⏳';
    case 'ralph_loop_complete': return '✅';
    case 'ralph_loop_error': return '❌';
    case 'milestone_completed': return '✅';
    case 'milestone_failed': return '❌';
  }
}

function eventDescription(event: SlackNotificationEvent): string {
  switch (event) {
    case 'agent_completed': return 'Agent session completed';
    case 'agent_failed': return 'Agent session failed';
    case 'agent_waiting': return 'Agent is waiting for input';
    case 'ralph_loop_complete': return 'Ralph Loop completed';
    case 'ralph_loop_error': return 'Ralph Loop error';
    case 'milestone_completed': return 'Milestone completed';
    case 'milestone_failed': return 'Milestone failed';
  }
}

function buildMentionsText(mentionUsers: string[]): string {
  if (!mentionUsers.length) return '';
  return '\n' + mentionUsers.map((u) => `<@${u}>`).join(' ');
}

interface NotificationBlocksOptions {
  event: SlackNotificationEvent;
  projectName: string;
  detail?: string;
  projectId: string;
  mentionUsers: string[];
}

function buildNotificationBlocks(opts: NotificationBlocksOptions): object[] {
  const emoji = eventEmoji(opts.event);
  const desc = eventDescription(opts.event);
  const mentions = buildMentionsText(opts.mentionUsers);
  const detailText = opts.detail ? `\n*Details:* ${opts.detail}` : '';
  const sectionText = `${emoji} ${desc}${detailText}${mentions}`;

  const blocks: object[] = [
    buildHeader(`🤖 Claudito: ${opts.projectName}`),
    buildSection(sectionText),
  ];

  if (opts.event === 'agent_waiting') {
    blocks.push(buildActions([
      buildButton('Stop Agent', `stop_agent:${opts.projectId}`, opts.projectId, 'danger'),
      buildButton('Approve Plan', `approve_plan:${opts.projectId}`, opts.projectId, 'primary'),
      buildButton('Reject Plan', `reject_plan:${opts.projectId}`, opts.projectId),
    ]));
  }

  return blocks;
}

// ============================================================================
// DefaultSlackNotificationService
// ============================================================================

export class DefaultSlackNotificationService implements SlackNotificationService {
  private readonly deps: SlackNotificationServiceDeps;
  private readonly logger: Logger;
  private readonly threadTsMap: Map<string, string> = new Map();
  private readonly runningProjects: Set<string> = new Set();
  private readonly startTimes: Map<string, Date> = new Map();

  private readonly boundStatusHandler: (projectId: string, status: AgentStatus) => void;
  private readonly boundWaitingHandler: (projectId: string, status: WaitingStatus) => void;
  private readonly boundMilestoneCompletedHandler: (projectId: string, milestone: MilestoneRef, reason: string) => void;
  private readonly boundMilestoneFailedHandler: (projectId: string, milestone: MilestoneRef | null, reason: string) => void;
  private readonly boundLoopCompleteHandler: (projectId: string, taskId: string, finalStatus: RalphLoopFinalStatus) => void;
  private readonly boundLoopErrorHandler: (projectId: string, taskId: string, error: string) => void;

  constructor(deps: SlackNotificationServiceDeps) {
    this.deps = deps;
    this.logger = getLogger('slack-notifications');

    this.boundStatusHandler = (p, s): void => void this.handleStatusChange(p, s);
    this.boundWaitingHandler = (p, w): void => void this.handleWaiting(p, w);
    this.boundMilestoneCompletedHandler = (p, m, r): void => void this.handleMilestoneCompleted(p, m, r);
    this.boundMilestoneFailedHandler = (p, m, r): void => void this.handleMilestoneFailed(p, m, r);
    this.boundLoopCompleteHandler = (p, t, f): void => void this.handleLoopComplete(p, t, f);
    this.boundLoopErrorHandler = (p, t, e): void => void this.handleLoopError(p, t, e);
  }

  start(): void {
    const { agentManager, ralphLoopService } = this.deps;
    agentManager.on('status', this.boundStatusHandler);
    agentManager.on('waitingForInput', this.boundWaitingHandler);
    agentManager.on('milestoneCompleted', this.boundMilestoneCompletedHandler);
    agentManager.on('milestoneFailed', this.boundMilestoneFailedHandler);

    if (ralphLoopService) {
      ralphLoopService.on('loop_complete', this.boundLoopCompleteHandler);
      ralphLoopService.on('loop_error', this.boundLoopErrorHandler);
    }

    this.logger.info('Slack notification service started');
  }

  stop(): void {
    const { agentManager, ralphLoopService } = this.deps;
    agentManager.off('status', this.boundStatusHandler);
    agentManager.off('waitingForInput', this.boundWaitingHandler);
    agentManager.off('milestoneCompleted', this.boundMilestoneCompletedHandler);
    agentManager.off('milestoneFailed', this.boundMilestoneFailedHandler);

    if (ralphLoopService) {
      ralphLoopService.off('loop_complete', this.boundLoopCompleteHandler);
      ralphLoopService.off('loop_error', this.boundLoopErrorHandler);
    }

    this.logger.info('Slack notification service stopped');
  }

  private async handleStatusChange(projectId: string, status: AgentStatus): Promise<void> {
    this.logger.debug('Agent status changed', { projectId, status });

    if (status === 'running') {
      this.runningProjects.add(projectId);
      this.startTimes.set(projectId, new Date());
      return;
    }

    const wasRunning = this.runningProjects.has(projectId);
    this.runningProjects.delete(projectId);
    const startTime = this.startTimes.get(projectId);
    this.startTimes.delete(projectId);

    if (!wasRunning) return;

    const event = status === 'error' ? 'agent_failed' : 'agent_completed';
    const detail = startTime ? buildDurationDetail(startTime) : undefined;
    this.logger.info('Dispatching agent notification', { projectId, event });

    await this.sendProjectNotification({ projectId, event, detail });
    await this.sendLinkedChannelSummary({ projectId, event, startTime });
  }

  private async handleWaiting(projectId: string, status: WaitingStatus): Promise<void> {
    if (!status.isWaiting) return;
    this.logger.info('Agent waiting, dispatching notification', { projectId });
    await this.sendProjectNotification({ projectId, event: 'agent_waiting' });
  }

  private async handleMilestoneCompleted(projectId: string, milestone: MilestoneRef, reason: string): Promise<void> {
    const detail = `${milestone.milestoneId}: ${reason}`;
    this.logger.info('Milestone event, dispatching notification', { projectId, event: 'milestone_completed', detail });
    await this.sendProjectNotification({ projectId, event: 'milestone_completed', detail });
    await this.sendLinkedChannelMilestone({ projectId, milestone, event: 'milestone_completed' });
  }

  private async handleMilestoneFailed(projectId: string, milestone: MilestoneRef | null, reason: string): Promise<void> {
    const detail = milestone ? `${milestone.milestoneId}: ${reason}` : reason;
    this.logger.info('Milestone event, dispatching notification', { projectId, event: 'milestone_failed', detail });
    await this.sendProjectNotification({ projectId, event: 'milestone_failed', detail });
  }

  private async handleLoopComplete(projectId: string, taskId: string, finalStatus: RalphLoopFinalStatus): Promise<void> {
    const detail = `Task ${taskId}: ${finalStatus}`;
    this.logger.info('Ralph Loop event, dispatching notification', { projectId, event: 'ralph_loop_complete' });
    await this.sendProjectNotification({ projectId, event: 'ralph_loop_complete', detail });
  }

  private async handleLoopError(projectId: string, taskId: string, error: string): Promise<void> {
    const detail = `Task ${taskId}: ${error}`;
    this.logger.info('Ralph Loop event, dispatching notification', { projectId, event: 'ralph_loop_error' });
    await this.sendProjectNotification({ projectId, event: 'ralph_loop_error', detail });
  }

  private async getBotToken(): Promise<string | null> {
    try {
      const settings = await this.deps.settingsRepository.get();

      if (!settings.slack?.enabled || !settings.slack.botToken) {
        this.logger.warn('Slack not enabled or bot token missing');
        return null;
      }

      return settings.slack.botToken;
    } catch {
      return null;
    }
  }

  private async getProjectConfig(projectId: string): Promise<{ name: string; config: SlackNotificationConfig | null | undefined } | null> {
    try {
      const project = await this.deps.projectRepository.findById(projectId);
      if (!project) return null;
      return { name: project.name, config: project.slackNotification };
    } catch {
      return null;
    }
  }

  private shouldNotify(config: SlackNotificationConfig | null | undefined, event: SlackNotificationEvent): boolean {
    return !!config && !!config.channelId && config.events.includes(event);
  }

  private getThreadTs(projectId: string, config: SlackNotificationConfig): string | undefined {
    if (!config.threadReplies) return undefined;
    return this.threadTsMap.get(projectId);
  }

  private async sendProjectNotification(opts: { projectId: string; event: SlackNotificationEvent; detail?: string }): Promise<void> {
    const { projectId, event, detail } = opts;
    const botToken = await this.getBotToken();
    if (!botToken) return;

    const projectData = await this.getProjectConfig(projectId);
    if (!projectData) return;

    const { name: projectName, config } = projectData;
    if (!this.shouldNotify(config, event)) {
      this.logger.debug('Notification skipped: no config or event not subscribed', { projectId, event });
      return;
    }

    const blocks = buildNotificationBlocks({ event, projectName, detail, projectId, mentionUsers: config!.mentionUsers });
    const text = `${eventEmoji(event)} ${eventDescription(event)} — ${projectName}`;
    const threadTs = this.getThreadTs(projectId, config!);

    await this.sendWithThreading({ botToken, channelId: config!.channelId, text, blocks, projectId, config: config!, threadTs });
  }

  private async sendWithThreading(opts: {
    botToken: string;
    channelId: string;
    text: string;
    blocks: object[];
    projectId: string;
    config: SlackNotificationConfig;
    threadTs?: string;
  }): Promise<void> {
    const { botToken, channelId, text, blocks, projectId, config, threadTs } = opts;

    try {
      if (threadTs) {
        await this.deps.slackService.replyInThread(botToken, channelId, threadTs, text, blocks);
        this.logger.info('Slack notification sent', { projectId, channelId, isThread: true });
      } else {
        const ts = await this.deps.slackService.sendMessage(botToken, channelId, text, blocks);
        this.logger.info('Slack notification sent', { projectId, channelId, isThread: false });

        if (ts && config.threadReplies) {
          this.threadTsMap.set(projectId, ts);
          this.logger.debug('Thread TS stored', { projectId, ts });
        }

        if (ts && this.deps.threadTracker) {
          this.deps.threadTracker.register(projectId, channelId, ts);
        }
      }
    } catch (err) {
      this.logger.error('Failed to send Slack notification', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async sendLinkedChannelSummary(opts: { projectId: string; event: SlackNotificationEvent; startTime?: Date }): Promise<void> {
    const botToken = await this.getBotToken();
    if (!botToken) return;

    try {
      const project = await this.deps.projectRepository.findById(opts.projectId);
      if (!project?.slackLinkedChannelId) return;

      const emoji = eventEmoji(opts.event);
      const desc = eventDescription(opts.event);
      const duration = opts.startTime ? buildDurationDetail(opts.startTime) : '';
      const text = `${emoji} *${project.name}* — ${desc}${duration ? ` (${duration})` : ''}`;

      // Skip if the notification config already sent to this same channel for this event
      if (project.slackNotification?.channelId === project.slackLinkedChannelId &&
          project.slackNotification.events.includes(opts.event)) {
        this.logger.debug('Linked channel summary skipped: notification config already covers this channel', {
          projectId: opts.projectId,
          channelId: project.slackLinkedChannelId,
        });
        return;
      }

      const latest = this.deps.threadTracker?.getLatest(opts.projectId);
      if (!latest) return;

      await this.deps.slackService.replyInThread(botToken, latest.channelId, latest.threadTs, text);
      this.logger.info('Linked channel summary sent', { projectId: opts.projectId });
    } catch (err) {
      this.logger.error('Failed to send linked channel summary', {
        projectId: opts.projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async sendLinkedChannelMilestone(opts: { projectId: string; milestone: MilestoneRef; event: SlackNotificationEvent }): Promise<void> {
    const botToken = await this.getBotToken();
    if (!botToken) return;

    try {
      const project = await this.deps.projectRepository.findById(opts.projectId);
      if (!project?.slackLinkedChannelId) return;

      const latest = this.deps.threadTracker?.getLatest(opts.projectId);
      if (!latest) return;

      const emoji = eventEmoji(opts.event);
      const text = `${emoji} *${project.name}* — Milestone completed: ${opts.milestone.milestoneId}`;

      await this.deps.slackService.replyInThread(botToken, latest.channelId, latest.threadTs, text);
      this.logger.info('Linked channel milestone sent', { projectId: opts.projectId });
    } catch (err) {
      this.logger.error('Failed to send linked channel milestone update', {
        projectId: opts.projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function buildDurationDetail(startTime: Date): string {
  const elapsedMs = Date.now() - startTime.getTime();
  const minutes = Math.floor(elapsedMs / 60000);
  const seconds = Math.floor((elapsedMs % 60000) / 1000);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// ============================================================================
// Markdown → mrkdwn conversion
// ============================================================================

const MRKDWN_BLOCK_LIMIT = 3000;

export function convertMarkdownToMrkdwn(text: string): string {
  // Protect code blocks from inline transformations using placeholders
  const codeBlocks: string[] = [];
  let result = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code: string) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`\`\`\`${code.trim()}\`\`\``);
    return `\x00CODE${idx}\x00`;
  });

  // Headers: # Text → *Text*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Bold: **text** and __text__ → *text*
  result = result.replace(/\*\*(.+?)\*\*/gs, '*$1*');
  result = result.replace(/__(.+?)__/gs, '*$1*');

  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~');

  // Links: [label](url) → <url|label>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Horizontal rules
  result = result.replace(/^(?:-{3,}|\*{3,}|_{3,})$/gm, '');

  // Restore code blocks
  codeBlocks.forEach((block, idx) => {
    result = result.replace(`\x00CODE${idx}\x00`, block);
  });

  return result.replace(/\n{3,}/g, '\n\n').trim();
}

export function buildMrkdwnBlocks(text: string): object[] {
  if (text.length <= MRKDWN_BLOCK_LIMIT) {
    return [{ type: 'section', text: { type: 'mrkdwn', text } }];
  }

  const blocks: object[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    let chunk = remaining.slice(0, MRKDWN_BLOCK_LIMIT);

    if (remaining.length > MRKDWN_BLOCK_LIMIT) {
      const lastNewline = chunk.lastIndexOf('\n');

      if (lastNewline > MRKDWN_BLOCK_LIMIT / 2) {
        chunk = chunk.slice(0, lastNewline);
      }
    }

    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } });
    remaining = remaining.slice(chunk.length).trimStart();
  }

  return blocks;
}

// ============================================================================
// Factory
// ============================================================================

export function createSlackNotificationService(deps: SlackNotificationServiceDeps): SlackNotificationService {
  return new DefaultSlackNotificationService(deps);
}
