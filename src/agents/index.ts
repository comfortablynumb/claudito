export * from './claude-agent';
export { CommandEntry } from './types';
export {
  AgentManager,
  AgentManagerEvents,
  AgentFactory,
  AgentManagerDependencies,
  DefaultAgentManager,
  AgentResourceStatus,
  ImageData,
  FullAgentStatus,
  StartAgentResult,
  OneOffAgentOptions,
  OneOffMeta,
  ActiveOneOffAgent,
  OneOffCommandEntry,
} from './agent-manager';

// Export from new modules
export {
  QueuedProject,
  AgentQueueEvents,
  AgentQueue,
} from './agent-queue';

export {
  SessionRecoveryResult,
  SessionManagerEvents,
  SessionManager,
} from './session-manager';

export {
  MilestoneRef,
  LoopConfig,
  LoopState,
  AgentLoopState,
  AgentCompletionResponse,
  AutonomousLoopEvents,
  AutonomousLoopOrchestrator,
} from './autonomous-loop-orchestrator';

export {
  TrackedProcessInfo,
  OrphanCleanupResult,
  ProcessTracker,
} from './process-tracker';
