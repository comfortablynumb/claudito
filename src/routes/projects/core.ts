import { Router, Request, Response } from 'express';
import { asyncHandler, NotFoundError, ValidationError } from '../../utils';
import {
  ProjectRouterDependencies,
  CreateProjectBody,
} from './types';
import {
  checkProjectClaudeMd,
  checkGlobalClaudeMd,
  checkRoadmap,
  findClaudeFiles
} from './helpers';
import { handleDiscoverProjects, handleGetDebugInfo, handleSaveClaudeFile } from './core-handlers';
import {
  handleGetPermissions,
  handleUpdatePermissions,
  handleGetModel,
  handleUpdateModel,
  handleGetMcpOverrides,
  handleUpdateMcpOverrides,
  handleGetDocker,
  handleUpdateDocker,
  handleGetAgentProfile,
  handleUpdateAgentProfile,
} from './core-config-handlers';
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
  } = deps;

  const projectExistsMiddleware = validateProjectExists(projectRepository, projectDiscoveryService ?? undefined);

  // List all projects
  router.get('/', asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const projects = await projectRepository.findAll();

    const projectsWithCurrentStatus = projects.map((project) => {
      const agentStatus = agentManager.getAgentStatus(project.id);
      return { ...project, status: agentStatus };
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
  router.post('/discover', asyncHandler(handleDiscoverProjects(deps)));

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

  // Debug info
  router.get('/:id/debug', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(handleGetDebugInfo()));

  // Permissions
  router.get('/:id/permissions', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(handleGetPermissions()));
  router.put('/:id/permissions', validateParams(projectIdSchema), validateBody(updatePermissionsSchema), projectExistsMiddleware, asyncHandler(handleUpdatePermissions(deps)));

  // Model
  router.get('/:id/model', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(handleGetModel()));
  router.put('/:id/model', validateParams(projectIdSchema), validateBody(updateModelSchema), projectExistsMiddleware, asyncHandler(handleUpdateModel(deps)));

  // MCP overrides
  router.get('/:id/mcp-overrides', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(handleGetMcpOverrides()));
  router.put('/:id/mcp-overrides', validateParams(projectIdSchema), validateBody(updateMcpOverridesSchema), projectExistsMiddleware, asyncHandler(handleUpdateMcpOverrides(deps)));

  // Optimizations
  router.get('/:id/optimizations', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const project = req.project!;
    const checks = await Promise.all([
      checkProjectClaudeMd((project).path),
      checkGlobalClaudeMd(),
      checkRoadmap((project).path),
    ]);
    res.json({ checks });
  }));

  // Claude files
  router.get('/:id/claude-files', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler((req: Request, res: Response) => {
    const project = req.project!;
    const files = findClaudeFiles((project).path);
    res.json({ files });
  }));
  router.put('/:id/claude-files', validateParams(projectIdSchema), validateBody(saveClaudeFileSchema), projectExistsMiddleware, asyncHandler(handleSaveClaudeFile()));

  // Docker
  router.get('/:id/docker', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(handleGetDocker(deps)));
  router.put('/:id/docker', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(handleUpdateDocker(deps)));

  // Agent profile
  router.get('/:id/agent-profile', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(handleGetAgentProfile(deps)));
  router.put('/:id/agent-profile', validateParams(projectIdSchema), projectExistsMiddleware, asyncHandler(handleUpdateAgentProfile(deps)));

  return router;
}
