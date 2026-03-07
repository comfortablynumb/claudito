/**
 * Roadmap Module
 * Handles roadmap rendering, selection, and task execution
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RoadmapModule = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Dependencies injected via init()
  var state = null;
  var lastRoadmapData = null;
  var escapeHtml = null;
  var showToast = null;
  var closeModal = null;
  var findProjectById = null;
  var doSendMessage = null;
  var startInteractiveAgentWithMessage = null;
  var api = null;
  var updateProjectStatusById = null;
  var startAgentStatusPolling = null;
  var appendMessage = null;
  var PermissionModeModule = null;

  function init(deps) {
    state = deps.state;
    escapeHtml = deps.escapeHtml;
    showToast = deps.showToast;
    closeModal = deps.closeModal;
    findProjectById = deps.findProjectById;
    doSendMessage = deps.doSendMessage;
    startInteractiveAgentWithMessage = deps.startInteractiveAgentWithMessage;
    api = deps.api;
    updateProjectStatusById = deps.updateProjectStatusById;
    startAgentStatusPolling = deps.startAgentStatusPolling;
    appendMessage = deps.appendMessage;
    PermissionModeModule = deps.PermissionModeModule;
  }

  function renderRoadmap(data) {
    lastRoadmapData = data;
    var $container = $('#roadmap-content');

    if (!data || !data.parsed) {
      $container.html('<div class="text-gray-500 text-center">No roadmap found</div>');
      return;
    }

    var parsed = data.parsed;

    if (!parsed.phases || parsed.phases.length === 0) {
      $container.html(
        '<div class="text-gray-400 text-center py-8">' +
        '<p class="mb-2">Roadmap format not recognized.</p>' +
        '<p class="text-xs text-gray-500 mb-4">Expected phase headers like <code class="bg-gray-700 px-1 rounded">## Phase 1: Title</code> and milestone headers like <code class="bg-gray-700 px-1 rounded">### Milestone 1.1: Title</code>.</p>' +
        '<button id="btn-adapt-roadmap-format" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded">' +
        'Adapt roadmap to expected Claudito format' +
        '</button>' +
        '</div>'
      );
      return;
    }

    var html = renderOverallProgress(parsed.overallProgress);
    html += renderPhases(parsed.phases, parsed.currentPhase, parsed.currentMilestone);

    $container.html(html);
  }

  function renderOverallProgress(progress) {
    return '<div class="mb-4 p-3 bg-gray-800 rounded">' +
      '<div class="flex justify-between text-sm mb-1">' +
        '<span class="text-gray-300">Overall Progress</span>' +
        '<span class="text-gray-400">' + progress + '%</span>' +
      '</div>' +
      '<div class="w-full bg-gray-700 rounded-full h-2">' +
        '<div class="bg-green-500 h-2 rounded-full" style="width: ' + progress + '%"></div>' +
      '</div>' +
    '</div>';
  }

  function isPhaseFullyComplete(phase) {
    if (!phase.milestones || phase.milestones.length === 0) return false;

    return phase.milestones.every(function(m) {
      return m.totalCount > 0 && m.completedCount === m.totalCount;
    });
  }

  function renderPhases(phases, currentPhase, currentMilestone) {
    var html = '';

    phases.forEach(function(phase) {
      var isCurrent = phase.id === currentPhase;
      var phaseClass = isCurrent ? 'border-blue-500' : 'border-gray-700';

      var isPhaseComplete = isPhaseFullyComplete(phase);
      var phaseDisabled = isPhaseComplete ? 'disabled title="All tasks completed"' : '';

      html += '<div class="mb-3 border-l-2 ' + phaseClass + ' pl-3">' +
        '<div class="flex items-center justify-between group mb-2">' +
          '<div class="flex items-center gap-2">' +
            '<input type="checkbox" class="roadmap-select-phase w-3.5 h-3.5 accent-purple-500 cursor-pointer" ' +
              'data-phase-id="' + escapeHtml(phase.id) + '" ' +
              'data-phase-title="' + escapeHtml(phase.title) + '" ' +
              phaseDisabled + ' />' +
            '<span class="text-sm font-medium text-gray-200">' + escapeHtml(phase.title) + '</span>' +
          '</div>' +
          '<button class="btn-delete-phase opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 p-0.5 transition-opacity" ' +
            'data-phase-id="' + escapeHtml(phase.id) + '" ' +
            'data-phase-title="' + escapeHtml(phase.title) + '" ' +
            'title="Delete phase">' +
            '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>' +
            '</svg>' +
          '</button>' +
        '</div>';

      phase.milestones.forEach(function(milestone) {
        html += renderMilestone(phase.id, milestone, milestone.id === currentMilestone);
      });

      html += '</div>';
    });

    return html;
  }

  function renderMilestone(phaseId, milestone, isCurrent) {
    var progress = milestone.totalCount > 0
      ? Math.round((milestone.completedCount / milestone.totalCount) * 100)
      : 0;
    var bgClass = isCurrent ? 'bg-blue-900/30' : 'bg-gray-800/50';
    var barColor = progress === 100 ? 'bg-green-500' : 'bg-blue-500';
    var milestoneKey = phaseId + '-' + milestone.id;
    var isExpanded = getMilestoneExpanded(milestoneKey);
    var chevronClass = isExpanded ? 'rotate-90' : '';
    var isMilestoneComplete = milestone.totalCount > 0 && milestone.completedCount === milestone.totalCount;
    var milestoneDisabled = isMilestoneComplete ? 'disabled title="All tasks completed"' : '';

    var html = '<div class="mb-2 p-2 ' + bgClass + ' rounded text-xs milestone-container group/milestone">' +
      '<div class="milestone-header flex items-center gap-2 cursor-pointer select-none" data-milestone-key="' + escapeHtml(milestoneKey) + '">' +
        '<input type="checkbox" class="roadmap-select-milestone w-3 h-3 accent-purple-500 cursor-pointer" ' +
          'data-phase-id="' + escapeHtml(phaseId) + '" ' +
          'data-milestone-id="' + escapeHtml(milestone.id) + '" ' +
          'data-milestone-title="' + escapeHtml(milestone.title) + '" ' +
          milestoneDisabled + ' />' +
        '<svg class="w-3 h-3 text-gray-400 transition-transform duration-200 milestone-chevron ' + chevronClass + '" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>' +
        '</svg>' +
        '<span class="flex-1 text-gray-300">' + escapeHtml(milestone.title) + '</span>' +
        '<span class="text-gray-500">' + milestone.completedCount + '/' + milestone.totalCount + '</span>' +
        '<button class="btn-delete-milestone opacity-0 group-hover/milestone:opacity-100 text-red-400 hover:text-red-300 p-0.5 transition-opacity" ' +
          'data-phase-id="' + escapeHtml(phaseId) + '" ' +
          'data-milestone-id="' + escapeHtml(milestone.id) + '" ' +
          'data-milestone-title="' + escapeHtml(milestone.title) + '" ' +
          'onclick="event.stopPropagation();" ' +
          'title="Delete milestone">' +
          '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>' +
          '</svg>' +
        '</button>' +
      '</div>' +
      '<div class="w-full bg-gray-700 rounded-full h-1 mt-1">' +
        '<div class="' + barColor + ' h-1 rounded-full transition-all duration-300" style="width: ' + progress + '%"></div>' +
      '</div>';

    // Render individual tasks with delete buttons and selection checkboxes (expandable)
    if (milestone.tasks && milestone.tasks.length > 0) {
      var displayStyle = isExpanded ? '' : 'display: none;';
      html += '<div class="milestone-tasks space-y-1 mt-2 overflow-hidden transition-all duration-200" style="' + displayStyle + '">';

      milestone.tasks.forEach(function(task, index) {
        var completedClass = task.completed ? 'text-gray-500 line-through' : 'text-gray-300';
        var checkboxIcon = task.completed
          ? '<svg class="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>'
          : '<svg class="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2"/></svg>';

        html += '<div class="flex items-center gap-2 group">' +
          '<input type="checkbox" class="roadmap-select-task w-3 h-3 accent-purple-500 cursor-pointer" ' +
            'data-phase-id="' + escapeHtml(phaseId) + '" ' +
            'data-milestone-id="' + escapeHtml(milestone.id) + '" ' +
            'data-task-index="' + index + '" ' +
            'data-task-title="' + escapeHtml(task.title) + '" ' +
            (task.completed ? 'disabled title="Already completed"' : '') + ' />' +
          '<span class="flex-shrink-0">' + checkboxIcon + '</span>' +
          '<span class="flex-1 ' + completedClass + '">' + escapeHtml(task.title) + '</span>' +
          '<button class="btn-delete-task opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 p-0.5 transition-opacity" ' +
            'data-phase-id="' + escapeHtml(phaseId) + '" ' +
            'data-milestone-id="' + escapeHtml(milestone.id) + '" ' +
            'data-task-index="' + index + '" ' +
            'data-task-title="' + escapeHtml(task.title) + '" ' +
            'title="Delete task">' +
            '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>' +
            '</svg>' +
          '</button>' +
        '</div>';
      });

      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function getMilestoneExpanded(key) {
    var stored = localStorage.getItem('claudito-milestone-expanded');
    var expanded = stored ? JSON.parse(stored) : {};
    return expanded[key] === true;
  }

  function setMilestoneExpanded(key, isExpanded) {
    var stored = localStorage.getItem('claudito-milestone-expanded');
    var expanded = stored ? JSON.parse(stored) : {};
    expanded[key] = isExpanded;
    localStorage.setItem('claudito-milestone-expanded', JSON.stringify(expanded));
  }

  function toggleMilestoneExpanded(key) {
    var isExpanded = getMilestoneExpanded(key);
    setMilestoneExpanded(key, !isExpanded);
    return !isExpanded;
  }

  function getSelectedRoadmapItems() {
    var items = [];

    // Collect selected phases
    $('.roadmap-select-phase:checked').each(function() {
      var $checkbox = $(this);
      items.push({
        type: 'phase',
        phaseId: $checkbox.data('phase-id'),
        title: $checkbox.data('phase-title')
      });
    });

    var selectedPhaseIds = items.map(function(item) { return item.phaseId; });

    // Collect selected milestones (skip if phase already selected)
    $('.roadmap-select-milestone:checked').each(function() {
      var $checkbox = $(this);
      var phaseId = $checkbox.data('phase-id');

      if (selectedPhaseIds.indexOf(phaseId) === -1) {
        items.push({
          type: 'milestone',
          phaseId: phaseId,
          milestoneId: $checkbox.data('milestone-id'),
          title: $checkbox.data('milestone-title')
        });
      }
    });

    // Collect selected tasks (skip if phase or milestone already selected)
    var selectedMilestoneIds = items
      .filter(function(item) { return item.type === 'milestone'; })
      .map(function(item) { return item.milestoneId; });

    $('.roadmap-select-task:checked:not(:disabled)').each(function() {
      var $checkbox = $(this);
      var phaseId = $checkbox.data('phase-id');
      var milestoneId = $checkbox.data('milestone-id');

      if (selectedPhaseIds.indexOf(phaseId) === -1 &&
          selectedMilestoneIds.indexOf(milestoneId) === -1) {
        items.push({
          type: 'task',
          phaseId: phaseId,
          milestoneId: milestoneId,
          taskIndex: $checkbox.data('task-index'),
          title: $checkbox.data('task-title')
        });
      }
    });

    return items;
  }

  function updateRoadmapSelectionUI() {
    var items = getSelectedRoadmapItems();
    var $section = $('#roadmap-run-selected');
    var $count = $('#roadmap-selected-count');

    if (items.length > 0) {
      $section.removeClass('hidden');
      $count.text(items.length);
    } else {
      $section.addClass('hidden');
    }
  }

  function clearRoadmapSelection() {
    $('.roadmap-select-phase, .roadmap-select-milestone, .roadmap-select-task').prop('checked', false);
    updateRoadmapSelectionUI();
  }

  function convertSelectedToTasks() {
    var items = getSelectedRoadmapItems();

    if (items.length === 0) {
      showToast('Please select items to convert', 'warning');
      return;
    }

    var prompt = generateConvertToTasksPrompt(items);

    closeModal('modal-roadmap');
    clearRoadmapSelection();

    var project = findProjectById(state.selectedProjectId);
    var isRunning = project && project.status === 'running';

    if (!isRunning) {
      ensureAcceptEditsMode();
      startInteractiveAgentWithMessage(prompt);
      return;
    }

    if (state.permissionMode === 'acceptEdits') {
      doSendMessage(prompt);
      return;
    }

    // Agent is running in plan mode — stop, switch, restart with prompt
    restartWithAcceptEditsAndMessage(prompt);
  }

  function ensureAcceptEditsMode() {
    if (state.permissionMode !== 'acceptEdits') {
      state.permissionMode = 'acceptEdits';
      state.pendingPermissionMode = null;

      if (PermissionModeModule) {
        PermissionModeModule.updateButtons();
        PermissionModeModule.updatePendingIndicator();
      }
    }
  }

  function restartWithAcceptEditsAndMessage(prompt) {
    var projectId = state.selectedProjectId;
    var sessionId = state.currentSessionId;

    if (!projectId) return;

    PermissionModeModule.setSwitchingState(true);
    showToast('Switching to Accept Edits mode...', 'info');

    api.stopAgent(projectId)
      .done(function() {
        updateProjectStatusById(projectId, 'stopped');

        setTimeout(function() {
          ensureAcceptEditsMode();

          api.startInteractiveAgent(projectId, prompt, [], sessionId, 'acceptEdits')
            .done(function(response) {
              state.currentAgentMode = 'interactive';
              updateProjectStatusById(projectId, 'running');
              startAgentStatusPolling(projectId);
              PermissionModeModule.setSwitchingState(false);

              if (response && response.sessionId) {
                state.currentSessionId = response.sessionId;
              }

              appendMessage(projectId, {
                type: 'system',
                content: 'Agent restarted with Accept Edits mode for roadmap tasks',
                timestamp: new Date().toISOString()
              });
            })
            .fail(function(xhr) {
              PermissionModeModule.setSwitchingState(false);
              var msg = xhr.responseJSON ? xhr.responseJSON.error : 'Failed to restart agent';
              showToast(msg, 'error');
            });
        }, 1000);
      })
      .fail(function(xhr) {
        PermissionModeModule.setSwitchingState(false);
        var msg = xhr.responseJSON ? xhr.responseJSON.error : 'Failed to stop agent';
        showToast(msg, 'error');
      });
  }

  function generateConvertToTasksPrompt(items) {
    var lines = ['Please convert the following roadmap items into actionable tasks for your todo list:\n'];

    items.forEach(function(item, index) {
      if (item.type === 'phase') {
        lines.push((index + 1) + '. **Phase**: ' + item.title);
      } else if (item.type === 'milestone') {
        lines.push((index + 1) + '. **Milestone**: ' + item.title);
      } else {
        lines.push((index + 1) + '. **Task**: ' + item.title);
      }
    });

    lines.push('\nFor each item:');
    lines.push('1. Break it down into specific, actionable sub-tasks if needed');
    lines.push('2. Add these to your todo list using the TodoWrite tool');
    lines.push('3. Start working on them in order');
    lines.push('4. Once a task is completed, update the ROADMAP.md to mark it as done with [x]');

    return lines.join('\n');
  }

  function setupHandlers() {
    // Milestone header click - toggle expansion
    $(document).on('click', '.milestone-header', function(e) {
      // Don't toggle if clicking on checkbox or delete button (but allow chevron clicks)
      var $target = $(e.target);
      if ($target.is('input, button')) return;
      if ($target.is('svg, path') && !$target.closest('.milestone-chevron').length) return;

      var $header = $(this);
      var key = $header.data('milestone-key');
      var isNowExpanded = toggleMilestoneExpanded(key);

      var $chevron = $header.find('.milestone-chevron');
      var $tasks = $header.closest('.milestone-container').find('.milestone-tasks');

      if (isNowExpanded) {
        $chevron.addClass('rotate-90');
        $tasks.slideDown(200);
      } else {
        $chevron.removeClass('rotate-90');
        $tasks.slideUp(200);
      }
    });

    // Roadmap selection change - update UI
    $(document).on('change', '.roadmap-select-phase, .roadmap-select-milestone, .roadmap-select-task', function() {
      updateRoadmapSelectionUI();
    });

    // Fallback: click handler catches cases where change event doesn't bubble
    // (e.g. milestone checkboxes with onclick="event.stopPropagation()")
    $(document).on('click', '.roadmap-select-phase, .roadmap-select-milestone, .roadmap-select-task', function() {
      setTimeout(updateRoadmapSelectionUI, 0);
    });

    // Phase checkbox cascades to milestones and tasks
    $(document).on('change', '.roadmap-select-phase', function() {
      var isChecked = $(this).is(':checked');
      var phaseId = $(this).data('phase-id');

      $('.roadmap-select-milestone[data-phase-id="' + phaseId + '"]:not(:disabled)')
        .prop('checked', isChecked);
      $('.roadmap-select-task[data-phase-id="' + phaseId + '"]:not(:disabled)')
        .prop('checked', isChecked);

      updateRoadmapSelectionUI();
    });

    // Milestone checkbox cascades to tasks
    $(document).on('change', '.roadmap-select-milestone', function() {
      var isChecked = $(this).is(':checked');
      var milestoneId = $(this).data('milestone-id');

      $('.roadmap-select-task[data-milestone-id="' + milestoneId + '"]:not(:disabled)')
        .prop('checked', isChecked);

      updateRoadmapSelectionUI();
    });

    // Convert to tasks button
    $('#btn-convert-to-tasks').on('click', function() {
      convertSelectedToTasks();
    });

    // Clear selection button
    $('#btn-clear-roadmap-selection').on('click', function() {
      clearRoadmapSelection();
    });

    // Adapt roadmap format button
    $(document).on('click', '#btn-adapt-roadmap-format', function() {
      adaptRoadmapFormat();
    });
  }

  function adaptRoadmapFormat() {
    var project = findProjectById(state.selectedProjectId);
    if (!project) return;

    var roadmapPath = project.path.replace(/\\/g, '/') + '/doc/ROADMAP.md';
    var prompt = buildAdaptRoadmapPrompt(roadmapPath);

    closeModal('modal-roadmap');

    var isRunning = project.status === 'running';

    if (!isRunning) {
      ensureAcceptEditsMode();
      startInteractiveAgentWithMessage(prompt);
      return;
    }

    if (state.permissionMode === 'acceptEdits') {
      doSendMessage(prompt);
      return;
    }

    restartWithAcceptEditsAndMessage(prompt);
  }

  function buildAdaptRoadmapPrompt(roadmapPath) {
    return 'The file `' + roadmapPath + '` exists but uses a format that Claudito\'s roadmap parser cannot parse.\n\n' +
      'Please reformat it to match the expected Claudito format:\n\n' +
      '- **Phase sections**: `## Phase N: Title` (e.g. `## Phase 1: Project Setup`)\n' +
      '- **Milestone sections**: `### Milestone N.N: Title` (e.g. `### Milestone 1.1: Initial Setup`)\n' +
      '- **Task items**: `- [ ] Task description` for pending, `- [x] Task description` for completed\n\n' +
      'Please read the current file, understand the existing structure (phases, milestones, tasks), and reformat it while preserving all content. Make only the minimal changes required to match the format above.';
  }

  return {
    init: init,
    render: renderRoadmap,
    getSelectedItems: getSelectedRoadmapItems,
    updateSelectionUI: updateRoadmapSelectionUI,
    clearSelection: clearRoadmapSelection,
    convertToTasks: convertSelectedToTasks,
    toggleMilestoneExpanded: toggleMilestoneExpanded,
    setupHandlers: setupHandlers
  };
}));
