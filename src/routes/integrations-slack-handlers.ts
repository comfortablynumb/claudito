import { Request, Response } from 'express';
import { SlackService } from '../services/slack-service';
import { SettingsRepository } from '../repositories';
import { ProjectRepository } from '../repositories';
import { ValidationError } from '../utils/errors';

export interface SlackHandlerDeps {
  slackService: SlackService;
  settingsRepository: SettingsRepository;
  projectRepository: ProjectRepository;
}

export function handleGetSlackStatus(deps: SlackHandlerDeps) {
  return async (_req: Request, res: Response): Promise<void> => {
    const settings = await deps.settingsRepository.get();
    const botToken = settings.slack?.botToken || null;
    const status = await deps.slackService.getStatus(botToken);
    res.json(status);
  };
}

export function handleValidateSlack(deps: SlackHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { botToken } = req.body as { botToken?: string };

    if (!botToken) {
      throw new ValidationError('botToken is required');
    }

    const result = await deps.slackService.validateBotToken(botToken);
    res.json(result);
  };
}

export function handleListSlackChannels(deps: SlackHandlerDeps) {
  return async (_req: Request, res: Response): Promise<void> => {
    const settings = await deps.settingsRepository.get();
    const botToken = settings.slack?.botToken;

    if (!botToken) {
      throw new ValidationError('No Slack bot token configured');
    }

    const channels = await deps.slackService.listChannels(botToken);
    res.json(channels);
  };
}

export function handleLinkSlackChannel(deps: SlackHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { projectId, channelId } = req.body as {
      projectId?: string;
      channelId?: string;
    };

    if (!projectId) {
      throw new ValidationError('projectId is required');
    }

    if (!channelId) {
      throw new ValidationError('channelId is required');
    }

    const project = await deps.projectRepository.findById(projectId);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await deps.projectRepository.updateSlackLinkedChannel(projectId, channelId);
    res.json({ success: true, channelId });
  };
}

export function handleUnlinkSlackChannel(deps: SlackHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params['projectId']!;
    const project = await deps.projectRepository.findById(projectId);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await deps.projectRepository.updateSlackLinkedChannel(projectId, null);
    res.json({ success: true });
  };
}

export function handleUpdateSlackSettings(deps: SlackHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { botToken, appToken, defaultChannelId, enabled } = req.body as {
      botToken?: string;
      appToken?: string;
      defaultChannelId?: string;
      enabled?: boolean;
    };

    if (botToken && botToken.trim()) {
      const validation = await deps.slackService.validateBotToken(botToken.trim());

      if (!validation.valid) {
        throw new ValidationError('Invalid bot token: ' + (validation.error ?? 'authentication failed'));
      }
    }

    const updated = await deps.settingsRepository.update({
      slack: {
        ...(botToken !== undefined && { botToken: botToken.trim() }),
        ...(appToken !== undefined && { appToken: appToken.trim() }),
        ...(defaultChannelId !== undefined && { defaultChannelId }),
        ...(enabled !== undefined && { enabled }),
      },
    });

    res.json(updated.slack);
  };
}
