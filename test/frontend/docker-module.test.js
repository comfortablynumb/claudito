const DockerModule = require('../../public/js/modules/docker-module');

/**
 * Creates a mock jQuery deferred-like return value with .done() and .fail()
 */
function createMockJqXhr(resolveData) {
  var obj = {
    done: jest.fn().mockImplementation(function(cb) {
      if (resolveData !== undefined) cb(resolveData);
      return obj;
    }),
    fail: jest.fn().mockImplementation(function() {
      return obj;
    }),
    always: jest.fn().mockImplementation(function(cb) {
      if (cb) cb();
      return obj;
    }),
  };

  return obj;
}

function createMockFailingJqXhr() {
  var obj = {
    done: jest.fn().mockImplementation(function() {
      return obj;
    }),
    fail: jest.fn().mockImplementation(function(cb) {
      if (cb) cb({ status: 500, responseJSON: { error: 'fail' } });
      return obj;
    }),
    always: jest.fn().mockImplementation(function(cb) {
      if (cb) cb();
      return obj;
    }),
  };

  return obj;
}

describe('DockerModule', () => {
  let mockApi;
  let mockState;
  let mockShowToast;
  let mockShowErrorToast;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="docker-availability-status"></div>
      <input type="checkbox" id="input-docker-enabled">
      <input type="text" id="input-docker-base-image" value="">
      <input type="number" id="input-docker-cpus" value="">
      <input type="number" id="input-docker-memory" value="">
      <select id="input-docker-network">
        <option value="bridge">Bridge</option>
        <option value="none">None</option>
      </select>
      <div id="docker-images-list"></div>
      <select id="docker-variant-select"></select>
      <button id="btn-check-docker"></button>
      <button id="btn-refresh-images"></button>
      <button id="btn-build-image"></button>
    `;

    mockApi = {
      getDockerAvailability: jest.fn(),
      getDockerImages: jest.fn(),
      getDockerVariants: jest.fn(),
      buildDockerImage: jest.fn(),
      removeDockerImage: jest.fn(),
    };

    mockState = { settings: {} };
    mockShowToast = jest.fn();
    mockShowErrorToast = jest.fn();

    DockerModule.init({
      api: mockApi,
      state: mockState,
      showToast: mockShowToast,
      showErrorToast: mockShowErrorToast,
    });
  });

  describe('populateSettingsFields', () => {
    it('should populate fields from settings', () => {
      DockerModule.populateSettingsFields({
        docker: {
          enabled: true,
          baseImage: 'my-image:v1',
          resourceLimits: { cpus: 4.0, memoryMb: 8192 },
          networkMode: 'none',
        },
      });

      expect($('#input-docker-enabled').prop('checked')).toBe(true);
      expect($('#input-docker-base-image').val()).toBe('my-image:v1');
      expect($('#input-docker-cpus').val()).toBe('4');
      expect($('#input-docker-memory').val()).toBe('8192');
      expect($('#input-docker-network').val()).toBe('none');
    });

    it('should use defaults when no docker settings', () => {
      DockerModule.populateSettingsFields({});

      expect($('#input-docker-enabled').prop('checked')).toBe(false);
      expect($('#input-docker-base-image').val()).toBe('claudito-agent:latest');
      expect($('#input-docker-cpus').val()).toBe('2');
      expect($('#input-docker-memory').val()).toBe('4096');
      expect($('#input-docker-network').val()).toBe('bridge');
    });

    it('should handle partial docker settings', () => {
      DockerModule.populateSettingsFields({
        docker: {
          enabled: true,
        },
      });

      expect($('#input-docker-enabled').prop('checked')).toBe(true);
      expect($('#input-docker-base-image').val()).toBe('claudito-agent:latest');
      expect($('#input-docker-cpus').val()).toBe('2');
      expect($('#input-docker-memory').val()).toBe('4096');
    });
  });

  describe('collectSettingsFields', () => {
    it('should collect values from form fields', () => {
      $('#input-docker-enabled').prop('checked', true);
      $('#input-docker-base-image').val('custom:latest');
      $('#input-docker-cpus').val('8');
      $('#input-docker-memory').val('16384');
      $('#input-docker-network').val('none');

      var result = DockerModule.collectSettingsFields();

      expect(result).toEqual({
        enabled: true,
        baseImage: 'custom:latest',
        resourceLimits: { cpus: 8, memoryMb: 16384 },
        networkMode: 'none',
      });
    });

    it('should return defaults for empty fields', () => {
      var result = DockerModule.collectSettingsFields();

      expect(result.enabled).toBe(false);
      expect(result.baseImage).toBe('claudito-agent:latest');
      expect(result.resourceLimits.cpus).toBe(2.0);
      expect(result.resourceLimits.memoryMb).toBe(4096);
      expect(result.networkMode).toBe('bridge');
    });
  });

  describe('checkAndRenderAvailability', () => {
    it('should show running status when Docker is available', () => {
      mockApi.getDockerAvailability.mockReturnValue(
        createMockJqXhr({ installed: true, running: true, version: '24.0.7' })
      );

      DockerModule.checkAndRenderAvailability();

      var html = $('#docker-availability-status').html();
      expect(html).toContain('24.0.7');
      expect(html).toContain('running');
    });

    it('should show not installed when Docker missing', () => {
      mockApi.getDockerAvailability.mockReturnValue(
        createMockJqXhr({ installed: false, running: false, version: null })
      );

      DockerModule.checkAndRenderAvailability();

      var html = $('#docker-availability-status').html();
      expect(html).toContain('not installed');
    });

    it('should show installed but not running', () => {
      mockApi.getDockerAvailability.mockReturnValue(
        createMockJqXhr({ installed: true, running: false, version: '24.0.7' })
      );

      DockerModule.checkAndRenderAvailability();

      var html = $('#docker-availability-status').html();
      expect(html).toContain('not running');
    });

    it('should handle API failure', () => {
      mockApi.getDockerAvailability.mockReturnValue(createMockFailingJqXhr());

      DockerModule.checkAndRenderAvailability();

      var html = $('#docker-availability-status').html();
      expect(html).toContain('Unable to check');
    });
  });

  describe('loadAndRenderImages', () => {
    it('should render image list', () => {
      mockApi.getDockerImages.mockReturnValue(
        createMockJqXhr({
          images: [
            { name: 'claudito-agent', tag: 'latest', size: '500MB', id: 'sha256:abc' },
          ],
        })
      );

      DockerModule.loadAndRenderImages();

      var html = $('#docker-images-list').html();
      expect(html).toContain('claudito-agent');
      expect(html).toContain('latest');
      expect(html).toContain('500MB');
    });

    it('should show empty message when no images', () => {
      mockApi.getDockerImages.mockReturnValue(
        createMockJqXhr({ images: [] })
      );

      DockerModule.loadAndRenderImages();

      var html = $('#docker-images-list').html();
      expect(html).toContain('No Claudito images found');
    });

    it('should render multiple images', () => {
      mockApi.getDockerImages.mockReturnValue(
        createMockJqXhr({
          images: [
            { name: 'claudito-agent', tag: 'latest', size: '500MB', id: 'sha256:abc' },
            { name: 'claudito-python', tag: 'latest', size: '800MB', id: 'sha256:def' },
          ],
        })
      );

      DockerModule.loadAndRenderImages();

      var html = $('#docker-images-list').html();
      expect(html).toContain('claudito-agent');
      expect(html).toContain('claudito-python');
      expect(html).toContain('800MB');
    });

    it('should include remove button per image', () => {
      mockApi.getDockerImages.mockReturnValue(
        createMockJqXhr({
          images: [
            { name: 'claudito-agent', tag: 'latest', size: '500MB', id: 'sha256:abc' },
          ],
        })
      );

      DockerModule.loadAndRenderImages();

      var html = $('#docker-images-list').html();
      expect(html).toContain('btn-remove-image');
      expect(html).toContain('data-name="claudito-agent:latest"');
    });
  });

  describe('onSettingsTabOpen', () => {
    it('should trigger availability check, variants load, and images load', () => {
      mockApi.getDockerAvailability.mockReturnValue(createMockJqXhr({ installed: true, running: true, version: '24.0.7' }));
      mockApi.getDockerVariants.mockReturnValue(createMockJqXhr({ variants: [] }));
      mockApi.getDockerImages.mockReturnValue(createMockJqXhr({ images: [] }));

      DockerModule.onSettingsTabOpen();

      expect(mockApi.getDockerAvailability).toHaveBeenCalled();
      expect(mockApi.getDockerVariants).toHaveBeenCalled();
      expect(mockApi.getDockerImages).toHaveBeenCalled();
    });
  });

  describe('handleBuildProgress', () => {
    it('should create output area and append building lines', () => {
      // Render images list first so the output area can be appended after it
      mockApi.getDockerImages.mockReturnValue(createMockJqXhr({ images: [] }));
      DockerModule.loadAndRenderImages();

      DockerModule.handleBuildProgress({
        variantName: 'python',
        imageName: 'claudito-python:latest',
        line: 'Step 1/5 : FROM node:22',
        phase: 'building',
      });

      var $output = $('#docker-build-output');
      expect($output.length).toBe(1);
      expect($output.html()).toContain('Step 1/5');
      expect($output.html()).toContain('text-gray-400');
    });

    it('should show error lines in red', () => {
      mockApi.getDockerImages.mockReturnValue(createMockJqXhr({ images: [] }));
      DockerModule.loadAndRenderImages();

      DockerModule.handleBuildProgress({
        variantName: 'python',
        imageName: 'claudito-python:latest',
        line: 'ERROR: failed to build',
        phase: 'error',
      });

      var $output = $('#docker-build-output');
      expect($output.html()).toContain('text-red-400');
    });

    it('should show done lines in green', () => {
      mockApi.getDockerImages.mockReturnValue(createMockJqXhr({ images: [] }));
      DockerModule.loadAndRenderImages();

      DockerModule.handleBuildProgress({
        variantName: 'python',
        imageName: 'claudito-python:latest',
        line: 'Build completed successfully',
        phase: 'done',
      });

      var $output = $('#docker-build-output');
      expect($output.html()).toContain('text-green-400');
    });

    it('should re-enable buttons on done', () => {
      // Disable buttons first
      $('#btn-build-image').prop('disabled', true).text('Building...');

      mockApi.getDockerImages.mockReturnValue(createMockJqXhr({ images: [] }));
      DockerModule.loadAndRenderImages();

      DockerModule.handleBuildProgress({
        variantName: 'python',
        imageName: 'claudito-python:latest',
        line: 'Build completed successfully',
        phase: 'done',
      });

      expect($('#btn-build-image').prop('disabled')).toBe(false);
      expect($('#btn-build-image').text()).toBe('Build');
    });

    it('should re-enable buttons on error', () => {
      $('#btn-build-image').prop('disabled', true).text('Building...');

      mockApi.getDockerImages.mockReturnValue(createMockJqXhr({ images: [] }));
      DockerModule.loadAndRenderImages();

      DockerModule.handleBuildProgress({
        variantName: 'python',
        imageName: 'claudito-python:latest',
        line: 'Build failed',
        phase: 'error',
      });

      expect($('#btn-build-image').prop('disabled')).toBe(false);
      expect($('#btn-build-image').text()).toBe('Build');
    });
  });
});
