/**
 * Agent Controls Module
 * Manages visibility of Start/Stop/Restart buttons, agent running indicator,
 * cancel button, input area state, and Ralph Loop controls integration.
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AgentControlsModule = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var state;
  var findProjectById;
  var updateProjectStatusById;
  var updateInputHint;
  var updateRalphLoopPauseButton;

  function init(deps) {
    state = deps.state;
    findProjectById = deps.findProjectById;
    updateProjectStatusById = deps.updateProjectStatusById;
    updateInputHint = deps.updateInputHint;
    updateRalphLoopPauseButton = deps.updateRalphLoopPauseButton;
  }

  function updateStartStopButtons() {
    var project = findProjectById(state.selectedProjectId);
    var isRunning = project && project.status === 'running';

    $('#loop-controls').addClass('hidden');

    if (isRunning) {
      $('#btn-start-agent').addClass('hidden');
      $('#btn-stop-agent').removeClass('hidden');
      $('#btn-restart-agent').removeClass('hidden');
    } else {
      $('#btn-start-agent').removeClass('hidden');
      $('#btn-stop-agent').addClass('hidden');
      $('#btn-restart-agent').addClass('hidden');
    }
  }

  function showAgentRunningIndicator(isRunning, statusText) {
    var spinner = $('#agent-output-spinner');
    var label = $('#agent-status-label');

    if (isRunning) {
      spinner.removeClass('hidden');
      label.text(statusText || 'Agent running...').removeClass('hidden');
    } else {
      spinner.addClass('hidden');
      label.addClass('hidden');
    }
  }

  function updateCancelButton() {
    var project = findProjectById(state.selectedProjectId);
    var isRunning = project && project.status === 'running';
    var isWaiting = project && project.isWaitingForInput;

    if (isRunning && !isWaiting) {
      $('#btn-cancel-agent').removeClass('hidden');
    } else {
      $('#btn-cancel-agent').addClass('hidden');
    }
  }

  function updateInputArea() {
    var isInteractiveMode = true;

    if (isInteractiveMode) {
      $('#input-message').prop('disabled', false);
      $('#btn-send-message').prop('disabled', false);
      updateInputHint();
    }
  }

  function formatRalphLoopStatusForLabel(status) {
    var baseText;

    switch (status) {
      case 'worker_running': baseText = 'Worker running...'; break;
      case 'reviewer_running': baseText = 'Reviewer running...'; break;
      case 'paused': baseText = 'Ralph Loop paused'; break;
      default: baseText = 'Ralph Loop: ' + status; break;
    }

    if (state.ralphLoopCurrentIteration !== null && state.ralphLoopCurrentIteration !== undefined &&
        state.ralphLoopMaxTurns !== null && state.ralphLoopMaxTurns !== undefined) {
      var remainingTurns = state.ralphLoopMaxTurns - state.ralphLoopCurrentIteration;
      return baseText + ' (Iteration ' + state.ralphLoopCurrentIteration + '/' + state.ralphLoopMaxTurns +
             ', ' + remainingTurns + ' left)';
    }

    return baseText;
  }

  function updateRalphLoopControls(status) {
    var isActive = status && status !== 'idle' && status !== 'completed' && status !== 'failed';

    if (!isActive) {
      $('#btn-ralph-loop-pause').addClass('hidden');
      $('#btn-agent-mode').addClass('hidden');
      state.isRalphLoopRunning = false;

      var project = findProjectById(state.selectedProjectId);
      var isAgentRunning = project && project.status === 'running';

      if (isAgentRunning) {
        updateStartStopButtons();
        updateInputArea();
      } else {
        showAgentRunningIndicator(false);
        $('#btn-stop-agent').addClass('hidden');
        $('#btn-restart-agent').addClass('hidden');
        $('#form-send-message').removeClass('opacity-50');
        $('#input-message').prop('disabled', false);
        $('#btn-send-message').prop('disabled', false);

        if (state.selectedProjectId) {
          updateProjectStatusById(state.selectedProjectId, 'stopped');
        }
      }
    } else {
      var statusText = formatRalphLoopStatusForLabel(status);
      showAgentRunningIndicator(true, statusText);

      $('#btn-stop-agent').removeClass('hidden');
      $('#btn-restart-agent').removeClass('hidden');
      $('#btn-agent-mode').removeClass('hidden');

      updateRalphLoopPauseButton(status);

      if (status === 'paused' || status === 'worker_running' || status === 'reviewer_running') {
        $('#btn-ralph-loop-pause').removeClass('hidden');
      } else {
        $('#btn-ralph-loop-pause').addClass('hidden');
      }

      $('#form-send-message').addClass('opacity-50');
      $('#input-message').prop('disabled', true);
      $('#btn-send-message').prop('disabled', true);
      state.isRalphLoopRunning = true;

      updateProjectStatusById(state.selectedProjectId, 'running');
    }
  }

  return {
    init: init,
    updateStartStopButtons: updateStartStopButtons,
    showAgentRunningIndicator: showAgentRunningIndicator,
    updateCancelButton: updateCancelButton,
    updateInputArea: updateInputArea,
    formatRalphLoopStatusForLabel: formatRalphLoopStatusForLabel,
    updateRalphLoopControls: updateRalphLoopControls
  };
}));
