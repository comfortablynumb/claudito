import { MilestoneRef, ImageData } from '../../agents';
import {
  ProjectRepository,
  ConversationRepository,
  SettingsRepository,
} from '../../repositories';
import {
  ProjectService,
  RoadmapParser,
  RoadmapGenerator,
  InstructionGenerator,
  RoadmapEditor,
  ShellService
} from '../../services';
import { GitService } from '../../services/git-service';
import { AgentManager } from '../../agents';
import { RalphLoopService } from '../../services/ralph-loop/types';
import { ConnectedClient } from '../../websocket/websocket-server';
import { ProjectDiscoveryService } from '../../services/project-discovery';
import { ClaudeOptimizationService, RunConfigurationService, RunConfigImportService, InventifyService } from '../../services';
import { RunProcessManager } from '../../services/run-config/run-process-types';

// Router dependencies interface
export interface ProjectRouterDependencies {
  projectRepository: ProjectRepository;
  projectService: ProjectService;
  roadmapParser: RoadmapParser;
  roadmapGenerator: RoadmapGenerator;
  roadmapEditor: RoadmapEditor;
  agentManager: AgentManager;
  instructionGenerator: InstructionGenerator;
  conversationRepository: ConversationRepository;
  settingsRepository: SettingsRepository;
  gitService: GitService;
  shellService?: ShellService | null;
  shellEnabled?: boolean;
  ralphLoopService?: RalphLoopService | null;
  projectDiscoveryService?: ProjectDiscoveryService | null;
  optimizationService?: ClaudeOptimizationService;
  runConfigurationService?: RunConfigurationService;
  runProcessManager?: RunProcessManager;
  runConfigImportService?: RunConfigImportService;
  inventifyService?: InventifyService;
}

// Request body interfaces
export interface CreateProjectBody {
  name?: string;
  path?: string;
  createNew?: boolean;
}

export interface RoadmapPromptBody {
  prompt?: string;
}

export interface DeleteTaskBody {
  phaseId?: string;
  milestoneId?: string;
  taskIndex?: number;
}

export interface DeleteMilestoneBody {
  phaseId?: string;
  milestoneId?: string;
}

export interface DeletePhaseBody {
  phaseId?: string;
}

export interface AddTaskBody {
  phaseId?: string;
  milestoneId?: string;
  taskTitle?: string;
}

export interface RoadmapRespondBody {
  response?: string;
}

export interface NextItemBody {
  phaseId?: string;
  milestoneId?: string;
  itemIndex?: number;
  taskTitle?: string;
}

export interface AgentMessageBody {
  message?: string;
  images?: ImageData[];
  sessionId?: string;
  permissionMode?: 'acceptEdits' | 'plan';
  planFeedback?: boolean;
}

export interface RenameConversationBody {
  label?: string;
}

export interface ClaudeFileSaveBody {
  filePath?: string;
  content?: string;
}

export interface PermissionOverridesBody {
  enabled?: boolean;
  allowRules?: string[];
  denyRules?: string[];
  defaultMode?: 'acceptEdits' | 'plan';
}

export interface McpOverridesBody {
  enabled?: boolean;
  serverOverrides?: {
    [serverId: string]: {
      enabled: boolean;
    };
  };
}

export interface GitStageBody {
  paths?: string[];
}

export interface GitCommitBody {
  message?: string;
}

export interface GitBranchBody {
  name?: string;
  checkout?: boolean;
}

export interface GitCheckoutBody {
  branch?: string;
}

export interface GitPushBody {
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
}

export interface GitPullBody {
  remote?: string;
  branch?: string;
  rebase?: boolean;
}

export interface GitTagBody {
  name: string;
  message?: string;
}

export interface GitPushTagBody {
  remote?: string;
}

export interface ShellInputBody {
  input?: string;
}

export interface ShellResizeBody {
  cols?: number;
  rows?: number;
}

export interface RalphLoopStartBody {
  taskDescription?: string;
  maxTurns?: number;
  workerModel?: string;
  reviewerModel?: string;
}

export interface ModelOverrideBody {
  model?: string | null;
}

export interface InventifyStartBody {
  projectTypes?: string[];
  themes?: string[];
}

// Response/shared types
export interface ConversationStats {
  messageCount: number;
  toolCallCount: number;
  userMessageCount: number;
  durationMs: number | null;
  startedAt: string | null;
}

export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
}

export interface DebugInfo {
  lastCommand: string | null;
  cliCommands: Array<{ label: string; command: string; timestamp: string }>;
  processInfo: {
    pid: number;
    cwd: string;
    startedAt: string;
  } | null;
  loopState: {
    isLooping: boolean;
    currentMilestone: MilestoneRef | null;
    currentConversationId: string | null;
  } | null;
  recentLogs: Array<{
    level: string;
    message: string;
    timestamp: string;
    context?: Record<string, unknown>;
  }>;
  trackedProcesses: Array<{
    pid: number;
    projectId: string;
    startedAt: string;
  }>;
  memoryUsage: MemoryUsage;
  connectedClients?: ConnectedClient[];
  ralphLoops?: {
    count: number;
    activeLoops: Array<{
      taskId: string;
      status: string;
      currentTurn: number;
    }>;
  };
}

export interface OptimizationCheck {
  id: string;
  title: string;
  description: string;
  status: 'passed' | 'warning' | 'info';
  statusMessage: string;
  filePath: string;
  action?: 'create' | 'edit' | 'claude-files';
  actionLabel?: string;
}

export interface ClaudeFile {
  path: string;
  name: string;
  content: string;
  size: number;
  isGlobal: boolean;
}