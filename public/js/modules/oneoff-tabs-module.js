/**
 * One-Off Tabs Module (Agent Tabs)
 * Manages sub-tabs in the Agent Output section for one-off agent tasks.
 * Each tab now supports full rendering (tool results, plan mode, input).
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OneOffTabsModule = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var state = null;
  var api = null;
  var escapeHtml = null;
  var showToast = null;
  var showConfirm = null;
  var MessageRenderer = null;
  var ToolRenderer = null;
  var FileCache = null;
  var TaskDisplayModule = null;
  var OneOffToolbarModule = null;

  function init(deps) {
    state = deps.state;
    api = deps.api;
    escapeHtml = deps.escapeHtml;
    showToast = deps.showToast;
    showConfirm = deps.showConfirm;
    MessageRenderer = deps.MessageRenderer;
    ToolRenderer = deps.ToolRenderer || null;
    FileCache = deps.FileCache || null;
    TaskDisplayModule = deps.TaskDisplayModule || null;
    OneOffToolbarModule = deps.OneOffToolbarModule || null;

    if (!state.oneOffTabs) {
      state.oneOffTabs = {};
    }

    state.activeOneOffTabId = null;
    setupHandlers();

    if (OneOffToolbarModule) {
      OneOffToolbarModule.setupHandlers();
    }
  }

  function getProjectTabs(projectId) {
    if (!state.oneOffTabs[projectId]) {
      state.oneOffTabs[projectId] = [];
    }

    return state.oneOffTabs[projectId];
  }

  function ensureTab(projectId, oneOffId, label) {
    var tabs = getProjectTabs(projectId);
    var existing = tabs.find(function(t) { return t.oneOffId === oneOffId; });

    if (existing) return;

    tabs.push({
      oneOffId: oneOffId,
      label: label || 'Task',
      status: 'running',
      messages: [],
      runningToolIds: [],
      isWaiting: false,
      waitingVersion: 0,
      currentTodos: [],
      search: { query: '', matches: [], currentIndex: -1, isOpen: false }
    });

    renderTabBar(projectId);
    createTabContainer(oneOffId);
  }

  function createTab(projectId, oneOffId, label) {
    ensureTab(projectId, oneOffId, label);
    switchToTab(oneOffId);
  }

  function createTabContainer(oneOffId) {
    var $parent = $('#oneoff-conversation-container');

    var $tabConv = $(
      '<div class="oneoff-tab-conv hidden" data-oneoff-id="' + oneOffId + '">' +
        '<div class="oneoff-tab-messages space-y-2 font-mono text-sm"></div>' +
      '</div>'
    );

    $parent.find('#oneoff-conversation').append($tabConv);
  }

  function switchToTab(oneOffId) {
    state.activeOneOffTabId = oneOffId;

    $('#conversation-wrapper').addClass('hidden');
    $('#oneoff-conversation-container').removeClass('hidden');

    // Hide main-only toolbar left section, inject one-off buttons
    $('#conversation-toolbar > .flex:first-child > *').addClass('oneoff-hidden');
    injectOneOffToolbarButtons(oneOffId);

    // Recreate DOM container if it was cleared (e.g. after project switch)
    var $tabConv = $('.oneoff-tab-conv[data-oneoff-id="' + oneOffId + '"]');

    if (!$tabConv.length) {
      createTabContainer(oneOffId);
      renderConversation(oneOffId);
    }

    $('.oneoff-tab-conv').addClass('hidden');
    $('.oneoff-tab-conv[data-oneoff-id="' + oneOffId + '"]').removeClass('hidden');

    updateTabBarActiveState();
    scrollOneOffToBottom();
  }

  function switchToMain() {
    state.activeOneOffTabId = null;

    $('#conversation-wrapper').removeClass('hidden');
    $('#oneoff-conversation-container').addClass('hidden');

    // Restore main toolbar left section, remove one-off buttons
    $('#conversation-toolbar > .flex:first-child > *').removeClass('oneoff-hidden');
    removeOneOffToolbarButtons();

    updateTabBarActiveState();
  }

  function injectOneOffToolbarButtons(oneOffId) {
    removeOneOffToolbarButtons();

    var $leftSection = $('#conversation-toolbar > .flex:first-child');

    if (!$leftSection.length) return;

    var buttonsHtml = '';

    if (OneOffToolbarModule) {
      buttonsHtml = OneOffToolbarModule.generateToolbarButtons(oneOffId);
    }

    $leftSection.append('<span id="oneoff-toolbar-buttons" class="flex items-center gap-2">' + buttonsHtml + '</span>');
  }

  function removeOneOffToolbarButtons() {
    $('#oneoff-toolbar-buttons').remove();
  }

  function requestCloseTab(oneOffId) {
    var tab = findTab(oneOffId);

    if (!tab) return;

    var message = tab.status === 'running'
      ? 'This will stop the running agent. Close tab?'
      : 'Close this tab?';

    showConfirm(message, function() {
      closeTab(oneOffId);
    });
  }

  function closeTab(oneOffId) {
    var projectId = state.selectedProjectId;

    if (!projectId) return;

    var tab = findTab(oneOffId);

    if (tab && tab.status === 'running') {
      api.stopOneOffAgent(projectId, oneOffId).fail(function() {
        // Silently ignore stop failure
      });
    }

    var tabs = getProjectTabs(projectId);
    var index = tabs.findIndex(function(t) { return t.oneOffId === oneOffId; });

    if (index >= 0) {
      tabs.splice(index, 1);
    }

    $('.oneoff-tab-conv[data-oneoff-id="' + oneOffId + '"]').remove();

    if (state.activeOneOffTabId === oneOffId) {
      switchToMain();
    }

    renderTabBar(projectId);
  }

  function appendMessage(projectId, oneOffId, message) {
    if (projectId !== state.selectedProjectId) return;

    var tab = findTab(oneOffId);

    if (!tab && message.label) {
      ensureTab(projectId, oneOffId, message.label);
      tab = findTab(oneOffId);
    }

    if (!tab) return;

    tab.messages.push(message);

    // Track Read tool files for FileCache (diff support in Write/Edit)
    if (message.type === 'tool_use' && message.toolInfo && FileCache) {
      if (message.toolInfo.name === 'Read' && message.toolInfo.input && message.toolInfo.input.file_path) {
        FileCache.cacheFile(message.toolInfo.input.file_path);
      }

      if (message.toolInfo.name === 'TodoWrite' && message.toolInfo.input) {
        if (OneOffToolbarModule) {
          OneOffToolbarModule.updateTabTodos(oneOffId, message.toolInfo.input);
        }
      }
    }

    // Handle tool_result: update existing tool status, don't render separately
    if (message.type === 'tool_result' && message.toolInfo && ToolRenderer) {
      ToolRenderer.updateToolStatus(
        message.toolInfo.id,
        message.toolInfo.status || 'completed',
        message.toolInfo.output || message.toolInfo.resultContent
      );

      // Remove from running tools
      var resultIdx = tab.runningToolIds.indexOf(message.toolInfo.id);

      if (resultIdx >= 0) {
        tab.runningToolIds.splice(resultIdx, 1);
      }

      return;
    }

    // Mark running tools as complete on non-tool messages
    if (message.type !== 'tool_use' && message.type !== 'user' && message.type !== 'tool_result') {
      markRunningToolsComplete(oneOffId);
    }

    // Track new tool_use
    if (message.type === 'tool_use' && message.toolInfo && message.toolInfo.id) {
      tab.runningToolIds.push(message.toolInfo.id);
    }

    // Render if this tab is visible
    if (state.activeOneOffTabId === oneOffId) {
      var $conv = getTabMessagesContainer(oneOffId);

      if ($conv.length && MessageRenderer) {
        $conv.append(MessageRenderer.renderMessage(message));
        scrollOneOffToBottom();
      }
    }
  }

  function markRunningToolsComplete(oneOffId) {
    var tab = findTab(oneOffId);

    if (!tab) return;

    var $conv = getTabMessagesContainer(oneOffId);

    tab.runningToolIds.forEach(function(toolId) {
      $conv.find('[data-tool-id="' + toolId + '"] .tool-status')
        .removeClass('running')
        .addClass('completed');
    });

    tab.runningToolIds = [];
  }

  function updateStatus(projectId, oneOffId, newStatus) {
    if (projectId !== state.selectedProjectId) return;

    var tab = findTab(oneOffId);

    if (!tab) return;

    tab.status = newStatus;

    // Show/hide cancel button based on status
    var $cancelBtn = $('.oneoff-cancel-btn[data-oneoff-id="' + oneOffId + '"]');

    if (newStatus === 'running') {
      $cancelBtn.removeClass('hidden');
    } else {
      $cancelBtn.addClass('hidden');
    }

    renderTabBar(projectId);
  }

  function updateWaiting(projectId, oneOffId, isWaiting, version) {
    if (projectId !== state.selectedProjectId) return;

    var tab = findTab(oneOffId);

    if (!tab) return;

    tab.isWaiting = isWaiting;
    tab.waitingVersion = version;

    // Only update the shared input area if this tab is currently active
    if (state.activeOneOffTabId !== oneOffId) return;

    var $input = $('#input-message');
    var $sendBtn = $('#btn-send-message');

    if (isWaiting) {
      $input.attr('placeholder', 'Agent is waiting for input...').focus();
      $sendBtn.removeClass('bg-purple-600 hover:bg-purple-700')
        .addClass('bg-green-600 hover:bg-green-700');
    } else {
      $input.attr('placeholder', 'Type a message...');
      $sendBtn.removeClass('bg-green-600 hover:bg-green-700')
        .addClass('bg-purple-600 hover:bg-purple-700');
    }
  }

  function renderConversation(oneOffId) {
    var tab = findTab(oneOffId);

    if (!tab) return;

    var $conv = getTabMessagesContainer(oneOffId);
    $conv.empty();

    var messages = tab.messages.filter(function(msg) {
      return msg.type !== 'tool_result';
    });

    messages.forEach(function(msg) {
      if (MessageRenderer) {
        $conv.append(MessageRenderer.renderMessage(msg));
      }
    });

    // Re-apply tool_result statuses
    tab.messages.forEach(function(msg) {
      if (msg.type === 'tool_result' && msg.toolInfo && ToolRenderer) {
        ToolRenderer.updateToolStatus(
          msg.toolInfo.id,
          msg.toolInfo.status || 'completed',
          msg.toolInfo.output || msg.toolInfo.resultContent
        );
      }
    });

    scrollOneOffToBottom();
  }

  function renderTabBar(projectId) {
    var $bar = $('#oneoff-tab-bar');
    var tabs = getProjectTabs(projectId);

    if (tabs.length === 0) {
      $bar.addClass('hidden');

      if (state.activeOneOffTabId) {
        switchToMain();
      }

      return;
    }

    $bar.removeClass('hidden');

    var html = buildMainTabButtonHtml();

    tabs.forEach(function(tab) {
      html += buildOneOffTabHtml(tab);
    });

    $bar.html(html);
  }

  function buildMainTabButtonHtml() {
    return '<button id="oneoff-tab-main" class="oneoff-tab shrink-0 px-3 py-1.5 text-xs font-medium border-r border-gray-700 whitespace-nowrap transition-colors ' +
      (!state.activeOneOffTabId ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50') +
      '" data-oneoff-tab="main">Main</button>';
  }

  function buildOneOffTabHtml(tab) {
    var isActive = state.activeOneOffTabId === tab.oneOffId;
    var statusIcon = tab.status === 'running'
      ? '<svg class="w-3 h-3 animate-spin text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/></svg>'
      : '<svg class="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>';

    return '<div class="oneoff-tab shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-r border-gray-700 transition-colors ' +
      (isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50') + '">' +
      '<button class="oneoff-tab-select flex items-center gap-1.5 text-xs font-medium whitespace-nowrap" data-oneoff-tab="' + tab.oneOffId + '">' +
        statusIcon +
        '<span>' + escapeHtml(tab.label) + '</span>' +
      '</button>' +
      '<button class="oneoff-tab-close text-gray-500 hover:text-red-400 transition-colors" data-oneoff-close="' + tab.oneOffId + '" title="Close tab">' +
        '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
      '</button>' +
    '</div>';
  }

  function updateTabBarActiveState() {
    var $bar = $('#oneoff-tab-bar');

    var $main = $bar.find('#oneoff-tab-main');

    if (!state.activeOneOffTabId) {
      $main.addClass('bg-gray-700 text-white').removeClass('text-gray-400 hover:text-white hover:bg-gray-700/50');
    } else {
      $main.removeClass('bg-gray-700 text-white').addClass('text-gray-400 hover:text-white hover:bg-gray-700/50');
    }

    $bar.find('.oneoff-tab').not('#oneoff-tab-main').each(function() {
      var $tab = $(this);
      var tabId = $tab.find('.oneoff-tab-select').data('oneoff-tab');

      if (tabId === state.activeOneOffTabId) {
        $tab.addClass('bg-gray-700 text-white').removeClass('text-gray-400 hover:text-white hover:bg-gray-700/50');
      } else {
        $tab.removeClass('bg-gray-700 text-white').addClass('text-gray-400 hover:text-white hover:bg-gray-700/50');
      }
    });
  }

  function findTab(oneOffId) {
    var projectId = state.selectedProjectId;

    if (!projectId) return null;

    var tabs = getProjectTabs(projectId);
    return tabs.find(function(t) { return t.oneOffId === oneOffId; }) || null;
  }

  function getTabMessagesContainer(oneOffId) {
    return $('.oneoff-tab-conv[data-oneoff-id="' + oneOffId + '"] .oneoff-tab-messages');
  }

  function scrollOneOffToBottom() {
    var $container = $('#oneoff-conversation-container');

    if ($container.length) {
      $container.scrollTop($container[0].scrollHeight);
    }
  }

  function sendOneOffMessage(oneOffId) {
    var projectId = state.selectedProjectId;

    if (!projectId) return;

    var $input = $('#input-message');
    var message = $input.val().trim();

    if (!message) return;

    $input.val('');

    // Show user message locally
    var userMsg = {
      type: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };

    appendMessage(projectId, oneOffId, userMsg);

    api.sendOneOffMessage(projectId, oneOffId, message).fail(function(xhr) {
      var errorMsg = 'Failed to send message';

      if (xhr.responseJSON && xhr.responseJSON.error) {
        errorMsg = xhr.responseJSON.error;
      }

      showToast(errorMsg, 'error');
    });
  }

  function setupHandlers() {
    $(document).on('click', '#oneoff-tab-main', function() {
      switchToMain();
    });

    $(document).on('click', '.oneoff-tab-select', function() {
      var tabId = $(this).data('oneoff-tab');

      if (tabId && tabId !== 'main') {
        switchToTab(tabId);
      }
    });

    $(document).on('click', '.oneoff-tab-close', function(e) {
      e.stopPropagation();
      var oneOffId = $(this).data('oneoff-close');

      if (oneOffId) {
        requestCloseTab(oneOffId);
      }
    });

  }

  function onProjectChanged(projectId) {
    state.activeOneOffTabId = null;

    if (projectId) {
      renderTabBar(projectId);
    } else {
      $('#oneoff-tab-bar').addClass('hidden');
    }

    $('#conversation-wrapper').removeClass('hidden');
    $('#conversation-toolbar').removeClass('hidden');
    $('#oneoff-conversation-container').addClass('hidden');

    // Restore main toolbar left section
    $('#conversation-toolbar > .flex:first-child > *').removeClass('oneoff-hidden');
    removeOneOffToolbarButtons();

    $('#oneoff-conversation').empty();
  }

  function loadActiveOneOffAgents(projectId) {
    if (!api) return;

    api.getActiveOneOffAgents(projectId)
      .done(function(data) {
        if (!data || !data.agents) return;

        data.agents.forEach(function(agent) {
          ensureTab(projectId, agent.oneOffId, agent.label);
        });
      });
  }

  return {
    init: init,
    createTab: createTab,
    switchToTab: switchToTab,
    switchToMain: switchToMain,
    requestCloseTab: requestCloseTab,
    sendOneOffMessage: sendOneOffMessage,
    appendMessage: appendMessage,
    updateStatus: updateStatus,
    updateWaiting: updateWaiting,
    renderConversation: renderConversation,
    renderTabBar: renderTabBar,
    onProjectChanged: onProjectChanged,
    loadActiveOneOffAgents: loadActiveOneOffAgents
  };
}));
