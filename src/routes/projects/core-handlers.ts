import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { NotFoundError, ValidationError, getProjectLogs } from '../../utils';
import { isPathWithinProject } from '../../utils/path-validator';
import { getAgentManager, getProcessTracker, getRalphLoopService, getWebSocketServer } from '../index';
import { generateIdFromPath } from '../../repositories';
import {
  ProjectRouterDependencies,
  DebugInfo,
  MemoryUsage,
  ClaudeFileSaveBody,
} from './types';

export function handleDiscoverProjects(deps: ProjectRouterDependencies) {
  const { projectRepository, projectDiscoveryService } = deps;

  return async (req: Request, res: Response): Promise<void> => {
    const { searchPath } = req.body as { searchPath?: string };

    if (!searchPath || typeof searchPath !== 'string') {
      throw new ValidationError('Search path is required');
    }

    if (!fs.existsSync(searchPath)) {
      throw new ValidationError('Search path does not exist');
    }

    if (!projectDiscoveryService) {
      throw new NotFoundError('Project discovery service not available');
    }

    const discovered = await projectDiscoveryService.scanForProjects(searchPath);
    const result = await registerDiscoveredProjects(projectRepository, discovered);
    res.json(result);
  };
}

async function registerDiscoveredProjects(
  projectRepository: ProjectRouterDependencies['projectRepository'],
  discovered: string[]
) {
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

  return {
    discovered: discovered.length,
    registered: registered.length,
    alreadyRegistered: alreadyRegistered.length,
    failed: failed.length,
    projects: registered
  };
}

export function handleGetDebugInfo() {
  return async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const debugInfo = await buildDebugInfo(id);
    res.json(debugInfo);
  };
}

async function buildDebugInfo(id: string): Promise<DebugInfo> {
  const agentManager = getAgentManager();
  const processTracker = getProcessTracker();
  const ralphLoopService = getRalphLoopService();
  const webSocketServer = getWebSocketServer();

  const processInfo = agentManager?.getProcessInfo(id);
  const debugInfo: DebugInfo = {
    lastCommand: agentManager?.getLastCommand(id) ?? null,
    cliCommands: agentManager?.getCliCommandHistory(id) ?? [],
    processInfo: processInfo ? {
      pid: processInfo.pid,
      cwd: processInfo.cwd || '',
      startedAt: processInfo.startedAt || '',
    } : null,
    loopState: agentManager?.getLoopState(id) ?? null,
    recentLogs: getProjectLogs(id, 100),
    trackedProcesses: extractTrackedProcesses(processTracker),
    memoryUsage: process.memoryUsage() as MemoryUsage,
  };

  if (webSocketServer) {
    debugInfo.connectedClients = webSocketServer.getConnectedClients(id);
  }

  if (ralphLoopService) {
    debugInfo.ralphLoops = await buildRalphLoopDebugInfo(ralphLoopService, id);
  }

  return debugInfo;
}

function extractTrackedProcesses(processTracker: unknown): Array<{ pid: number; projectId: string; startedAt: string }> {
  if (processTracker && typeof processTracker === 'object' && 'getAllProcesses' in processTracker && typeof processTracker.getAllProcesses === 'function') {
    return processTracker.getAllProcesses() as Array<{ pid: number; projectId: string; startedAt: string }>;
  }
  return [];
}

async function buildRalphLoopDebugInfo(ralphLoopService: { listByProject: (id: string) => Promise<Array<{ taskId: string; status: string; currentIteration: number }>> }, id: string) {
  const ralphLoops = await ralphLoopService.listByProject(id);
  return {
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

export function handleSaveClaudeFile() {
  return async (req: Request, res: Response): Promise<void> => {
    const project = req.project!;
    const body = req.body as ClaudeFileSaveBody;
    const { filePath, content } = body;

    validateClaudeFilePath(filePath!, (project).path);

    const dir = path.dirname(filePath!);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath!, content!, 'utf-8');

    res.json({
      success: true,
      filePath,
      size: Buffer.byteLength(content!, 'utf-8'),
    });
  };
}

function validateClaudeFilePath(filePath: string, projectPath: string): void {
  const fileName = path.basename(filePath);

  if (fileName !== 'CLAUDE.md') {
    throw new ValidationError('Can only edit CLAUDE.md files');
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const globalClaudePath = path.join(homeDir, '.claude', 'CLAUDE.md');
  const isGlobalFile = path.resolve(filePath) === path.resolve(globalClaudePath);

  if (isGlobalFile) return;

  const allowedPaths = [
    path.join(projectPath, 'CLAUDE.md'),
    path.join(projectPath, '.claude', 'CLAUDE.md'),
  ];

  const resolvedPath = path.resolve(filePath);
  const isAllowed = allowedPaths.some(allowed => resolvedPath === path.resolve(allowed));

  if (!isAllowed) {
    throw new ValidationError('Invalid file path');
  }

  if (!isPathWithinProject(resolvedPath, projectPath)) {
    throw new ValidationError('File path is outside project directory');
  }
}
