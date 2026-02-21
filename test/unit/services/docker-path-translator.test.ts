import { translateToDockerPath } from '../../../src/services/docker/docker-path-translator';

describe('translateToDockerPath', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('on Windows', () => {
    beforeEach(() => {
      // The module caches process.platform at import time
      // We test the internal logic through the exported function
      // For Windows-specific tests, we use a helper that calls the same logic
    });

    // Since the module caches isWindows at module load time,
    // we test the path translation logic directly via known inputs.
    // The translateToDockerPath function only transforms on Windows.
    // On the actual test machine (Windows), these will exercise real paths.

    if (process.platform === 'win32') {
      it('should convert Windows drive letter paths', () => {
        expect(translateToDockerPath('D:\\Development\\Project')).toBe('/d/Development/Project');
      });

      it('should convert C drive paths', () => {
        expect(translateToDockerPath('C:\\Users\\user\\project')).toBe('/c/Users/user/project');
      });

      it('should handle forward slashes on Windows', () => {
        expect(translateToDockerPath('D:/Development/Project')).toBe('/d/Development/Project');
      });

      it('should handle mixed slashes', () => {
        expect(translateToDockerPath('D:\\Dev/Mixed\\Path')).toBe('/d/Dev/Mixed/Path');
      });

      it('should lowercase drive letter', () => {
        const result = translateToDockerPath('E:\\Some\\Path');
        expect(result.startsWith('/e/')).toBe(true);
      });

      it('should handle paths with spaces', () => {
        expect(translateToDockerPath('D:\\My Projects\\My App')).toBe('/d/My Projects/My App');
      });
    } else {
      it('should passthrough Linux/macOS paths', () => {
        expect(translateToDockerPath('/home/user/project')).toBe('/home/user/project');
      });

      it('should passthrough root path', () => {
        expect(translateToDockerPath('/')).toBe('/');
      });

      it('should passthrough paths with spaces', () => {
        expect(translateToDockerPath('/home/user/my project')).toBe('/home/user/my project');
      });

      it('should passthrough nested paths', () => {
        expect(translateToDockerPath('/var/lib/docker/volumes')).toBe('/var/lib/docker/volumes');
      });
    }
  });

  describe('general behavior', () => {
    it('should handle empty string', () => {
      expect(translateToDockerPath('')).toBe('');
    });

    it('should return a string', () => {
      const result = translateToDockerPath('/some/path');
      expect(typeof result).toBe('string');
    });
  });
});
