import { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '../../utils';
import { RalphLoopStartBody } from './types';
import { isValidModel, DEFAULT_MODEL } from '../../config/models';
import { RalphLoopService, RalphLoopState } from '../../services/ralph-loop/types';
import { SettingsRepository } from '../../repositories';

const DISABLED_MESSAGE = 'Ralph Loop service is not available';

interface RalphLoopDeps {
  ralphLoopService?: RalphLoopService | null;
  settingsRepository: SettingsRepository;
}

function requireService(deps: RalphLoopDeps, res: Response): deps is RalphLoopDeps & { ralphLoopService: RalphLoopService } {
  if (!deps.ralphLoopService) {
    res.status(503).json({ error: DISABLED_MESSAGE });
    return false;
  }

  return true;
}

async function requireLoop(service: RalphLoopService, projectId: string, taskId: string): Promise<RalphLoopState> {
  const loop = await service.getState(projectId, taskId);

  if (!loop) {
    throw new NotFoundError('Ralph Loop');
  }

  return loop;
}

export function handleStart(deps: RalphLoopDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireService(deps, res)) return;

    const id = req.params['id'] as string;
    const body = req.body as RalphLoopStartBody;
    const { taskDescription, maxTurns, workerModel, reviewerModel } = body;

    const settings = await deps.settingsRepository.get();
    const defaults = settings.ralphLoop || {};

    if (workerModel && !isValidModel(workerModel)) {
      throw new ValidationError(`Invalid worker model: ${workerModel}`);
    }

    if (reviewerModel && !isValidModel(reviewerModel)) {
      throw new ValidationError(`Invalid reviewer model: ${reviewerModel}`);
    }

    const state = await deps.ralphLoopService.start(id, {
      taskDescription: taskDescription!,
      maxTurns: maxTurns || defaults.defaultMaxTurns || 5,
      workerModel: workerModel || defaults.defaultWorkerModel || DEFAULT_MODEL,
      reviewerModel: reviewerModel || defaults.defaultReviewerModel || DEFAULT_MODEL,
    });

    res.status(201).json({
      taskId: state.taskId,
      config: state.config,
    });
  };
}

export function handleList(deps: RalphLoopDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireService(deps, res)) return;

    const id = req.params['id'] as string;
    const loops = await deps.ralphLoopService.listByProject(id);
    res.json(loops);
  };
}

export function handleGetState(deps: RalphLoopDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireService(deps, res)) return;

    const id = req.params['id'] as string;
    const taskId = req.params['taskId'] as string;
    const loop = await requireLoop(deps.ralphLoopService, id, taskId);
    res.json(loop);
  };
}

export function handleStop(deps: RalphLoopDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireService(deps, res)) return;

    const id = req.params['id'] as string;
    const taskId = req.params['taskId'] as string;

    await requireLoop(deps.ralphLoopService, id, taskId);
    await deps.ralphLoopService.stop(id, taskId);

    res.json({ success: true });
  };
}

export function handlePause(deps: RalphLoopDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireService(deps, res)) return;

    const id = req.params['id'] as string;
    const taskId = req.params['taskId'] as string;
    const loop = await requireLoop(deps.ralphLoopService, id, taskId);

    if (loop.status === 'paused') {
      res.status(409).json({ error: 'Ralph Loop is already paused' });
      return;
    }

    if (loop.status !== 'worker_running' && loop.status !== 'reviewer_running') {
      res.status(409).json({ error: 'Ralph Loop is not running' });
      return;
    }

    await deps.ralphLoopService.pause(id, taskId);
    res.json({ success: true });
  };
}

export function handleResume(deps: RalphLoopDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireService(deps, res)) return;

    const id = req.params['id'] as string;
    const taskId = req.params['taskId'] as string;
    const loop = await requireLoop(deps.ralphLoopService, id, taskId);

    if (loop.status !== 'paused') {
      res.status(409).json({ error: 'Ralph Loop is not paused' });
      return;
    }

    await deps.ralphLoopService.resume(id, taskId);
    res.json({ success: true });
  };
}

export function handleDelete(deps: RalphLoopDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireService(deps, res)) return;

    const id = req.params['id'] as string;
    const taskId = req.params['taskId'] as string;

    const deleted = await deps.ralphLoopService.delete(id, taskId);

    if (!deleted) {
      throw new NotFoundError('Ralph Loop');
    }

    res.status(204).send();
  };
}
