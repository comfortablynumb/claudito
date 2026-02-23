/**
 * @jest-environment jsdom
 */

const PermissionModeModule = require('../../public/js/modules/permission-mode-module');

describe('PermissionModeModule', () => {
  let mockState;
  let mockApi;
  let mockShowToast;
  let mockShowErrorToast;
  let mockFindProjectById;
  let mockUpdateProjectStatusById;
  let mockStartAgentStatusPolling;
  let mockAppendMessage;
  let mockRenderProjectList;
  let mockOpenModal;
  let mockCloseModal;

  function createMockJQuery() {
    const mockElement = {
      text: jest.fn().mockReturnThis(),
      addClass: jest.fn().mockReturnThis(),
      removeClass: jest.fn().mockReturnThis(),
      prop: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      attr: jest.fn().mockReturnThis(),
      data: jest.fn().mockReturnThis(),
    };

    return jest.fn().mockReturnValue(mockElement);
  }

  beforeEach(() => {
    mockState = {
      selectedProjectId: 'test-project-id',
      permissionMode: 'acceptEdits',
      pendingPermissionMode: null,
      currentSessionId: null,
      isModeSwitching: false,
      currentAgentMode: null,
      waitingVersion: 0,
      settings: null,
    };

    mockApi = {
      stopAgent: jest.fn().mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          this._doneCb = cb;
          return this;
        }),
        fail: jest.fn().mockReturnThis(),
      }),
      startInteractiveAgent: jest.fn().mockReturnValue({
        done: jest.fn().mockReturnThis(),
        fail: jest.fn().mockReturnThis(),
      }),
      sendAgentMessage: jest.fn().mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          if (cb) cb();
          return this;
        }),
        fail: jest.fn().mockReturnThis(),
      }),
    };

    mockShowToast = jest.fn();
    mockShowErrorToast = jest.fn();
    mockFindProjectById = jest.fn().mockReturnValue(null);
    mockUpdateProjectStatusById = jest.fn();
    mockStartAgentStatusPolling = jest.fn();
    mockAppendMessage = jest.fn();
    mockRenderProjectList = jest.fn();
    mockOpenModal = jest.fn();
    mockCloseModal = jest.fn();

    global.$ = createMockJQuery();

    PermissionModeModule.init({
      state: mockState,
      api: mockApi,
      showToast: mockShowToast,
      showErrorToast: mockShowErrorToast,
      findProjectById: mockFindProjectById,
      updateProjectStatusById: mockUpdateProjectStatusById,
      startAgentStatusPolling: mockStartAgentStatusPolling,
      appendMessage: mockAppendMessage,
      renderProjectList: mockRenderProjectList,
      openModal: mockOpenModal,
      closeModal: mockCloseModal,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getModeLabel', () => {
    it('should return "Plan" for plan mode', () => {
      expect(PermissionModeModule.getModeLabel('plan')).toBe('Plan');
    });

    it('should return "Accept Edits" for acceptEdits mode', () => {
      expect(PermissionModeModule.getModeLabel('acceptEdits')).toBe('Accept Edits');
    });

    it('should return "Default" for unknown mode', () => {
      expect(PermissionModeModule.getModeLabel('unknown')).toBe('Default');
    });
  });

  describe('updateButtons', () => {
    it('should activate Accept Edits button by default', () => {
      mockState.permissionMode = 'acceptEdits';
      mockState.pendingPermissionMode = null;
      const mockBtn = global.$();

      PermissionModeModule.updateButtons();

      expect(global.$).toHaveBeenCalledWith('.perm-btn');
      expect(mockBtn.removeClass).toHaveBeenCalledWith('perm-active');
    });

    it('should activate Plan button when mode is plan', () => {
      mockState.permissionMode = 'plan';
      mockState.pendingPermissionMode = null;

      PermissionModeModule.updateButtons();

      expect(global.$).toHaveBeenCalledWith('#btn-perm-plan');
    });

    it('should use pending mode for display if set', () => {
      mockState.permissionMode = 'acceptEdits';
      mockState.pendingPermissionMode = 'plan';

      PermissionModeModule.updateButtons();

      expect(global.$).toHaveBeenCalledWith('#btn-perm-plan');
    });
  });

  describe('updatePendingIndicator', () => {
    it('should show indicator when pending mode exists', () => {
      mockState.pendingPermissionMode = 'plan';
      const mockIndicator = global.$();

      PermissionModeModule.updatePendingIndicator();

      expect(global.$).toHaveBeenCalledWith('#pending-mode-label');
      expect(mockIndicator.text).toHaveBeenCalledWith('(switching to Plan)');
      expect(mockIndicator.removeClass).toHaveBeenCalledWith('hidden');
    });

    it('should hide indicator when no pending mode', () => {
      mockState.pendingPermissionMode = null;
      const mockIndicator = global.$();

      PermissionModeModule.updatePendingIndicator();

      expect(mockIndicator.addClass).toHaveBeenCalledWith('hidden');
    });
  });

  describe('setSwitchingState', () => {
    it('should disable buttons when switching', () => {
      const mockBtn = global.$();

      PermissionModeModule.setSwitchingState(true);

      expect(mockState.isModeSwitching).toBe(true);
      expect(global.$).toHaveBeenCalledWith('#btn-perm-accept, #btn-perm-plan');
      expect(mockBtn.prop).toHaveBeenCalledWith('disabled', true);
    });

    it('should enable buttons when not switching', () => {
      const mockBtn = global.$();

      PermissionModeModule.setSwitchingState(false);

      expect(mockState.isModeSwitching).toBe(false);
      expect(mockBtn.prop).toHaveBeenCalledWith('disabled', false);
    });

    it('should add opacity class when switching', () => {
      const mockSelector = global.$();

      PermissionModeModule.setSwitchingState(true);

      expect(global.$).toHaveBeenCalledWith('#permission-mode-selector');
      expect(mockSelector.addClass).toHaveBeenCalledWith('opacity-50 pointer-events-none');
    });

    it('should remove opacity class when not switching', () => {
      const mockSelector = global.$();

      PermissionModeModule.setSwitchingState(false);

      expect(mockSelector.removeClass).toHaveBeenCalledWith('opacity-50 pointer-events-none');
    });
  });

  describe('setMode', () => {
    it('should do nothing if mode is same as current', () => {
      mockState.permissionMode = 'acceptEdits';

      PermissionModeModule.setMode('acceptEdits');

      expect(mockShowToast).not.toHaveBeenCalled();
      expect(mockOpenModal).not.toHaveBeenCalled();
    });

    it('should apply immediately if agent not running', () => {
      mockState.permissionMode = 'acceptEdits';
      mockFindProjectById.mockReturnValue(null);

      PermissionModeModule.setMode('plan');

      expect(mockState.permissionMode).toBe('plan');
      expect(mockShowToast).toHaveBeenCalledWith(
        'Permission mode set to Plan',
        'info'
      );
      expect(mockOpenModal).not.toHaveBeenCalled();
    });

    it('should restart agent directly if running', () => {
      mockState.permissionMode = 'acceptEdits';
      mockState.currentSessionId = 'session-123';
      mockFindProjectById.mockReturnValue({ status: 'running' });

      PermissionModeModule.setMode('plan');

      expect(mockState.permissionMode).toBe('plan');
      expect(mockApi.stopAgent).toHaveBeenCalledWith('test-project-id');
      expect(mockOpenModal).not.toHaveBeenCalled();
    });

    it('should apply immediately if agent exists but not running', () => {
      mockState.permissionMode = 'acceptEdits';
      mockFindProjectById.mockReturnValue({ status: 'stopped' });

      PermissionModeModule.setMode('plan');

      expect(mockState.permissionMode).toBe('plan');
      expect(mockOpenModal).not.toHaveBeenCalled();
    });
  });

  describe('restartWithMode', () => {
    it('should stop agent and restart with target mode', () => {
      mockState.currentSessionId = 'session-123';

      PermissionModeModule.restartWithMode('plan');

      expect(mockApi.stopAgent).toHaveBeenCalledWith('test-project-id');
      expect(mockShowToast).toHaveBeenCalledWith(
        'Restarting agent in Plan mode...',
        'info'
      );
    });

    it('should do nothing if no project selected', () => {
      mockState.selectedProjectId = null;

      PermissionModeModule.restartWithMode('plan');

      expect(mockApi.stopAgent).not.toHaveBeenCalled();
    });
  });

  describe('getModeForProject', () => {
    it('should return default mode if no per-project mode saved', () => {
      mockState.permissionMode = 'acceptEdits';

      const result = PermissionModeModule.getModeForProject('unknown-project');

      expect(result).toBe('acceptEdits');
    });
  });

  describe('onProjectChanged', () => {
    it('should clear pending mode', () => {
      mockState.pendingPermissionMode = 'plan';

      PermissionModeModule.onProjectChanged('new-project');

      expect(mockState.pendingPermissionMode).toBeNull();
    });
  });

  describe('syncFromServer', () => {
    it('should update state and buttons', () => {
      PermissionModeModule.syncFromServer('plan', 'test-project-id');

      expect(mockState.permissionMode).toBe('plan');
    });

    it('should do nothing if mode is null', () => {
      mockState.permissionMode = 'acceptEdits';

      PermissionModeModule.syncFromServer(null);

      expect(mockState.permissionMode).toBe('acceptEdits');
    });
  });

  describe('applyPendingIfNeeded', () => {
    it('should do nothing if no pending mode', () => {
      mockState.pendingPermissionMode = null;

      PermissionModeModule.applyPendingIfNeeded();

      expect(mockApi.stopAgent).not.toHaveBeenCalled();
    });

    it('should clear pending if project not running', () => {
      mockState.pendingPermissionMode = 'plan';
      mockFindProjectById.mockReturnValue({
        status: 'stopped',
      });

      PermissionModeModule.applyPendingIfNeeded();

      expect(mockState.pendingPermissionMode).toBeNull();
      expect(mockApi.stopAgent).not.toHaveBeenCalled();
    });

    it('should apply pending mode if conditions met', () => {
      mockState.pendingPermissionMode = 'plan';
      mockState.currentSessionId = 'session-123';
      mockFindProjectById.mockReturnValue({
        status: 'running',
      });

      PermissionModeModule.applyPendingIfNeeded();

      expect(mockState.permissionMode).toBe('plan');
      expect(mockState.pendingPermissionMode).toBeNull();
      expect(mockApi.stopAgent).toHaveBeenCalled();
    });
  });

  describe('approvePlanAndSwitch', () => {
    it('should set mode to acceptEdits and send yes', () => {
      mockState.currentSessionId = 'session-123';

      PermissionModeModule.approvePlanAndSwitch();

      expect(mockApi.sendAgentMessage).toHaveBeenCalledWith('test-project-id', 'yes', null, true);
      expect(mockState.permissionMode).toBe('acceptEdits');
      expect(mockState.pendingPermissionMode).toBeNull();
    });
  });

  describe('setupHandlers', () => {
    it('should register Accept Edits button handler', () => {
      const mockBtn = global.$();

      PermissionModeModule.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#btn-perm-accept');
      expect(mockBtn.on).toHaveBeenCalledWith('click', expect.any(Function));
    });

    it('should register Plan button handler', () => {
      const mockBtn = global.$();

      PermissionModeModule.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#btn-perm-plan');
      expect(mockBtn.on).toHaveBeenCalledWith('click', expect.any(Function));
    });

  });
});
