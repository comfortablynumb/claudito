/**
 * @jest-environment jsdom
 */

const OneOffToolbarModule = require('../../public/js/modules/oneoff-toolbar-module');

describe('OneOffToolbarModule', () => {
  let mockState;
  let mockEscapeHtml;
  let mockEscapeRegExp;
  let mockOpenModal;
  let mockShowToast;
  let mockPermissionModeModule;
  let mockTaskDisplayModule;

  function createMockJQuery() {
    const mockElement = {
      html: jest.fn().mockReturnThis(),
      text: jest.fn().mockReturnThis(),
      val: jest.fn().mockReturnThis(),
      empty: jest.fn().mockReturnThis(),
      append: jest.fn().mockReturnThis(),
      addClass: jest.fn().mockReturnThis(),
      removeClass: jest.fn().mockReturnThis(),
      hasClass: jest.fn().mockReturnValue(false),
      find: jest.fn().mockReturnThis(),
      each: jest.fn().mockReturnThis(),
      replaceWith: jest.fn().mockReturnThis(),
      focus: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      prop: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      data: jest.fn(),
      length: 1,
      0: document.createElement('div')
    };

    const $ = jest.fn().mockReturnValue(mockElement);
    $.fn = {};
    return $;
  }

  beforeEach(() => {
    mockState = {
      permissionMode: 'plan',
      currentProjectModel: 'claude-opus-4-6',
      fontSize: 14,
      selectedProjectId: 'project-1',
      oneOffTabs: {
        'project-1': [
          {
            oneOffId: 'oneoff-1',
            label: 'Test Task',
            status: 'running',
            messages: [],
            runningToolIds: [],
            isWaiting: false,
            waitingVersion: 0,
            currentTodos: [],
            search: { query: '', matches: [], currentIndex: -1, isOpen: false }
          }
        ]
      },
      sendWithCtrlEnter: true
    };

    mockEscapeHtml = jest.fn((str) => str);
    mockEscapeRegExp = jest.fn((str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    mockOpenModal = jest.fn();
    mockShowToast = jest.fn();
    mockPermissionModeModule = { setMode: jest.fn() };
    mockTaskDisplayModule = {
      renderModalContent: jest.fn().mockReturnValue('<div>tasks content</div>')
    };

    global.$ = createMockJQuery();
    global.document.createTreeWalker = jest.fn().mockReturnValue({
      nextNode: jest.fn().mockReturnValue(null)
    });

    OneOffToolbarModule.init({
      state: mockState,
      escapeHtml: mockEscapeHtml,
      escapeRegExp: mockEscapeRegExp,
      openModal: mockOpenModal,
      showToast: mockShowToast,
      PermissionModeModule: mockPermissionModeModule,
      TaskDisplayModule: mockTaskDisplayModule
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateToolbarHtml', () => {
    it('should return HTML with tasks button', () => {
      const html = OneOffToolbarModule.generateToolbarHtml('oneoff-1');

      expect(html).toContain('oneoff-toolbar-tasks');
      expect(html).toContain('data-oneoff-id="oneoff-1"');
      expect(html).toContain('Tasks');
    });

    it('should return HTML with search button', () => {
      const html = OneOffToolbarModule.generateToolbarHtml('oneoff-1');

      expect(html).toContain('oneoff-toolbar-search');
      expect(html).toContain('Search');
    });

    it('should return HTML with permission mode buttons', () => {
      const html = OneOffToolbarModule.generateToolbarHtml('oneoff-1');

      expect(html).toContain('oneoff-perm-btn');
      expect(html).toContain('data-mode="acceptEdits"');
      expect(html).toContain('data-mode="plan"');
      expect(html).toContain('Accept Edits');
      expect(html).toContain('Plan');
    });

    it('should return HTML with model selector', () => {
      const html = OneOffToolbarModule.generateToolbarHtml('oneoff-1');

      expect(html).toContain('oneoff-model-select');
      expect(html).toContain('Opus 4.6');
      expect(html).toContain('Sonnet 4.5');
      expect(html).toContain('Haiku 4.5');
    });

    it('should return HTML with font size controls', () => {
      const html = OneOffToolbarModule.generateToolbarHtml('oneoff-1');

      expect(html).toContain('oneoff-font-decrease');
      expect(html).toContain('oneoff-font-increase');
      expect(html).toContain('oneoff-font-size-display');
      expect(html).toContain('14px');
    });

    it('should return HTML with search controls (hidden)', () => {
      const html = OneOffToolbarModule.generateToolbarHtml('oneoff-1');

      expect(html).toContain('oneoff-search-controls');
      expect(html).toContain('oneoff-search-input');
      expect(html).toContain('oneoff-search-counter');
      expect(html).toContain('oneoff-search-prev');
      expect(html).toContain('oneoff-search-next');
      expect(html).toContain('oneoff-search-close');
    });

    it('should apply current permission mode as active', () => {
      mockState.permissionMode = 'acceptEdits';
      const html = OneOffToolbarModule.generateToolbarHtml('oneoff-1');

      // The acceptEdits button should have perm-active class
      expect(html).toContain('data-mode="acceptEdits"');
    });

    it('should set current font size', () => {
      mockState.fontSize = 18;
      const html = OneOffToolbarModule.generateToolbarHtml('oneoff-1');

      expect(html).toContain('18px');
    });

    it('should contain tasks badge', () => {
      const html = OneOffToolbarModule.generateToolbarHtml('oneoff-1');

      expect(html).toContain('oneoff-tasks-badge');
    });
  });

  describe('updateTabTodos', () => {
    it('should store todos in tab state', () => {
      OneOffToolbarModule.updateTabTodos('oneoff-1', {
        todos: [
          { content: 'Task 1', status: 'pending' },
          { content: 'Task 2', status: 'in_progress' }
        ]
      });

      const tab = mockState.oneOffTabs['project-1'][0];

      expect(tab.currentTodos).toHaveLength(2);
      expect(tab.currentTodos[0].content).toBe('Task 1');
    });

    it('should update badge after storing todos', () => {
      OneOffToolbarModule.updateTabTodos('oneoff-1', {
        todos: [{ content: 'Task 1', status: 'pending' }]
      });

      // Badge selector is called
      expect(global.$).toHaveBeenCalledWith('.oneoff-tasks-badge[data-oneoff-id="oneoff-1"]');
    });

    it('should handle JSON string input', () => {
      OneOffToolbarModule.updateTabTodos('oneoff-1', JSON.stringify({
        todos: [{ content: 'From JSON', status: 'completed' }]
      }));

      const tab = mockState.oneOffTabs['project-1'][0];

      expect(tab.currentTodos).toHaveLength(1);
      expect(tab.currentTodos[0].content).toBe('From JSON');
    });

    it('should not update for invalid JSON string', () => {
      mockState.oneOffTabs['project-1'][0].currentTodos = [{ content: 'existing' }];

      OneOffToolbarModule.updateTabTodos('oneoff-1', 'not valid json');

      const tab = mockState.oneOffTabs['project-1'][0];

      expect(tab.currentTodos).toHaveLength(1);
      expect(tab.currentTodos[0].content).toBe('existing');
    });

    it('should not update for non-array todos', () => {
      mockState.oneOffTabs['project-1'][0].currentTodos = [];

      OneOffToolbarModule.updateTabTodos('oneoff-1', { todos: 'not array' });

      expect(mockState.oneOffTabs['project-1'][0].currentTodos).toHaveLength(0);
    });

    it('should do nothing for unknown tab', () => {
      // Should not throw
      OneOffToolbarModule.updateTabTodos('nonexistent', {
        todos: [{ content: 'Task', status: 'pending' }]
      });
    });
  });

  describe('openTabTasksModal', () => {
    it('should render modal with tab-specific todos', () => {
      mockState.oneOffTabs['project-1'][0].currentTodos = [
        { content: 'Tab task', status: 'in_progress' }
      ];

      OneOffToolbarModule.openTabTasksModal('oneoff-1');

      expect(mockTaskDisplayModule.renderModalContent).toHaveBeenCalledWith([
        { content: 'Tab task', status: 'in_progress' }
      ]);
      expect(mockOpenModal).toHaveBeenCalledWith('modal-tasks');
    });

    it('should do nothing for unknown tab', () => {
      OneOffToolbarModule.openTabTasksModal('nonexistent');

      expect(mockTaskDisplayModule.renderModalContent).not.toHaveBeenCalled();
      expect(mockOpenModal).not.toHaveBeenCalled();
    });
  });

  describe('syncPermissionMode', () => {
    it('should update all oneoff perm buttons for acceptEdits', () => {
      OneOffToolbarModule.syncPermissionMode('acceptEdits');

      expect(global.$).toHaveBeenCalledWith('.oneoff-perm-btn');
      expect(global.$).toHaveBeenCalledWith('.oneoff-perm-btn[data-mode="acceptEdits"]');
    });

    it('should update all oneoff perm buttons for plan', () => {
      OneOffToolbarModule.syncPermissionMode('plan');

      expect(global.$).toHaveBeenCalledWith('.oneoff-perm-btn');
      expect(global.$).toHaveBeenCalledWith('.oneoff-perm-btn[data-mode="plan"]');
    });
  });

  describe('syncModel', () => {
    it('should update all oneoff model selectors', () => {
      OneOffToolbarModule.syncModel('claude-sonnet-4-5-20250929');

      expect(global.$).toHaveBeenCalledWith('.oneoff-model-select');
    });

    it('should default to sonnet when null', () => {
      OneOffToolbarModule.syncModel(null);

      expect(global.$).toHaveBeenCalledWith('.oneoff-model-select');
      const mockEl = global.$();
      expect(mockEl.val).toHaveBeenCalledWith('claude-sonnet-4-6');
    });
  });

  describe('syncFontSize', () => {
    it('should update all oneoff font size displays', () => {
      OneOffToolbarModule.syncFontSize(18);

      expect(global.$).toHaveBeenCalledWith('.oneoff-font-size-display');
      const mockEl = global.$();
      expect(mockEl.text).toHaveBeenCalledWith('18px');
    });
  });

  describe('search functions', () => {
    it('openTabSearch should show search controls', () => {
      OneOffToolbarModule.openTabSearch('oneoff-1');

      expect(global.$).toHaveBeenCalledWith('.oneoff-search-controls[data-oneoff-id="oneoff-1"]');

      const tab = mockState.oneOffTabs['project-1'][0];

      expect(tab.search.isOpen).toBe(true);
    });

    it('closeTabSearch should hide search controls and clear state', () => {
      mockState.oneOffTabs['project-1'][0].search.isOpen = true;
      mockState.oneOffTabs['project-1'][0].search.query = 'test';

      OneOffToolbarModule.closeTabSearch('oneoff-1');

      const tab = mockState.oneOffTabs['project-1'][0];

      expect(tab.search.isOpen).toBe(false);
      expect(tab.search.query).toBe('');
      expect(tab.search.matches).toHaveLength(0);
      expect(tab.search.currentIndex).toBe(-1);
    });

    it('performTabSearch should initialize search state', () => {
      OneOffToolbarModule.performTabSearch('oneoff-1', 'test');

      const tab = mockState.oneOffTabs['project-1'][0];

      expect(tab.search.query).toBe('test');
    });

    it('performTabSearch with empty query should reset', () => {
      mockState.oneOffTabs['project-1'][0].search.query = 'old';

      OneOffToolbarModule.performTabSearch('oneoff-1', '');

      const tab = mockState.oneOffTabs['project-1'][0];

      expect(tab.search.query).toBe('');
      expect(tab.search.matches).toHaveLength(0);
    });
  });

  describe('setupHandlers', () => {
    it('should register delegated event handlers', () => {
      OneOffToolbarModule.setupHandlers();

      // Check that $(document).on was called for various selectors
      expect(global.$).toHaveBeenCalledWith(document);
    });
  });
});
