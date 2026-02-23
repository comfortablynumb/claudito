import { Router } from 'express';
import { asyncHandler, ValidationError } from '../../utils/errors';
import { validateProjectExists } from '../../middleware/project';
import { ProjectRouterDependencies } from './types';
import { SlackNotificationConfig, SlackNotificationEvent } from '../../repositories/project';
import { getLogger } from '../../utils';

const logger = getLogger('slack-routes');

const VALID_EVENTS: SlackNotificationEvent[] = [
  'agent_completed',
  'agent_failed',
  'agent_waiting',
  'ralph_loop_complete',
  'ralph_loop_error',
  'milestone_completed',
  'milestone_failed',
];

function isValidEvent(event: unknown): event is SlackNotificationEvent {
  return typeof event === 'string' && VALID_EVENTS.includes(event as SlackNotificationEvent);
}

export function createSlackRouter(deps: ProjectRouterDependencies): Router {
  const router = Router({ mergeParams: true });
  const { projectRepository } = deps;

  router.get('/', validateProjectExists(projectRepository), asyncHandler(async (req, res) => {
    const id = req.params['id']!;
    logger.debug('Get Slack config', { projectId: id });
    const project = await projectRepository.findById(id);
    res.json(project?.slackNotification ?? null);
  }));

  router.put('/', validateProjectExists(projectRepository), asyncHandler(async (req, res) => {
    const id = req.params['id']!;
    const body = req.body as {
      channelId?: string;
      events?: unknown[];
      mentionUsers?: unknown[];
      threadReplies?: boolean;
    } | null;

    if (body === null) {
      await projectRepository.updateSlackNotification(id, null);
      logger.info('Slack config cleared', { projectId: id });
      res.json(null);
      return;
    }

    if (!body?.channelId) {
      throw new ValidationError('channelId is required');
    }

    const events = (body.events ?? []).filter(isValidEvent);
    const mentionUsers = (body.mentionUsers ?? [])
      .filter((u): u is string => typeof u === 'string');

    const config: SlackNotificationConfig = {
      channelId: body.channelId,
      events,
      mentionUsers,
      threadReplies: body.threadReplies ?? false,
    };

    const updated = await projectRepository.updateSlackNotification(id, config);
    logger.info('Slack config updated', { projectId: id, channelId: body.channelId, eventCount: events.length });
    res.json(updated?.slackNotification ?? null);
  }));

  router.delete('/', validateProjectExists(projectRepository), asyncHandler(async (req, res) => {
    const id = req.params['id']!;
    await projectRepository.updateSlackNotification(id, null);
    logger.info('Slack config deleted', { projectId: id });
    res.json({ success: true });
  }));

  return router;
}
