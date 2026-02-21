/**
 * Image Manager
 * Manages Docker images for Claudito agent containers.
 * Lists images, builds from Dockerfile variants, and removes unused images.
 */

import path from 'path';
import { getLogger, Logger } from '../../utils';
import {
  ImageManager,
  DockerCommandRunner,
  DockerImage,
  ImageVariant,
  BuildImageOptions,
} from './types';

interface ImageManagerDependencies {
  commandRunner: DockerCommandRunner;
  variantsDir: string;
  logger?: Logger;
}

const CLAUDITO_IMAGE_PREFIX = 'claudito-';

function isDaemonNotRunning(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('Cannot connect to the Docker daemon') ||
    msg.includes('error during connect') ||
    msg.includes('Is the docker daemon running')
  );
}

const BUILT_IN_VARIANTS: ImageVariant[] = [
  {
    name: 'agent',
    displayName: 'Base Agent',
    description: 'Node.js 22 with Claude Code CLI, Git, and common tools',
    dockerfilePath: 'Dockerfile.claudito-agent',
  },
  {
    name: 'python',
    displayName: 'Python',
    description: 'Base agent + Python 3.12 with pip',
    dockerfilePath: 'variants/Dockerfile.python',
  },
  {
    name: 'rust',
    displayName: 'Rust',
    description: 'Base agent + Rust toolchain with cargo',
    dockerfilePath: 'variants/Dockerfile.rust',
  },
  {
    name: 'go',
    displayName: 'Go',
    description: 'Base agent + Go 1.22 toolchain',
    dockerfilePath: 'variants/Dockerfile.go',
  },
];

export class DefaultImageManager implements ImageManager {
  private readonly commandRunner: DockerCommandRunner;
  private readonly variantsDir: string;
  private readonly logger: Logger;

  constructor(deps: ImageManagerDependencies) {
    this.commandRunner = deps.commandRunner;
    this.variantsDir = deps.variantsDir;
    this.logger = deps.logger || getLogger('image-manager');
  }

  async listImages(): Promise<DockerImage[]> {
    try {
      const { stdout } = await this.commandRunner.exec('docker', [
        'images',
        '--format', '{{json .}}',
        '--filter', `reference=${CLAUDITO_IMAGE_PREFIX}*`,
      ]);

      return this.parseImageList(stdout);
    } catch (error) {
      if (isDaemonNotRunning(error)) {
        throw error;
      }

      this.logger.error('Failed to list Docker images', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async buildImage(options: BuildImageOptions): Promise<void> {
    const dockerfilePath = path.resolve(this.variantsDir, options.dockerfilePath);
    const contextDir = options.context || this.variantsDir;

    this.logger.info('Building Docker image', {
      imageName: options.imageName,
      dockerfile: dockerfilePath,
    });

    await this.commandRunner.exec('docker', [
      'build',
      '-t', options.imageName,
      '-f', dockerfilePath,
      contextDir,
    ]);

    this.logger.info('Docker image built successfully', {
      imageName: options.imageName,
    });
  }

  async buildImageStreaming(
    options: BuildImageOptions,
    onOutput: (line: string) => void,
  ): Promise<void> {
    const dockerfilePath = path.resolve(this.variantsDir, options.dockerfilePath);
    const contextDir = options.context || this.variantsDir;

    this.logger.info('Building Docker image (streaming)', {
      imageName: options.imageName,
      dockerfile: dockerfilePath,
    });

    return new Promise<void>((resolve, reject) => {
      const child = this.commandRunner.spawn('docker', [
        'build',
        '-t', options.imageName,
        '-f', dockerfilePath,
        contextDir,
      ]);

      const processData = (data: Buffer): void => {
        const lines = data.toString().split('\n').filter(Boolean);
        lines.forEach((line) => onOutput(line));
      };

      child.stdout?.on('data', processData);
      child.stderr?.on('data', processData);

      child.on('close', (code) => {
        if (code === 0) {
          this.logger.info('Docker image built successfully', {
            imageName: options.imageName,
          });
          resolve();
        } else {
          reject(new Error(`Docker build failed with exit code ${code}`));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  async removeImage(imageName: string): Promise<void> {
    this.logger.info('Removing Docker image', { imageName });

    await this.commandRunner.exec('docker', ['rmi', imageName]);

    this.logger.info('Docker image removed', { imageName });
  }

  getAvailableVariants(): ImageVariant[] {
    return BUILT_IN_VARIANTS.map((variant) => ({
      ...variant,
      dockerfilePath: path.resolve(this.variantsDir, variant.dockerfilePath),
    }));
  }

  private parseImageList(stdout: string): DockerImage[] {
    const lines = stdout.trim().split('\n').filter(Boolean);

    return lines.map((line) => {
      const parsed = JSON.parse(line) as {
        ID: string;
        Repository: string;
        Tag: string;
        Size: string;
        CreatedAt: string;
      };

      return {
        id: parsed.ID,
        name: parsed.Repository,
        tag: parsed.Tag,
        size: parsed.Size,
        createdAt: parsed.CreatedAt,
      };
    });
  }
}
