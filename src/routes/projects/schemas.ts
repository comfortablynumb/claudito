import { z } from 'zod';

// Core project schemas
export const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(255),
  path: z.string().min(1, 'Project path is required'),
  createNew: z.preprocess(
    (val) => {
      if (typeof val === 'string') return val === 'true';
      return val;
    },
    z.boolean().optional(),
  ),
});

export const updatePermissionsSchema = z.object({
  enabled: z.boolean(),
  allowRules: z.array(z.string()).optional(),
  denyRules: z.array(z.string()).optional(),
  defaultMode: z.enum(['acceptEdits', 'plan']).optional(),
});

export const updateModelSchema = z.object({
  model: z.string().nullable(),
});

export const updateMcpOverridesSchema = z.object({
  enabled: z.boolean(),
  serverOverrides: z.record(z.string(), z.object({
    enabled: z.boolean(),
  })).optional(),
});

export const saveClaudeFileSchema = z.object({
  filePath: z.string().min(1, 'File path is required'),
  content: z.string(),
});

// Roadmap schemas
export const roadmapPromptSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
});

export const roadmapRespondSchema = z.object({
  response: z.string().min(1, 'Response is required'),
});

export const deleteTaskSchema = z.object({
  phaseId: z.string().min(1),
  milestoneId: z.string().min(1),
  taskIndex: z.number().int().min(0),
});

export const deleteMilestoneSchema = z.object({
  phaseId: z.string().min(1),
  milestoneId: z.string().min(1),
});

export const deletePhaseSchema = z.object({
  phaseId: z.string().min(1),
});

export const addTaskSchema = z.object({
  phaseId: z.string().min(1),
  milestoneId: z.string().min(1),
  taskTitle: z.string().min(1, 'Task title is required'),
});

export const nextItemSchema = z.object({
  phaseId: z.string().nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  itemIndex: z.number().int().min(0).nullable().optional(),
  taskTitle: z.string().optional(),
});

// Agent schemas
const imageSchema = z.object({
  type: z.string(),
  data: z.string(),
});

export const agentMessageSchema = z.object({
  message: z.string().optional(),
  images: z.array(imageSchema).optional(),
  sessionId: z.string().optional(),
  permissionMode: z.enum(['acceptEdits', 'plan']).optional(),
});

export const agentSendMessageSchema = z.object({
  message: z.string().min(1, 'Message is required').optional(),
  images: z.array(imageSchema).optional(),
  planFeedback: z.boolean().optional(),
}).refine((data) => data.message || (data.images && data.images.length > 0), {
  message: 'Either message or images must be provided',
});

// Conversation schemas
export const renameConversationSchema = z.object({
  label: z.string().min(1, 'Label is required').max(255),
});

export const setCurrentConversationSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
});

// Shell schemas
export const shellInputSchema = z.object({
  input: z.string().min(1, 'Input is required'),
});

export const shellResizeSchema = z.object({
  cols: z.number().int().min(1),
  rows: z.number().int().min(1),
});

// Ralph Loop schemas
export const ralphLoopStartSchema = z.object({
  taskDescription: z.string().min(1, 'Task description is required'),
  maxTurns: z.number().int().min(1).max(100).optional(),
  workerModel: z.string().optional(),
  reviewerModel: z.string().optional(),
});

// Git schemas
export const gitStageSchema = z.object({
  paths: z.array(z.string()).min(1, 'Paths array is required'),
});

export const gitCommitSchema = z.object({
  message: z.string().min(1, 'Commit message is required'),
});

export const gitBranchSchema = z.object({
  name: z.string().min(1, 'Branch name is required'),
  checkout: z.boolean().optional(),
});

export const gitCheckoutSchema = z.object({
  branch: z.string().min(1, 'Branch name is required'),
});

export const gitPushSchema = z.object({
  remote: z.string().default('origin'),
  branch: z.string().optional(),
  setUpstream: z.boolean().optional(),
});

export const gitPullSchema = z.object({
  remote: z.string().default('origin'),
  branch: z.string().optional(),
  rebase: z.boolean().optional(),
});

export const gitTagSchema = z.object({
  name: z.string().min(1, 'Tag name is required'),
  message: z.string().optional(),
});

export const gitPushTagSchema = z.object({
  remote: z.string().default('origin'),
});

// Inventify schemas
export const inventifyStartSchema = z.object({
  projectTypes: z.array(z.string()).min(1, 'At least one project type is required'),
  themes: z.array(z.string()).min(1, 'At least one theme is required'),
  languages: z.array(z.string()).optional().default([]),
  technologies: z.array(z.string()).optional().default([]),
  customPrompt: z.string().optional().default(''),
});

export const inventifySuggestNamesSchema = z.object({
  selectedIndex: z.number().int().min(0).max(4),
});

export const inventifySelectSchema = z.object({
  selectedIndex: z.number().int().min(0).max(4),
  projectName: z.string().min(1).max(100).regex(
    /^[a-z0-9-]+$/,
    'Project name must be lowercase with hyphens and numbers only',
  ),
});

export const inventifyCompleteBuildSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
});

// Run Configuration schemas
export const createRunConfigSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  command: z.string().min(1, 'Command is required'),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  shell: z.string().nullable().optional(),
  autoRestart: z.boolean().optional(),
  autoRestartDelay: z.number().int().min(100).max(60000).optional(),
  autoRestartMaxRetries: z.number().int().min(0).max(100).optional(),
  preLaunchConfigId: z.string().nullable().optional(),
});

export const updateRunConfigSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  shell: z.string().nullable().optional(),
  autoRestart: z.boolean().optional(),
  autoRestartDelay: z.number().int().min(100).max(60000).optional(),
  autoRestartMaxRetries: z.number().int().min(0).max(100).optional(),
  preLaunchConfigId: z.string().nullable().optional(),
});

export const projectAndConfigIdSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
  configId: z.string().min(1, 'Config ID is required'),
});

// Query parameter schemas
export const listConversationsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
});

export const searchConversationsQuerySchema = z.object({
  q: z.string().min(2, 'Query must be at least 2 characters'),
});

export const getConversationQuerySchema = z.object({
  conversationId: z.string().optional(),
});

export const fileDiffQuerySchema = z.object({
  path: z.string().min(1, 'File path is required'),
});

// Parameter schemas
export const projectIdSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
});

export const conversationIdSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
});

export const taskIdSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
});

export const projectAndTaskIdSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
  taskId: z.string().min(1, 'Task ID is required'),
});

export const tagNameSchema = z.object({
  name: z.string().min(1, 'Tag name is required'),
});

export const projectAndTagNameSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
  name: z.string().min(1, 'Tag name is required'),
});

export const queueIndexSchema = z.object({
  index: z.string().regex(/^\d+$/).transform(Number),
});

export const projectAndQueueIndexSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
  index: z.string().regex(/^\d+$/).transform(Number),
});

export const projectAndConversationIdSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
  conversationId: z.string().min(1, 'Conversation ID is required'),
});