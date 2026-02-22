export interface AppConfig {
  port: number;
  host: string;
  env: 'development' | 'production' | 'test';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxConcurrentAgents: number;
  devMode: boolean;
  shellEnabled: boolean;
  shellForceEnabled: boolean;
}

export interface ConfigLoader {
  load(): AppConfig;
}

export class EnvironmentConfigLoader implements ConfigLoader {
  load(): AppConfig {
    const env = this.parseEnv();
    const host = process.env['HOST'] || '0.0.0.0';
    const shellForceEnabled = process.env['CLAUDITO_FORCE_SHELL_ENABLED'] === '1';
    const isBindingToAllInterfaces = host === '0.0.0.0';
    const shellEnabled = shellForceEnabled || !isBindingToAllInterfaces;

    return {
      port: this.parsePort(),
      host,
      env,
      logLevel: this.parseLogLevel(),
      maxConcurrentAgents: this.parseMaxConcurrentAgents(),
      devMode: process.env['CLAUDITO_DEV_MODE'] === '1',
      shellEnabled,
      shellForceEnabled,
    };
  }

  private parsePort(): number {
    const portStr = process.env['PORT'];
    const port = portStr ? parseInt(portStr, 10) : 3000;

    if (isNaN(port) || port < 1 || port > 65535) {
      return 3000;
    }

    return port;
  }

  private parseEnv(): AppConfig['env'] {
    const env = process.env['NODE_ENV'];

    if (env === 'production' || env === 'test') {
      return env;
    }

    return 'development';
  }

  private parseLogLevel(): AppConfig['logLevel'] {
    const level = process.env['LOG_LEVEL'];
    const validLevels: AppConfig['logLevel'][] = ['debug', 'info', 'warn', 'error'];

    if (level && validLevels.includes(level as AppConfig['logLevel'])) {
      return level as AppConfig['logLevel'];
    }

    return 'info';
  }

  private parseMaxConcurrentAgents(): number {
    const maxStr = process.env['MAX_CONCURRENT_AGENTS'];
    const max = maxStr ? parseInt(maxStr, 10) : 5;

    if (isNaN(max) || max < 1) {
      return 5;
    }

    return max;
  }
}
