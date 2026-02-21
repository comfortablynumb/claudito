import path from 'path';
import { Router } from 'express';
import { createFilesystemRouter, createFilesystemService } from './filesystem';
import { createProjectsRouter } from './projects';
import { createSettingsRouter } from './settings';
import {
  FileProjectRepository,
  FileConversationRepository,
  FileSettingsRepository,
} from '../repositories';
import {
  DefaultProjectService,
  MarkdownRoadmapParser,
  MarkdownRoadmapEditor,
  ClaudeRoadmapGenerator,
  DefaultInstructionGenerator,
  ClaudeOptimizationService,
  DefaultDataWipeService,
  DefaultRunConfigurationService,
  RunConfigurationService,
  DefaultRunProcessManager,
  DefaultRunConfigImportService,
  InventifyService,
  DefaultInventifyService,
  ClaudeCliService,
  ClaudeCliInfo,
  createClaudeCliService,
} from '../services';
import { RunProcessManager } from '../services/run-config/run-process-types';
import { createGitService } from '../services/git-service';
import { createShellService, ShellService } from '../services/shell-service';
import { createGitHubCLIService, GitHubCLIService } from '../services/github-cli-service';
import { createIntegrationsRouter } from './integrations';
import { DefaultAgentManager, AgentManager } from '../agents';
import { DefaultDockerService, DefaultContainerManager, DefaultDockerCommandRunner, DefaultImageManager } from '../services/docker';
import { DockerService, ContainerManager, ImageManager } from '../services/docker/types';
import { createDockerRouter } from './docker';
import { DefaultRalphLoopService } from '../services/ralph-loop/ralph-loop-service';
import { RalphLoopService } from '../services/ralph-loop/types';
import { FileRalphLoopRepository } from '../repositories/ralph-loop';
import { getDataDirectory, getLogger, getGlobalLogs } from '../utils';
import { RoadmapGenerator } from '../services';
import { ProjectWebSocketServer } from '../websocket';
import { ProjectDiscoveryService, DefaultProjectDiscoveryService } from '../services/project-discovery';
import { AuthService } from '../services/auth-service';
import { parseCookie, COOKIE_NAME } from '../middleware/auth-middleware';
import packageJson from '../../package.json';

const frontendLogger = getLogger('frontend');

let sharedAgentManager: AgentManager | null = null;
let sharedRoadmapGenerator: RoadmapGenerator | null = null;
let sharedShellService: ShellService | null = null;
let sharedRalphLoopService: RalphLoopService | null = null;
let sharedConversationRepository: FileConversationRepository | null = null;
let sharedProjectRepository: FileProjectRepository | null = null;
let sharedWebSocketServer: ProjectWebSocketServer | null = null;
let sharedProjectDiscoveryService: ProjectDiscoveryService | null = null;
let sharedOptimizationService: ClaudeOptimizationService | null = null;
let sharedGitHubCLIService: GitHubCLIService | null = null;
let sharedRunConfigurationService: RunConfigurationService | null = null;
let sharedRunProcessManager: RunProcessManager | null = null;
let sharedInventifyService: InventifyService | null = null;
let sharedDockerService: DockerService | null = null;
let sharedContainerManager: ContainerManager | null = null;
let sharedImageManager: ImageManager | null = null;
let sharedClaudeCliService: ClaudeCliService | null = null;
let cachedClaudeCliInfo: ClaudeCliInfo | null = null;

export interface ApiRouterDependencies {
  agentManager?: AgentManager;
  maxConcurrentAgents?: number;
  devMode?: boolean;
  shellEnabled?: boolean;
  onShutdown?: () => void;
  authService?: AuthService;
}

export function createApiRouter(deps: ApiRouterDependencies = {}): Router {
  const router = Router();
  const dataDir = getDataDirectory();

  // Repositories
  const projectRepository = sharedProjectRepository || new FileProjectRepository(dataDir);
  if (!sharedProjectRepository) {
    sharedProjectRepository = projectRepository;
  }
  // Conversation repository uses project repository to resolve project paths
  const conversationRepository = sharedConversationRepository || new FileConversationRepository({
    projectPathResolver: projectRepository,
  });
  if (!sharedConversationRepository) {
    sharedConversationRepository = conversationRepository;
  }
  const settingsRepository = new FileSettingsRepository(dataDir);

  // Services
  const projectService = new DefaultProjectService({ projectRepository });
  const roadmapParser = new MarkdownRoadmapParser();
  const roadmapEditor = new MarkdownRoadmapEditor(roadmapParser);
  const roadmapGenerator = getOrCreateRoadmapGenerator();
  const instructionGenerator = new DefaultInstructionGenerator();

  // Docker service & container manager (needed by agent manager)
  const dockerService = getOrCreateDockerService();
  const containerManager = getOrCreateContainerManager(dockerService, settingsRepository);

  // Agent Manager (singleton for WebSocket integration)
  const agentManager = deps.agentManager || getOrCreateAgentManager({
    projectRepository,
    conversationRepository,
    settingsRepository,
    instructionGenerator,
    roadmapParser,
    containerManager,
    maxConcurrentAgents: deps.maxConcurrentAgents,
  });

  // Claude CLI info (eagerly fetch and cache on startup)
  const cliLogger = getLogger('claude-cli');
  const claudeCliService = getOrCreateClaudeCliService();
  const claudeCliInfoPromise = claudeCliService.getInfo().catch((): ClaudeCliInfo => {
    return { installed: false, version: null, auth: null, error: 'Failed to check Claude CLI' };
  });

  void claudeCliInfoPromise.then((info) => {
    cachedClaudeCliInfo = info;
    cliLogger.info('Claude CLI info resolved', {
      installed: info.installed,
      version: info.version,
      loggedIn: info.auth?.loggedIn ?? false,
    });
  });

  // Health check (public; optionally checks auth when ?auth=1)
  router.get('/health', async (req, res) => {
    if (req.query.auth === '1' && deps.authService) {
      const sessionId = parseCookie(req.headers.cookie, COOKIE_NAME);

      if (!sessionId || !deps.authService.validateSession(sessionId)) {
        res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
        return;
      }
    }

    if (!cachedClaudeCliInfo) {
      cachedClaudeCliInfo = await claudeCliInfoPromise;
    }

    res.json({
      status: 'ok',
      version: packageJson.version,
      timestamp: new Date().toISOString(),
      shellEnabled: deps.shellEnabled !== false,
      claudeCli: cachedClaudeCliInfo,
    });
  });

  // Frontend error logging
  router.post('/log/error', (req, res) => {
    const body = req.body as {
      message?: string;
      stack?: string;
      source?: string;
      line?: number;
      column?: number;
      projectId?: string;
      userAgent?: string;
      clientId?: string;
      errorType?: string;
    };

    const loggerWithProject = body.projectId
      ? frontendLogger.withProject(body.projectId)
      : frontendLogger;

    loggerWithProject.error('Frontend error', {
      message: body.message,
      stack: body.stack,
      source: body.source,
      line: body.line,
      column: body.column,
      userAgent: body.userAgent,
      type: 'frontend',
      errorType: body.errorType || 'runtime',
      clientId: body.clientId,
    });

    res.json({ success: true });
  });

  // Dev mode status
  router.get('/dev', (_req, res) => {
    res.json({
      devMode: deps.devMode || false,
    });
  });

  // Shutdown endpoint (only works in dev mode)
  router.post('/dev/shutdown', (_req, res) => {
    if (!deps.devMode) {
      res.status(403).json({ error: 'Shutdown only available in dev mode' });
      return;
    }

    res.json({ message: 'Shutting down...' });

    if (deps.onShutdown) {
      // Give response time to be sent, then trigger shutdown
      setTimeout(() => {
        deps.onShutdown!();
        // Force exit if graceful shutdown takes too long
        setTimeout(() => {
          console.log('Force exiting process...');
          process.exit(0);
        }, 5000);
      }, 100);
    }
  });

  // Agent resource status
  router.get('/agents/status', (_req, res) => {
    const resourceStatus = agentManager.getResourceStatus();
    res.json(resourceStatus);
  });

  // Global logs endpoint (for debug modal)
  router.get('/logs', (req, res) => {
    const limit = req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : 100;
    const logs = getGlobalLogs(limit);
    res.json({ logs });
  });

  // Get all connected clients
  router.get('/debug/clients', (_req, res) => {
    const webSocketServer = getWebSocketServer();
    const projectId = _req.query['projectId'] as string | undefined;

    if (!webSocketServer) {
      res.json([]);
      return;
    }

    const clients = projectId
      ? webSocketServer.getConnectedClients(projectId)
      : webSocketServer.getConnectedClients();

    res.json(clients);
  });

  // Filesystem routes
  const filesystemService = createFilesystemService();
  router.use('/fs', createFilesystemRouter(filesystemService));

  // Settings routes
  const dataWipeService = new DefaultDataWipeService({
    projectRepository,
    dataDirectory: dataDir,
  });

  router.use('/settings', createSettingsRouter({
    settingsRepository,
    dataWipeService,
    onSettingsChange: (event) => {
      if (event.maxConcurrentAgents !== undefined) {
        agentManager.setMaxConcurrentAgents(event.maxConcurrentAgents);
      }

      if (event.appendSystemPromptChanged || event.mcpChanged) {
        // Restart all running agents to apply the new system prompt or MCP changes
        agentManager.restartAllRunningAgents().catch((error) => {
          console.error('Failed to restart agents after settings change:', error);
        });
      }
    },
  }));

  // Integrations
  const githubCLIService = getOrCreateGitHubCLIService();
  router.use('/integrations', createIntegrationsRouter({
    githubCLIService,
    projectService,
    projectRepository,
    broadcast: (message) => {
      const ws = getWebSocketServer();

      if (ws) {
        ws.broadcast(message);
      }
    },
  }));

  // Git service
  const gitService = createGitService();

  // Shell service (singleton for WebSocket integration) - only create if enabled
  const shellEnabled = deps.shellEnabled !== false;
  const shellService = shellEnabled ? getOrCreateShellService() : null;

  // Optimization service
  const optimizationService = getOrCreateOptimizationService(agentManager);

  // Run configuration service, process manager & import service
  const runConfigurationService = getOrCreateRunConfigurationService(projectRepository);
  const runProcessManager = getOrCreateRunProcessManager(runConfigurationService);
  const runConfigImportService = new DefaultRunConfigImportService();

  // Inventify service
  const ralphLoopService = getOrCreateRalphLoopService(projectRepository, settingsRepository);
  const inventifyService = getOrCreateInventifyService(
    agentManager,
    projectService,
    ralphLoopService,
    settingsRepository,
  );

  // Docker routes
  const imageManager = getOrCreateImageManager();
  router.use('/docker', createDockerRouter({
    dockerService,
    containerManager,
    imageManager,
    settingsRepository,
    broadcast: (message) => {
      const ws = getWebSocketServer();

      if (ws) {
        ws.broadcast(message);
      }
    },
  }));

  // Project routes
  router.use('/projects', createProjectsRouter({
    projectRepository,
    projectService,
    roadmapParser,
    roadmapGenerator,
    roadmapEditor,
    agentManager,
    instructionGenerator,
    conversationRepository,
    settingsRepository,
    gitService,
    shellService,
    shellEnabled,
    ralphLoopService,
    projectDiscoveryService: getOrCreateProjectDiscoveryService(projectRepository),
    optimizationService,
    runConfigurationService,
    runProcessManager,
    runConfigImportService,
    inventifyService,
  }));

  return router;
}

interface AgentManagerConfig {
  projectRepository: FileProjectRepository;
  conversationRepository: FileConversationRepository;
  settingsRepository: FileSettingsRepository;
  instructionGenerator: DefaultInstructionGenerator;
  roadmapParser: MarkdownRoadmapParser;
  containerManager?: ContainerManager;
  maxConcurrentAgents?: number;
}

function getOrCreateAgentManager(config: AgentManagerConfig): AgentManager {
  if (!sharedAgentManager) {
    sharedAgentManager = new DefaultAgentManager({
      projectRepository: config.projectRepository,
      conversationRepository: config.conversationRepository,
      settingsRepository: config.settingsRepository,
      instructionGenerator: config.instructionGenerator,
      roadmapParser: config.roadmapParser,
      containerManager: config.containerManager,
      maxConcurrentAgents: config.maxConcurrentAgents,
    });
  }

  return sharedAgentManager;
}

export function getAgentManager(): AgentManager | null {
  return sharedAgentManager;
}

function getOrCreateRoadmapGenerator(): RoadmapGenerator {
  if (!sharedRoadmapGenerator) {
    sharedRoadmapGenerator = new ClaudeRoadmapGenerator();
  }

  return sharedRoadmapGenerator;
}

export function getRoadmapGenerator(): RoadmapGenerator | null {
  return sharedRoadmapGenerator;
}

function getOrCreateShellService(): ShellService {
  if (!sharedShellService) {
    sharedShellService = createShellService();
  }

  return sharedShellService;
}

export function getShellService(): ShellService | null {
  return sharedShellService;
}

function getOrCreateRalphLoopService(projectRepository: FileProjectRepository, settingsRepository?: FileSettingsRepository): RalphLoopService {
  if (!sharedRalphLoopService) {
    const ralphLoopRepository = new FileRalphLoopRepository({
      projectPathResolver: projectRepository,
    });
    sharedRalphLoopService = new DefaultRalphLoopService({
      repository: ralphLoopRepository,
      projectRepository,
      projectPathResolver: projectRepository,
      settingsRepository,
    });
  }
  return sharedRalphLoopService;
}

export function getRalphLoopService(): RalphLoopService | null {
  return sharedRalphLoopService;
}

export function getConversationRepository(): FileConversationRepository | null {
  return sharedConversationRepository;
}

export function getProjectRepository(): FileProjectRepository | null {
  return sharedProjectRepository;
}

export function setWebSocketServer(server: ProjectWebSocketServer): void {
  sharedWebSocketServer = server;
}

export function getWebSocketServer(): ProjectWebSocketServer | null {
  return sharedWebSocketServer;
}

export function getProcessTracker(): unknown {
  // Process tracker is part of the agent manager
  return sharedAgentManager ? (sharedAgentManager as { processTracker?: unknown }).processTracker : null;
}

function getOrCreateProjectDiscoveryService(projectRepository: FileProjectRepository): ProjectDiscoveryService {
  if (!sharedProjectDiscoveryService) {
    const logger = getLogger('project-discovery');
    sharedProjectDiscoveryService = new DefaultProjectDiscoveryService(projectRepository, logger);
  }
  return sharedProjectDiscoveryService;
}

export function getProjectDiscoveryService(): ProjectDiscoveryService | null {
  return sharedProjectDiscoveryService;
}

function getOrCreateGitHubCLIService(): GitHubCLIService {
  if (!sharedGitHubCLIService) {
    sharedGitHubCLIService = createGitHubCLIService();
  }

  return sharedGitHubCLIService;
}

export function getGitHubCLIService(): GitHubCLIService | null {
  return sharedGitHubCLIService;
}

function getOrCreateOptimizationService(
  agentManager: AgentManager
): ClaudeOptimizationService {
  if (!sharedOptimizationService) {
    const logger = getLogger('optimization');
    sharedOptimizationService = new ClaudeOptimizationService(
      logger,
      agentManager
    );
  }
  return sharedOptimizationService;
}

export function getOptimizationService(): ClaudeOptimizationService | null {
  return sharedOptimizationService;
}

function getOrCreateRunConfigurationService(
  projectRepository: FileProjectRepository,
): RunConfigurationService {
  if (!sharedRunConfigurationService) {
    sharedRunConfigurationService = new DefaultRunConfigurationService({
      projectRepository,
    });
  }
  return sharedRunConfigurationService;
}

export function getRunConfigurationService(): RunConfigurationService | null {
  return sharedRunConfigurationService;
}

function getOrCreateRunProcessManager(
  runConfigurationService: RunConfigurationService,
): RunProcessManager {
  if (!sharedRunProcessManager) {
    sharedRunProcessManager = new DefaultRunProcessManager({
      runConfigurationService,
    });
  }
  return sharedRunProcessManager;
}

export function getRunProcessManager(): RunProcessManager | null {
  return sharedRunProcessManager;
}

function getOrCreateInventifyService(
  agentManager: AgentManager,
  projectService: DefaultProjectService,
  ralphLoopService: RalphLoopService,
  settingsRepository: FileSettingsRepository,
): InventifyService {
  if (!sharedInventifyService) {
    const logger = getLogger('inventify');
    sharedInventifyService = new DefaultInventifyService({
      logger,
      agentManager,
      projectService,
      ralphLoopService,
      settingsRepository,
    });
  }
  return sharedInventifyService;
}

export function getInventifyService(): InventifyService | null {
  return sharedInventifyService;
}

function getOrCreateDockerService(): DockerService {
  if (!sharedDockerService) {
    const commandRunner = new DefaultDockerCommandRunner();
    const logger = getLogger('docker');
    sharedDockerService = new DefaultDockerService({ commandRunner, logger });
  }
  return sharedDockerService;
}

export function getDockerService(): DockerService | null {
  return sharedDockerService;
}

function getOrCreateContainerManager(
  dockerService: DockerService,
  settingsRepository: FileSettingsRepository,
): ContainerManager {
  if (!sharedContainerManager) {
    const logger = getLogger('container-manager');
    sharedContainerManager = new DefaultContainerManager({
      dockerService,
      settingsRepository,
      logger,
    });
  }
  return sharedContainerManager;
}

export function getContainerManager(): ContainerManager | null {
  return sharedContainerManager;
}

function getOrCreateImageManager(): ImageManager {
  if (!sharedImageManager) {
    const commandRunner = new DefaultDockerCommandRunner();
    const logger = getLogger('image-manager');
    const variantsDir = path.resolve(__dirname, '../../docker');
    sharedImageManager = new DefaultImageManager({
      commandRunner,
      variantsDir,
      logger,
    });
  }
  return sharedImageManager;
}

export function getImageManager(): ImageManager | null {
  return sharedImageManager;
}

function getOrCreateClaudeCliService(): ClaudeCliService {
  if (!sharedClaudeCliService) {
    sharedClaudeCliService = createClaudeCliService();
  }
  return sharedClaudeCliService;
}

export function getClaudeCliInfo(): ClaudeCliInfo | null {
  return cachedClaudeCliInfo;
}
