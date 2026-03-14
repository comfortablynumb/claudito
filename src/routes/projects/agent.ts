import { Router } from 'express';
import { asyncHandler } from '../../utils';
import { ProjectRouterDependencies } from './types';

import { validateBody, validateParams } from '../../middleware/validation';
import { validateProjectExists } from '../../middleware/project';
import { agentOperationRateLimit, moderateRateLimit } from '../../middleware/rate-limit';
import {
  agentMessageSchema,
  agentSendMessageSchema,
  projectAndQueueIndexSchema
} from './schemas';
import {
  handleStartAutonomousLoop,
  handleStopAgent,
  handleGetStatus,
  handleGetContext,
  handleGetQueue,
  handleGetLoop,
  handleRemoveFromQueue,
  handleRemoveQueuedMessage,
  handleStartInteractive,
  handleOneOffStop,
  handleOneOffSend,
  handleOneOffStatus,
  handleOneOffContext,
  handleListOneOffAgents,
  handleAnswer,
  handleSend,
} from './agent-handlers';

export function createAgentRouter(deps: ProjectRouterDependencies): Router {
  const router = Router({ mergeParams: true });
  const { projectRepository, agentManager } = deps;
  const validate = validateProjectExists(projectRepository);

  router.post('/start', validate, agentOperationRateLimit, asyncHandler(handleStartAutonomousLoop(agentManager)));
  router.post('/stop', validate, asyncHandler(handleStopAgent(agentManager)));
  router.get('/status', validate, asyncHandler(handleGetStatus(agentManager)));
  router.get('/context', validate, asyncHandler(handleGetContext(agentManager)));
  router.get('/queue', validate, asyncHandler(handleGetQueue(agentManager)));
  router.get('/loop', validate, asyncHandler(handleGetLoop(agentManager)));
  router.delete('/queue', validate, asyncHandler(handleRemoveFromQueue(agentManager)));
  router.delete('/queue/:index', validateParams(projectAndQueueIndexSchema), validate, asyncHandler(handleRemoveQueuedMessage(agentManager)));

  router.post('/interactive', validateBody(agentMessageSchema), validate, agentOperationRateLimit, asyncHandler(handleStartInteractive(agentManager)));

  router.post('/oneoff/:oneOffId/stop', asyncHandler(handleOneOffStop(agentManager)));
  router.post('/oneoff/:oneOffId/send', asyncHandler(handleOneOffSend(agentManager)));
  router.get('/oneoff/:oneOffId/status', asyncHandler(handleOneOffStatus(agentManager)));
  router.get('/oneoff/:oneOffId/context', asyncHandler(handleOneOffContext(agentManager)));
  router.get('/oneoff', validate, asyncHandler(handleListOneOffAgents(agentManager)));

  router.post('/answer', validate, moderateRateLimit, asyncHandler(handleAnswer(agentManager)));
  router.post('/send', validateBody(agentSendMessageSchema), validate, moderateRateLimit, asyncHandler(handleSend(agentManager)));

  return router;
}
