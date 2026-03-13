import {
  FileSettingsRepository,
  SettingsUpdate,
  DEFAULT_AGENT_PROMPT_TEMPLATE,
  DEFAULT_PROMPT_TEMPLATES,
  FileSystemAdapter,
} from '../../../src/repositories/settings';

describe('FileSettingsRepository', () => {
  let mockFileSystem: jest.Mocked<FileSystemAdapter>;
  let repository: FileSettingsRepository;
  const testDataDir = '/test/data';
  // const expectedFilePath = '/test/data/settings.json'; // Currently unused

  beforeEach(() => {
    mockFileSystem = {
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
      existsSync: jest.fn(),
      mkdirSync: jest.fn(),
    };
  });

  describe('constructor', () => {
    it('should create data directory if it does not exist', () => {
      mockFileSystem.existsSync.mockReturnValueOnce(false); // dataDir doesn't exist
      mockFileSystem.existsSync.mockReturnValueOnce(false); // settings file doesn't exist

      repository = new FileSettingsRepository(testDataDir, mockFileSystem);

      expect(mockFileSystem.mkdirSync).toHaveBeenCalledWith(testDataDir, { recursive: true });
    });

    it('should not create data directory if it already exists', () => {
      mockFileSystem.existsSync.mockReturnValueOnce(true); // dataDir exists
      mockFileSystem.existsSync.mockReturnValueOnce(false); // settings file doesn't exist

      repository = new FileSettingsRepository(testDataDir, mockFileSystem);

      expect(mockFileSystem.mkdirSync).not.toHaveBeenCalled();
    });

    it('should load settings from file if it exists', () => {
      const savedSettings = {
        maxConcurrentAgents: 5,
        sendWithCtrlEnter: false,
      };

      mockFileSystem.existsSync.mockReturnValueOnce(true); // dataDir exists
      mockFileSystem.existsSync.mockReturnValueOnce(true); // settings file exists
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(savedSettings));

      repository = new FileSettingsRepository(testDataDir, mockFileSystem);

      expect(mockFileSystem.readFileSync).toHaveBeenCalledWith(expect.stringContaining('settings.json'), 'utf-8');
    });

    it('should use defaults if settings file does not exist', () => {
      mockFileSystem.existsSync.mockReturnValueOnce(true); // dataDir exists
      mockFileSystem.existsSync.mockReturnValueOnce(false); // settings file doesn't exist

      repository = new FileSettingsRepository(testDataDir, mockFileSystem);

      expect(mockFileSystem.readFileSync).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    beforeEach(() => {
      mockFileSystem.existsSync.mockReturnValue(false);
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
    });

    it('should return default settings when no file exists', async () => {
      const settings = await repository.get();

      // Verify default settings structure
      expect(settings.maxConcurrentAgents).toBe(3);
      expect(settings.sendWithCtrlEnter).toBe(true);
      expect(settings.historyLimit).toBe(25);
    });

    it('should return merged settings when file exists', async () => {
      const savedSettings = {
        maxConcurrentAgents: 5,
        sendWithCtrlEnter: false,
        claudePermissions: {
          allowRules: ['Read', 'Write'],
        },
      };

      mockFileSystem.existsSync.mockReturnValueOnce(true); // dataDir exists
      mockFileSystem.existsSync.mockReturnValueOnce(true); // settings file exists
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(savedSettings));

      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.maxConcurrentAgents).toBe(5);
      expect(settings.sendWithCtrlEnter).toBe(false);
      expect(settings.claudePermissions.allowRules).toEqual(['Read', 'Write']);
      // Other fields should have defaults
      expect(settings.historyLimit).toBe(25);
    });

    it('should handle corrupted JSON gracefully', () => {
      mockFileSystem.existsSync.mockReturnValueOnce(true); // dataDir exists
      mockFileSystem.existsSync.mockReturnValueOnce(true); // settings file exists
      mockFileSystem.readFileSync.mockReturnValue('invalid json');

      repository = new FileSettingsRepository(testDataDir, mockFileSystem);

      // Should not throw and should use defaults
      expect(async () => await repository.get()).not.toThrow();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      mockFileSystem.existsSync.mockReturnValue(false);
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
    });

    it('should update and persist simple settings', async () => {
      const updates: SettingsUpdate = {
        maxConcurrentAgents: 8,
        sendWithCtrlEnter: false,
        historyLimit: 50,
      };

      const result = await repository.update(updates);

      expect(result.maxConcurrentAgents).toBe(8);
      expect(result.sendWithCtrlEnter).toBe(false);
      expect(result.historyLimit).toBe(50);

      expect(mockFileSystem.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('settings.json'),
        expect.stringContaining('"maxConcurrentAgents": 8')
      );
    });

    it('should update nested claudePermissions', async () => {
      const updates: SettingsUpdate = {
        claudePermissions: {
          allowRules: ['Read', 'Write', 'Bash'],
          defaultMode: 'plan',
        },
      };

      const result = await repository.update(updates);

      expect(result.claudePermissions.allowRules).toEqual(['Read', 'Write', 'Bash']);
      expect(result.claudePermissions.defaultMode).toBe('plan');
      // Other permissions should remain defaults
      expect(Array.isArray(result.claudePermissions.denyRules)).toBe(true);
    });

    it('should update nested agentLimits', async () => {
      const updates: SettingsUpdate = {
        agentLimits: {
          maxTurns: 20,
        },
      };

      const result = await repository.update(updates);

      expect(result.agentLimits.maxTurns).toBe(20);
    });

    it('should update nested agentStreaming', async () => {
      const updates: SettingsUpdate = {
        agentStreaming: {
          includePartialMessages: true,
          noSessionPersistence: true,
        },
      };

      const result = await repository.update(updates);

      expect(result.agentStreaming.includePartialMessages).toBe(true);
      expect(result.agentStreaming.noSessionPersistence).toBe(true);
    });

    it('should update nested ralphLoop settings', async () => {
      const updates: SettingsUpdate = {
        ralphLoop: {
          defaultMaxTurns: 10,
          defaultWorkerModel: 'claude-opus-4-6',
        },
      };

      const result = await repository.update(updates);

      expect(result.ralphLoop.defaultMaxTurns).toBe(10);
      expect(result.ralphLoop.defaultWorkerModel).toBe('claude-opus-4-6');
      // Unchanged nested property should remain
      expect(result.ralphLoop.defaultReviewerModel).toBe('claude-sonnet-4-6');
    });

    it('should update promptTemplates', async () => {
      const customTemplate = {
        id: 'custom',
        name: 'Custom Template',
        description: 'A custom template',
        content: 'Custom content',
      };

      const updates: SettingsUpdate = {
        promptTemplates: [customTemplate],
      };

      const result = await repository.update(updates);

      expect(result.promptTemplates).toEqual([customTemplate]);
    });

    it('should preserve existing settings when updating partial settings', async () => {
      // First, set some initial settings
      await repository.update({
        maxConcurrentAgents: 5,
        sendWithCtrlEnter: false,
      });

      // Then update only one setting
      const result = await repository.update({
        historyLimit: 75,
      });

      expect(result.maxConcurrentAgents).toBe(5); // Should be preserved
      expect(result.sendWithCtrlEnter).toBe(false); // Should be preserved
      expect(result.historyLimit).toBe(75); // Should be updated
    });


    it('should accept valid concurrent agents values', async () => {
      const result = await repository.update({
        maxConcurrentAgents: 5,
      });

      expect(result.maxConcurrentAgents).toBe(5);
    });

    it('should accept valid history limit values', async () => {
      const result = await repository.update({
        historyLimit: 50,
      });

      expect(result.historyLimit).toBe(50);
    });

    it('should accept valid Claude MD max size values', async () => {
      const result = await repository.update({
        claudeMdMaxSizeKB: 100,
      });

      expect(result.claudeMdMaxSizeKB).toBe(100);
    });

    it('should handle multiple setting updates', async () => {
      const result = await repository.update({
        maxConcurrentAgents: 5,
        historyLimit: 50,
      });

      expect(result.maxConcurrentAgents).toBe(5);
      expect(result.historyLimit).toBe(50);
    });

    it('should write formatted JSON to file', async () => {
      await repository.update({
        maxConcurrentAgents: 3,
      });

      expect(mockFileSystem.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('settings.json'),
        expect.stringMatching(/\{\n/) // Should be formatted JSON
      );
    });
  });

  describe('Default Settings Structure', () => {
    it('should create repository with default settings', () => {
      mockFileSystem.existsSync.mockReturnValue(false);
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);

      // Test that default settings are accessible via get()
      return repository.get().then(settings => {
        expect(settings.maxConcurrentAgents).toBe(3);
        expect(settings.sendWithCtrlEnter).toBe(true);
        expect(settings.historyLimit).toBe(25);
        expect(settings.enableDesktopNotifications).toBe(false);
        expect(settings.claudeMdMaxSizeKB).toBe(50);
        expect(settings.agentPromptTemplate).toBe(DEFAULT_AGENT_PROMPT_TEMPLATE);
        expect(settings.appendSystemPrompt).toBe(`* ALWAYS use tasks instead of todos
* ALWAYS generate mermaidjs diagrams when explaining code or when generating a plan`);

        // Check nested structures
        expect(settings.claudePermissions.defaultMode).toBe('plan');
        expect(settings.claudePermissions.dangerouslySkipPermissions).toBe(false);
        expect(Array.isArray(settings.claudePermissions.allowRules)).toBe(true);
        expect(Array.isArray(settings.claudePermissions.askRules)).toBe(true);
        expect(Array.isArray(settings.claudePermissions.denyRules)).toBe(true);

        expect(settings.agentLimits.maxTurns).toBe(0);
        expect(settings.agentStreaming.includePartialMessages).toBe(false);
        expect(settings.agentStreaming.noSessionPersistence).toBe(false);

        expect(settings.ralphLoop.defaultMaxTurns).toBe(5);
        expect(settings.ralphLoop.defaultWorkerModel).toBe('claude-opus-4-6');
        expect(settings.ralphLoop.defaultReviewerModel).toBe('claude-sonnet-4-6');

        expect(settings.promptTemplates).toEqual(DEFAULT_PROMPT_TEMPLATES);
      });
    });
  });

  describe('DEFAULT_PROMPT_TEMPLATES', () => {
    it('should include expected template types', () => {
      const templateIds = DEFAULT_PROMPT_TEMPLATES.map(t => t.id);

      expect(templateIds).toContain('bug-fix');
      expect(templateIds).toContain('documentation');
      expect(templateIds).toContain('feature-implementation');
      expect(templateIds).toContain('refactoring');
      expect(templateIds).toContain('testing');
    });

    it('should have valid template structure', () => {
      DEFAULT_PROMPT_TEMPLATES.forEach(template => {
        expect(template.id).toBeDefined();
        expect(typeof template.id).toBe('string');
        expect(template.id.length).toBeGreaterThan(0);

        expect(template.name).toBeDefined();
        expect(typeof template.name).toBe('string');
        expect(template.name.length).toBeGreaterThan(0);

        expect(template.description).toBeDefined();
        expect(typeof template.description).toBe('string');

        expect(template.content).toBeDefined();
        expect(typeof template.content).toBe('string');
        expect(template.content.length).toBeGreaterThan(0);
      });
    });

    it('should contain variable placeholders in templates', () => {
      const bugFixTemplate = DEFAULT_PROMPT_TEMPLATES.find(t => t.id === 'bug-fix');
      expect(bugFixTemplate?.content).toContain('${text:');
      expect(bugFixTemplate?.content).toContain('${textarea:');
      expect(bugFixTemplate?.content).toContain('${checkbox:');
    });
  });

  describe('mergeWithDefaults (via loadFromFile)', () => {
    it('should merge partial nested claudePermissions with defaults', async () => {
      const saved = { claudePermissions: { denyRules: ['Bash'] } };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.claudePermissions.denyRules).toEqual(['Bash']);
      expect(settings.claudePermissions.dangerouslySkipPermissions).toBe(false);
      expect(settings.claudePermissions.defaultMode).toBe('plan');
      expect(Array.isArray(settings.claudePermissions.allowRules)).toBe(true);
    });

    it('should merge partial agentLimits with defaults', async () => {
      const saved = { agentLimits: { maxTurns: 15 } };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.agentLimits.maxTurns).toBe(15);
    });

    it('should merge partial agentStreaming with defaults', async () => {
      const saved = { agentStreaming: { noSessionPersistence: true } };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.agentStreaming.noSessionPersistence).toBe(true);
      expect(settings.agentStreaming.includePartialMessages).toBe(false);
    });

    it('should merge partial ralphLoop with defaults', async () => {
      const saved = { ralphLoop: { defaultMaxTurns: 10, historyLimit: 20 } };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.ralphLoop.defaultMaxTurns).toBe(10);
      expect(settings.ralphLoop.historyLimit).toBe(20);
      expect(settings.ralphLoop.defaultWorkerModel).toBe('claude-opus-4-6');
      expect(settings.ralphLoop.defaultReviewerModel).toBe('claude-sonnet-4-6');
    });

    it('should merge partial mcp with defaults', async () => {
      const saved = { mcp: { servers: [{ id: 's1', name: 'test', enabled: true, type: 'stdio' }] } };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.mcp.servers).toHaveLength(1);
      expect(settings.mcp.enabled).toBe(true);
    });

    it('should merge partial slack with defaults', async () => {
      const saved = { slack: { enabled: true, botToken: 'xoxb-123' } };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.slack.enabled).toBe(true);
      expect(settings.slack.botToken).toBe('xoxb-123');
      expect(settings.slack.appToken).toBe('');
      expect(settings.slack.defaultChannelId).toBe('');
    });

    it('should merge partial docker with defaults', async () => {
      const saved = { docker: { enabled: true, resourceLimits: { cpus: 4 } } };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.docker.enabled).toBe(true);
      expect(settings.docker.resourceLimits.cpus).toBe(4);
      expect(settings.docker.resourceLimits.memoryMb).toBe(4096);
      expect(settings.docker.baseImage).toBe('claudito-agent:latest');
    });

    it('should merge chromeEnabled and inventifyFolder', async () => {
      const saved = { chromeEnabled: true, inventifyFolder: '/tmp/projects' };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.chromeEnabled).toBe(true);
      expect(settings.inventifyFolder).toBe('/tmp/projects');
    });

    it('should migrate old model IDs to defaults during merge', async () => {
      const saved = {
        ralphLoop: {
          defaultWorkerModel: 'claude-sonnet-4-20250514',
          defaultReviewerModel: 'claude-opus-4-20250514',
        },
      };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      // Old model IDs should fall back to defaults
      expect(settings.ralphLoop.defaultWorkerModel).toBe('claude-opus-4-6');
      expect(settings.ralphLoop.defaultReviewerModel).toBe('claude-sonnet-4-6');
    });

    it('should keep non-old model IDs as-is during merge', async () => {
      const saved = {
        ralphLoop: {
          defaultWorkerModel: 'claude-opus-4-6',
          defaultReviewerModel: 'custom-model-v2',
        },
      };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.ralphLoop.defaultWorkerModel).toBe('claude-opus-4-6');
      expect(settings.ralphLoop.defaultReviewerModel).toBe('custom-model-v2');
    });
  });

  describe('mergeProfiles (via loadFromFile)', () => {
    it('should return default profile when agentProfiles is undefined', async () => {
      const saved = {};
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.agentProfiles).toHaveLength(1);
      expect(settings.agentProfiles[0]!.id).toBe('default');
      expect(settings.agentProfiles[0]!.isDefault).toBe(true);
    });

    it('should return default profile when agentProfiles is empty', async () => {
      const saved = { agentProfiles: [] };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.agentProfiles).toHaveLength(1);
      expect(settings.agentProfiles[0]!.isDefault).toBe(true);
    });

    it('should set first profile as default if none has isDefault', async () => {
      const saved = {
        agentProfiles: [
          { id: 'p1', name: 'Profile 1', provider: 'anthropic', isDefault: false },
          { id: 'p2', name: 'Profile 2', provider: 'opencode', isDefault: false },
        ],
      };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.agentProfiles[0]!.isDefault).toBe(true);
      expect(settings.agentProfiles[1]!.isDefault).toBe(false);
    });

    it('should preserve existing profiles when one has isDefault', async () => {
      const saved = {
        agentProfiles: [
          { id: 'p1', name: 'Profile 1', provider: 'anthropic', isDefault: false },
          { id: 'p2', name: 'Profile 2', provider: 'opencode', isDefault: true },
        ],
      };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.agentProfiles).toHaveLength(2);
      expect(settings.agentProfiles[0]!.isDefault).toBe(false);
      expect(settings.agentProfiles[1]!.isDefault).toBe(true);
    });
  });

  describe('mergeTemplates (via loadFromFile)', () => {
    it('should return defaults when promptTemplates is not an array', async () => {
      const saved = { promptTemplates: 'invalid' as unknown };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      expect(settings.promptTemplates).toEqual(DEFAULT_PROMPT_TEMPLATES);
    });

    it('should update existing default templates to latest content', async () => {
      const saved = {
        promptTemplates: [
          { id: 'bug-fix', name: 'Old Bug Fix', description: 'old', content: 'old content' },
        ],
      };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      const bugFix = settings.promptTemplates.find(t => t.id === 'bug-fix');
      expect(bugFix).toBeDefined();
      // Should be updated to latest default version
      expect(bugFix!.name).toBe('Bug Fix');
      expect(bugFix!.content).toContain('${text:location}');
    });

    it('should preserve user-created templates', async () => {
      const saved = {
        promptTemplates: [
          { id: 'my-custom', name: 'Custom', description: 'mine', content: 'my content' },
        ],
      };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      const custom = settings.promptTemplates.find(t => t.id === 'my-custom');
      expect(custom).toBeDefined();
      expect(custom!.content).toBe('my content');
      // Should also add back missing defaults
      expect(settings.promptTemplates.length).toBeGreaterThan(1);
    });

    it('should add missing default templates', async () => {
      const saved = {
        promptTemplates: [
          { id: 'bug-fix', name: 'Old', description: 'x', content: 'x' },
        ],
      };
      mockFileSystem.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFileSystem.readFileSync.mockReturnValue(JSON.stringify(saved));
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
      const settings = await repository.get();

      const ids = settings.promptTemplates.map(t => t.id);
      expect(ids).toContain('documentation');
      expect(ids).toContain('feature-implementation');
      expect(ids).toContain('refactoring');
      expect(ids).toContain('testing');
    });
  });

  describe('update validation clamping', () => {
    beforeEach(() => {
      mockFileSystem.existsSync.mockReturnValue(false);
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
    });

    it('should clamp maxConcurrentAgents to minimum of 1', async () => {
      const result = await repository.update({ maxConcurrentAgents: 0 });
      expect(result.maxConcurrentAgents).toBe(1);

      const result2 = await repository.update({ maxConcurrentAgents: -5 });
      expect(result2.maxConcurrentAgents).toBe(1);
    });

    it('should clamp historyLimit to [5, 100]', async () => {
      const low = await repository.update({ historyLimit: 1 });
      expect(low.historyLimit).toBe(5);

      const high = await repository.update({ historyLimit: 500 });
      expect(high.historyLimit).toBe(100);
    });

    it('should clamp claudeMdMaxSizeKB to [10, 500]', async () => {
      const low = await repository.update({ claudeMdMaxSizeKB: 1 });
      expect(low.claudeMdMaxSizeKB).toBe(10);

      const high = await repository.update({ claudeMdMaxSizeKB: 1000 });
      expect(high.claudeMdMaxSizeKB).toBe(500);
    });

    it('should clamp negative agentLimits.maxTurns to 0', async () => {
      const result = await repository.update({ agentLimits: { maxTurns: -10 } });
      expect(result.agentLimits.maxTurns).toBe(0);
    });

    it('should clamp ralphLoop.defaultMaxTurns to minimum of 1', async () => {
      const result = await repository.update({ ralphLoop: { defaultMaxTurns: 0 } });
      expect(result.ralphLoop.defaultMaxTurns).toBe(1);

      const result2 = await repository.update({ ralphLoop: { defaultMaxTurns: -5 } });
      expect(result2.ralphLoop.defaultMaxTurns).toBe(1);
    });

    it('should clamp ralphLoop.historyLimit to [1, 50]', async () => {
      const low = await repository.update({ ralphLoop: { historyLimit: 0 } });
      expect(low.ralphLoop.historyLimit).toBe(1);

      const high = await repository.update({ ralphLoop: { historyLimit: 100 } });
      expect(high.ralphLoop.historyLimit).toBe(50);
    });

    it('should clamp docker resource limits cpus to [0.5, 16]', async () => {
      const low = await repository.update({ docker: { resourceLimits: { cpus: 0.1, memoryMb: 1024 } } });
      expect(low.docker.resourceLimits.cpus).toBe(0.5);

      const high = await repository.update({ docker: { resourceLimits: { cpus: 32, memoryMb: 1024 } } });
      expect(high.docker.resourceLimits.cpus).toBe(16);
    });

    it('should clamp docker resource limits memoryMb to [512, 32768]', async () => {
      const low = await repository.update({ docker: { resourceLimits: { cpus: 2, memoryMb: 100 } } });
      expect(low.docker.resourceLimits.memoryMb).toBe(512);

      const high = await repository.update({ docker: { resourceLimits: { cpus: 2, memoryMb: 99999 } } });
      expect(high.docker.resourceLimits.memoryMb).toBe(32768);
    });
  });

  describe('update nested settings', () => {
    beforeEach(() => {
      mockFileSystem.existsSync.mockReturnValue(false);
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);
    });

    it('should update mcp settings', async () => {
      const result = await repository.update({
        mcp: { enabled: false, servers: [] },
      });

      expect(result.mcp.enabled).toBe(false);
      expect(result.mcp.servers).toEqual([]);
    });

    it('should update slack settings', async () => {
      const result = await repository.update({
        slack: { enabled: true, botToken: 'xoxb-test' },
      });

      expect(result.slack.enabled).toBe(true);
      expect(result.slack.botToken).toBe('xoxb-test');
    });

    it('should update chromeEnabled', async () => {
      const result = await repository.update({ chromeEnabled: true });
      expect(result.chromeEnabled).toBe(true);
    });

    it('should update inventifyFolder', async () => {
      const result = await repository.update({ inventifyFolder: '/projects' });
      expect(result.inventifyFolder).toBe('/projects');
    });

    it('should update enableDesktopNotifications', async () => {
      const result = await repository.update({ enableDesktopNotifications: true });
      expect(result.enableDesktopNotifications).toBe(true);
    });

    it('should update appendSystemPrompt', async () => {
      const result = await repository.update({ appendSystemPrompt: 'custom prompt' });
      expect(result.appendSystemPrompt).toBe('custom prompt');
    });

    it('should update agentProfiles', async () => {
      const profiles = [
        { id: 'test', name: 'Test', provider: 'anthropic' as const, isDefault: true },
      ];
      const result = await repository.update({ agentProfiles: profiles });
      expect(result.agentProfiles).toEqual(profiles);
    });

    it('should update docker with partial resourceLimits preserving existing', async () => {
      // First set initial docker config
      await repository.update({
        docker: { resourceLimits: { cpus: 4, memoryMb: 8192 } },
      });

      // Then update only cpus
      const result = await repository.update({
        docker: { resourceLimits: { cpus: 8, memoryMb: 8192 } },
      });

      expect(result.docker.resourceLimits.cpus).toBe(8);
      expect(result.docker.resourceLimits.memoryMb).toBe(8192);
    });
  });

  describe('File system integration', () => {
    it('should handle file system errors gracefully', async () => {
      mockFileSystem.writeFileSync.mockImplementation(() => {
        throw new Error('Disk full');
      });
      mockFileSystem.existsSync.mockReturnValue(false);

      repository = new FileSettingsRepository(testDataDir, mockFileSystem);

      await expect(async () => {
        await repository.update({ maxConcurrentAgents: 5 });
      }).rejects.toThrow('Disk full');
    });

    it('should handle read errors gracefully', () => {
      mockFileSystem.existsSync.mockReturnValueOnce(true); // dataDir exists
      mockFileSystem.existsSync.mockReturnValueOnce(true); // settings file exists
      mockFileSystem.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should fall back to defaults instead of throwing
      repository = new FileSettingsRepository(testDataDir, mockFileSystem);

      expect(async () => await repository.get()).not.toThrow();
    });
  });
});