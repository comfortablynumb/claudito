/**
 * Docker Routes
 * API endpoints for Docker container and image management
 */

import { Router, Request, Response } from 'express';
import { DockerService, ContainerManager, ImageManager } from '../services/docker/types';
import { SettingsRepository } from '../repositories/settings';
import { WebSocketMessage } from '../websocket/websocket-server';
import { asyncHandler, NotFoundError, ValidationError } from '../utils/errors';

export interface DockerRouterDependencies {
  dockerService: DockerService;
  containerManager: ContainerManager;
  imageManager?: ImageManager;
  settingsRepository?: SettingsRepository;
  broadcast?: (message: WebSocketMessage) => void;
}

export function createDockerRouter(deps: DockerRouterDependencies): Router {
  const router = Router();
  const { dockerService, containerManager, imageManager, settingsRepository, broadcast } = deps;

  // GET /api/agents/containers - List all project containers
  router.get('/containers', asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const containers = await containerManager.getProjectContainers();

    // Enrich with resource usage
    const enriched = await Promise.all(containers.map(async (container) => {
      const usage = await dockerService.getResourceUsage(container.containerId);
      return { ...container, resourceUsage: usage };
    }));

    res.json({ containers: enriched });
  }));

  // GET /api/agents/containers/:projectId - Container info for specific project
  router.get('/containers/:projectId', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    const containerId = containerManager.getContainerForProject(projectId!);

    if (!containerId) {
      throw new NotFoundError(`Container for project ${projectId}`);
    }

    const status = await dockerService.getContainerStatus(containerId);
    const usage = await dockerService.getResourceUsage(containerId);

    res.json({
      ...status,
      resourceUsage: usage,
    });
  }));

  // POST /api/agents/containers/:projectId/restart - Restart a project's container
  router.post('/containers/:projectId/restart', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    const containerId = containerManager.getContainerForProject(projectId!);

    if (!containerId) {
      throw new NotFoundError(`Container for project ${projectId}`);
    }

    await dockerService.stopContainer(containerId);
    await dockerService.startContainer(containerId);

    const status = await dockerService.getContainerStatus(containerId);
    res.json(status);
  }));

  // GET /api/docker/availability - Check Docker availability
  router.get('/availability', asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const availability = await dockerService.checkAvailability();
    res.json(availability);
  }));

  // Image management routes (only when imageManager is provided)
  if (imageManager) {
    mountImageRoutes(router, imageManager, settingsRepository, broadcast);
  }

  return router;
}

const DAEMON_NOT_RUNNING_WARNING =
  'Docker engine does not appear to be running. Falling back to host execution. ' +
  'Docker has been disabled in settings.';

function mountImageRoutes(
  router: Router,
  imageManager: ImageManager,
  settingsRepository?: SettingsRepository,
  broadcast?: (message: WebSocketMessage) => void,
): void {
  // GET /api/docker/images - List Docker images
  router.get('/images', asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    try {
      const images = await imageManager.listImages();
      res.json({ images });
    } catch (_err) {
      if (!settingsRepository) {
        res.json({ images: [] });
        return;
      }

      const settings = await settingsRepository.get();

      if (!settings.docker.enabled) {
        res.json({ images: [] });
        return;
      }

      await settingsRepository.update({ docker: { enabled: false } });
      res.json({ images: [], daemonNotRunning: true, warning: DAEMON_NOT_RUNNING_WARNING });
    }
  }));

  // POST /api/docker/images/build - Build a Docker image
  router.post('/images/build', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const body = req.body as {
      variantName?: string;
      imageName?: string;
    };

    if (!body.variantName) {
      throw new ValidationError('variantName is required');
    }

    const variants = imageManager.getAvailableVariants();
    const variant = variants.find((v) => v.name === body.variantName);

    if (!variant) {
      throw new NotFoundError(`Variant ${body.variantName}`);
    }

    const imageName = body.imageName || `claudito-${variant.name}:latest`;
    const variantName = body.variantName;

    const emitProgress = (line: string, phase: 'building' | 'done' | 'error'): void => {
      if (broadcast) {
        broadcast({
          type: 'docker_build_progress',
          data: { variantName, imageName, line, phase },
        });
      }
    };

    await imageManager.buildImageStreaming(
      { dockerfilePath: variant.dockerfilePath, imageName },
      (line) => emitProgress(line, 'building'),
    );

    emitProgress('Build completed successfully', 'done');
    res.json({ imageName, built: true });
  }));

  // DELETE /api/docker/images/:name - Remove a Docker image
  router.delete('/images/:name', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { name } = req.params;
    await imageManager.removeImage(name!);
    res.json({ removed: true });
  }));

  // GET /api/docker/variants - List available Dockerfile templates
  router.get('/variants', (_req: Request, res: Response) => {
    const variants = imageManager.getAvailableVariants();
    res.json({ variants });
  });
}
