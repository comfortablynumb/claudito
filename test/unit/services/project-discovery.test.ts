import path from 'path';
import os from 'os';
import { DefaultProjectDiscoveryService } from '../../../src/services/project-discovery';
import { ProjectRepository, ProjectStatus } from '../../../src/repositories/project';
import { Logger } from '../../../src/utils/logger';
import { createMockProjectRepository } from '../helpers/mock-factories';

// ---------------------------------------------------------------------------
// Stable mock functions declared before jest.mock factory so they are in scope
// ---------------------------------------------------------------------------
const mockExistsSync = jest.fn();
const mockReaddir = jest.fn();
const mockStat = jest.fn();

jest.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  promises: {
    readdir: (...args: unknown[]) => mockReaddir(...args),
    stat: (...args: unknown[]) => mockStat(...args),
  },
}));

jest.mock('os');
jest.mock('../../../src/repositories/project', () => ({
  ...jest.requireActual('../../../src/repositories/project'),
  generateIdFromPath: jest.fn(),
}));

import { generateIdFromPath } from '../../../src/repositories/project';
import fs from 'fs';

const mockOs = os as jest.Mocked<typeof os>;
const mockGenerateIdFromPath = generateIdFromPath as jest.MockedFunction<typeof generateIdFromPath>;

const mockLogger: Logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  withProject: jest.fn().mockReturnThis(),
} as unknown as Logger;

function makeProjectStatus(id: string, projectPath: string): ProjectStatus {
  return {
    id,
    name: 'Test Project',
    path: projectPath,
    status: 'stopped',
    currentConversationId: null,
    nextItem: null,
    currentItem: null,
    lastContextUsage: null,
    permissionOverrides: null,
    modelOverride: null,
    mcpOverrides: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeDirent(name: string, isDir: boolean): fs.Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as fs.Dirent;
}

// Use path.join for all paths so tests are platform-agnostic
const BASE = path.join(path.sep, 'base');
const HOME = path.join(path.sep, 'home', 'user');
const DEV_DIR = path.join(HOME, 'Development');
const PROJECTS_DIR = path.join(HOME, 'Projects');

describe('DefaultProjectDiscoveryService', () => {
  let service: DefaultProjectDiscoveryService;
  let mockProjectRepository: jest.Mocked<ProjectRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOs.homedir.mockReturnValue(HOME);
    mockExistsSync.mockReturnValue(false);
    mockProjectRepository = createMockProjectRepository([]);
    service = new DefaultProjectDiscoveryService(mockProjectRepository, mockLogger);
  });

  // ---------------------------------------------------------------------------
  // scanForProjects
  // ---------------------------------------------------------------------------

  describe('scanForProjects', () => {
    it('returns empty array when search path does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await service.scanForProjects(path.join(BASE, 'nonexistent'));

      expect(result).toEqual([]);
    });

    it('returns directories found at root level', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddir.mockResolvedValue([
        makeDirent('my-project', true),
        makeDirent('other-project', true),
      ]);

      const result = await service.scanForProjects(PROJECTS_DIR, 0);

      expect(result).toEqual([
        path.join(PROJECTS_DIR, 'my-project'),
        path.join(PROJECTS_DIR, 'other-project'),
      ]);
    });

    it('recurses into subdirectories up to maxDepth', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddir
        .mockResolvedValueOnce([makeDirent('project-a', true)])
        .mockResolvedValueOnce([makeDirent('sub-project', true)])
        .mockResolvedValueOnce([]);

      const result = await service.scanForProjects(BASE, 2);

      expect(result).toContain(path.join(BASE, 'project-a'));
      expect(result).toContain(path.join(BASE, 'project-a', 'sub-project'));
    });

    it('skips hidden directories (dot-prefixed)', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddir.mockResolvedValue([
        makeDirent('.git', true),
        makeDirent('.claudito', true),
        makeDirent('visible', true),
      ]);

      const result = await service.scanForProjects(BASE, 0);

      expect(result).toEqual([path.join(BASE, 'visible')]);
    });

    it('skips node_modules, __pycache__, target, dist, build', async () => {
      const skipped = ['node_modules', '__pycache__', 'target', 'dist', 'build'];
      mockExistsSync.mockReturnValue(true);
      mockReaddir.mockResolvedValue([
        ...skipped.map(n => makeDirent(n, true)),
        makeDirent('src', true),
      ]);

      const result = await service.scanForProjects(BASE, 0);

      expect(result).toEqual([path.join(BASE, 'src')]);
    });

    it('ignores non-directory entries', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddir.mockResolvedValue([
        makeDirent('README.md', false),
        makeDirent('package.json', false),
        makeDirent('src', true),
      ]);

      const result = await service.scanForProjects(BASE, 0);

      expect(result).toEqual([path.join(BASE, 'src')]);
    });

    it('stops recursing beyond maxDepth', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddir
        .mockResolvedValueOnce([makeDirent('level1', true)])
        .mockResolvedValueOnce([makeDirent('level2', true)]);

      const result = await service.scanForProjects(BASE, 1);

      expect(result).toContain(path.join(BASE, 'level1'));
      expect(result).toContain(path.join(BASE, 'level1', 'level2'));
      // readdir called twice: BASE then level1; level2 is beyond maxDepth
      expect(mockReaddir).toHaveBeenCalledTimes(2);
    });

    it('silently skips EACCES permission errors', async () => {
      mockExistsSync.mockReturnValue(true);
      const permError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      mockReaddir.mockRejectedValue(permError);

      const result = await service.scanForProjects(BASE, 0);

      expect(result).toEqual([]);
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it('silently skips EPERM permission errors', async () => {
      mockExistsSync.mockReturnValue(true);
      const permError = Object.assign(new Error('EPERM'), { code: 'EPERM' });
      mockReaddir.mockRejectedValue(permError);

      const result = await service.scanForProjects(BASE, 0);

      expect(result).toEqual([]);
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it('logs debug for non-permission errors', async () => {
      mockExistsSync.mockReturnValue(true);
      const genericError = Object.assign(new Error('EIO'), { code: 'EIO' });
      mockReaddir.mockRejectedValue(genericError);

      await service.scanForProjects(BASE, 0);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Error scanning directory',
        expect.objectContaining({ dir: BASE }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // autoRegisterProject
  // ---------------------------------------------------------------------------

  describe('autoRegisterProject', () => {
    it('returns null when no search paths exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await service.autoRegisterProject('some_id');

      expect(result).toBeNull();
      expect(mockProjectRepository.create).not.toHaveBeenCalled();
    });

    it('returns null when no candidate matches the project id', async () => {
      mockExistsSync.mockImplementation(p => p === DEV_DIR);
      mockReaddir.mockResolvedValue([makeDirent('other-project', true)]);
      mockGenerateIdFromPath.mockReturnValue('different_id');

      const result = await service.autoRegisterProject('target_id');

      expect(result).toBeNull();
    });

    it('creates and returns project when matching candidate is found', async () => {
      const projectPath = path.join(DEV_DIR, 'my-app');
      const expectedProject = makeProjectStatus('my_app_id', projectPath);

      mockExistsSync.mockImplementation(p => p === DEV_DIR);
      mockReaddir.mockResolvedValue([makeDirent('my-app', true)]);
      mockGenerateIdFromPath.mockImplementation((p: string) =>
        p === projectPath ? 'my_app_id' : 'other_id',
      );
      mockStat.mockResolvedValue({ isDirectory: () => true });
      mockProjectRepository.create.mockResolvedValue(expectedProject);

      const result = await service.autoRegisterProject('my_app_id');

      expect(mockProjectRepository.create).toHaveBeenCalledWith({
        name: 'my-app',
        path: projectPath,
      });
      expect(result).toEqual(expectedProject);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Auto-registered project',
        expect.objectContaining({ projectId: expectedProject.id }),
      );
    });

    it('returns null when matching path is not a directory according to stat', async () => {
      mockExistsSync.mockImplementation(p => p === DEV_DIR);
      mockReaddir.mockResolvedValue([makeDirent('my-app', true)]);
      mockGenerateIdFromPath.mockReturnValue('my_app_id');
      mockStat.mockResolvedValue({ isDirectory: () => false });

      const result = await service.autoRegisterProject('my_app_id');

      expect(result).toBeNull();
      expect(mockProjectRepository.create).not.toHaveBeenCalled();
    });

    it('returns null when stat throws (path not accessible)', async () => {
      mockExistsSync.mockImplementation(p => p === DEV_DIR);
      mockReaddir.mockResolvedValue([makeDirent('my-app', true)]);
      mockGenerateIdFromPath.mockReturnValue('target_id');
      mockStat.mockRejectedValue(new Error('ENOENT'));

      const result = await service.autoRegisterProject('target_id');

      expect(result).toBeNull();
      expect(mockProjectRepository.create).not.toHaveBeenCalled();
    });

    it('returns null and logs error when repository.create throws', async () => {
      mockExistsSync.mockImplementation(p => p === DEV_DIR);
      mockReaddir.mockResolvedValue([makeDirent('my-app', true)]);
      mockGenerateIdFromPath.mockReturnValue('my_app_id');
      mockStat.mockResolvedValue({ isDirectory: () => true });
      mockProjectRepository.create.mockRejectedValue(new Error('Already exists'));

      const result = await service.autoRegisterProject('my_app_id');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error auto-registering project',
        expect.objectContaining({ projectId: 'my_app_id' }),
      );
    });

    it('uses CLAUDITO_PROJECT_PATHS env var as extra search roots', async () => {
      const envPath = path.join(path.sep, 'custom', 'path');
      process.env.CLAUDITO_PROJECT_PATHS = envPath;

      try {
        mockExistsSync.mockImplementation(p => p === envPath);
        mockReaddir.mockResolvedValue([makeDirent('project-x', true)]);
        mockGenerateIdFromPath.mockReturnValue('custom_id');
        mockStat.mockResolvedValue({ isDirectory: () => true });

        const expectedProject = makeProjectStatus(
          'custom_id',
          path.join(envPath, 'project-x'),
        );
        mockProjectRepository.create.mockResolvedValue(expectedProject);

        const result = await service.autoRegisterProject('custom_id');

        expect(result).toEqual(expectedProject);
      } finally {
        delete process.env.CLAUDITO_PROJECT_PATHS;
      }
    });

    it('stops after first match and does not scan further search paths', async () => {
      const projectPath = path.join(DEV_DIR, 'my-app');

      // DEV_DIR is the first common path; PROJECTS_DIR is the second
      mockExistsSync.mockImplementation(p => p === DEV_DIR || p === PROJECTS_DIR);
      // Only one readdir response — match found in the first search path
      mockReaddir.mockResolvedValueOnce([makeDirent('my-app', true)]);
      mockGenerateIdFromPath.mockReturnValue('my_app_id');
      mockStat.mockResolvedValue({ isDirectory: () => true });

      const expectedProject = makeProjectStatus('my_app_id', projectPath);
      mockProjectRepository.create.mockResolvedValue(expectedProject);

      await service.autoRegisterProject('my_app_id');

      expect(mockProjectRepository.create).toHaveBeenCalledTimes(1);
    });
  });
});
