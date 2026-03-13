/* eslint-disable @typescript-eslint/unbound-method */
import request from 'supertest';
import express, { Express } from 'express';
import {
  createFilesystemRouter,
  createFilesystemService,
  FilesystemService,
  WindowsFilesystemService,
  UnixFilesystemService,
} from '../../../src/routes/filesystem';
import {
  createMockFilesystemService,
  sampleDrives,
  sampleDirectoryEntries,
  sampleFileContent,
} from '../helpers/mock-factories';

interface DirectoryEntryWithEditable {
  name: string;
  path: string;
  isDirectory: boolean;
  isEditable: boolean;
}

describe('createFilesystemService', () => {
  const originalPlatform = process.platform;

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('should return WindowsFilesystemService on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const service = createFilesystemService();
    expect(service).toBeInstanceOf(WindowsFilesystemService);
  });

  it('should return UnixFilesystemService on non-win32', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const service = createFilesystemService();
    expect(service).toBeInstanceOf(UnixFilesystemService);
  });
});

describe('WindowsFilesystemService isTextFile', () => {
  let service: WindowsFilesystemService;

  beforeEach(() => {
    service = new WindowsFilesystemService();
  });

  describe('MIME type detection', () => {
    it('should return true for text/* MIME types', () => {
      expect(service.isTextFile('/path/to/file.txt')).toBe(true);
      expect(service.isTextFile('/path/to/file.html')).toBe(true);
      expect(service.isTextFile('/path/to/file.css')).toBe(true);
    });

    it('should return true for application/json', () => {
      expect(service.isTextFile('/path/to/file.json')).toBe(true);
    });

    it('should return true for application/javascript', () => {
      expect(service.isTextFile('/path/to/file.js')).toBe(true);
    });

    it('should return true for application/xml', () => {
      expect(service.isTextFile('/path/to/file.xml')).toBe(true);
    });
  });

  describe('extension-based detection', () => {
    it('should return true for common code file extensions', () => {
      expect(service.isTextFile('/path/to/file.ts')).toBe(true);
      expect(service.isTextFile('/path/to/file.tsx')).toBe(true);
      expect(service.isTextFile('/path/to/file.py')).toBe(true);
      expect(service.isTextFile('/path/to/file.rs')).toBe(true);
      expect(service.isTextFile('/path/to/file.go')).toBe(true);
    });

    it('should return true for config file extensions', () => {
      expect(service.isTextFile('/path/to/file.yaml')).toBe(true);
      expect(service.isTextFile('/path/to/file.yml')).toBe(true);
      expect(service.isTextFile('/path/to/file.toml')).toBe(true);
      expect(service.isTextFile('/path/to/file.ini')).toBe(true);
    });

    it('should return true for script file extensions', () => {
      expect(service.isTextFile('/path/to/file.sh')).toBe(true);
      expect(service.isTextFile('/path/to/file.bash')).toBe(true);
      expect(service.isTextFile('/path/to/file.ps1')).toBe(true);
      expect(service.isTextFile('/path/to/file.bat')).toBe(true);
    });
  });

  describe('filename-based detection', () => {
    it('should return true for dotfiles', () => {
      expect(service.isTextFile('/path/to/.gitignore')).toBe(true);
      expect(service.isTextFile('/path/to/.env')).toBe(true);
      expect(service.isTextFile('/path/to/.npmrc')).toBe(true);
      expect(service.isTextFile('/path/to/.editorconfig')).toBe(true);
    });

    it('should return true for extensionless text files', () => {
      expect(service.isTextFile('/path/to/Makefile')).toBe(true);
      expect(service.isTextFile('/path/to/Dockerfile')).toBe(true);
      expect(service.isTextFile('/path/to/LICENSE')).toBe(true);
    });
  });

  describe('binary files', () => {
    it('should return false for binary file extensions', () => {
      expect(service.isTextFile('/path/to/file.exe')).toBe(false);
      expect(service.isTextFile('/path/to/file.dll')).toBe(false);
      expect(service.isTextFile('/path/to/file.png')).toBe(false);
      expect(service.isTextFile('/path/to/file.jpg')).toBe(false);
      expect(service.isTextFile('/path/to/file.zip')).toBe(false);
    });

    it('should return false for unknown files', () => {
      expect(service.isTextFile('/path/to/file.xyz123')).toBe(false);
      expect(service.isTextFile('/path/to/unknownfile')).toBe(false);
    });
  });
});

// Mock fs module for filesystem service tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    access: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    unlink: jest.fn(),
    rm: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
const mockFsPromises = fs.promises;

describe('WindowsFilesystemService filesystem operations', () => {
  let service: WindowsFilesystemService;

  beforeEach(() => {
    service = new WindowsFilesystemService();
    jest.clearAllMocks();
  });

  describe('listDrives', () => {
    it('should list available drives', async () => {
      // Mock C: and D: as existing
      mockFsPromises.access.mockImplementation((path: string) => {
        if (path === 'C:\\' || path === 'D:\\') {
          return Promise.resolve();
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const drives = await service.listDrives();

      expect(drives).toEqual([
        { name: 'C:', path: 'C:\\' },
        { name: 'D:', path: 'D:\\' },
      ]);
    });

    it('should return empty array when no drives exist', async () => {
      mockFsPromises.access.mockRejectedValue(new Error('ENOENT'));

      const drives = await service.listDrives();

      expect(drives).toEqual([]);
    });
  });

  describe('listDirectory', () => {
    it('should list only directories', async () => {
      mockFsPromises.readdir.mockResolvedValue([
        { name: 'folder1', isDirectory: () => true },
        { name: 'file1.txt', isDirectory: () => false },
        { name: 'folder2', isDirectory: () => true },
      ]);

      const entries = await service.listDirectory('/test');

      expect(entries).toEqual([
        { name: 'folder1', path: expect.stringContaining('folder1'), isDirectory: true },
        { name: 'folder2', path: expect.stringContaining('folder2'), isDirectory: true },
      ]);
    });
  });

  describe('listDirectoryWithFiles', () => {
    it('should list directories first then files', async () => {
      mockFsPromises.readdir.mockResolvedValue([
        { name: 'file1.txt', isDirectory: () => false },
        { name: 'folder1', isDirectory: () => true },
        { name: 'file2.txt', isDirectory: () => false },
      ]);

      const entries = await service.listDirectoryWithFiles('/test');

      expect(entries[0]?.name).toBe('folder1');
      expect(entries[0]?.isDirectory).toBe(true);
      expect(entries[1]?.isDirectory).toBe(false);
      expect(entries[2]?.isDirectory).toBe(false);
    });
  });

  describe('readFile', () => {
    it('should read file content', async () => {
      mockFsPromises.readFile.mockResolvedValue('file content');

      const content = await service.readFile('/test/file.txt');

      expect(content).toBe('file content');
      expect(mockFsPromises.readFile).toHaveBeenCalledWith(
        expect.stringContaining('file.txt'),
        'utf-8'
      );
    });
  });

  describe('writeFile', () => {
    it('should write file content', async () => {
      mockFsPromises.writeFile.mockResolvedValue(undefined);

      await service.writeFile('/test/file.txt', 'new content');

      expect(mockFsPromises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('file.txt'),
        'new content',
        'utf-8'
      );
    });
  });

  describe('createDirectory', () => {
    it('should create directory', async () => {
      mockFsPromises.mkdir.mockResolvedValue(undefined);

      await service.createDirectory('/test/newfolder');

      expect(mockFsPromises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('newfolder'),
        { recursive: false }
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete file', async () => {
      mockFsPromises.unlink.mockResolvedValue(undefined);

      await service.deleteFile('/test/file.txt');

      expect(mockFsPromises.unlink).toHaveBeenCalledWith(expect.stringContaining('file.txt'));
    });
  });

  describe('deleteDirectory', () => {
    it('should delete directory recursively', async () => {
      mockFsPromises.rm.mockResolvedValue(undefined);

      await service.deleteDirectory('/test/folder');

      expect(mockFsPromises.rm).toHaveBeenCalledWith(
        expect.stringContaining('folder'),
        { recursive: true }
      );
    });
  });
});

describe('UnixFilesystemService filesystem operations', () => {
  let service: UnixFilesystemService;

  beforeEach(() => {
    service = new UnixFilesystemService();
    jest.clearAllMocks();
  });

  describe('listDrives', () => {
    it('should always include root drive', async () => {
      mockFsPromises.stat.mockRejectedValue(new Error('ENOENT'));

      const drives = await service.listDrives();

      expect(drives).toContainEqual({ name: '/', path: '/' });
    });

    it('should include mounted volumes on macOS', async () => {
      mockFsPromises.stat.mockResolvedValue({ isDirectory: () => true });
      mockFsPromises.readdir.mockResolvedValue([
        { name: 'ExternalDrive', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'USBDrive', isDirectory: () => false, isSymbolicLink: () => true },
      ]);

      const drives = await service.listDrives();

      expect(drives).toContainEqual({ name: '/', path: '/' });
      expect(drives.find(d => d.name === 'ExternalDrive')).toBeDefined();
      expect(drives.find(d => d.name === 'ExternalDrive')?.path).toContain('ExternalDrive');
      expect(drives.find(d => d.name === 'USBDrive')).toBeDefined();
      expect(drives.find(d => d.name === 'USBDrive')?.path).toContain('USBDrive');
    });

    it('should handle errors reading /Volumes', async () => {
      mockFsPromises.stat.mockResolvedValue({ isDirectory: () => true });
      mockFsPromises.readdir.mockRejectedValue(new Error('Permission denied'));

      const drives = await service.listDrives();

      expect(drives).toEqual([{ name: '/', path: '/' }]);
    });

    it('should skip /Volumes when it is not a directory', async () => {
      mockFsPromises.stat.mockResolvedValue({ isDirectory: () => false });

      const drives = await service.listDrives();

      expect(drives).toEqual([{ name: '/', path: '/' }]);
    });
  });
});

describe('FilesystemRouter', () => {
  let mockService: jest.Mocked<FilesystemService>;
  let app: Express;

  beforeEach(() => {
    mockService = createMockFilesystemService();
    app = express();
    app.use(express.json());
    app.use('/fs', createFilesystemRouter(mockService));
  });

  describe('GET /fs/drives', () => {
    it('should return list of drives', async () => {
      mockService.listDrives.mockResolvedValue(sampleDrives);

      const response = await request(app).get('/fs/drives');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(sampleDrives);
      expect(mockService.listDrives).toHaveBeenCalled();
    });

    it('should return 500 on service error', async () => {
      mockService.listDrives.mockRejectedValue(new Error('Failed'));

      const response = await request(app).get('/fs/drives');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to list drives' });
    });
  });

  describe('GET /fs/browse', () => {
    it('should return directory entries when path provided', async () => {
      const dirEntries = sampleDirectoryEntries.filter((e) => e.isDirectory);
      mockService.listDirectory.mockResolvedValue(dirEntries);

      const response = await request(app).get('/fs/browse').query({ path: '/project' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(dirEntries);
      expect(mockService.listDirectory).toHaveBeenCalledWith('/project');
    });

    it('should return 400 when path not provided', async () => {
      const response = await request(app).get('/fs/browse');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Path parameter is required' });
    });

    it('should return 500 on service error', async () => {
      mockService.listDirectory.mockRejectedValue(new Error('Access denied'));

      const response = await request(app).get('/fs/browse').query({ path: '/restricted' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to list directory' });
    });
  });

  describe('GET /fs/browse-with-files', () => {
    it('should return entries with isEditable flag', async () => {
      mockService.listDirectoryWithFiles.mockResolvedValue(sampleDirectoryEntries);
      mockService.isTextFile.mockImplementation((path) =>
        path.endsWith('.json') || path.endsWith('.md')
      );

      const response = await request(app).get('/fs/browse-with-files').query({ path: '/project' });

      expect(response.status).toBe(200);
      expect(mockService.listDirectoryWithFiles).toHaveBeenCalledWith('/project');

      const result = response.body as DirectoryEntryWithEditable[];
      expect(result.length).toBe(4);
      // Directories should have isEditable false
      expect(result[0]?.isEditable).toBe(false); // src is directory
      expect(result[1]?.isEditable).toBe(false); // test is directory
      expect(result[2]?.isEditable).toBe(true);  // package.json
      expect(result[3]?.isEditable).toBe(true);  // README.md
    });

    it('should return 400 when path not provided', async () => {
      const response = await request(app).get('/fs/browse-with-files');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Path parameter is required' });
    });

    it('should return 500 on service error', async () => {
      mockService.listDirectoryWithFiles.mockRejectedValue(new Error('Failed'));

      const response = await request(app).get('/fs/browse-with-files').query({ path: '/project' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to list directory' });
    });
  });

  describe('GET /fs/read', () => {
    it('should return file content', async () => {
      mockService.readFile.mockResolvedValue(sampleFileContent);

      const response = await request(app).get('/fs/read').query({ path: '/project/index.ts' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ content: sampleFileContent });
      expect(mockService.readFile).toHaveBeenCalledWith('/project/index.ts');
    });

    it('should return 400 when path not provided', async () => {
      const response = await request(app).get('/fs/read');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Path parameter is required' });
    });

    it('should return 404 on read error', async () => {
      mockService.readFile.mockRejectedValue(new Error('ENOENT'));

      const response = await request(app).get('/fs/read').query({ path: '/nonexistent' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Failed to read file' });
    });
  });

  describe('PUT /fs/write', () => {
    it('should write file content', async () => {
      mockService.writeFile.mockResolvedValue(undefined);

      const response = await request(app)
        .put('/fs/write')
        .send({ path: '/project/file.ts', content: 'new content' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockService.writeFile).toHaveBeenCalledWith('/project/file.ts', 'new content');
    });

    it('should return 400 when path not provided', async () => {
      const response = await request(app)
        .put('/fs/write')
        .send({ content: 'content' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Path is required' });
    });

    it('should return 400 when content not provided', async () => {
      const response = await request(app)
        .put('/fs/write')
        .send({ path: '/file.ts' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Content is required' });
    });

    it('should allow empty string as content', async () => {
      mockService.writeFile.mockResolvedValue(undefined);

      const response = await request(app)
        .put('/fs/write')
        .send({ path: '/project/file.ts', content: '' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockService.writeFile).toHaveBeenCalledWith('/project/file.ts', '');
    });

    it('should return 500 on write error', async () => {
      mockService.writeFile.mockRejectedValue(new Error('Permission denied'));

      const response = await request(app)
        .put('/fs/write')
        .send({ path: '/readonly/file.ts', content: 'content' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to write file' });
    });
  });

  describe('DELETE /fs/delete', () => {
    it('should delete a file', async () => {
      mockService.deleteFile.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/fs/delete')
        .send({ path: '/project/file.ts', isDirectory: false });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockService.deleteFile).toHaveBeenCalledWith('/project/file.ts');
    });

    it('should delete a directory', async () => {
      mockService.deleteDirectory.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/fs/delete')
        .send({ path: '/project/old-folder', isDirectory: true });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockService.deleteDirectory).toHaveBeenCalledWith('/project/old-folder');
    });

    it('should return 400 when path not provided', async () => {
      const response = await request(app).delete('/fs/delete').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Path is required' });
    });

    it('should return 500 on delete error', async () => {
      mockService.deleteFile.mockRejectedValue(new Error('File in use'));

      const response = await request(app)
        .delete('/fs/delete')
        .send({ path: '/locked/file.ts', isDirectory: false });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to delete' });
    });

    it('should treat missing isDirectory as false (file)', async () => {
      mockService.deleteFile.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/fs/delete')
        .send({ path: '/project/file.ts' });

      expect(response.status).toBe(200);
      expect(mockService.deleteFile).toHaveBeenCalledWith('/project/file.ts');
      expect(mockService.deleteDirectory).not.toHaveBeenCalled();
    });
  });

  describe('POST /fs/mkdir', () => {
    it('should create a directory', async () => {
      mockService.createDirectory.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/fs/mkdir')
        .send({ path: '/project/new-folder' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockService.createDirectory).toHaveBeenCalledWith('/project/new-folder');
    });

    it('should return 400 when path not provided', async () => {
      const response = await request(app).post('/fs/mkdir').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Path is required' });
    });

    it('should return 409 when directory already exists', async () => {
      mockService.createDirectory.mockRejectedValue(new Error('EEXIST: directory exists'));

      const response = await request(app)
        .post('/fs/mkdir')
        .send({ path: '/project/existing' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Folder already exists' });
    });

    it('should return 500 on other creation errors', async () => {
      mockService.createDirectory.mockRejectedValue(new Error('Permission denied'));

      const response = await request(app)
        .post('/fs/mkdir')
        .send({ path: '/restricted/folder' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to create folder' });
    });
  });

  describe('PUT /fs/move', () => {
    it('should move a file successfully', async () => {
      mockFsPromises.stat.mockImplementation((p: string) => {
        if (p === '/project/old.ts') return Promise.resolve({ isDirectory: () => false });
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });
      mockFsPromises.rename = jest.fn().mockResolvedValue(undefined);

      const response = await request(app)
        .put('/fs/move')
        .send({ sourcePath: '/project/old.ts', targetPath: '/project/new.ts' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockFsPromises.rename).toHaveBeenCalledWith('/project/old.ts', '/project/new.ts');
    });

    it('should return 400 when sourcePath is missing', async () => {
      const response = await request(app)
        .put('/fs/move')
        .send({ targetPath: '/project/new.ts' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'sourcePath and targetPath are required' });
    });

    it('should return 400 when targetPath is missing', async () => {
      const response = await request(app)
        .put('/fs/move')
        .send({ sourcePath: '/project/old.ts' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'sourcePath and targetPath are required' });
    });

    it('should return 404 when source does not exist', async () => {
      mockFsPromises.stat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const response = await request(app)
        .put('/fs/move')
        .send({ sourcePath: '/nonexistent/file.ts', targetPath: '/project/new.ts' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Source file or directory not found' });
    });

    it('should return 409 when target already exists', async () => {
      mockFsPromises.stat.mockResolvedValue({ isDirectory: () => false });

      const response = await request(app)
        .put('/fs/move')
        .send({ sourcePath: '/project/old.ts', targetPath: '/project/existing.ts' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Target already exists' });
    });

    it('should return 404 on ENOENT rename error', async () => {
      mockFsPromises.stat.mockImplementation((p: string) => {
        if (p === '/project/old.ts') return Promise.resolve({ isDirectory: () => false });
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });
      mockFsPromises.rename = jest.fn().mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );

      const response = await request(app)
        .put('/fs/move')
        .send({ sourcePath: '/project/old.ts', targetPath: '/project/new.ts' });

      expect(response.status).toBe(404);
    });

    it('should return 409 on EEXIST rename error', async () => {
      mockFsPromises.stat.mockImplementation((p: string) => {
        if (p === '/project/old.ts') return Promise.resolve({ isDirectory: () => false });
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });
      mockFsPromises.rename = jest.fn().mockRejectedValue(
        Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
      );

      const response = await request(app)
        .put('/fs/move')
        .send({ sourcePath: '/project/old.ts', targetPath: '/project/new.ts' });

      expect(response.status).toBe(409);
    });

    it('should return 400 on EXDEV cross-device rename error', async () => {
      mockFsPromises.stat.mockImplementation((p: string) => {
        if (p === '/project/old.ts') return Promise.resolve({ isDirectory: () => false });
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });
      mockFsPromises.rename = jest.fn().mockRejectedValue(
        Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
      );

      const response = await request(app)
        .put('/fs/move')
        .send({ sourcePath: '/project/old.ts', targetPath: '/other-drive/new.ts' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Cannot move across different drives' });
    });

    it('should return 500 on unknown rename error', async () => {
      mockFsPromises.stat.mockImplementation((p: string) => {
        if (p === '/project/old.ts') return Promise.resolve({ isDirectory: () => false });
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });
      mockFsPromises.rename = jest.fn().mockRejectedValue(
        Object.assign(new Error('Something else'), { code: 'EPERM' })
      );

      const response = await request(app)
        .put('/fs/move')
        .send({ sourcePath: '/project/old.ts', targetPath: '/project/new.ts' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Something else' });
    });
  });
});
