import { EnvironmentConfigLoader, AppConfig } from '../../src/config';

describe('EnvironmentConfigLoader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('load', () => {
    it('should return default config when no env vars set', () => {
      delete process.env['PORT'];
      delete process.env['HOST'];
      delete process.env['NODE_ENV'];
      delete process.env['LOG_LEVEL'];
      delete process.env['MAX_CONCURRENT_AGENTS'];
      delete process.env['DEV_MODE'];
      delete process.env['CLAUDITO_DEV_MODE'];

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config).toEqual({
        port: 3000,
        host: '0.0.0.0',
        env: 'development',
        logLevel: 'info',
        maxConcurrentAgents: 5,
        devMode: false,
        shellEnabled: false,
        shellForceEnabled: false,
      });
    });

    it('should parse MAX_CONCURRENT_AGENTS from env', () => {
      process.env['MAX_CONCURRENT_AGENTS'] = '5';

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.maxConcurrentAgents).toBe(5);
    });

    it('should use default for invalid MAX_CONCURRENT_AGENTS', () => {
      process.env['MAX_CONCURRENT_AGENTS'] = 'invalid';

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.maxConcurrentAgents).toBe(5);
    });

    it('should parse PORT from env', () => {
      process.env['PORT'] = '8080';

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.port).toBe(8080);
    });

    it('should use default port for invalid PORT', () => {
      process.env['PORT'] = 'invalid';

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.port).toBe(3000);
    });

    it('should use default port for out of range PORT', () => {
      process.env['PORT'] = '99999';

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.port).toBe(3000);
    });

    it('should parse HOST from env', () => {
      process.env['HOST'] = '0.0.0.0';

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.host).toBe('0.0.0.0');
    });

    it('should parse NODE_ENV production', () => {
      process.env['NODE_ENV'] = 'production';

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.env).toBe('production');
    });

    it('should parse NODE_ENV test', () => {
      process.env['NODE_ENV'] = 'test';

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.env).toBe('test');
    });

    it('should default to development for invalid NODE_ENV', () => {
      process.env['NODE_ENV'] = 'invalid';

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.env).toBe('development');
    });

    it('should parse LOG_LEVEL from env', () => {
      const levels: AppConfig['logLevel'][] = ['debug', 'info', 'warn', 'error'];

      for (const level of levels) {
        process.env['LOG_LEVEL'] = level;

        const loader = new EnvironmentConfigLoader();
        const config = loader.load();

        expect(config.logLevel).toBe(level);
      }
    });

    it('should default to info for invalid LOG_LEVEL', () => {
      process.env['LOG_LEVEL'] = 'invalid';

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.logLevel).toBe('info');
    });

    it('should disable shell when host is 0.0.0.0', () => {
      process.env['HOST'] = '0.0.0.0';
      delete process.env['CLAUDITO_FORCE_SHELL_ENABLED'];

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.shellEnabled).toBe(false);
      expect(config.shellForceEnabled).toBe(false);
    });

    it('should enable shell when host is 127.0.0.1', () => {
      process.env['HOST'] = '127.0.0.1';
      delete process.env['CLAUDITO_FORCE_SHELL_ENABLED'];

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.shellEnabled).toBe(true);
      expect(config.shellForceEnabled).toBe(false);
    });

    it('should enable shell when host is localhost', () => {
      process.env['HOST'] = 'localhost';
      delete process.env['CLAUDITO_FORCE_SHELL_ENABLED'];

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.shellEnabled).toBe(true);
      expect(config.shellForceEnabled).toBe(false);
    });

    it('should force enable shell with CLAUDITO_FORCE_SHELL_ENABLED=1', () => {
      process.env['HOST'] = '0.0.0.0';
      process.env['CLAUDITO_FORCE_SHELL_ENABLED'] = '1';

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.shellEnabled).toBe(true);
      expect(config.shellForceEnabled).toBe(true);
    });

    it('should not force enable shell with CLAUDITO_FORCE_SHELL_ENABLED=0', () => {
      process.env['HOST'] = '0.0.0.0';
      process.env['CLAUDITO_FORCE_SHELL_ENABLED'] = '0';

      const loader = new EnvironmentConfigLoader();
      const config = loader.load();

      expect(config.shellEnabled).toBe(false);
      expect(config.shellForceEnabled).toBe(false);
    });
  });
});
