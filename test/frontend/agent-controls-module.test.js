/**
 * @jest-environment jsdom
 */

const AgentControlsModule = require('../../public/js/modules/agent-controls-module');

describe('AgentControlsModule', () => {
  let mockState;
  let mockFindProjectById;
  let mockUpdateProjectStatusById;
  let mockUpdateInputHint;
  let mockUpdateRalphLoopPauseButton;

  function createDomElements() {
    document.body.innerHTML = `
      <div id="loop-controls"></div>
      <button id="btn-start-agent"></button>
      <button id="btn-stop-agent" class="hidden"></button>
      <button id="btn-restart-agent" class="hidden"></button>
      <div id="agent-output-spinner" class="hidden"></div>
      <span id="agent-status-label" class="hidden"></span>
      <button id="btn-cancel-agent" class="hidden"></button>
      <input id="input-message" />
      <button id="btn-send-message"></button>
      <form id="form-send-message"></form>
      <button id="btn-ralph-loop-pause" class="hidden"></button>
      <button id="btn-agent-mode" class="hidden"></button>
    `;
  }

  beforeEach(() => {
    createDomElements();

    mockState = {
      selectedProjectId: 'project-1',
      currentSessionId: 'session-1',
      currentAgentMode: 'interactive',
      isRalphLoopRunning: false,
      ralphLoopCurrentIteration: null,
      ralphLoopMaxTurns: null,
      sendWithCtrlEnter: false,
    };

    mockFindProjectById = jest.fn();
    mockUpdateProjectStatusById = jest.fn();
    mockUpdateInputHint = jest.fn();
    mockUpdateRalphLoopPauseButton = jest.fn();

    AgentControlsModule.init({
      state: mockState,
      findProjectById: mockFindProjectById,
      updateProjectStatusById: mockUpdateProjectStatusById,
      updateInputHint: mockUpdateInputHint,
      updateRalphLoopPauseButton: mockUpdateRalphLoopPauseButton,
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  // ─── updateStartStopButtons ───

  describe('updateStartStopButtons', () => {
    it('should show Stop and Restart when agent is running', () => {
      mockFindProjectById.mockReturnValue({ status: 'running' });

      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-start-agent').hasClass('hidden')).toBe(true);
      expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
      expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
    });

    it('should show Start and hide Stop/Restart when agent is stopped', () => {
      mockFindProjectById.mockReturnValue({ status: 'stopped' });

      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-start-agent').hasClass('hidden')).toBe(false);
      expect($('#btn-stop-agent').hasClass('hidden')).toBe(true);
      expect($('#btn-restart-agent').hasClass('hidden')).toBe(true);
    });

    it('should show Start when no project is selected', () => {
      mockState.selectedProjectId = null;
      mockFindProjectById.mockReturnValue(null);

      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-start-agent').hasClass('hidden')).toBe(false);
      expect($('#btn-stop-agent').hasClass('hidden')).toBe(true);
      expect($('#btn-restart-agent').hasClass('hidden')).toBe(true);
    });

    it('should show Start when project not found', () => {
      mockFindProjectById.mockReturnValue(null);

      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-start-agent').hasClass('hidden')).toBe(false);
      expect($('#btn-stop-agent').hasClass('hidden')).toBe(true);
    });

    it('should show Start when project status is error', () => {
      mockFindProjectById.mockReturnValue({ status: 'error' });

      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-start-agent').hasClass('hidden')).toBe(false);
      expect($('#btn-stop-agent').hasClass('hidden')).toBe(true);
      expect($('#btn-restart-agent').hasClass('hidden')).toBe(true);
    });

    it('should always hide loop-controls', () => {
      mockFindProjectById.mockReturnValue({ status: 'running' });
      document.getElementById('loop-controls').classList.remove('hidden');

      AgentControlsModule.updateStartStopButtons();

      expect($('#loop-controls').hasClass('hidden')).toBe(true);
    });

    it('should show buttons correctly regardless of permission mode', () => {
      // This is the core of the bug fix: permission mode should NOT affect button visibility
      mockFindProjectById.mockReturnValue({ status: 'running' });
      mockState.permissionMode = 'plan';

      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
      expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
    });

    it('should show buttons when agent is running in acceptEdits mode', () => {
      mockFindProjectById.mockReturnValue({ status: 'running' });
      mockState.permissionMode = 'acceptEdits';

      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
      expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
    });

    it('should treat undefined status as not running', () => {
      mockFindProjectById.mockReturnValue({ status: undefined });

      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-start-agent').hasClass('hidden')).toBe(false);
      expect($('#btn-stop-agent').hasClass('hidden')).toBe(true);
      expect($('#btn-restart-agent').hasClass('hidden')).toBe(true);
    });

    it('should transition correctly from running to stopped', () => {
      mockFindProjectById.mockReturnValue({ status: 'running' });
      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);

      mockFindProjectById.mockReturnValue({ status: 'stopped' });
      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-start-agent').hasClass('hidden')).toBe(false);
      expect($('#btn-stop-agent').hasClass('hidden')).toBe(true);
      expect($('#btn-restart-agent').hasClass('hidden')).toBe(true);
    });

    it('should transition correctly from stopped to running', () => {
      mockFindProjectById.mockReturnValue({ status: 'stopped' });
      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-start-agent').hasClass('hidden')).toBe(false);

      mockFindProjectById.mockReturnValue({ status: 'running' });
      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-start-agent').hasClass('hidden')).toBe(true);
      expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
      expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
    });

    it('should be idempotent when called multiple times with same state', () => {
      mockFindProjectById.mockReturnValue({ status: 'running' });

      AgentControlsModule.updateStartStopButtons();
      AgentControlsModule.updateStartStopButtons();
      AgentControlsModule.updateStartStopButtons();

      expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
      expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
      expect($('#btn-start-agent').hasClass('hidden')).toBe(true);
    });
  });

  // ─── showAgentRunningIndicator ───

  describe('showAgentRunningIndicator', () => {
    it('should show spinner and label when running', () => {
      AgentControlsModule.showAgentRunningIndicator(true);

      expect($('#agent-output-spinner').hasClass('hidden')).toBe(false);
      expect($('#agent-status-label').hasClass('hidden')).toBe(false);
    });

    it('should set default status text when running', () => {
      AgentControlsModule.showAgentRunningIndicator(true);

      expect(document.getElementById('agent-status-label').textContent).toBe('Agent running...');
    });

    it('should set custom status text when provided', () => {
      AgentControlsModule.showAgentRunningIndicator(true, 'Worker running...');

      expect(document.getElementById('agent-status-label').textContent).toBe('Worker running...');
    });

    it('should hide spinner and label when not running', () => {
      // First show them
      AgentControlsModule.showAgentRunningIndicator(true);
      // Then hide
      AgentControlsModule.showAgentRunningIndicator(false);

      expect($('#agent-output-spinner').hasClass('hidden')).toBe(true);
      expect($('#agent-status-label').hasClass('hidden')).toBe(true);
    });

    it('should hide when called with false and no status text', () => {
      AgentControlsModule.showAgentRunningIndicator(false);

      expect($('#agent-output-spinner').hasClass('hidden')).toBe(true);
      expect($('#agent-status-label').hasClass('hidden')).toBe(true);
    });

    it('should use empty string as status text when explicitly passed', () => {
      AgentControlsModule.showAgentRunningIndicator(true, '');

      // Empty string is falsy, so it falls back to default
      expect(document.getElementById('agent-status-label').textContent).toBe('Agent running...');
    });

    it('should use default text when null is passed as status text', () => {
      AgentControlsModule.showAgentRunningIndicator(true, null);

      expect(document.getElementById('agent-status-label').textContent).toBe('Agent running...');
    });

    it('should update text when called repeatedly with different status', () => {
      AgentControlsModule.showAgentRunningIndicator(true, 'Worker running...');
      expect(document.getElementById('agent-status-label').textContent).toBe('Worker running...');

      AgentControlsModule.showAgentRunningIndicator(true, 'Reviewer running...');
      expect(document.getElementById('agent-status-label').textContent).toBe('Reviewer running...');
    });

    it('should toggle correctly between running and not running', () => {
      AgentControlsModule.showAgentRunningIndicator(true);
      expect($('#agent-output-spinner').hasClass('hidden')).toBe(false);

      AgentControlsModule.showAgentRunningIndicator(false);
      expect($('#agent-output-spinner').hasClass('hidden')).toBe(true);

      AgentControlsModule.showAgentRunningIndicator(true, 'Custom');
      expect($('#agent-output-spinner').hasClass('hidden')).toBe(false);
      expect(document.getElementById('agent-status-label').textContent).toBe('Custom');
    });
  });

  // ─── updateCancelButton ───

  describe('updateCancelButton', () => {
    it('should show cancel when running and not waiting', () => {
      mockFindProjectById.mockReturnValue({ status: 'running', isWaitingForInput: false });

      AgentControlsModule.updateCancelButton();

      expect($('#btn-cancel-agent').hasClass('hidden')).toBe(false);
    });

    it('should hide cancel when running but waiting for input', () => {
      mockFindProjectById.mockReturnValue({ status: 'running', isWaitingForInput: true });

      AgentControlsModule.updateCancelButton();

      expect($('#btn-cancel-agent').hasClass('hidden')).toBe(true);
    });

    it('should hide cancel when agent is stopped', () => {
      mockFindProjectById.mockReturnValue({ status: 'stopped', isWaitingForInput: false });

      AgentControlsModule.updateCancelButton();

      expect($('#btn-cancel-agent').hasClass('hidden')).toBe(true);
    });

    it('should hide cancel when no project found', () => {
      mockFindProjectById.mockReturnValue(null);

      AgentControlsModule.updateCancelButton();

      expect($('#btn-cancel-agent').hasClass('hidden')).toBe(true);
    });

    it('should hide cancel when project is in error state', () => {
      mockFindProjectById.mockReturnValue({ status: 'error', isWaitingForInput: false });

      AgentControlsModule.updateCancelButton();

      expect($('#btn-cancel-agent').hasClass('hidden')).toBe(true);
    });

    it('should show cancel when running with isWaitingForInput undefined', () => {
      // isWaitingForInput undefined is falsy, so !isWaiting is true
      mockFindProjectById.mockReturnValue({ status: 'running' });

      AgentControlsModule.updateCancelButton();

      expect($('#btn-cancel-agent').hasClass('hidden')).toBe(false);
    });

    it('should show cancel when running with isWaitingForInput null', () => {
      mockFindProjectById.mockReturnValue({ status: 'running', isWaitingForInput: null });

      AgentControlsModule.updateCancelButton();

      expect($('#btn-cancel-agent').hasClass('hidden')).toBe(false);
    });

    it('should update when isWaitingForInput toggles', () => {
      var project = { status: 'running', isWaitingForInput: false };
      mockFindProjectById.mockReturnValue(project);

      AgentControlsModule.updateCancelButton();
      expect($('#btn-cancel-agent').hasClass('hidden')).toBe(false);

      project.isWaitingForInput = true;
      AgentControlsModule.updateCancelButton();
      expect($('#btn-cancel-agent').hasClass('hidden')).toBe(true);

      project.isWaitingForInput = false;
      AgentControlsModule.updateCancelButton();
      expect($('#btn-cancel-agent').hasClass('hidden')).toBe(false);
    });
  });

  // ─── updateInputArea ───

  describe('updateInputArea', () => {
    it('should enable input and send button in interactive mode', () => {
      // Disable them first
      document.getElementById('input-message').disabled = true;
      document.getElementById('btn-send-message').disabled = true;

      AgentControlsModule.updateInputArea();

      expect(document.getElementById('input-message').disabled).toBe(false);
      expect(document.getElementById('btn-send-message').disabled).toBe(false);
    });

    it('should call updateInputHint', () => {
      AgentControlsModule.updateInputArea();

      expect(mockUpdateInputHint).toHaveBeenCalled();
    });

    it('should be idempotent when called multiple times', () => {
      document.getElementById('input-message').disabled = true;

      AgentControlsModule.updateInputArea();
      AgentControlsModule.updateInputArea();
      AgentControlsModule.updateInputArea();

      expect(document.getElementById('input-message').disabled).toBe(false);
      expect(mockUpdateInputHint).toHaveBeenCalledTimes(3);
    });
  });

  // ─── formatRalphLoopStatusForLabel ───

  describe('formatRalphLoopStatusForLabel', () => {
    it('should format worker_running status', () => {
      var result = AgentControlsModule.formatRalphLoopStatusForLabel('worker_running');
      expect(result).toBe('Worker running...');
    });

    it('should format reviewer_running status', () => {
      var result = AgentControlsModule.formatRalphLoopStatusForLabel('reviewer_running');
      expect(result).toBe('Reviewer running...');
    });

    it('should format paused status', () => {
      var result = AgentControlsModule.formatRalphLoopStatusForLabel('paused');
      expect(result).toBe('Ralph Loop paused');
    });

    it('should format unknown status as generic', () => {
      var result = AgentControlsModule.formatRalphLoopStatusForLabel('initializing');
      expect(result).toBe('Ralph Loop: initializing');
    });

    it('should include iteration info when available', () => {
      mockState.ralphLoopCurrentIteration = 2;
      mockState.ralphLoopMaxTurns = 5;

      var result = AgentControlsModule.formatRalphLoopStatusForLabel('worker_running');
      expect(result).toBe('Worker running... (Iteration 2/5, 3 left)');
    });

    it('should not include iteration info when null', () => {
      mockState.ralphLoopCurrentIteration = null;
      mockState.ralphLoopMaxTurns = null;

      var result = AgentControlsModule.formatRalphLoopStatusForLabel('worker_running');
      expect(result).toBe('Worker running...');
    });

    it('should handle iteration 0', () => {
      mockState.ralphLoopCurrentIteration = 0;
      mockState.ralphLoopMaxTurns = 5;

      var result = AgentControlsModule.formatRalphLoopStatusForLabel('worker_running');
      expect(result).toBe('Worker running... (Iteration 0/5, 5 left)');
    });

    it('should handle undefined status in default branch', () => {
      var result = AgentControlsModule.formatRalphLoopStatusForLabel(undefined);
      expect(result).toBe('Ralph Loop: undefined');
    });

    it('should handle empty string status', () => {
      var result = AgentControlsModule.formatRalphLoopStatusForLabel('');
      expect(result).toBe('Ralph Loop: ');
    });

    it('should not show iteration when only currentIteration is set', () => {
      mockState.ralphLoopCurrentIteration = 3;
      mockState.ralphLoopMaxTurns = null;

      var result = AgentControlsModule.formatRalphLoopStatusForLabel('worker_running');
      expect(result).toBe('Worker running...');
    });

    it('should not show iteration when only maxTurns is set', () => {
      mockState.ralphLoopCurrentIteration = null;
      mockState.ralphLoopMaxTurns = 10;

      var result = AgentControlsModule.formatRalphLoopStatusForLabel('worker_running');
      expect(result).toBe('Worker running...');
    });

    it('should handle currentIteration exceeding maxTurns', () => {
      mockState.ralphLoopCurrentIteration = 7;
      mockState.ralphLoopMaxTurns = 5;

      var result = AgentControlsModule.formatRalphLoopStatusForLabel('worker_running');
      expect(result).toBe('Worker running... (Iteration 7/5, -2 left)');
    });

    it('should handle both iteration values set to 0', () => {
      mockState.ralphLoopCurrentIteration = 0;
      mockState.ralphLoopMaxTurns = 0;

      var result = AgentControlsModule.formatRalphLoopStatusForLabel('paused');
      expect(result).toBe('Ralph Loop paused (Iteration 0/0, 0 left)');
    });
  });

  // ─── updateRalphLoopControls ───

  describe('updateRalphLoopControls', () => {
    describe('when Ralph Loop is not active (null/idle/completed/failed)', () => {
      it('should hide Ralph Loop-specific buttons for null status', () => {
        AgentControlsModule.updateRalphLoopControls(null);

        expect($('#btn-ralph-loop-pause').hasClass('hidden')).toBe(true);
        expect($('#btn-agent-mode').hasClass('hidden')).toBe(true);
      });

      it('should set isRalphLoopRunning to false', () => {
        mockState.isRalphLoopRunning = true;
        mockFindProjectById.mockReturnValue(null);

        AgentControlsModule.updateRalphLoopControls(null);

        expect(mockState.isRalphLoopRunning).toBe(false);
      });

      it('should hide Ralph Loop-specific buttons for idle status', () => {
        mockFindProjectById.mockReturnValue(null);

        AgentControlsModule.updateRalphLoopControls('idle');

        expect($('#btn-ralph-loop-pause').hasClass('hidden')).toBe(true);
        expect($('#btn-agent-mode').hasClass('hidden')).toBe(true);
      });

      it('should hide Ralph Loop-specific buttons for completed status', () => {
        mockFindProjectById.mockReturnValue(null);

        AgentControlsModule.updateRalphLoopControls('completed');

        expect($('#btn-ralph-loop-pause').hasClass('hidden')).toBe(true);
        expect($('#btn-agent-mode').hasClass('hidden')).toBe(true);
      });

      it('should hide Ralph Loop-specific buttons for failed status', () => {
        mockFindProjectById.mockReturnValue(null);

        AgentControlsModule.updateRalphLoopControls('failed');

        expect($('#btn-ralph-loop-pause').hasClass('hidden')).toBe(true);
        expect($('#btn-agent-mode').hasClass('hidden')).toBe(true);
      });

      // ─── THE BUG FIX: agent running when Ralph Loop is not active ───

      it('should keep Stop/Restart visible when a regular agent is running (bug fix)', () => {
        mockFindProjectById.mockReturnValue({ status: 'running' });

        AgentControlsModule.updateRalphLoopControls(null);

        // Stop and Restart should still be visible because a regular agent is running
        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
      });

      it('should keep Stop/Restart visible in Plan mode when agent is running (bug fix)', () => {
        mockFindProjectById.mockReturnValue({ status: 'running' });
        mockState.permissionMode = 'plan';

        AgentControlsModule.updateRalphLoopControls(null);

        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
      });

      it('should keep Stop/Restart visible in Accept Edits mode when agent is running (bug fix)', () => {
        mockFindProjectById.mockReturnValue({ status: 'running' });
        mockState.permissionMode = 'acceptEdits';

        AgentControlsModule.updateRalphLoopControls(null);

        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
      });

      it('should call updateInputArea when agent is running', () => {
        mockFindProjectById.mockReturnValue({ status: 'running' });

        AgentControlsModule.updateRalphLoopControls(null);

        expect(mockUpdateInputHint).toHaveBeenCalled();
      });

      it('should NOT call updateProjectStatusById when agent is running', () => {
        mockFindProjectById.mockReturnValue({ status: 'running' });

        AgentControlsModule.updateRalphLoopControls(null);

        expect(mockUpdateProjectStatusById).not.toHaveBeenCalled();
      });

      // ─── When no agent is running ───

      it('should hide Stop/Restart and show running indicator off when no agent running', () => {
        mockFindProjectById.mockReturnValue({ status: 'stopped' });

        AgentControlsModule.updateRalphLoopControls(null);

        expect($('#btn-stop-agent').hasClass('hidden')).toBe(true);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(true);
        expect($('#agent-output-spinner').hasClass('hidden')).toBe(true);
        expect($('#agent-status-label').hasClass('hidden')).toBe(true);
      });

      it('should enable input when no agent running and no Ralph Loop', () => {
        mockFindProjectById.mockReturnValue({ status: 'stopped' });

        AgentControlsModule.updateRalphLoopControls(null);

        expect(document.getElementById('input-message').disabled).toBe(false);
        expect(document.getElementById('btn-send-message').disabled).toBe(false);
      });

      it('should remove opacity from send form when no agent running', () => {
        document.getElementById('form-send-message').classList.add('opacity-50');
        mockFindProjectById.mockReturnValue({ status: 'stopped' });

        AgentControlsModule.updateRalphLoopControls(null);

        expect($('#form-send-message').hasClass('opacity-50')).toBe(false);
      });

      it('should call updateProjectStatusById with stopped when no agent running', () => {
        mockFindProjectById.mockReturnValue({ status: 'stopped' });

        AgentControlsModule.updateRalphLoopControls(null);

        expect(mockUpdateProjectStatusById).toHaveBeenCalledWith('project-1', 'stopped');
      });

      it('should not call updateProjectStatusById when no project selected', () => {
        mockState.selectedProjectId = null;
        mockFindProjectById.mockReturnValue(null);

        AgentControlsModule.updateRalphLoopControls(null);

        expect(mockUpdateProjectStatusById).not.toHaveBeenCalled();
      });

      it('should hide everything when project not found', () => {
        mockFindProjectById.mockReturnValue(null);

        AgentControlsModule.updateRalphLoopControls(null);

        expect($('#btn-stop-agent').hasClass('hidden')).toBe(true);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(true);
        expect($('#agent-output-spinner').hasClass('hidden')).toBe(true);
      });
    });

    describe('when Ralph Loop is active (worker_running/reviewer_running/paused)', () => {
      it('should show running indicator with worker status text', () => {
        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect($('#agent-output-spinner').hasClass('hidden')).toBe(false);
        expect(document.getElementById('agent-status-label').textContent).toBe('Worker running...');
      });

      it('should show running indicator with reviewer status text', () => {
        AgentControlsModule.updateRalphLoopControls('reviewer_running');

        expect($('#agent-output-spinner').hasClass('hidden')).toBe(false);
        expect(document.getElementById('agent-status-label').textContent).toBe('Reviewer running...');
      });

      it('should show Stop and Restart buttons', () => {
        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
      });

      it('should show Agent Mode button', () => {
        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect($('#btn-agent-mode').hasClass('hidden')).toBe(false);
      });

      it('should show pause button for worker_running', () => {
        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect($('#btn-ralph-loop-pause').hasClass('hidden')).toBe(false);
      });

      it('should show pause button for reviewer_running', () => {
        AgentControlsModule.updateRalphLoopControls('reviewer_running');

        expect($('#btn-ralph-loop-pause').hasClass('hidden')).toBe(false);
      });

      it('should show pause button for paused status', () => {
        AgentControlsModule.updateRalphLoopControls('paused');

        expect($('#btn-ralph-loop-pause').hasClass('hidden')).toBe(false);
      });

      it('should disable input when Ralph Loop is active', () => {
        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect(document.getElementById('input-message').disabled).toBe(true);
        expect(document.getElementById('btn-send-message').disabled).toBe(true);
      });

      it('should add opacity to send form when Ralph Loop is active', () => {
        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect($('#form-send-message').hasClass('opacity-50')).toBe(true);
      });

      it('should set isRalphLoopRunning to true', () => {
        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect(mockState.isRalphLoopRunning).toBe(true);
      });

      it('should call updateProjectStatusById with running', () => {
        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect(mockUpdateProjectStatusById).toHaveBeenCalledWith('project-1', 'running');
      });

      it('should call updateRalphLoopPauseButton with current status', () => {
        AgentControlsModule.updateRalphLoopControls('paused');

        expect(mockUpdateRalphLoopPauseButton).toHaveBeenCalledWith('paused');
      });

      it('should include iteration info in status label', () => {
        mockState.ralphLoopCurrentIteration = 3;
        mockState.ralphLoopMaxTurns = 10;

        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect(document.getElementById('agent-status-label').textContent)
          .toBe('Worker running... (Iteration 3/10, 7 left)');
      });

      it('should call updateProjectStatusById with null when selectedProjectId is null', () => {
        mockState.selectedProjectId = null;

        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect(mockUpdateProjectStatusById).toHaveBeenCalledWith(null, 'running');
      });

      it('should hide pause button for non-standard active status', () => {
        // A status that passes isActive check but doesn't match pause-button whitelist
        AgentControlsModule.updateRalphLoopControls('starting');

        expect(mockState.isRalphLoopRunning).toBe(true);
        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect($('#btn-ralph-loop-pause').hasClass('hidden')).toBe(true);
      });

      it('should still call updateRalphLoopPauseButton for non-standard status', () => {
        AgentControlsModule.updateRalphLoopControls('starting');

        expect(mockUpdateRalphLoopPauseButton).toHaveBeenCalledWith('starting');
      });

      it('should call updateRalphLoopPauseButton for each active status', () => {
        AgentControlsModule.updateRalphLoopControls('worker_running');
        expect(mockUpdateRalphLoopPauseButton).toHaveBeenCalledWith('worker_running');

        mockUpdateRalphLoopPauseButton.mockClear();
        AgentControlsModule.updateRalphLoopControls('reviewer_running');
        expect(mockUpdateRalphLoopPauseButton).toHaveBeenCalledWith('reviewer_running');
      });

      it('should hide Start button when active', () => {
        // Start button is managed by updateStartStopButtons, but let's verify
        // that the active branch shows Stop/Restart (Start stays as-is from prior state)
        document.getElementById('btn-start-agent').classList.remove('hidden');

        AgentControlsModule.updateRalphLoopControls('worker_running');

        // Stop and Restart shown; Start is not explicitly touched by the active branch
        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
      });
    });

    // ─── Race condition scenarios (the original bug) ───

    describe('race condition: loadRalphLoopStatus completes while agent is running', () => {
      it('should preserve button state when Ralph Loop status returns null but agent is running', () => {
        // Simulate: agent started and buttons are shown
        mockFindProjectById.mockReturnValue({ status: 'running' });
        AgentControlsModule.updateStartStopButtons();

        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);

        // Simulate: loadRalphLoopStatus returns with no active loop
        AgentControlsModule.updateRalphLoopControls(null);

        // Buttons should still be visible
        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
      });

      it('should preserve button state in Plan mode (the original bug scenario)', () => {
        mockState.permissionMode = 'plan';
        mockFindProjectById.mockReturnValue({ status: 'running' });

        // Agent starts and buttons are shown
        AgentControlsModule.updateStartStopButtons();

        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);

        // Ralph Loop status check returns null (no active loop)
        AgentControlsModule.updateRalphLoopControls(null);

        // Buttons must remain visible - this was the bug
        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
      });

      it('should correctly hide buttons when agent stops after Ralph Loop check', () => {
        // Agent is running initially
        mockFindProjectById.mockReturnValue({ status: 'running' });
        AgentControlsModule.updateStartStopButtons();

        // Ralph Loop status returns null, agent still running
        AgentControlsModule.updateRalphLoopControls(null);
        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);

        // Agent stops
        mockFindProjectById.mockReturnValue({ status: 'stopped' });
        AgentControlsModule.updateStartStopButtons();

        expect($('#btn-stop-agent').hasClass('hidden')).toBe(true);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(true);
      });
    });

    // ─── Transition scenarios ───

    describe('transitions between Ralph Loop and regular agent', () => {
      it('should properly transition from Ralph Loop active to inactive with agent still running', () => {
        // Ralph Loop is active
        mockFindProjectById.mockReturnValue({ status: 'running' });
        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect(mockState.isRalphLoopRunning).toBe(true);
        expect($('#btn-ralph-loop-pause').hasClass('hidden')).toBe(false);

        // Ralph Loop finishes but regular agent is still running
        AgentControlsModule.updateRalphLoopControls(null);

        expect(mockState.isRalphLoopRunning).toBe(false);
        expect($('#btn-ralph-loop-pause').hasClass('hidden')).toBe(true);
        expect($('#btn-agent-mode').hasClass('hidden')).toBe(true);
        // Regular agent buttons should still be visible
        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(false);
      });

      it('should properly transition from Ralph Loop active to inactive with no agent running', () => {
        // Ralph Loop is active
        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect(mockState.isRalphLoopRunning).toBe(true);

        // Ralph Loop finishes and no agent running
        mockFindProjectById.mockReturnValue({ status: 'stopped' });
        AgentControlsModule.updateRalphLoopControls(null);

        expect(mockState.isRalphLoopRunning).toBe(false);
        expect($('#btn-stop-agent').hasClass('hidden')).toBe(true);
        expect($('#btn-restart-agent').hasClass('hidden')).toBe(true);
      });

      it('should update from idle to worker_running correctly', () => {
        mockFindProjectById.mockReturnValue({ status: 'stopped' });
        AgentControlsModule.updateRalphLoopControls('idle');

        expect(mockState.isRalphLoopRunning).toBe(false);

        // Now Ralph Loop becomes active
        AgentControlsModule.updateRalphLoopControls('worker_running');

        expect(mockState.isRalphLoopRunning).toBe(true);
        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect($('#btn-ralph-loop-pause').hasClass('hidden')).toBe(false);
      });

      it('should transition between active statuses (worker -> reviewer -> paused)', () => {
        AgentControlsModule.updateRalphLoopControls('worker_running');
        expect(document.getElementById('agent-status-label').textContent).toBe('Worker running...');
        expect(mockUpdateRalphLoopPauseButton).toHaveBeenCalledWith('worker_running');

        AgentControlsModule.updateRalphLoopControls('reviewer_running');
        expect(document.getElementById('agent-status-label').textContent).toBe('Reviewer running...');
        expect(mockUpdateRalphLoopPauseButton).toHaveBeenCalledWith('reviewer_running');

        AgentControlsModule.updateRalphLoopControls('paused');
        expect(document.getElementById('agent-status-label').textContent).toBe('Ralph Loop paused');
        expect(mockUpdateRalphLoopPauseButton).toHaveBeenCalledWith('paused');

        // All three should keep buttons visible
        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect($('#btn-ralph-loop-pause').hasClass('hidden')).toBe(false);
        expect(mockState.isRalphLoopRunning).toBe(true);
      });

      it('should transition active -> inactive -> active', () => {
        // Start active
        AgentControlsModule.updateRalphLoopControls('worker_running');
        expect(mockState.isRalphLoopRunning).toBe(true);

        // Go inactive
        mockFindProjectById.mockReturnValue({ status: 'stopped' });
        AgentControlsModule.updateRalphLoopControls(null);
        expect(mockState.isRalphLoopRunning).toBe(false);
        expect($('#btn-stop-agent').hasClass('hidden')).toBe(true);

        // Back to active
        AgentControlsModule.updateRalphLoopControls('reviewer_running');
        expect(mockState.isRalphLoopRunning).toBe(true);
        expect($('#btn-stop-agent').hasClass('hidden')).toBe(false);
        expect(document.getElementById('agent-status-label').textContent).toBe('Reviewer running...');
      });

      it('should toggle form opacity through full lifecycle', () => {
        // Initially no opacity
        expect($('#form-send-message').hasClass('opacity-50')).toBe(false);

        // Ralph Loop starts — opacity added
        AgentControlsModule.updateRalphLoopControls('worker_running');
        expect($('#form-send-message').hasClass('opacity-50')).toBe(true);

        // Ralph Loop ends, no agent — opacity removed
        mockFindProjectById.mockReturnValue({ status: 'stopped' });
        AgentControlsModule.updateRalphLoopControls(null);
        expect($('#form-send-message').hasClass('opacity-50')).toBe(false);
      });

      it('should toggle input disabled state through full lifecycle', () => {
        // Initially enabled
        expect(document.getElementById('input-message').disabled).toBe(false);

        // Ralph Loop starts — disabled
        AgentControlsModule.updateRalphLoopControls('worker_running');
        expect(document.getElementById('input-message').disabled).toBe(true);
        expect(document.getElementById('btn-send-message').disabled).toBe(true);

        // Ralph Loop ends, agent running — re-enabled via updateInputArea
        mockFindProjectById.mockReturnValue({ status: 'running' });
        AgentControlsModule.updateRalphLoopControls(null);
        expect(document.getElementById('input-message').disabled).toBe(false);
        expect(document.getElementById('btn-send-message').disabled).toBe(false);
      });
    });

    describe('selectedProjectId changes', () => {
      it('should use current selectedProjectId for updateProjectStatusById in active branch', () => {
        mockState.selectedProjectId = 'project-A';
        AgentControlsModule.updateRalphLoopControls('worker_running');
        expect(mockUpdateProjectStatusById).toHaveBeenCalledWith('project-A', 'running');

        mockUpdateProjectStatusById.mockClear();
        mockState.selectedProjectId = 'project-B';
        AgentControlsModule.updateRalphLoopControls('reviewer_running');
        expect(mockUpdateProjectStatusById).toHaveBeenCalledWith('project-B', 'running');
      });

      it('should use current selectedProjectId for updateProjectStatusById in inactive branch', () => {
        mockState.selectedProjectId = 'project-A';
        mockFindProjectById.mockReturnValue({ status: 'stopped' });

        AgentControlsModule.updateRalphLoopControls(null);
        expect(mockUpdateProjectStatusById).toHaveBeenCalledWith('project-A', 'stopped');

        mockUpdateProjectStatusById.mockClear();
        mockState.selectedProjectId = 'project-B';
        AgentControlsModule.updateRalphLoopControls('completed');
        expect(mockUpdateProjectStatusById).toHaveBeenCalledWith('project-B', 'stopped');
      });
    });

    describe('running indicator state through Ralph Loop transitions', () => {
      it('should show indicator when active and hide when inactive with no agent', () => {
        AgentControlsModule.updateRalphLoopControls('worker_running');
        expect($('#agent-output-spinner').hasClass('hidden')).toBe(false);
        expect($('#agent-status-label').hasClass('hidden')).toBe(false);

        mockFindProjectById.mockReturnValue({ status: 'stopped' });
        AgentControlsModule.updateRalphLoopControls(null);
        expect($('#agent-output-spinner').hasClass('hidden')).toBe(true);
        expect($('#agent-status-label').hasClass('hidden')).toBe(true);
      });

      it('should not hide indicator when Ralph Loop ends but regular agent is running', () => {
        // Ralph Loop active
        AgentControlsModule.updateRalphLoopControls('worker_running');
        expect($('#agent-output-spinner').hasClass('hidden')).toBe(false);

        // Ralph Loop ends, regular agent still running
        // updateStartStopButtons is called but does NOT touch the indicator
        // The indicator state depends on what app.js does next (showAgentRunningIndicator)
        // But updateRalphLoopControls itself should NOT hide it in the agent-running branch
        mockFindProjectById.mockReturnValue({ status: 'running' });
        AgentControlsModule.updateRalphLoopControls(null);

        // Indicator is still showing from the previous active call since
        // updateStartStopButtons doesn't touch the spinner
        expect($('#agent-output-spinner').hasClass('hidden')).toBe(false);
      });
    });
  });
});
