import {
  InMemoryRepositoryFactory,
  createMockRepositoryFactory,
} from '../../../src/repositories/factories';
import {
  IProjectRepository,
  IConversationRepository,
  ISettingsRepository,
  IRalphLoopRepository,
} from '../../../src/repositories/interfaces';

describe('InMemoryRepositoryFactory', () => {
  describe('with mocks provided', () => {
    it('should return provided project repository', () => {
      const mockProjectRepo = {} as IProjectRepository;
      const factory = new InMemoryRepositoryFactory({
        projectRepository: mockProjectRepo,
      });

      expect(factory.createProjectRepository()).toBe(mockProjectRepo);
    });

    it('should return provided conversation repository', () => {
      const mockConvRepo = {} as IConversationRepository;
      const factory = new InMemoryRepositoryFactory({
        conversationRepository: mockConvRepo,
      });

      expect(factory.createConversationRepository()).toBe(mockConvRepo);
    });

    it('should return provided settings repository', () => {
      const mockSettingsRepo = {} as ISettingsRepository;
      const factory = new InMemoryRepositoryFactory({
        settingsRepository: mockSettingsRepo,
      });

      expect(factory.createSettingsRepository()).toBe(mockSettingsRepo);
    });

    it('should return provided ralph loop repository', () => {
      const mockRalphRepo = {} as IRalphLoopRepository;
      const factory = new InMemoryRepositoryFactory({
        ralphLoopRepository: mockRalphRepo,
      });

      expect(factory.createRalphLoopRepository()).toBe(mockRalphRepo);
    });
  });

  describe('without mocks', () => {
    it('should throw for project repository when not provided', () => {
      const factory = new InMemoryRepositoryFactory();

      expect(() => factory.createProjectRepository()).toThrow(
        'In-memory project repository not implemented'
      );
    });

    it('should throw for conversation repository when not provided', () => {
      const factory = new InMemoryRepositoryFactory();

      expect(() => factory.createConversationRepository()).toThrow(
        'In-memory conversation repository not implemented'
      );
    });

    it('should throw for settings repository when not provided', () => {
      const factory = new InMemoryRepositoryFactory();

      expect(() => factory.createSettingsRepository()).toThrow(
        'In-memory settings repository not implemented'
      );
    });

    it('should throw for ralph loop repository when not provided', () => {
      const factory = new InMemoryRepositoryFactory();

      expect(() => factory.createRalphLoopRepository()).toThrow(
        'In-memory ralph loop repository not implemented'
      );
    });
  });

  describe('with empty mocks object', () => {
    it('should throw when specific mock not provided', () => {
      const factory = new InMemoryRepositoryFactory({});

      expect(() => factory.createProjectRepository()).toThrow();
      expect(() => factory.createConversationRepository()).toThrow();
      expect(() => factory.createSettingsRepository()).toThrow();
      expect(() => factory.createRalphLoopRepository()).toThrow();
    });
  });
});

describe('createMockRepositoryFactory', () => {
  it('should create factory with all repository methods', () => {
    const factory = createMockRepositoryFactory();

    expect(factory.createProjectRepository).toBeDefined();
    expect(factory.createConversationRepository).toBeDefined();
    expect(factory.createSettingsRepository).toBeDefined();
    expect(factory.createRalphLoopRepository).toBeDefined();
  });

  it('should return mock project repository with standard methods', () => {
    const factory = createMockRepositoryFactory();
    const repo = factory.createProjectRepository();

    expect(repo.findAll).toBeDefined();
    expect(repo.findById).toBeDefined();
    expect(repo.create).toBeDefined();
    expect(repo.delete).toBeDefined();
  });

  it('should return mock conversation repository with standard methods', () => {
    const factory = createMockRepositoryFactory();
    const repo = factory.createConversationRepository();

    expect(repo.create).toBeDefined();
    expect(repo.findById).toBeDefined();
    expect(repo.getByProject).toBeDefined();
    expect(repo.addMessage).toBeDefined();
  });

  it('should return mock settings repository with standard methods', () => {
    const factory = createMockRepositoryFactory();
    const repo = factory.createSettingsRepository();

    expect(repo.get).toBeDefined();
    expect(repo.update).toBeDefined();
  });

  it('should return mock ralph loop repository with standard methods', () => {
    const factory = createMockRepositoryFactory();
    const repo = factory.createRalphLoopRepository();

    expect(repo.create).toBeDefined();
    expect(repo.findById).toBeDefined();
    expect(repo.findByProject).toBeDefined();
    expect(repo.update).toBeDefined();
  });

  it('should allow overriding individual factory methods', () => {
    const customProjectRepo = { custom: true } as unknown as IProjectRepository;
    const factory = createMockRepositoryFactory({
      createProjectRepository: jest.fn().mockReturnValue(customProjectRepo),
    });

    expect(factory.createProjectRepository()).toBe(customProjectRepo);
  });

  it('should preserve non-overridden methods when overriding', () => {
    const factory = createMockRepositoryFactory({
      createProjectRepository: jest.fn().mockReturnValue({}),
    });

    // Other methods should still work
    expect(factory.createConversationRepository).toBeDefined();
    expect(factory.createSettingsRepository).toBeDefined();
    expect(factory.createRalphLoopRepository).toBeDefined();
  });
});
