import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Logger } from '../utils/logger';
import { ProjectRepository, generateIdFromPath } from '../repositories/project';
import { ProjectStatus } from '../repositories';

export interface ProjectDiscoveryService {
  autoRegisterProject(projectId: string): Promise<ProjectStatus | null>;
  scanForProjects(searchPath: string, maxDepth?: number): Promise<string[]>;
}

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '__pycache__',
  'target',
  'dist',
  'build',
]);

function isSkippedDirectory(name: string): boolean {
  return name.startsWith('.') || SKIPPED_DIRECTORIES.has(name);
}

export class DefaultProjectDiscoveryService implements ProjectDiscoveryService {
  private readonly logger: Logger;

  constructor(
    private readonly projectRepository: ProjectRepository,
    logger: Logger
  ) {
    this.logger = logger;
  }

  async autoRegisterProject(projectId: string): Promise<ProjectStatus | null> {
    try {
      // Try common project locations
      const searchPaths = this.getProjectSearchPaths();

      for (const searchPath of searchPaths) {
        const projectPath = await this.findProjectByIdInPath(projectId, searchPath);

        if (projectPath && await this.isValidProjectDirectory(projectPath)) {
          // Auto-register the project
          const project = await this.projectRepository.create({
            name: path.basename(projectPath),
            path: projectPath
          });

          this.logger.info('Auto-registered project', {
            projectId: project.id,
            path: project.path
          });

          return project;
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Error auto-registering project', { projectId, error });
      return null;
    }
  }

  private async findProjectByIdInPath(projectId: string, searchPath: string): Promise<string | null> {
    const candidates = await this.scanForProjects(searchPath, 3);

    for (const candidatePath of candidates) {
      const candidateId = generateIdFromPath(candidatePath);
      if (candidateId === projectId) {
        return candidatePath;
      }
    }

    return null;
  }

  async scanForProjects(searchPath: string, maxDepth = 3): Promise<string[]> {
    const projects: string[] = [];

    const scan = async (dir: string, depth: number): Promise<void> => {
      if (depth > maxDepth || !fs.existsSync(dir)) return;

      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const fullPath = path.join(dir, entry.name);

          if (isSkippedDirectory(entry.name)) {
            continue;
          }

          // Add all directories as potential projects (remove .claudito check)
          projects.push(fullPath);

          // Still recurse to find nested projects
          await scan(fullPath, depth + 1);
        }
      } catch (error: unknown) {
        // Ignore permission errors and continue scanning
        const errCode = (error as NodeJS.ErrnoException).code;

        if (errCode !== 'EACCES' && errCode !== 'EPERM') {
          this.logger.debug('Error scanning directory', { dir, error });
        }
      }
    };

    await scan(searchPath, 0);
    return projects;
  }

  private getProjectSearchPaths(): string[] {
    const customPaths = process.env.CLAUDITO_PROJECT_PATHS?.split(':') || [];
    const homedir = os.homedir();

    // Common development directories
    const commonPaths = [
      path.join(homedir, 'Development'),
      path.join(homedir, 'Projects'),
      path.join(homedir, 'Documents', 'Projects'),
      path.join(homedir, 'dev'),
      path.join(homedir, 'workspace'),
      path.join(homedir, 'code'),
      path.join(homedir, 'src'),
      // Windows-specific paths
      path.join('D:', 'Development'),
      path.join('C:', 'Development'),
      path.join('D:', 'Projects'),
      path.join('C:', 'Projects'),
    ];

    return [...customPaths, ...commonPaths].filter(p => fs.existsSync(p));
  }

  private async isValidProjectDirectory(projectPath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(projectPath);
      // Only check if it's a directory, don't require .claudito
      return stats.isDirectory();
    } catch {
      return false;
    }
  }
}