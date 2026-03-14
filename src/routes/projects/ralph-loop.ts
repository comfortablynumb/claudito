import { Router } from 'express';
import { asyncHandler } from '../../utils';
import { ProjectRouterDependencies } from './types';
import { validateBody, validateParams } from '../../middleware/validation';
import { validateProjectExists } from '../../middleware/project';
import { agentOperationRateLimit } from '../../middleware/rate-limit';
import { ralphLoopStartSchema, projectAndTaskIdSchema } from './schemas';
import {
  handleStart,
  handleList,
  handleGetState,
  handleStop,
  handlePause,
  handleResume,
  handleDelete,
} from './ralph-loop-handlers';

export function createRalphLoopRouter(deps: ProjectRouterDependencies): Router {
  const router = Router({ mergeParams: true });
  const { projectRepository, ralphLoopService, settingsRepository } = deps;
  const validate = validateProjectExists(projectRepository);
  const validateTask = validateParams(projectAndTaskIdSchema);
  const loopDeps = { ralphLoopService, settingsRepository };

  router.post('/start', validateBody(ralphLoopStartSchema), validate, agentOperationRateLimit, asyncHandler(handleStart(loopDeps)));
  router.get('/', validate, asyncHandler(handleList(loopDeps)));
  router.get('/:taskId', validateTask, validate, asyncHandler(handleGetState(loopDeps)));
  router.post('/:taskId/stop', validateTask, validate, asyncHandler(handleStop(loopDeps)));
  router.post('/:taskId/pause', validateTask, validate, asyncHandler(handlePause(loopDeps)));
  router.post('/:taskId/resume', validateTask, validate, asyncHandler(handleResume(loopDeps)));
  router.delete('/:taskId', validateTask, validate, asyncHandler(handleDelete(loopDeps)));

  return router;
}
