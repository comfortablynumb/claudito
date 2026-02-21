import express, { Express } from 'express';
import request from 'supertest';
import { createDockerRouter } from '../../../src/routes/docker';
import { createErrorHandler } from '../../../src/utils/errors';
import {
  createMockDockerService,
  createMockContainerManager,
  createMockImageManager,
  createMockSettingsRepository,
  sampleContainerInfo,
  sampleDockerAvailability,
} from '../helpers/mock-factories';
import { DockerService, ContainerManager, ImageManager } from '../../../src/services/docker/types';
import { SettingsRepository } from '../../../src/repositories/settings';

describe('Docker Routes', () => {
  let app: Express;
  let dockerService: jest.Mocked<DockerService>;
  let containerManager: jest.Mocked<ContainerManager>;

  beforeEach(() => {
    dockerService = createMockDockerService();
    containerManager = createMockContainerManager();

    app = express();
    app.use(express.json());
    app.use('/api/docker', createDockerRouter({
      dockerService,
      containerManager,
    }));
    app.use(createErrorHandler());
  });

  describe('GET /api/docker/containers', () => {
    it('should return list of containers with resource usage', async () => {
      containerManager.getProjectContainers.mockResolvedValue([sampleContainerInfo]);
      dockerService.getResourceUsage.mockResolvedValue({
        cpuPercent: 5.2,
        memoryUsageMb: 256,
        memoryLimitMb: 4096,
      });

      const response = await request(app).get('/api/docker/containers');

      expect(response.status).toBe(200);
      expect(response.body.containers).toHaveLength(1);
      expect(response.body.containers[0].containerId).toBe(sampleContainerInfo.containerId);
      expect(response.body.containers[0].resourceUsage.cpuPercent).toBe(5.2);
    });

    it('should return empty list when no containers', async () => {
      containerManager.getProjectContainers.mockResolvedValue([]);

      const response = await request(app).get('/api/docker/containers');

      expect(response.status).toBe(200);
      expect(response.body.containers).toHaveLength(0);
    });

    it('should handle null resource usage', async () => {
      containerManager.getProjectContainers.mockResolvedValue([sampleContainerInfo]);
      dockerService.getResourceUsage.mockResolvedValue(null);

      const response = await request(app).get('/api/docker/containers');

      expect(response.status).toBe(200);
      expect(response.body.containers[0].resourceUsage).toBeNull();
    });
  });

  describe('GET /api/docker/containers/:projectId', () => {
    const projectId = '123e4567-e89b-12d3-a456-426614174000';

    it('should return container info for a project', async () => {
      containerManager.getContainerForProject.mockReturnValue('abc123def456');
      dockerService.getContainerStatus.mockResolvedValue(sampleContainerInfo);
      dockerService.getResourceUsage.mockResolvedValue(null);

      const response = await request(app).get(`/api/docker/containers/${projectId}`);

      expect(response.status).toBe(200);
      expect(response.body.containerId).toBe(sampleContainerInfo.containerId);
    });

    it('should return 404 when no container exists', async () => {
      containerManager.getContainerForProject.mockReturnValue(null);

      const response = await request(app).get(`/api/docker/containers/${projectId}`);

      expect(response.status).toBe(404);
    });

    it('should include resource usage', async () => {
      containerManager.getContainerForProject.mockReturnValue('abc123def456');
      dockerService.getContainerStatus.mockResolvedValue(sampleContainerInfo);
      dockerService.getResourceUsage.mockResolvedValue({
        cpuPercent: 10.5,
        memoryUsageMb: 512,
        memoryLimitMb: 4096,
      });

      const response = await request(app).get(`/api/docker/containers/${projectId}`);

      expect(response.status).toBe(200);
      expect(response.body.resourceUsage.cpuPercent).toBe(10.5);
    });
  });

  describe('POST /api/docker/containers/:projectId/restart', () => {
    const projectId = '123e4567-e89b-12d3-a456-426614174000';

    it('should restart a container', async () => {
      containerManager.getContainerForProject.mockReturnValue('abc123def456');
      dockerService.getContainerStatus.mockResolvedValue(sampleContainerInfo);

      const response = await request(app)
        .post(`/api/docker/containers/${projectId}/restart`);

      expect(response.status).toBe(200);
      expect(dockerService.stopContainer).toHaveBeenCalledWith('abc123def456');
      expect(dockerService.startContainer).toHaveBeenCalledWith('abc123def456');
    });

    it('should return 404 when no container exists', async () => {
      containerManager.getContainerForProject.mockReturnValue(null);

      const response = await request(app)
        .post(`/api/docker/containers/${projectId}/restart`);

      expect(response.status).toBe(404);
    });

    it('should return updated status after restart', async () => {
      containerManager.getContainerForProject.mockReturnValue('abc123def456');
      dockerService.getContainerStatus.mockResolvedValue({
        ...sampleContainerInfo,
        status: 'running',
      });

      const response = await request(app)
        .post(`/api/docker/containers/${projectId}/restart`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('running');
    });
  });

  describe('GET /api/docker/availability', () => {
    it('should return Docker availability status', async () => {
      dockerService.checkAvailability.mockResolvedValue(sampleDockerAvailability);

      const response = await request(app).get('/api/docker/availability');

      expect(response.status).toBe(200);
      expect(response.body.installed).toBe(true);
      expect(response.body.running).toBe(true);
      expect(response.body.version).toBe('24.0.7');
    });

    it('should return not installed status', async () => {
      dockerService.checkAvailability.mockResolvedValue({
        installed: false,
        version: null,
        running: false,
        error: 'Docker not found',
      });

      const response = await request(app).get('/api/docker/availability');

      expect(response.status).toBe(200);
      expect(response.body.installed).toBe(false);
      expect(response.body.error).toBe('Docker not found');
    });
  });

  describe('Image routes (with imageManager)', () => {
    let imageApp: Express;
    let imageManager: jest.Mocked<ImageManager>;

    beforeEach(() => {
      imageManager = createMockImageManager();

      imageApp = express();
      imageApp.use(express.json());
      imageApp.use('/api/docker', createDockerRouter({
        dockerService,
        containerManager,
        imageManager,
      }));
      imageApp.use(createErrorHandler());
    });

    describe('GET /api/docker/images', () => {
      it('should return list of images', async () => {
        imageManager.listImages.mockResolvedValue([
          { id: 'sha256:abc', name: 'claudito-agent', tag: 'latest', size: '500MB', createdAt: '2024-01-01' },
        ]);

        const response = await request(imageApp).get('/api/docker/images');

        expect(response.status).toBe(200);
        expect(response.body.images).toHaveLength(1);
        expect(response.body.images[0].name).toBe('claudito-agent');
      });

      it('should return empty array when no images', async () => {
        imageManager.listImages.mockResolvedValue([]);

        const response = await request(imageApp).get('/api/docker/images');

        expect(response.status).toBe(200);
        expect(response.body.images).toHaveLength(0);
      });

      describe('when daemon is not running', () => {
        const daemonError = new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock');

        it('should return empty images silently when Docker is disabled in settings', async () => {
          const settingsRepo: jest.Mocked<SettingsRepository> = createMockSettingsRepository({
            docker: { enabled: false, baseImage: 'claudito-agent:latest', resourceLimits: { cpus: 2, memoryMb: 4096 }, networkMode: 'bridge' },
          });
          const settingsApp = express();
          settingsApp.use(express.json());
          settingsApp.use('/api/docker', createDockerRouter({
            dockerService,
            containerManager,
            imageManager,
            settingsRepository: settingsRepo,
          }));
          settingsApp.use(createErrorHandler());

          imageManager.listImages.mockRejectedValue(daemonError);

          const response = await request(settingsApp).get('/api/docker/images');

          expect(response.status).toBe(200);
          expect(response.body.images).toHaveLength(0);
          expect(response.body.daemonNotRunning).toBeUndefined();
          expect(settingsRepo.update).not.toHaveBeenCalled();
        });

        it('should disable Docker and return warning when Docker is enabled in settings', async () => {
          const settingsRepo: jest.Mocked<SettingsRepository> = createMockSettingsRepository({
            docker: { enabled: true, baseImage: 'claudito-agent:latest', resourceLimits: { cpus: 2, memoryMb: 4096 }, networkMode: 'bridge' },
          });
          const settingsApp = express();
          settingsApp.use(express.json());
          settingsApp.use('/api/docker', createDockerRouter({
            dockerService,
            containerManager,
            imageManager,
            settingsRepository: settingsRepo,
          }));
          settingsApp.use(createErrorHandler());

          imageManager.listImages.mockRejectedValue(daemonError);

          const response = await request(settingsApp).get('/api/docker/images');

          expect(response.status).toBe(200);
          expect(response.body.images).toHaveLength(0);
          expect(response.body.daemonNotRunning).toBe(true);
          expect(response.body.warning).toContain('Docker engine does not appear to be running');
          expect(settingsRepo.update).toHaveBeenCalledWith({ docker: { enabled: false } });
        });

        it('should return empty images silently when no settingsRepository provided', async () => {
          imageManager.listImages.mockRejectedValue(daemonError);

          const response = await request(imageApp).get('/api/docker/images');

          expect(response.status).toBe(200);
          expect(response.body.images).toHaveLength(0);
          expect(response.body.daemonNotRunning).toBeUndefined();
        });
      });
    });

    describe('POST /api/docker/images/build', () => {
      it('should build an image from a variant via streaming', async () => {
        imageManager.getAvailableVariants.mockReturnValue([
          { name: 'python', displayName: 'Python', description: 'Python', dockerfilePath: '/app/docker/variants/Dockerfile.python' },
        ]);

        const response = await request(imageApp)
          .post('/api/docker/images/build')
          .send({ variantName: 'python' });

        expect(response.status).toBe(200);
        expect(response.body.built).toBe(true);
        expect(response.body.imageName).toBe('claudito-python:latest');
        expect(imageManager.buildImageStreaming).toHaveBeenCalled();
      });

      it('should return 400 when variantName is missing', async () => {
        const response = await request(imageApp)
          .post('/api/docker/images/build')
          .send({});

        expect(response.status).toBe(400);
      });

      it('should return 404 for unknown variant', async () => {
        imageManager.getAvailableVariants.mockReturnValue([]);

        const response = await request(imageApp)
          .post('/api/docker/images/build')
          .send({ variantName: 'unknown' });

        expect(response.status).toBe(404);
      });

      it('should accept custom image name', async () => {
        imageManager.getAvailableVariants.mockReturnValue([
          { name: 'python', displayName: 'Python', description: 'Python', dockerfilePath: '/app/docker/variants/Dockerfile.python' },
        ]);

        const response = await request(imageApp)
          .post('/api/docker/images/build')
          .send({ variantName: 'python', imageName: 'my-custom-image:v1' });

        expect(response.status).toBe(200);
        expect(response.body.imageName).toBe('my-custom-image:v1');
      });

      it('should broadcast build progress via WebSocket', async () => {
        const broadcastFn = jest.fn();
        const broadcastApp = express();
        broadcastApp.use(express.json());
        broadcastApp.use('/api/docker', createDockerRouter({
          dockerService,
          containerManager,
          imageManager,
          broadcast: broadcastFn,
        }));
        broadcastApp.use(createErrorHandler());

        imageManager.getAvailableVariants.mockReturnValue([
          { name: 'python', displayName: 'Python', description: 'Python', dockerfilePath: '/app/docker/variants/Dockerfile.python' },
        ]);

        const response = await request(broadcastApp)
          .post('/api/docker/images/build')
          .send({ variantName: 'python' });

        expect(response.status).toBe(200);

        // Should broadcast 'done' message after build completes
        expect(broadcastFn).toHaveBeenCalledWith(expect.objectContaining({
          type: 'docker_build_progress',
          data: expect.objectContaining({
            variantName: 'python',
            phase: 'done',
          }),
        }));
      });
    });

    describe('DELETE /api/docker/images/:name', () => {
      it('should remove an image', async () => {
        const response = await request(imageApp)
          .delete('/api/docker/images/claudito-agent:latest');

        expect(response.status).toBe(200);
        expect(response.body.removed).toBe(true);
        expect(imageManager.removeImage).toHaveBeenCalledWith('claudito-agent:latest');
      });
    });

    describe('GET /api/docker/variants', () => {
      it('should return available variants', async () => {
        imageManager.getAvailableVariants.mockReturnValue([
          { name: 'agent', displayName: 'Base Agent', description: 'Base', dockerfilePath: '/app/docker/Dockerfile.agent' },
          { name: 'python', displayName: 'Python', description: 'Python', dockerfilePath: '/app/docker/Dockerfile.python' },
        ]);

        const response = await request(imageApp).get('/api/docker/variants');

        expect(response.status).toBe(200);
        expect(response.body.variants).toHaveLength(2);
        expect(response.body.variants[0].name).toBe('agent');
      });
    });
  });
});
