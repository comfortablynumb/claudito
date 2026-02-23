/**
 * Shared types for Claude agent modules.
 */

export interface ToolUseInfo {
  id?: string;
  name: string;
  input?: Record<string, unknown>;
  output?: string;
  status?: 'running' | 'completed' | 'failed';
  error?: string;
}

export interface QuestionInfo {
  question: string;
  options: Array<{ label: string; value: string; description?: string }>;
}

export interface PermissionRequest {
  tool: string;
  operation?: string;
  action?: string;
  reason: string;
  allowOnce?: boolean;
  allowAlways?: boolean;
  deny?: boolean;
  details?: Record<string, unknown>;
}

export interface PlanModeInfo {
  action: 'enter' | 'exit';
  planContent?: string;
}

export interface ResultInfo {
  result?: string;
  isError: boolean;
}

export interface StatusChangeInfo {
  status: string;
}

export interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  maxContextTokens: number;
  percentUsed: number;
}

export interface AskUserQuestionData {
  toolId: string;
  questions: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

export interface WaitingStatus {
  isWaiting: boolean;
  version: number;
  askUserQuestion?: AskUserQuestionData;
}

export interface AgentMessage {
  type: 'stdout' | 'stderr' | 'system' | 'tool_use' | 'tool_result' | 'user' | 'question' | 'permission' | 'plan_mode' | 'compaction' | 'result' | 'status_change';
  content: string;
  timestamp: string;
  hidden?: boolean; // If true, message should not be displayed in UI
  toolInfo?: ToolUseInfo;
  questionInfo?: QuestionInfo;
  permissionInfo?: PermissionRequest;
  planModeInfo?: PlanModeInfo;
  resultInfo?: ResultInfo;
  statusChangeInfo?: StatusChangeInfo;
  ralphLoopPhase?: 'worker' | 'reviewer';
  source?: 'browser' | 'slack';
  slackUsername?: string;
}

export interface ProcessInfo {
  pid: number;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  startTime?: Date;
  cwd?: string;
  startedAt?: string;
}

export type AgentStatus = 'stopped' | 'running' | 'error';
export type AgentMode = 'autonomous' | 'interactive';