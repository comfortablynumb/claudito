#!/usr/bin/env node

import { EnvironmentConfigLoader } from './config';
import { ExpressHttpServer } from './server';
import { initializeLogger, getLogger } from './utils';

const VERSION = process.env.npm_package_version || '0.1.0';

function printHelp(): void {
  console.log(`
Claudito - Claude Code Autonomous Agent Manager

Usage: claudito [options]

Options:
  -p, --port <port>     Server port (default: 3000, env: PORT)
  -h, --host <host>     Server host (default: localhost, env: HOST)
  --dev                 Enable development mode (shows Development button)
  -v, --version         Show version number
  --help                Show this help message

Environment Variables:
  PORT                  Server port
  HOST                  Server host
  NODE_ENV              Environment (development/production)
  LOG_LEVEL             Log level (debug/info/warn/error)
  MAX_CONCURRENT_AGENTS Maximum concurrent agents (default: 5)
  DEV_MODE              Enable development mode (true/false)
  CLAUDITO_DEV_MODE     Enable development mode (1 to enable)

Examples:
  claudito                    Start with defaults (localhost:3000)
  claudito -p 8080            Start on port 8080
  claudito --host 0.0.0.0     Listen on all interfaces
  claudito --dev              Start with development features
  PORT=8080 claudito          Start on port 8080 via env var
`);
}

interface CliArgs {
  port?: number;
  host?: string;
  help?: boolean;
  version?: boolean;
  dev?: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help') {
      result.help = true;
    } else if (arg === '-v' || arg === '--version') {
      result.version = true;
    } else if (arg === '-p' || arg === '--port') {
      const portStr = args[++i];

      if (portStr) {
        const port = parseInt(portStr, 10);

        if (!isNaN(port) && port > 0 && port < 65536) {
          result.port = port;
        } else {
          console.error(`Invalid port: ${portStr}`);
          process.exit(1);
        }
      }
    } else if (arg === '-h' || arg === '--host') {
      const host = args[++i];

      if (host) {
        result.host = host;
      }
    } else if (arg === '--dev') {
      result.dev = true;
    }
  }

  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.log(`claudito v${VERSION}`);
    process.exit(0);
  }

  // Override environment variables with CLI args
  if (args.port) {
    process.env.PORT = String(args.port);
  }

  if (args.host) {
    process.env.HOST = args.host;
  }

  if (args.dev) {
    process.env.DEV_MODE = 'true';
  }

  const configLoader = new EnvironmentConfigLoader();
  const config = configLoader.load();

  initializeLogger({ level: config.logLevel });
  const logger = getLogger('claudito');

  const server = new ExpressHttpServer({ config });

  let isShuttingDown = false;

  const shutdown = (signal: string): void => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    logger.info('Shutting down...', { signal });
    server
      .stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  server.onShutdown(() => shutdown('API'));

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await server.start();

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   Claudito - Claude Code Agent Manager                    ║
║                                                           ║
║   Server running at: http://${config.host}:${config.port.toString().padEnd(5)}                 ║
║                                                           ║
║   Press Ctrl+C to stop                                    ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Failed to start Claudito:', message);
  process.exit(1);
});
