import {
  AgentStatus,
  AgentMode,
  AgentMessage,
  WaitingStatus,
  ContextUsage,
  ProcessInfo,
} from './types';

// Re-export types from types file that are part of the public API
export {
  AgentStatus,
  AgentMode,
  ToolUseInfo,
  QuestionInfo,
  PermissionRequest,
  PlanModeInfo,
  ResultInfo,
  StatusChangeInfo,
  AgentMessage,
  WaitingStatus,
  ContextUsage,
  ProcessInfo,
} from './types';

// Export ProcessSpawner type for testing
export { ProcessSpawner } from './process-manager';

export interface Agent {
  readonly projectId: string;
  readonly status: AgentStatus;
  readonly mode: AgentMode;
  readonly lastCommand: string | null;
  readonly processInfo: ProcessInfo | null;
  readonly collectedOutput: string;
  readonly contextUsage: ContextUsage | null;
  readonly queuedMessageCount: number;
  readonly queuedMessages: string[];
  readonly isWaitingForInput: boolean;
  readonly waitingVersion: number;
  readonly sessionId: string | null;
  readonly sessionError: string | null;
  readonly permissionMode: 'acceptEdits' | 'plan' | null;
  start(instructions: string): void;
  stop(): Promise<void>;
  sendInput(input: string): void;
  sendToolResult(toolUseId: string, content: string): void;
  removeQueuedMessage(index: number): boolean;
  on<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): void;
  off<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): void;
}

export interface AgentEvents {
  message: (message: AgentMessage) => void;
  status: (status: AgentStatus) => void;
  exit: (code: number | null) => void;
  waitingForInput: (status: WaitingStatus) => void;
  sessionNotFound: (sessionId: string) => void;
  exitPlanMode: (planContent: string) => void;
  enterPlanMode: () => void;
}

export interface PermissionConfig {
  skipPermissions: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: 'acceptEdits' | 'plan';
  appendSystemPrompt?: string;
}

export interface AgentLimits {
  /** Maximum number of agentic turns before stopping (print mode only) */
  maxTurns?: number;
  /** Maximum context tokens to use */
  contextTokens?: number;
  /** Total budget in USD */
  totalBudget?: number;
}

export interface AgentStreamingOptions {
  /** Include partial streaming events in output (requires stream-json output) */
  includePartialMessages?: boolean;
  /** Disable session persistence - sessions won't be saved to disk */
  noSessionPersistence?: boolean;
  /** Cache anything for improved performance */
  cacheAnything?: boolean;
}
