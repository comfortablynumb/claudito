import { Router } from 'express';
import { GitHubCLIService } from '../services/github-cli-service';
import { SlackService } from '../services/slack-service';
import { SettingsRepository } from '../repositories';
import { ProjectService } from '../services/project';
import { ProjectRepository } from '../repositories';
import { asyncHandler } from '../utils/errors';
import { WebSocketMessage } from '../websocket/websocket-server';
import {
  handleGetStatus,
  handleListRepos,
  handleSearchRepos,
  handleCloneRepo,
  handleListIssues,
  handleViewIssue,
  handleCloseIssue,
  handleCommentOnIssue,
  handleCreateIssue,
  handleListLabels,
  handleListMilestones,
  handleListCollaborators,
  handleCreatePR,
  handleListPRs,
  handleViewPR,
  handleCommentOnPR,
  handleMergePR,
} from './integrations-github-handlers';
import {
  handleGetSlackStatus,
  handleValidateSlack,
  handleListSlackChannels,
  handleLinkSlackChannel,
  handleUnlinkSlackChannel,
  handleUpdateSlackSettings,
} from './integrations-slack-handlers';

export interface IntegrationsRouterDependencies {
  githubCLIService: GitHubCLIService;
  slackService: SlackService;
  settingsRepository: SettingsRepository;
  projectService: ProjectService;
  projectRepository: ProjectRepository;
  broadcast?: (message: WebSocketMessage) => void;
}

export function createIntegrationsRouter(deps: IntegrationsRouterDependencies): Router {
  const router = Router();

  const ghDeps = {
    githubCLIService: deps.githubCLIService,
    projectService: deps.projectService,
    projectRepository: deps.projectRepository,
    broadcast: deps.broadcast,
  };

  const slackDeps = {
    slackService: deps.slackService,
    settingsRepository: deps.settingsRepository,
    projectRepository: deps.projectRepository,
  };

  registerGitHubRoutes(router, ghDeps);
  registerSlackRoutes(router, slackDeps);

  return router;
}

function registerGitHubRoutes(
  router: Router,
  deps: { githubCLIService: GitHubCLIService; projectService: ProjectService; projectRepository: ProjectRepository; broadcast?: (message: WebSocketMessage) => void }
): void {
  router.get('/github/status', asyncHandler(handleGetStatus(deps)));
  router.get('/github/repos', asyncHandler(handleListRepos(deps)));
  router.get('/github/repos/search', asyncHandler(handleSearchRepos(deps)));
  router.post('/github/clone', asyncHandler(handleCloneRepo(deps)));

  // Issues
  router.get('/github/issues', asyncHandler(handleListIssues(deps)));
  router.get('/github/issues/:issueNumber', asyncHandler(handleViewIssue(deps)));
  router.post('/github/issues/:issueNumber/close', asyncHandler(handleCloseIssue(deps)));
  router.post('/github/issues/:issueNumber/comment', asyncHandler(handleCommentOnIssue(deps)));
  router.post('/github/issues', asyncHandler(handleCreateIssue(deps)));
  router.get('/github/labels', asyncHandler(handleListLabels(deps)));
  router.get('/github/milestones', asyncHandler(handleListMilestones(deps)));
  router.get('/github/collaborators', asyncHandler(handleListCollaborators(deps)));

  // Pull Requests
  router.post('/github/pr', asyncHandler(handleCreatePR(deps)));
  router.get('/github/pulls', asyncHandler(handleListPRs(deps)));
  router.get('/github/pulls/:prNumber', asyncHandler(handleViewPR(deps)));
  router.post('/github/pulls/:prNumber/comment', asyncHandler(handleCommentOnPR(deps)));
  router.post('/github/pulls/:prNumber/merge', asyncHandler(handleMergePR(deps)));
}

function registerSlackRoutes(
  router: Router,
  deps: { slackService: SlackService; settingsRepository: SettingsRepository; projectRepository: ProjectRepository }
): void {
  router.get('/slack/status', asyncHandler(handleGetSlackStatus(deps)));
  router.post('/slack/validate', asyncHandler(handleValidateSlack(deps)));
  router.get('/slack/channels', asyncHandler(handleListSlackChannels(deps)));
  router.post('/slack/link', asyncHandler(handleLinkSlackChannel(deps)));
  router.delete('/slack/link/:projectId', asyncHandler(handleUnlinkSlackChannel(deps)));
  router.put('/slack/settings', asyncHandler(handleUpdateSlackSettings(deps)));
}
