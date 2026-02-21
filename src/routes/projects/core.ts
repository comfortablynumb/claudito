import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler, NotFoundError, ValidationError, getProjectLogs } from '../../utils';
import { isPathWithinProject } from '../../utils/path-validator';
import { SUPPORTED_MODELS, isValidModel, getModelDisplayName, DEFAULT_MODEL } from '../../config/models';
import { getAgentManager, getProcessTracker, getRalphLoopService, getWebSocketServer } from '../index';
import { generateIdFromPath } from '../../repositories';
import {
  ProjectRouterDependencies,
  CreateProjectBody,
  DebugInfo,
  MemoryUsage,
  ClaudeFileSaveBody,
  PermissionOverridesBody,
  ModelOverrideBody,
  McpOverridesBody
} from './types';
import {
  checkProjectClaudeMd,
  checkGlobalClaudeMd,
  checkRoadmap,
  findClaudeFiles
} from './helpers';
import { validateBody, validateParams } from '../../middleware/validation';
import { validateProjectExists } from '../../middleware/project';
import {
  createProjectSchema,
  updatePermissionsSchema,
  updateModelSchema,
  updateMcpOverridesSchema,
  saveClaudeFileSchema,
  projectIdSchema
} from './schemas';

export function createCoreRouter(deps: ProjectRouterDependencies): Router {
  const router = Router();
  const {
    projectRepository,
    projectService,
    agentManager,
    projectDiscoveryService,
    settingsRepository,
  } = deps;

  // Create a middleware instance that uses the discovery service if available
  const projectExistsMiddleware = validateProjectExists(projectRepository, projectDiscoveryService ?? undefined);

  // List all projects
  router.get('/', asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const projects = await projectRepository.findAll();

    // Add current agent status to each project
    const projectsWithCurrentStatus = projects.map((project) => {
      const agentStatus = agentManager.getAgentStatus(project.id);
      return {
        ...project,
        status: agentStatus // This will override the persisted status with current status
      };
    });

    res.json(projectsWithCurrentStatus);
  }));

  // Create a new project
  router.post('/', validateBody(createProjectSchema), asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CreateProjectBody;
    const { name, path: projectPath, createNew } = body;

    const result = await projectService.createProject({
      name: name ?? '',
      path: projectPath!,
      createNew: createNew === true,
    });

    if (!result.success) {
      throw new ValidationError(result.error || 'Failed to create project');
    }

    res.status(201).json(result.project);
  }));

  // Discover and register projects
  router.post('/discover', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { searchPath } = req.body as { searchPath?: string };

    if (!searchPath || typeof searchPath !== 'string') {
      throw new ValidationError('Search path is required');
    }

    // Validate the search path exists
    if (!fs.existsSync(searchPath)) {
      throw new ValidationError('Search path does not exist');
    }

    if (!projectDiscoveryService) {
      throw new NotFoundError('Project discovery service not available');
    }

    const discovered = await projectDiscoveryService.scanForProjects(searchPath);

    const registered: Array<{ id: string; name: string; path: string }> = [];
    const alreadyRegistered: string[] = [];
    const failed: string[] = [];

    for (const projectPath of discovered) {
      try {
        const projectId = generateIdFromPath(projectPath);
        const existing = await projectRepository.findById(projectId);

        if (existing) {
          alreadyRegistered.push(projectPath);
        } else {
          const project = await projectRepository.create({
            name: path.basename(projectPath),
            path: projectPath
          });
          registered.push(project);
        }
      } catch (error) {
        console.error('Failed to register project', { projectPath, error });
        failed.push(projectPath);
      }
    }

    res.json({
      discovered: discovered.length,
      registered: registered.length,
      alreadyRegistered: alreadyRegistered.length,
      failed: failed.length,
      projects: registered
    });
  }));

  // Get project by ID
  router.get('/:id', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler((req: Request, res: Response) => {
    res.json(req.project!);
  }));

  // Delete a project
  router.delete('/:id', validateParams(projectIdSchema), asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const deleted = await projectRepository.delete(id);

    if (!deleted) {
      throw new NotFoundError('Project');
    }

    res.status(204).send();
  }));

  // Get debug information for a project
  router.get('/:id/debug', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;

    const agentManager = getAgentManager();
    const processTracker = getProcessTracker();
    const ralphLoopService = getRalphLoopService();
    const webSocketServer = getWebSocketServer();

    const processInfo = agentManager?.getProcessInfo(id);
    const debugInfo: DebugInfo = {
      lastCommand: agentManager?.getLastCommand(id) ?? null,
      processInfo: processInfo ? {
        pid: processInfo.pid,
        cwd: processInfo.cwd || '',
        startedAt: processInfo.startedAt || '',
      } : null,
      loopState: agentManager?.getLoopState(id) ?? null,
      recentLogs: getProjectLogs(id, 100),
      trackedProcesses: processTracker && typeof processTracker === 'object' && 'getAllProcesses' in processTracker && typeof processTracker.getAllProcesses === 'function'
        ? (processTracker.getAllProcesses() as Array<{ pid: number; projectId: string; startedAt: string }>)
        : [],
      memoryUsage: process.memoryUsage() as MemoryUsage,
    };

    // Add connected clients if WebSocket server is available
    if (webSocketServer) {
      debugInfo.connectedClients = webSocketServer.getConnectedClients(id);
    }

    // Add Ralph Loop status if service is available
    if (ralphLoopService) {
      const ralphLoops = await ralphLoopService.listByProject(id);
      debugInfo.ralphLoops = {
        count: ralphLoops.length,
        activeLoops: ralphLoops.filter((loop) =>
          loop.status === 'idle' ||
          loop.status === 'worker_running' ||
          loop.status === 'reviewer_running'
        ).map((loop) => ({
          taskId: loop.taskId,
          status: loop.status,
          currentTurn: loop.currentIteration,
        })),
      };
    }

    res.json(debugInfo);
  }));

  // Get project permission overrides
  router.get('/:id/permissions', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler((req: Request, res: Response) => {
    const project = req.project!;

    res.json((project).permissionOverrides || {
      enabled: false,
      allowRules: [],
      denyRules: [],
      defaultMode: null
    });
  }));

  // Update project permission overrides
  router.put('/:id/permissions', validateParams(projectIdSchema), validateBody(updatePermissionsSchema), projectExistsMiddleware, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const body = req.body as PermissionOverridesBody;

    // If enabled is false, clear overrides by passing null
    if (body.enabled === false) {
      const overrides = await projectRepository.updatePermissionOverrides(id, null);
      res.json(overrides);
      return;
    }

    const overrides = await projectRepository.updatePermissionOverrides(id, {
      enabled: body.enabled ?? false,
      allowRules: body.allowRules ?? [],
      denyRules: body.denyRules ?? [],
      defaultMode: body.defaultMode || undefined
    });

    res.json(overrides);
  }));

  // Get project model configuration
  router.get('/:id/model', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler((req: Request, res: Response) => {
    const project = req.project!;

    const effectiveModel = (project).modelOverride || DEFAULT_MODEL;

    res.json({
      projectModel: (project).modelOverride,
      defaultModel: DEFAULT_MODEL,
      effectiveModel,
      availableModels: SUPPORTED_MODELS.map(m => ({
        id: m,
        name: getModelDisplayName(m),
        isDefault: m === DEFAULT_MODEL,
        isCurrent: m === effectiveModel
      }))
    });
  }));

  // Set project model override
  router.put('/:id/model', validateParams(projectIdSchema), validateBody(updateModelSchema), projectExistsMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const body = req.body as ModelOverrideBody;
    const { model } = body;

    // Allow null to clear override
    if (model !== null && model !== undefined) {
      if (!isValidModel(model)) {
        throw new ValidationError(`Invalid model: ${model}. Supported models: ${SUPPORTED_MODELS.join(', ')}`);
      }
    }

    await projectRepository.updateModelOverride(id, model ?? null);

    const effectiveModel = model || DEFAULT_MODEL;

    res.json({
      projectModel: model,
      defaultModel: DEFAULT_MODEL,
      effectiveModel,
      updated: true
    });
  }));

  // Get project MCP overrides
  router.get('/:id/mcp-overrides', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler((req: Request, res: Response) => {
    const project = req.project!;

    res.json((project).mcpOverrides || {
      enabled: false,
      serverOverrides: {}
    });
  }));

  // Update project MCP overrides
  router.put('/:id/mcp-overrides', validateParams(projectIdSchema), validateBody(updateMcpOverridesSchema), projectExistsMiddleware, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const body = req.body as McpOverridesBody;

    // Only clear overrides if explicitly requested (empty overrides + enabled false)
    if (body.enabled === false && (!body.serverOverrides || Object.keys(body.serverOverrides).length === 0)) {
      const overrides = await projectRepository.updateMcpOverrides(id, null);

      // Restart agent if running
      const agentStatus = agentManager.getAgentStatus(id);
      if (agentStatus === 'running') {
        await agentManager.restartProjectAgent(id);
      }

      res.json({
        overrides,
        agentRestarted: agentStatus === 'running'
      });
      return;
    }

    // Save the overrides as provided
    const overrides = await projectRepository.updateMcpOverrides(id, {
      enabled: body.enabled ?? true,
      serverOverrides: body.serverOverrides || {}
    });

    // Restart agent if running
    const agentStatus = agentManager.getAgentStatus(id);
    if (agentStatus === 'running') {
      await agentManager.restartProjectAgent(id);
    }

    res.json({
      overrides,
      agentRestarted: agentStatus === 'running'
    });
  }));

  // Get optimization suggestions for a project
  router.get('/:id/optimizations', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const project = req.project!;

    const checks = await Promise.all([
      checkProjectClaudeMd((project).path),
      checkGlobalClaudeMd(),
      checkRoadmap((project).path),
    ]);

    res.json({ checks });
  }));

  // Get CLAUDE.md files for a project
  router.get('/:id/claude-files', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler((req: Request, res: Response) => {
    const project = req.project!;

    const files = findClaudeFiles((project).path);
    res.json({ files });
  }));

  // Save CLAUDE.md file
  router.put('/:id/claude-files', validateParams(projectIdSchema), validateBody(saveClaudeFileSchema), projectExistsMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const project = req.project!;
    const body = req.body as ClaudeFileSaveBody;
    const { filePath, content } = body;

    // Security: Ensure the file is a CLAUDE.md file and within allowed paths
    const fileName = path.basename(filePath!);
    if (fileName !== 'CLAUDE.md') {
      throw new ValidationError('Can only edit CLAUDE.md files');
    }

    // Check if it's the global file
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const globalClaudePath = path.join(homeDir, '.claude', 'CLAUDE.md');
    const isGlobalFile = path.resolve(filePath!) === path.resolve(globalClaudePath);

    if (!isGlobalFile) {
      // For project files, ensure they're within the project
      const allowedPaths = [
        path.join((project).path, 'CLAUDE.md'),
        path.join((project).path, '.claude', 'CLAUDE.md'),
      ];

      const resolvedPath = path.resolve(filePath!);
      const isAllowed = allowedPaths.some(allowed => resolvedPath === path.resolve(allowed));

      if (!isAllowed) {
        throw new ValidationError('Invalid file path');
      }

      // Additional check for path traversal
      if (!isPathWithinProject(resolvedPath, (project).path)) {
        throw new ValidationError('File path is outside project directory');
      }
    }

    // Ensure directory exists
    const dir = path.dirname(filePath!);
    await fs.promises.mkdir(dir, { recursive: true });

    // Write the file
    await fs.promises.writeFile(filePath!, content!, 'utf-8');

    res.json({
      success: true,
      filePath,
      size: Buffer.byteLength(content!, 'utf-8'),
    });
  }));

  // Get project Docker override with effective state
  router.get('/:id/docker', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const project = req.project!;
    const settings = await settingsRepository.get();
    const globalEnabled = settings.docker?.enabled ?? false;

    let effectiveDocker = false;

    if (globalEnabled) {
      if (project.dockerOverride === false) {
        effectiveDocker = false;
      } else {
        effectiveDocker = true;
      }
    }

    const effectiveImage = effectiveDocker
      ? (project.dockerImage || settings.docker?.baseImage || null)
      : null;

    res.json({
      dockerOverride: project.dockerOverride,
      dockerImage: project.dockerImage ?? null,
      effectiveDocker,
      imageName: effectiveImage,
    });
  }));

  // Set project Docker override and/or image
  router.put('/:id/docker', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const body = req.body as { dockerOverride?: boolean; dockerImage?: string | null };
    const { dockerOverride, dockerImage } = body;

    if (dockerOverride !== undefined && typeof dockerOverride !== 'boolean') {
      throw new ValidationError('dockerOverride must be a boolean');
    }

    if (dockerImage !== undefined && dockerImage !== null && typeof dockerImage !== 'string') {
      throw new ValidationError('dockerImage must be a string or null');
    }

    if (dockerOverride !== undefined) {
      await projectRepository.updateDockerOverride(id, dockerOverride);
    }

    if (dockerImage !== undefined) {
      await projectRepository.updateDockerImage(id, dockerImage);
    }

    res.json({
      dockerOverride,
      dockerImage,
      updated: true,
    });
  }));

  return router;
}