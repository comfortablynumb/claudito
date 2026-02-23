import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler, ValidationError, ConflictError, getLogger } from '../../utils';
import { ProjectRouterDependencies, AgentMessageBody } from './types';

import { validateBody, validateParams } from '../../middleware/validation';
import { validateProjectExists } from '../../middleware/project';
import { agentOperationRateLimit, moderateRateLimit } from '../../middleware/rate-limit';
import {
  agentMessageSchema,
  agentSendMessageSchema,
  projectAndQueueIndexSchema
} from './schemas';

export function createAgentRouter(deps: ProjectRouterDependencies): Router {
  const router = Router({ mergeParams: true });
  const {
    projectRepository,
    agentManager,
  } = deps;

  // Start autonomous loop
  router.post('/start', validateProjectExists(projectRepository), agentOperationRateLimit, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const project = req.project!;

    if (agentManager.isRunning(id)) {
      throw new ConflictError('Agent is already running');
    }

    // Validate roadmap exists before starting
    const roadmapPath = path.join((project).path, 'doc', 'ROADMAP.md');

    try {
      await fs.promises.access(roadmapPath);
    } catch {
      throw new ValidationError('Roadmap not found. A ROADMAP.md file is required to start the agent.');
    }

    await agentManager.startAutonomousLoop(id);
    res.json({ success: true, status: agentManager.isQueued(id) ? 'queued' : 'running' });
  }));

  // Stop agent
  router.post('/stop', validateProjectExists(projectRepository), asyncHandler(async (req: Request, res: Response) => {
    const id = req.params['id'] as string;

    await agentManager.stopAgent(id);
    res.json({ success: true, status: 'stopped' });
  }));

  // Get agent status
  router.get('/status', validateProjectExists(projectRepository), asyncHandler((req: Request, res: Response) => {
    const id = req.params['id'] as string;

    const fullStatus = agentManager.getFullStatus(id);
    res.json(fullStatus);
  }));

  // Get context usage for running agent or last saved usage
  router.get('/context', validateProjectExists(projectRepository), asyncHandler((req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const project = req.project!;

    // First try to get from running agent
    let contextUsage = agentManager.getContextUsage(id);

    // If agent is not running, use last saved context usage from project status
    if (!contextUsage && (project).lastContextUsage) {
      contextUsage = (project).lastContextUsage;
    }

    res.json({ contextUsage });
  }));

  // Get queued messages for running agent
  router.get('/queue', validateProjectExists(projectRepository), asyncHandler((req: Request, res: Response) => {
    const id = req.params['id'] as string;

    const messages = agentManager.getQueuedMessages(id);
    res.json({ messages });
  }));

  // Get loop status (enhanced with progress tracking)
  router.get('/loop', validateProjectExists(projectRepository), asyncHandler((req: Request, res: Response) => {
    const id = req.params['id'] as string;

    const loopState = agentManager.getLoopState(id);

    if (!loopState) {
      res.json({ isLooping: false, progress: null });
      return;
    }

    res.json(loopState);
  }));

  // Remove project from agent queue
  router.delete('/queue', validateProjectExists(projectRepository), asyncHandler((req: Request, res: Response) => {
    const id = req.params['id'] as string;

    if (!agentManager.isQueued(id)) {
      throw new ValidationError('Agent is not queued');
    }

    agentManager.removeFromQueue(id);
    res.json({ success: true });
  }));

  // Remove a queued message from a running agent
  router.delete('/queue/:index', validateParams(projectAndQueueIndexSchema), validateProjectExists(projectRepository), asyncHandler((req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const index = req.params['index'] as unknown as number;

    if (!agentManager.isRunning(id)) {
      throw new ValidationError('Agent is not running');
    }

    const removed = agentManager.removeQueuedMessage(id, index);

    if (!removed) {
      throw new ValidationError('Failed to remove message from queue');
    }

    res.json({ success: true, remainingMessages: agentManager.getQueuedMessages(id) });
  }));

  // Start interactive agent session
  router.post('/interactive', validateBody(agentMessageSchema), validateProjectExists(projectRepository), agentOperationRateLimit, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const body = req.body as AgentMessageBody;
    const { message, images, sessionId, permissionMode } = body;

    if (agentManager.isRunning(id)) {
      const currentMode = agentManager.getAgentMode(id);
      if (currentMode === 'autonomous') {
        throw new ConflictError('An autonomous agent is already running. Stop it first.');
      }
      throw new ConflictError('An agent is already running');
    }

    // Don't validate sessionId - let the agent manager handle session creation/resumption
    const result = await agentManager.startInteractiveAgent(id, {
      initialMessage: message,
      images,
      sessionId,
      permissionMode,
    });

    const status = agentManager.isQueued(id) ? 'queued' : 'running';
    const actualSessionId = agentManager.getSessionId(id);

    res.json({
      success: true,
      status,
      mode: 'interactive',
      sessionId: actualSessionId,
      containerRestarted: result.containerRestarted,
      containerImageName: result.containerImageName,
      dockerFallback: result.dockerFallback,
      dockerFallbackReason: result.dockerFallbackReason,
    });
  }));

  // Stop a one-off agent
  router.post('/oneoff/:oneOffId/stop', asyncHandler(async (req: Request, res: Response) => {
    await agentManager.stopOneOffAgent(req.params['oneOffId'] as string);
    res.json({ success: true });
  }));

  // Send input to a one-off agent
  router.post('/oneoff/:oneOffId/send', asyncHandler((req: Request, res: Response) => {
    const oneOffId = req.params['oneOffId'] as string;
    const { message, images } = req.body as AgentMessageBody;

    if (!message && (!images || images.length === 0)) {
      throw new ValidationError('Message is required');
    }

    agentManager.sendOneOffInput(oneOffId, message || '', images);
    res.json({ success: true });
  }));

  // Get one-off agent status
  router.get('/oneoff/:oneOffId/status', asyncHandler((req: Request, res: Response) => {
    const oneOffId = req.params['oneOffId'] as string;
    const status = agentManager.getOneOffStatus(oneOffId);

    if (!status) {
      res.status(404).json({ error: 'One-off agent not found' });
      return;
    }

    res.json(status);
  }));

  // Get one-off agent context usage
  router.get('/oneoff/:oneOffId/context', asyncHandler((req: Request, res: Response) => {
    const oneOffId = req.params['oneOffId'] as string;
    const contextUsage = agentManager.getOneOffContextUsage(oneOffId);
    res.json({ contextUsage });
  }));

  // List active one-off agents for this project
  router.get('/oneoff', validateProjectExists(projectRepository), asyncHandler((req: Request, res: Response) => {
    const id = req.params['id'] as string;
    res.json({ agents: agentManager.getActiveOneOffAgents(id) });
  }));

  // Answer an AskUserQuestion from the agent
  router.post('/answer', validateProjectExists(projectRepository), moderateRateLimit, asyncHandler((req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const { toolUseId, answers } = req.body as { toolUseId?: string; answers?: Record<string, string | string[]> };

    if (!toolUseId) {
      throw new ValidationError('toolUseId is required');
    }

    if (!answers || typeof answers !== 'object') {
      throw new ValidationError('answers is required');
    }

    if (!agentManager.isRunning(id)) {
      throw new ValidationError('Agent is not running');
    }

    const content = JSON.stringify({ answers });
    agentManager.sendToolResult(id, toolUseId, content);

    res.json({ success: true });
  }));

  // Send input to running interactive agent
  router.post('/send', validateBody(agentSendMessageSchema), validateProjectExists(projectRepository), moderateRateLimit, asyncHandler(async (req: Request, res: Response) => {
    const logger = getLogger('agent-send');
    const id = req.params['id'] as string;
    const body = req.body as AgentMessageBody;
    const { message, images, planFeedback } = body;

    logger.info('Received send request', {
      projectId: id,
      messageLength: message?.length ?? 0,
      hasImages: !!images && images.length > 0,
    });

    // Plan approval: handle before isRunning check — agent may have exited after ExitPlanMode
    if (planFeedback && agentManager.hasPendingPlan(id)) {
      logger.info('Processing plan approval response', { projectId: id });
      await agentManager.approvePlan(id, message || '');
      res.json({ success: true });
      return;
    }

    if (!agentManager.isRunning(id)) {
      logger.warn('Agent not running', { projectId: id });
      throw new ValidationError('Agent is not running');
    }

    const mode = agentManager.getAgentMode(id);
    if (mode !== 'interactive') {
      logger.warn('Agent not in interactive mode', { projectId: id, mode });
      throw new ValidationError('Agent is not in interactive mode');
    }

    if (agentManager.hasPendingPlan(id)) {
      logger.warn('Rejected: plan approval pending', { projectId: id });
      throw new ValidationError('Agent is waiting for plan approval. Use the plan approval controls.');
    }

    logger.info('Sending input to agent', { projectId: id });
    agentManager.sendInput(id, message || '', images);

    res.json({ success: true });
  }));

  return router;
}