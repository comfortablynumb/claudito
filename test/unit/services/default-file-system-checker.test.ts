import fs from 'fs';
import { DefaultFileSystemChecker } from '../../../src/services/docker/container-manager';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  readdirSync: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('DefaultFileSystemChecker', () => {
  let checker: DefaultFileSystemChecker;

  beforeEach(() => {
    checker = new DefaultFileSystemChecker();
    jest.clearAllMocks();
  });

  describe('directoryExists', () => {
    it('should return true when directory exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ isDirectory: () => true } as fs.Stats);

      expect(checker.directoryExists('/some/dir')).toBe(true);
      expect(mockFs.existsSync).toHaveBeenCalledWith('/some/dir');
    });

    it('should return false when path is a file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ isDirectory: () => false } as fs.Stats);

      expect(checker.directoryExists('/some/file')).toBe(false);
    });

    it('should return false when path does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(checker.directoryExists('/missing')).toBe(false);
    });

    it('should return false when statSync throws', () => {
      mockFs.existsSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(checker.directoryExists('/error')).toBe(false);
    });
  });

  describe('fileExists', () => {
    it('should return true when file exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ isFile: () => true } as fs.Stats);

      expect(checker.fileExists('/some/file.txt')).toBe(true);
    });

    it('should return false when path is a directory', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ isFile: () => false } as fs.Stats);

      expect(checker.fileExists('/some/dir')).toBe(false);
    });

    it('should return false when path does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(checker.fileExists('/missing')).toBe(false);
    });

    it('should return false when statSync throws', () => {
      mockFs.existsSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      expect(checker.fileExists('/error')).toBe(false);
    });
  });

  describe('listEntries', () => {
    it('should return directory entries', () => {
      (mockFs.readdirSync as jest.Mock).mockReturnValue([
        'file1.txt',
        'file2.txt',
      ]);

      const result = checker.listEntries('/some/dir');

      expect(result).toEqual(['file1.txt', 'file2.txt']);
      expect(mockFs.readdirSync).toHaveBeenCalledWith('/some/dir');
    });

    it('should return empty array when directory does not exist', () => {
      mockFs.readdirSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(checker.listEntries('/missing')).toEqual([]);
    });

    it('should return empty array on permission error', () => {
      mockFs.readdirSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      expect(checker.listEntries('/restricted')).toEqual([]);
    });
  });
});
