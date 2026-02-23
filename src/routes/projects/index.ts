import { Router } from 'express';
import { createCoreRouter } from './core';
import { createRoadmapRouter } from './roadmap';
import { createAgentRouter } from './agent';
import { createConversationRouter } from './conversation';
import { createShellRouter } from './shell';
import { createRalphLoopRouter } from './ralph-loop';
import { createGitRouter } from './git';
import { createOptimizationRouter } from './optimization';
import { createRunConfigsRouter } from './run-configs';
import { createInventifyRouter } from './inventify';
import { createSlackRouter } from './slack';

// Re-export types for backward compatibility
export * from './types';
export * from './helpers';

export function createProjectsRouter(deps: ProjectRouterDependencies): Router {
  const router = Router();

  // Mount sub-routers
  // Inventify must be before /:id routes to avoid 'inventify' being treated as project ID
  router.use('/inventify', createInventifyRouter(deps));

  // Core routes are mounted at root level
  router.use('/', createCoreRouter(deps));

  // Mount specific feature routers under their paths
  router.use('/:id/roadmap', createRoadmapRouter(deps));
  router.use('/:id/agent', createAgentRouter(deps));
  router.use('/:id/conversation', createConversationRouter(deps));
  router.use('/:id/conversations', createConversationRouter(deps));
  router.use('/:id/shell', createShellRouter(deps));
  router.use('/:id/ralph-loop', createRalphLoopRouter(deps));
  router.use('/:id/git', createGitRouter(deps));
  router.use('/:id/run-configs', createRunConfigsRouter(deps));
  router.use('/:id/slack', createSlackRouter(deps));
  router.use('/:id', createOptimizationRouter(deps));

  return router;
}

// Import type from local file to avoid circular dependency
import { ProjectRouterDependencies } from './types';