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