import path from 'path';
import {
  DefaultProjectService,
  FileSystemOperations,
  CreateProjectOptions,
} from '../../../src/services/project';
import { createMockProjectRepository, sampleProject } from '../helpers/mock-factories';

describe('DefaultProjectService', () => {
  let service: DefaultProjectService;
  let mockFs: jest.Mocked<FileSystemOperations>;
  let mockProjectRepository: ReturnType<typeof createMockProjectRepository>;

  beforeEach(() => {
    mockFs = {
      exists: jest.fn(),
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn(),
    };

    mockProjectRepository = createMockProjectRepository([{ ...sampleProject }]);

    service = new DefaultProjectService({
      projectRepository: mockProjectRepository,
      fileSystem: mockFs,
    });
  });

  describe('createProject', () => {
    describe('when createNew is false (use existing folder)', () => {
      it('should create project when folder exists', async () => {
        mockFs.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        const options: CreateProjectOptions = {
          path: '/test/project',
          createNew: false,
          name: 'Test Project',
        };

        const result = await service.createProject(options);

        expect(result.success).toBe(true);
        expect(result.project).toBeDefined();
        expect(result.project?.name).toBe('Test Project');
        expect(mockProjectRepository.create).toHaveBeenCalledWith({
          name: 'Test Project',
          path: '/test/project',
        });
      });

      it('should return error when folder does not exist', async () => {
        mockFs.exists.mockResolvedValue(false);

        const options: CreateProjectOptions = {
          path: '/nonexistent/path',
          createNew: false,
        };

        const result = await service.createProject(options);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Folder does not exist');
        expect(mockProjectRepository.create).not.toHaveBeenCalled();
      });

      it('should use folder name as project name when name is not provided', async () => {
        mockFs.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        const options: CreateProjectOptions = {
          path: '/test/my-awesome-project',
          createNew: false,
        };

        const result = await service.createProject(options);

        expect(result.success).toBe(true);
        expect(mockProjectRepository.create).toHaveBeenCalledWith({
          name: 'my-awesome-project',
          path: '/test/my-awesome-project',
        });
      });

      it('should initialize .claudito folder', async () => {
        mockFs.exists
          .mockResolvedValueOnce(true) // folder exists
          .mockResolvedValueOnce(false); // .claudito does not exist

        await service.createProject({
          path: '/test/project',
          createNew: false,
        });

        expect(mockFs.mkdir).toHaveBeenCalledWith(
          path.join('/test/project', '.claudito')
        );
      });

      it('should not create .claudito if it already exists', async () => {
        mockFs.exists
          .mockResolvedValueOnce(true) // folder exists
          .mockResolvedValueOnce(true); // .claudito exists

        await service.createProject({
          path: '/test/project',
          createNew: false,
        });

        expect(mockFs.mkdir).not.toHaveBeenCalled();
      });
    });

    describe('when createNew is true (create new folder)', () => {
      it('should create project folder when it does not exist', async () => {
        mockFs.exists
          .mockResolvedValueOnce(false) // project folder does not exist
          .mockResolvedValueOnce(false); // .claudito does not exist

        const options: CreateProjectOptions = {
          path: '/test/new-project',
          createNew: true,
          name: 'New Project',
        };

        const result = await service.createProject(options);

        expect(result.success).toBe(true);
        expect(mockFs.mkdir).toHaveBeenCalledWith('/test/new-project');
        expect(mockFs.mkdir).toHaveBeenCalledWith(
          path.join('/test/new-project', '.claudito')
        );
      });

      it('should return error when folder already exists', async () => {
        mockFs.exists.mockResolvedValue(true);

        const options: CreateProjectOptions = {
          path: '/test/existing-folder',
          createNew: true,
        };

        const result = await service.createProject(options);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Folder already exists');
        expect(mockProjectRepository.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('hasRoadmap', () => {
    it('should return true when roadmap exists', async () => {
      mockFs.exists.mockResolvedValue(true);

      const result = await service.hasRoadmap('/test/project');

      expect(result).toBe(true);
      expect(mockFs.exists).toHaveBeenCalledWith(
        path.join('/test/project', 'doc', 'ROADMAP.md')
      );
    });

    it('should return false when roadmap does not exist', async () => {
      mockFs.exists.mockResolvedValue(false);

      const result = await service.hasRoadmap('/test/project');

      expect(result).toBe(false);
    });
  });

  describe('getRoadmapContent', () => {
    it('should return roadmap content when file exists', async () => {
      const content = '# Roadmap\n## Phase 1';
      mockFs.readFile.mockResolvedValue(content);

      const result = await service.getRoadmapContent('/test/project');

      expect(result).toBe(content);
      expect(mockFs.readFile).toHaveBeenCalledWith(
        path.join('/test/project', 'doc', 'ROADMAP.md')
      );
    });

    it('should return null when file does not exist', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));

      const result = await service.getRoadmapContent('/test/project');

      expect(result).toBeNull();
    });

    it('should return null on read error', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Permission denied'));

      const result = await service.getRoadmapContent('/test/project');

      expect(result).toBeNull();
    });
  });

  describe('updateProjectPath', () => {
    it('should delegate to repository', async () => {
      mockProjectRepository.updateProjectPath.mockResolvedValue({
        ...sampleProject,
        name: 'New Name',
        path: '/new/path',
      });

      const result = await service.updateProjectPath('123', 'New Name', '/new/path');

      expect(result).toBeDefined();
      expect(result!.name).toBe('New Name');
      expect(mockProjectRepository.updateProjectPath).toHaveBeenCalledWith('123', 'New Name', '/new/path');
    });

    it('should return null when project not found', async () => {
      mockProjectRepository.updateProjectPath.mockResolvedValue(null);

      const result = await service.updateProjectPath('nonexistent', 'Name', '/path');

      expect(result).toBeNull();
    });
  });

  describe('constructor', () => {
    it('should use provided dependencies', async () => {
      const customFs: FileSystemOperations = {
        exists: jest.fn(),
        mkdir: jest.fn(),
        writeFile: jest.fn(),
        readFile: jest.fn(),
      };

      const customService = new DefaultProjectService({
        projectRepository: mockProjectRepository,
        fileSystem: customFs,
      });

      // Verify service uses the custom filesystem
      customFs.exists = jest.fn().mockResolvedValue(true);

      await customService.hasRoadmap('/test');

      expect(customFs.exists).toHaveBeenCalled();
    });
  });
});
