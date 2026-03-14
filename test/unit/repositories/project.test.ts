import path from 'path';
import {
  FileProjectRepository,
  FileSystem,
  MilestoneItemRef,
  generateIdFromPath,
  ProjectIndexEntryWithPath,
  ProjectStatus,
} from '../../../src/repositories/project';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function createMockFileSystem(): FileSystem & {
  files: Map<string, string>;
  dirs: Set<string>;
} {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  return {
    files,
    dirs,
    readFileSync: jest.fn((filePath: string) => {
      const normalized = normalizePath(filePath);
      const content = files.get(normalized);

      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory: ${filePath}`);
      }

      return content;
    }),
    writeFileSync: jest.fn((filePath: string, data: string) => {
      files.set(normalizePath(filePath), data);
    }),
    existsSync: jest.fn((filePath: string) => {
      const normalized = normalizePath(filePath);
      return files.has(normalized) || dirs.has(normalized);
    }),
    mkdirSync: jest.fn((dirPath: string) => {
      dirs.add(normalizePath(dirPath));
    }),
    rmdirSync: jest.fn((dirPath: string) => {
      const normalized = normalizePath(dirPath);
      dirs.delete(normalized);
      const prefix = normalized.endsWith('/') ? normalized : normalized + '/';

      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          files.delete(key);
        }
      }
    }),
    renameSync: jest.fn((oldPath: string, newPath: string) => {
      const normalizedOld = normalizePath(oldPath);
      const normalizedNew = normalizePath(newPath);
      const content = files.get(normalizedOld);

      if (content !== undefined) {
        files.delete(normalizedOld);
        files.set(normalizedNew, content);
      }
    }),
  };
}

describe('generateIdFromPath', () => {
  it('should replace non-alphanumeric characters with underscores', () => {
    expect(generateIdFromPath('/home/user/project')).toBe('_home_user_project');
    expect(generateIdFromPath('C:\\Users\\test')).toBe('C__Users_test');
    expect(generateIdFromPath('my-project.name')).toBe('my_project_name');
  });

  it('should preserve alphanumeric characters', () => {
    expect(generateIdFromPath('project123')).toBe('project123');
    expect(generateIdFromPath('MyProject')).toBe('MyProject');
  });
});

describe('FileProjectRepository', () => {
  let mockFs: ReturnType<typeof createMockFileSystem>;
  let repository: FileProjectRepository;
  const dataDir = '/data';
  const projectsDir = normalizePath(path.join(dataDir, 'projects'));
  const indexPath = normalizePath(path.join(projectsDir, 'index.json'));

  beforeEach(() => {
    mockFs = createMockFileSystem();
    repository = new FileProjectRepository(dataDir, mockFs);
  });

  describe('constructor', () => {
    it('should create projects directory if it does not exist', () => {
      expect(mockFs.dirs.has(projectsDir)).toBe(true);
    });

    it('should not create projects directory if it exists', () => {
      const fs = createMockFileSystem();
      fs.dirs.add(projectsDir);
      new FileProjectRepository(dataDir, fs);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should load existing index file', () => {
      const fs = createMockFileSystem();
      fs.dirs.add(projectsDir);
      fs.files.set(indexPath, JSON.stringify([{ id: 'test', name: 'Test' }]));
      new FileProjectRepository(dataDir, fs);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(fs.readFileSync).toHaveBeenCalled();
    });

    it('should handle corrupted index file gracefully', () => {
      const fs = createMockFileSystem();
      fs.dirs.add(projectsDir);
      fs.files.set(indexPath, 'not valid json');

      expect(() => new FileProjectRepository(dataDir, fs)).not.toThrow();
    });
  });

  describe('create', () => {
    it('should create a new project with correct properties', async () => {
      const project = await repository.create({
        name: 'Test Project',
        path: '/path/to/project',
      });

      expect(project.id).toBe('_path_to_project');
      expect(project.name).toBe('Test Project');
      expect(project.path).toBe('/path/to/project');
      expect(project.status).toBe('stopped');
      expect(project.currentConversationId).toBeNull();
      expect(project.nextItem).toBeNull();
      expect(project.currentItem).toBeNull();
      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBeDefined();
    });

    it('should save project to index and status file', async () => {
      await repository.create({
        name: 'Test Project',
        path: '/path/to/project',
      });

      const indexContent = mockFs.files.get(indexPath);
      expect(indexContent).toBeDefined();
      const index = JSON.parse(indexContent!) as ProjectIndexEntryWithPath[];
      expect(index).toHaveLength(1);
      expect(index[0]).toEqual({ id: '_path_to_project', name: 'Test Project', path: '/path/to/project' });

      // Data is now stored in {project-root}/.claudito/
      const statusPath = '/path/to/project/.claudito/status.json';
      const statusContent = mockFs.files.get(statusPath);
      expect(statusContent).toBeDefined();
      const status = JSON.parse(statusContent!) as ProjectStatus;
      expect(status.name).toBe('Test Project');
    });

    it('should throw error if project with same path already exists', async () => {
      await repository.create({
        name: 'Test Project',
        path: '/path/to/project',
      });

      await expect(
        repository.create({
          name: 'Another Project',
          path: '/path/to/project',
        })
      ).rejects.toThrow('Project with this path already exists');
    });

    it('should create .claudito directory in project path', async () => {
      await repository.create({
        name: 'Test',
        path: '/test/path',
      });

      // Data is now stored in {project-root}/.claudito/
      const projectDataDir = '/test/path/.claudito';
      expect(mockFs.dirs.has(projectDataDir)).toBe(true);
    });
  });

  describe('findAll', () => {
    it('should return empty array when no projects exist', async () => {
      const projects = await repository.findAll();
      expect(projects).toEqual([]);
    });

    it('should return all projects', async () => {
      await repository.create({ name: 'Project 1', path: '/path1' });
      await repository.create({ name: 'Project 2', path: '/path2' });

      const projects = await repository.findAll();

      expect(projects).toHaveLength(2);
      expect(projects.map((p) => p.name)).toContain('Project 1');
      expect(projects.map((p) => p.name)).toContain('Project 2');
    });

    it('should return copies of projects (not references)', async () => {
      await repository.create({ name: 'Project', path: '/path' });
      const projects1 = await repository.findAll();
      const projects2 = await repository.findAll();

      expect(projects1[0]).not.toBe(projects2[0]);
      expect(projects1[0]).toEqual(projects2[0]);
    });
  });

  describe('findById', () => {
    it('should return null for non-existent project', async () => {
      const project = await repository.findById('non-existent');
      expect(project).toBeNull();
    });

    it('should return project by id', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      const found = await repository.findById(created.id);

      expect(found).toBeDefined();
      expect(found!.name).toBe('Test');
      expect(found!.id).toBe(created.id);
    });

    it('should return copy of project (not reference)', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      const found1 = await repository.findById(created.id);
      const found2 = await repository.findById(created.id);

      expect(found1).not.toBe(found2);
      expect(found1).toEqual(found2);
    });
  });

  describe('findByPath', () => {
    it('should return null for non-existent path', async () => {
      const project = await repository.findByPath('/non/existent');
      expect(project).toBeNull();
    });

    it('should return project by path', async () => {
      await repository.create({ name: 'Test', path: '/test/path' });
      const found = await repository.findByPath('/test/path');

      expect(found).toBeDefined();
      expect(found!.name).toBe('Test');
      expect(found!.path).toBe('/test/path');
    });
  });

  describe('updateStatus', () => {
    it('should return null for non-existent project', async () => {
      const result = await repository.updateStatus('non-existent', 'running');
      expect(result).toBeNull();
    });

    it('should update project status', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateStatus(created.id, 'running');

      expect(updated).toBeDefined();
      expect(updated!.status).toBe('running');
    });

    it('should persist status change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateStatus(created.id, 'error');

      const found = await repository.findById(created.id);

      expect(found!.status).toBe('error');
    });

    it('should update updatedAt timestamp', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      const originalUpdatedAt = created.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));
      await repository.updateStatus(created.id, 'running');

      const found = await repository.findById(created.id);
      expect(new Date(found!.updatedAt).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
    });
  });

  describe('updateNextItem', () => {
    const testItem: MilestoneItemRef = {
      phaseId: 'phase1',
      milestoneId: 'milestone1',
      itemIndex: 0,
      taskTitle: 'Test Task',
    };

    it('should return null for non-existent project', async () => {
      const result = await repository.updateNextItem('non-existent', testItem);
      expect(result).toBeNull();
    });

    it('should update next item', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateNextItem(created.id, testItem);

      expect(updated).toBeDefined();
      expect(updated!.nextItem).toEqual(testItem);
    });

    it('should allow setting next item to null', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateNextItem(created.id, testItem);

      const updated = await repository.updateNextItem(created.id, null);

      expect(updated!.nextItem).toBeNull();
    });

    it('should persist next item change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateNextItem(created.id, testItem);

      const found = await repository.findById(created.id);

      expect(found!.nextItem).toEqual(testItem);
    });
  });

  describe('updateCurrentItem', () => {
    const testItem: MilestoneItemRef = {
      phaseId: 'phase1',
      milestoneId: 'milestone1',
      itemIndex: 0,
      taskTitle: 'Test Task',
    };

    it('should return null for non-existent project', async () => {
      const result = await repository.updateCurrentItem('non-existent', testItem);
      expect(result).toBeNull();
    });

    it('should update current item', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateCurrentItem(created.id, testItem);

      expect(updated).toBeDefined();
      expect(updated!.currentItem).toEqual(testItem);
    });

    it('should allow setting current item to null', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateCurrentItem(created.id, testItem);

      const updated = await repository.updateCurrentItem(created.id, null);

      expect(updated!.currentItem).toBeNull();
    });

    it('should persist current item change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateCurrentItem(created.id, testItem);

      const found = await repository.findById(created.id);

      expect(found!.currentItem).toEqual(testItem);
    });
  });

  describe('setCurrentConversation', () => {
    it('should return null for non-existent project', async () => {
      const result = await repository.setCurrentConversation('non-existent', 'conv-1');
      expect(result).toBeNull();
    });

    it('should set current conversation id', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.setCurrentConversation(created.id, 'conv-123');

      expect(updated).toBeDefined();
      expect(updated!.currentConversationId).toBe('conv-123');
    });

    it('should allow setting conversation id to null', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.setCurrentConversation(created.id, 'conv-123');

      const updated = await repository.setCurrentConversation(created.id, null);

      expect(updated!.currentConversationId).toBeNull();
    });

    it('should persist conversation id change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.setCurrentConversation(created.id, 'conv-456');

      const found = await repository.findById(created.id);

      expect(found!.currentConversationId).toBe('conv-456');
    });
  });

  describe('delete', () => {
    it('should return false for non-existent project', async () => {
      const result = await repository.delete('non-existent');
      expect(result).toBe(false);
    });

    it('should delete existing project', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const result = await repository.delete(created.id);

      expect(result).toBe(true);
    });

    it('should remove project from index', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.delete(created.id);

      const found = await repository.findById(created.id);

      expect(found).toBeNull();
    });

    it('should remove project from findAll results', async () => {
      await repository.create({ name: 'Test 1', path: '/test1' });
      const project2 = await repository.create({ name: 'Test 2', path: '/test2' });
      await repository.delete(project2.id);

      const projects = await repository.findAll();

      expect(projects).toHaveLength(1);
      expect(projects[0]!.name).toBe('Test 1');
    });

    it('should remove .claudito directory in project path', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      // Data is stored in {project-root}/.claudito/
      const projectDataDir = '/test/.claudito';

      // Verify the directory was created
      expect(mockFs.dirs.has(projectDataDir)).toBe(true);

      await repository.delete(created.id);

      expect(mockFs.dirs.has(projectDataDir)).toBe(false);
    });

    it('should update index file after deletion', async () => {
      await repository.create({ name: 'Test 1', path: '/test1' });
      const project2 = await repository.create({ name: 'Test 2', path: '/test2' });
      await repository.delete(project2.id);

      const indexContent = mockFs.files.get(indexPath);
      expect(indexContent).toBeDefined();
      const index = JSON.parse(indexContent!) as ProjectIndexEntryWithPath[];

      expect(index).toHaveLength(1);
      expect(index[0]?.name).toBe('Test 1');
    });
  });

  describe('caching behavior', () => {
    it('should cache status after first load', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      await repository.findById(created.id);
      await repository.findById(created.id);

      const readCalls = (mockFs.readFileSync as jest.Mock).mock.calls.filter(
        (call: string[]) => call[0]?.includes('status.json') && call[0]?.includes('_test')
      );
      expect(readCalls.length).toBeLessThanOrEqual(1);
    });

    it('should update cache on status change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateStatus(created.id, 'running');

      const found = await repository.findById(created.id);

      expect(found!.status).toBe('running');
    });

    it('should clear cache on delete', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.findById(created.id);
      await repository.delete(created.id);

      const found = await repository.findById(created.id);

      expect(found).toBeNull();
    });
  });

  describe('persistence across repository instances', () => {
    it('should load existing projects from a new repository instance', async () => {
      await repository.create({ name: 'Existing Project', path: '/existing' });

      const newRepository = new FileProjectRepository(dataDir, mockFs);
      const projects = await newRepository.findAll();

      expect(projects).toHaveLength(1);
      expect(projects[0]!.name).toBe('Existing Project');
    });
  });

  describe('getProjectPath', () => {
    it('should return project path for valid id', async () => {
      const created = await repository.create({ name: 'Test', path: '/test/project' });

      const projectPath = repository.getProjectPath(created.id);

      expect(projectPath).toBe('/test/project');
    });

    it('should return null for non-existent id', () => {
      const projectPath = repository.getProjectPath('non-existent');

      expect(projectPath).toBeNull();
    });
  });

  describe('updateContextUsage', () => {
    const testContextUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 100,
      maxContextTokens: 100000,
      percentUsed: 1.5,
    };

    it('should return null for non-existent project', async () => {
      const result = await repository.updateContextUsage('non-existent', testContextUsage);
      expect(result).toBeNull();
    });

    it('should update context usage', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateContextUsage(created.id, testContextUsage);

      expect(updated).toBeDefined();
      expect(updated!.lastContextUsage).toEqual(testContextUsage);
    });

    it('should allow setting context usage to null', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateContextUsage(created.id, testContextUsage);

      const updated = await repository.updateContextUsage(created.id, null);

      expect(updated!.lastContextUsage).toBeNull();
    });

    it('should persist context usage change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateContextUsage(created.id, testContextUsage);

      const found = await repository.findById(created.id);

      expect(found!.lastContextUsage).toEqual(testContextUsage);
    });
  });

  describe('updatePermissionOverrides', () => {
    const testOverrides = {
      enabled: true,
      allowRules: ['Read', 'Bash(npm:*)'],
      denyRules: ['Bash(rm:*)'],
      defaultMode: 'plan' as const,
    };

    it('should return null for non-existent project', async () => {
      const result = await repository.updatePermissionOverrides('non-existent', testOverrides);
      expect(result).toBeNull();
    });

    it('should update permission overrides', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updatePermissionOverrides(created.id, testOverrides);

      expect(updated).toBeDefined();
      expect(updated!.permissionOverrides).toEqual(testOverrides);
    });

    it('should allow setting permission overrides to null', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updatePermissionOverrides(created.id, testOverrides);

      const updated = await repository.updatePermissionOverrides(created.id, null);

      expect(updated!.permissionOverrides).toBeNull();
    });

    it('should persist permission overrides change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updatePermissionOverrides(created.id, testOverrides);

      const found = await repository.findById(created.id);

      expect(found!.permissionOverrides).toEqual(testOverrides);
    });
  });

  describe('updateModelOverride', () => {
    const testModel = 'claude-opus-4-6';

    it('should return null for non-existent project', async () => {
      const result = await repository.updateModelOverride('non-existent', testModel);
      expect(result).toBeNull();
    });

    it('should update model override', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateModelOverride(created.id, testModel);

      expect(updated).toBeDefined();
      expect(updated!.modelOverride).toEqual(testModel);
    });

    it('should allow setting model override to null', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateModelOverride(created.id, testModel);

      const updated = await repository.updateModelOverride(created.id, null);

      expect(updated!.modelOverride).toBeNull();
    });

    it('should persist model override change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateModelOverride(created.id, testModel);

      const found = await repository.findById(created.id);

      expect(found!.modelOverride).toEqual(testModel);
    });

    it('should initialize modelOverride to null on create', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      expect(created.modelOverride).toBeNull();
    });
  });

  describe('updateMcpOverrides', () => {
    const testOverrides: import('../../../src/repositories/project').McpOverrides = {
      enabled: true,
      serverOverrides: {
        'mcp-server-1': { enabled: true },
        'mcp-server-2': { enabled: false },
      },
    };

    it('should return null for non-existent project', async () => {
      const result = await repository.updateMcpOverrides('non-existent', testOverrides);
      expect(result).toBeNull();
    });

    it('should update MCP overrides', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateMcpOverrides(created.id, testOverrides);

      expect(updated).toBeDefined();
      expect(updated!.mcpOverrides).toEqual(testOverrides);
    });

    it('should allow setting MCP overrides to null', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateMcpOverrides(created.id, testOverrides);

      const updated = await repository.updateMcpOverrides(created.id, null);

      expect(updated!.mcpOverrides).toBeNull();
    });

    it('should persist MCP overrides change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateMcpOverrides(created.id, testOverrides);

      const found = await repository.findById(created.id);

      expect(found!.mcpOverrides).toEqual(testOverrides);
    });
  });

  describe('updateRunConfigurations', () => {
    const testConfigs: import('../../../src/repositories/project').RunConfiguration[] = [
      {
        id: 'config-1',
        name: 'Dev Server',
        command: 'npm',
        args: ['run', 'dev'],
        cwd: '/project',
        env: { NODE_ENV: 'development' },
        shell: null,
        autoRestart: true,
        autoRestartDelay: 1000,
        autoRestartMaxRetries: 3,
        preLaunchConfigId: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ];

    it('should return null for non-existent project', async () => {
      const result = await repository.updateRunConfigurations('non-existent', testConfigs);
      expect(result).toBeNull();
    });

    it('should update run configurations', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateRunConfigurations(created.id, testConfigs);

      expect(updated).toBeDefined();
      expect(updated!.runConfigurations).toEqual(testConfigs);
    });

    it('should allow setting empty run configurations', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateRunConfigurations(created.id, testConfigs);

      const updated = await repository.updateRunConfigurations(created.id, []);

      expect(updated!.runConfigurations).toEqual([]);
    });

    it('should persist run configurations change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateRunConfigurations(created.id, testConfigs);

      const found = await repository.findById(created.id);

      expect(found!.runConfigurations).toEqual(testConfigs);
    });
  });

  describe('updateDockerOverride', () => {
    it('should return null for non-existent project', async () => {
      const result = await repository.updateDockerOverride('non-existent', true);
      expect(result).toBeNull();
    });

    it('should set docker override to true', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateDockerOverride(created.id, true);

      expect(updated).toBeDefined();
      expect(updated!.dockerOverride).toBe(true);
    });

    it('should set docker override to false', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateDockerOverride(created.id, false);

      expect(updated!.dockerOverride).toBe(false);
    });

    it('should allow setting docker override to undefined', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateDockerOverride(created.id, true);

      const updated = await repository.updateDockerOverride(created.id, undefined);

      expect(updated!.dockerOverride).toBeUndefined();
    });

    it('should persist docker override change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateDockerOverride(created.id, true);

      const found = await repository.findById(created.id);

      expect(found!.dockerOverride).toBe(true);
    });
  });

  describe('updateDockerImage', () => {
    it('should return null for non-existent project', async () => {
      const result = await repository.updateDockerImage('non-existent', 'my-image:latest');
      expect(result).toBeNull();
    });

    it('should update docker image', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateDockerImage(created.id, 'my-image:latest');

      expect(updated).toBeDefined();
      expect(updated!.dockerImage).toBe('my-image:latest');
    });

    it('should allow setting docker image to null', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateDockerImage(created.id, 'my-image:latest');

      const updated = await repository.updateDockerImage(created.id, null);

      expect(updated!.dockerImage).toBeNull();
    });

    it('should persist docker image change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateDockerImage(created.id, 'custom-image:v2');

      const found = await repository.findById(created.id);

      expect(found!.dockerImage).toBe('custom-image:v2');
    });
  });

  describe('updateSlackNotification', () => {
    const testConfig: import('../../../src/repositories/project').SlackNotificationConfig = {
      channelId: 'C12345',
      events: ['agent_completed', 'agent_failed'],
      mentionUsers: ['U001', 'U002'],
      threadReplies: true,
    };

    it('should return null for non-existent project', async () => {
      const result = await repository.updateSlackNotification('non-existent', testConfig);
      expect(result).toBeNull();
    });

    it('should update slack notification config', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateSlackNotification(created.id, testConfig);

      expect(updated).toBeDefined();
      expect(updated!.slackNotification).toEqual(testConfig);
    });

    it('should allow setting slack notification to null', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateSlackNotification(created.id, testConfig);

      const updated = await repository.updateSlackNotification(created.id, null);

      expect(updated!.slackNotification).toBeNull();
    });

    it('should persist slack notification change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateSlackNotification(created.id, testConfig);

      const found = await repository.findById(created.id);

      expect(found!.slackNotification).toEqual(testConfig);
    });
  });

  describe('updateSlackLinkedChannel', () => {
    it('should return null for non-existent project', async () => {
      const result = await repository.updateSlackLinkedChannel('non-existent', 'C12345');
      expect(result).toBeNull();
    });

    it('should update slack linked channel', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateSlackLinkedChannel(created.id, 'C12345');

      expect(updated).toBeDefined();
      expect(updated!.slackLinkedChannelId).toBe('C12345');
    });

    it('should allow setting slack linked channel to null', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateSlackLinkedChannel(created.id, 'C12345');

      const updated = await repository.updateSlackLinkedChannel(created.id, null);

      expect(updated!.slackLinkedChannelId).toBeNull();
    });

    it('should persist slack linked channel change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateSlackLinkedChannel(created.id, 'C99999');

      const found = await repository.findById(created.id);

      expect(found!.slackLinkedChannelId).toBe('C99999');
    });
  });

  describe('updateAgentProfileId', () => {
    it('should return null for non-existent project', async () => {
      const result = await repository.updateAgentProfileId('non-existent', 'profile-1');
      expect(result).toBeNull();
    });

    it('should update agent profile id', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });

      const updated = await repository.updateAgentProfileId(created.id, 'profile-1');

      expect(updated).toBeDefined();
      expect(updated!.agentProfileId).toBe('profile-1');
    });

    it('should allow setting agent profile id to null', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateAgentProfileId(created.id, 'profile-1');

      const updated = await repository.updateAgentProfileId(created.id, null);

      expect(updated!.agentProfileId).toBeNull();
    });

    it('should persist agent profile id change', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      await repository.updateAgentProfileId(created.id, 'custom-profile');

      const found = await repository.findById(created.id);

      expect(found!.agentProfileId).toBe('custom-profile');
    });
  });

  describe('updateProjectPath', () => {
    it('should return null for non-existent project', async () => {
      const result = await repository.updateProjectPath('non-existent', 'New Name', '/new/path');
      expect(result).toBeNull();
    });

    it('should update project name and path', async () => {
      const created = await repository.create({ name: 'Old Name', path: '/old/path' });

      const updated = await repository.updateProjectPath(created.id, 'New Name', '/new/path');

      expect(updated).toBeDefined();
      expect(updated!.name).toBe('New Name');
      expect(updated!.path).toBe('/new/path');
    });

    it('should generate new id from new path', async () => {
      const created = await repository.create({ name: 'Test', path: '/test/project' });

      const updated = await repository.updateProjectPath(created.id, 'Renamed', '/renamed/project');

      expect(updated!.id).toBe(generateIdFromPath('/renamed/project'));
    });

    it('should remove old id from index', async () => {
      const created = await repository.create({ name: 'Test', path: '/test/project' });
      const oldId = created.id;

      await repository.updateProjectPath(oldId, 'Renamed', '/renamed/project');

      const oldProject = await repository.findById(oldId);
      expect(oldProject).toBeNull();
    });

    it('should be findable by new id', async () => {
      const created = await repository.create({ name: 'Test', path: '/test/project' });

      const updated = await repository.updateProjectPath(created.id, 'Renamed', '/renamed/project');
      const newId = updated!.id;

      const found = await repository.findById(newId);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Renamed');
      expect(found!.path).toBe('/renamed/project');
    });

    it('should persist updated index to file', async () => {
      const created = await repository.create({ name: 'Test', path: '/test/project' });

      await repository.updateProjectPath(created.id, 'Renamed', '/renamed/project');

      const indexContent = mockFs.files.get(indexPath);
      const index = JSON.parse(indexContent!) as ProjectIndexEntryWithPath[];
      expect(index).toHaveLength(1);
      expect(index[0]?.name).toBe('Renamed');
      expect(index[0]?.path).toBe('/renamed/project');
    });
  });

  describe('loadStatus edge cases', () => {
    it('should return null when status file is corrupted', async () => {
      const created = await repository.create({ name: 'Test', path: '/test' });
      // Corrupt the status file
      const statusPath = '/test/.claudito/status.json';
      mockFs.files.set(statusPath, 'not valid json');

      // Clear cache to force reload
      const newRepo = new FileProjectRepository(dataDir, mockFs);
      const found = await newRepo.findById(created.id);

      expect(found).toBeNull();
    });

    it('should return null when status file does not exist', async () => {
      // Set up index with a project but no status file
      const indexContent = JSON.stringify([{ id: 'test_id', name: 'Test', path: '/missing/status' }]);
      mockFs.files.set(indexPath, indexContent);

      const newRepo = new FileProjectRepository(dataDir, mockFs);
      const found = await newRepo.findById('test_id');

      expect(found).toBeNull();
    });
  });

  describe('backward compatibility migration', () => {
    it('should migrate from old location when path is missing in index', async () => {
      // Set up an old-style entry (no path in index)
      const projectId = 'old_project';
      const oldStatusPath = normalizePath(path.join(projectsDir, projectId, 'status.json'));
      const oldStatus: ProjectStatus = {
        id: projectId,
        name: 'Old Project',
        path: '/migrated/project',
        status: 'stopped',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nextItem: null,
        currentItem: null,
        currentConversationId: null,
        lastContextUsage: null,
        permissionOverrides: null,
        modelOverride: null,
        mcpOverrides: null,
      };

      // Set up old-style index (no path field)
      const indexContent = JSON.stringify([{ id: projectId, name: 'Old Project' }]);
      mockFs.files.set(indexPath, indexContent);
      mockFs.dirs.add(normalizePath(path.join(projectsDir, projectId)));
      mockFs.files.set(oldStatusPath, JSON.stringify(oldStatus));

      const newRepo = new FileProjectRepository(dataDir, mockFs);
      const found = await newRepo.findById(projectId);

      expect(found).toBeDefined();
      expect(found!.name).toBe('Old Project');
      expect(found!.path).toBe('/migrated/project');
    });

    it('should return null for old entry with missing status file', async () => {
      // Set up an old-style entry (no path in index) but no status file
      const projectId = 'orphan_project';
      const indexContent = JSON.stringify([{ id: projectId, name: 'Orphan' }]);
      mockFs.files.set(indexPath, indexContent);
      mockFs.dirs.add(normalizePath(path.join(projectsDir, projectId)));
      // Note: no status file

      const newRepo = new FileProjectRepository(dataDir, mockFs);
      const found = await newRepo.findById(projectId);

      expect(found).toBeNull();
    });

    it('should return null for old entry with corrupted status file', async () => {
      // Set up an old-style entry with corrupted status
      const projectId = 'corrupt_project';
      const oldStatusPath = normalizePath(path.join(projectsDir, projectId, 'status.json'));
      const indexContent = JSON.stringify([{ id: projectId, name: 'Corrupt' }]);
      mockFs.files.set(indexPath, indexContent);
      mockFs.dirs.add(normalizePath(path.join(projectsDir, projectId)));
      mockFs.files.set(oldStatusPath, 'not valid json');

      const newRepo = new FileProjectRepository(dataDir, mockFs);
      const found = await newRepo.findById(projectId);

      expect(found).toBeNull();
    });
  });
});
