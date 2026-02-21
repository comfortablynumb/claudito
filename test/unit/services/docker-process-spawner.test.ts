import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import { DockerProcessSpawner } from '../../../src/services/docker/docker-process-spawner';
import { ProcessSpawner, SpawnOptions } from '../../../src/agents/process-manager';

function createMockHostSpawner(): jest.Mocked<ProcessSpawner> {
  return {
    spawn: jest.fn().mockReturnValue(new EventEmitter() as unknown as ChildProcess),
  };
}

describe('DockerProcessSpawner', () => {
  let hostSpawner: jest.Mocked<ProcessSpawner>;
  let spawner: DockerProcessSpawner;

  const containerId = 'abc123def456';
  const workDir = '/workspace';

  beforeEach(() => {
    hostSpawner = createMockHostSpawner();
    spawner = new DockerProcessSpawner({ containerId, workDir }, hostSpawner);
  });

  it('should translate spawn into docker exec command', () => {
    const options: SpawnOptions = {
      cwd: '/host/path',
      shell: false,
      windowsHide: true,
    };

    spawner.spawn('claude', ['--json', '-p', 'hello'], options);

    expect(hostSpawner.spawn).toHaveBeenCalledWith(
      'docker',
      ['exec', '-i', '-w', '/workspace', containerId, 'claude', '--json', '-p', 'hello'],
      { cwd: '/host/path', shell: false, windowsHide: true },
    );
  });

  it('should forward whitelisted env vars as -e flags', () => {
    const options: SpawnOptions = {
      cwd: '/host/path',
      shell: false,
      windowsHide: true,
      env: {
        ANTHROPIC_API_KEY: 'sk-test-123',
        FORCE_COLOR: '1',
        AWS_REGION: 'us-east-1',
      },
    };

    spawner.spawn('claude', ['--json'], options);

    const envFlags = extractEnvFlags(hostSpawner.spawn.mock.calls[0]![1]);

    expect(envFlags).toContain('ANTHROPIC_API_KEY=sk-test-123');
    expect(envFlags).toContain('FORCE_COLOR=1');
    expect(envFlags).toContain('AWS_REGION=us-east-1');
  });

  it('should NOT forward Windows-specific env vars', () => {
    const options: SpawnOptions = {
      cwd: '/host/path',
      shell: false,
      windowsHide: true,
      env: {
        HOME: 'C:\\Users\\comfo',
        USERPROFILE: 'C:\\Users\\comfo',
        TEMP: 'C:\\Users\\comfo\\AppData\\Local\\Temp',
        PATH: 'C:\\Windows\\system32;C:\\Windows',
        NODE_ENV: 'production',
        npm_config_cache: 'C:\\Users\\comfo\\AppData\\npm-cache',
        ANTHROPIC_API_KEY: 'sk-test-123',
      },
    };

    spawner.spawn('claude', ['--json'], options);

    const envFlags = extractEnvFlags(hostSpawner.spawn.mock.calls[0]![1]);

    expect(envFlags).toHaveLength(1);
    expect(envFlags).toContain('ANTHROPIC_API_KEY=sk-test-123');
    expect(envFlags).not.toContainEqual(expect.stringContaining('HOME='));
    expect(envFlags).not.toContainEqual(expect.stringContaining('USERPROFILE='));
    expect(envFlags).not.toContainEqual(expect.stringContaining('TEMP='));
    expect(envFlags).not.toContainEqual(expect.stringContaining('PATH='));
    expect(envFlags).not.toContainEqual(expect.stringContaining('NODE_ENV='));
  });

  it('should always use shell: false for docker commands', () => {
    spawner.spawn('claude', [], {
      cwd: '/some/path',
      shell: true,
      windowsHide: true,
    });

    const callOptions = hostSpawner.spawn.mock.calls[0]![2];
    expect(callOptions.shell).toBe(false);
  });

  it('should always use windowsHide: true', () => {
    spawner.spawn('claude', [], {
      cwd: '/some/path',
      shell: false,
      windowsHide: false,
    });

    const callOptions = hostSpawner.spawn.mock.calls[0]![2];
    expect(callOptions.windowsHide).toBe(true);
  });

  it('should use the configured work directory', () => {
    const customSpawner = new DockerProcessSpawner(
      { containerId, workDir: '/custom/work' },
      hostSpawner,
    );

    customSpawner.spawn('node', ['script.js'], {
      cwd: '/host/path',
      shell: false,
      windowsHide: true,
    });

    const args = hostSpawner.spawn.mock.calls[0]![1];
    expect(args).toContain('-w');
    expect(args[args.indexOf('-w') + 1]).toBe('/custom/work');
  });

  it('should pass the correct container ID', () => {
    const customSpawner = new DockerProcessSpawner(
      { containerId: 'my-container-id', workDir },
      hostSpawner,
    );

    customSpawner.spawn('claude', [], {
      cwd: '/host/path',
      shell: false,
      windowsHide: true,
    });

    const args = hostSpawner.spawn.mock.calls[0]![1];
    expect(args).toContain('my-container-id');
  });

  it('should return the child process from host spawner', () => {
    const mockProcess = new EventEmitter() as unknown as ChildProcess;
    hostSpawner.spawn.mockReturnValue(mockProcess);

    const result = spawner.spawn('claude', [], {
      cwd: '/host/path',
      shell: false,
      windowsHide: true,
    });

    expect(result).toBe(mockProcess);
  });

  it('should handle empty args', () => {
    spawner.spawn('claude', [], {
      cwd: '/host/path',
      shell: false,
      windowsHide: true,
    });

    const args = hostSpawner.spawn.mock.calls[0]![1];
    expect(args).toEqual(['exec', '-i', '-w', '/workspace', containerId, 'claude']);
  });

  it('should handle no env vars', () => {
    spawner.spawn('claude', ['--help'], {
      cwd: '/host/path',
      shell: false,
      windowsHide: true,
    });

    const args = hostSpawner.spawn.mock.calls[0]![1];
    expect(args).not.toContain('-e');
    expect(args).toEqual([
      'exec', '-i', '-w', '/workspace', containerId, 'claude', '--help',
    ]);
  });
});

function extractEnvFlags(args: string[]): string[] {
  const flags: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-e') {
      flags.push(args[i + 1]!);
    }
  }

  return flags;
}
