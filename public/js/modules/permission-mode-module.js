/**
 * Permission Mode Module
 * Handles permission mode switching with confirmation, per-project state, and agent restarts
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PermissionModeModule = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Dependencies (injected via init)
  var state;
  var api;
  var showToast;
  var showErrorToast;
  var findProjectById;
  var updateProjectStatusById;
  var startAgentStatusPolling;
  var appendMessage;
  var renderProjectList;
  var openModal;
  var closeModal;

  // Per-project permission mode map: { projectId: 'acceptEdits' | 'plan' }
  var projectModes = {};


  function init(deps) {
    state = deps.state;
    api = deps.api;
    showToast = deps.showToast;
    showErrorToast = deps.showErrorToast;
    findProjectById = deps.findProjectById;
    updateProjectStatusById = deps.updateProjectStatusById;
    startAgentStatusPolling = deps.startAgentStatusPolling;
    appendMessage = deps.appendMessage;
    renderProjectList = deps.renderProjectList;
    openModal = deps.openModal;
    closeModal = deps.closeModal;
  }

  function getModeLabel(mode) {
    switch (mode) {
      case 'plan': return 'Plan';
      case 'acceptEdits': return 'Accept Edits';
      default: return 'Default';
    }
  }

  /**
   * Get the permission mode for a specific project
   */
  function getModeForProject(projectId) {
    return projectModes[projectId] || state.permissionMode || 'plan';
  }

  /**
   * Set the permission mode for a specific project
   */
  function setModeForProject(projectId, mode) {
    projectModes[projectId] = mode;
  }

  function updateButtons() {
    $('.perm-btn').removeClass('perm-active');

    var displayMode = state.pendingPermissionMode || state.permissionMode;

    switch (displayMode) {
      case 'plan':
        $('#btn-perm-plan').addClass('perm-active');
        break;
      case 'acceptEdits':
      default:
        $('#btn-perm-accept').addClass('perm-active');
        break;
    }

    updateSkipPermissionsWarning();
  }

  function updateSkipPermissionsWarning() {
    var skipEnabled = state.settings &&
      state.settings.claudePermissions &&
      state.settings.claudePermissions.dangerouslySkipPermissions;

    var $icon = $('#skip-perms-icon');
    var $btn = $('#btn-perm-accept');

    if (skipEnabled) {
      $icon.removeClass('hidden');
      $btn.attr('title', 'Accept Edits - Skipping ALL permission prompts (dangerous)');
    } else {
      $icon.addClass('hidden');
      $btn.attr('title', 'Accept Edits - Auto-approve file edits');
    }
  }

  function updatePendingIndicator() {
    var $indicator = $('#pending-mode-label');

    if (state.pendingPermissionMode) {
      $indicator.text('(switching to ' + getModeLabel(state.pendingPermissionMode) + ')').removeClass('hidden');
    } else {
      $indicator.addClass('hidden');
    }
  }

  function setSwitchingState(isSwitching) {
    state.isModeSwitching = isSwitching;

    $('#btn-perm-accept, #btn-perm-plan').prop('disabled', isSwitching);
    $('#input-message').prop('disabled', isSwitching);
    $('#btn-send-message').prop('disabled', isSwitching);
    $('#btn-cancel-agent').prop('disabled', isSwitching);

    if (isSwitching) {
      $('#permission-mode-selector').addClass('opacity-50 pointer-events-none');
      $('#form-send-message').addClass('opacity-50');
    } else {
      $('#permission-mode-selector').removeClass('opacity-50 pointer-events-none');
      $('#form-send-message').removeClass('opacity-50');
    }
  }

  /**
   * Restart agent with the given permission mode and send a continue message
   */
  function restartWithMode(targetMode) {
    var projectId = state.selectedProjectId;

    if (!projectId) return;

    var sessionId = state.currentSessionId;

    setSwitchingState(true);
    showToast('Restarting agent in ' + getModeLabel(targetMode) + ' mode...', 'info');

    var continueMessage = 'You are now in ' + getModeLabel(targetMode) + ' mode. Please continue where you left off.';

    api.stopAgent(projectId)
      .done(function() {
        updateProjectStatusById(projectId, 'stopped');

        setTimeout(function() {
          api.startInteractiveAgent(projectId, continueMessage, [], sessionId, targetMode)
            .done(function(response) {
              state.currentAgentMode = 'interactive';
              updateProjectStatusById(projectId, 'running');
              startAgentStatusPolling(projectId);
              setSwitchingState(false);

              if (response && response.sessionId) {
                state.currentSessionId = response.sessionId;
              }

              appendMessage(projectId, {
                type: 'system',
                content: 'Agent restarted in ' + getModeLabel(targetMode) + ' mode',
                timestamp: new Date().toISOString()
              });
            })
            .fail(function(xhr) {
              setSwitchingState(false);
              showErrorToast(xhr, 'Failed to restart agent');
            });
        }, 1000);
      })
      .fail(function(xhr) {
        setSwitchingState(false);
        showErrorToast(xhr, 'Failed to stop agent');
      });
  }

  /**
   * Set permission mode. If agent is running, restart immediately.
   */
  function setMode(mode) {
    var project = findProjectById(state.selectedProjectId);
    var isRunning = project && project.status === 'running';
    var currentMode = state.permissionMode;

    if (currentMode === mode) return;

    applyModeChange(mode);

    if (isRunning && state.currentSessionId) {
      restartWithMode(mode);
    } else {
      showToast('Permission mode set to ' + getModeLabel(mode), 'info');
    }
  }

  /**
   * Apply a mode change to state and per-project map
   */
  function applyModeChange(mode) {
    state.permissionMode = mode;
    state.pendingPermissionMode = null;
    updatePendingIndicator();
    updateButtons();

    if (state.selectedProjectId) {
      setModeForProject(state.selectedProjectId, mode);
    }
  }

  /**
   * Apply pending permission mode if there is one and conditions are met
   */
  function applyPendingIfNeeded() {
    if (!state.pendingPermissionMode) return;

    var project = findProjectById(state.selectedProjectId);

    if (!project || project.status !== 'running' || !state.currentSessionId) {
      state.pendingPermissionMode = null;
      updatePendingIndicator();
      updateButtons();
      return;
    }

    var pendingMode = state.pendingPermissionMode;
    applyModeChange(pendingMode);
    restartWithMode(pendingMode);
  }

  /**
   * Called when the user switches to a different project.
   * Restores the per-project permission mode.
   */
  function onProjectChanged(projectId) {
    var savedMode = projectModes[projectId];

    if (savedMode) {
      state.permissionMode = savedMode;
    }

    state.pendingPermissionMode = null;
    updatePendingIndicator();
    updateButtons();
  }

  /**
   * Sync mode from server (e.g. from agent status response).
   * Also saves it per-project.
   */
  function syncFromServer(mode, projectId) {
    if (!mode) return;

    state.permissionMode = mode;

    var pid = projectId || state.selectedProjectId;

    if (pid) {
      setModeForProject(pid, mode);
    }

    updateButtons();
  }

  function approvePlanAndSwitch() {
    api.sendAgentMessage(state.selectedProjectId, 'yes', null, true)
      .done(function() {
        state.permissionMode = 'acceptEdits';
        state.pendingPermissionMode = null;
        updatePendingIndicator();
        updateButtons();

        if (state.selectedProjectId) {
          setModeForProject(state.selectedProjectId, 'acceptEdits');
        }
      })
      .fail(function(xhr) {
        showErrorToast(xhr, 'Failed to send plan approval');
      });
  }

  function setupHandlers() {
    $('#btn-perm-accept').on('click', function() {
      setMode('acceptEdits');
    });

    $('#btn-perm-plan').on('click', function() {
      setMode('plan');
    });
  }

  return {
    init: init,
    getModeLabel: getModeLabel,
    getModeForProject: getModeForProject,
    updateButtons: updateButtons,
    updatePendingIndicator: updatePendingIndicator,
    setSwitchingState: setSwitchingState,
    restartWithMode: restartWithMode,
    setMode: setMode,
    applyPendingIfNeeded: applyPendingIfNeeded,
    approvePlanAndSwitch: approvePlanAndSwitch,
    updateSkipPermissionsWarning: updateSkipPermissionsWarning,
    onProjectChanged: onProjectChanged,
    syncFromServer: syncFromServer,
    setupHandlers: setupHandlers
  };
}));
