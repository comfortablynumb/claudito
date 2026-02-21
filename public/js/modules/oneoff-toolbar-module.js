/**
 * One-Off Toolbar Module
 * Handles per-tab toolbar: tasks, search, permission mode, model selector, font size.
 * Shared controls (permission mode, model, font size) sync across all tabs.
 * Per-tab controls (tasks, search) are scoped to each one-off agent tab.
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OneOffToolbarModule = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var state = null;
  var escapeHtml = null;
  var escapeRegExp = null;
  var openModal = null;
  var showToast = null;
  var PermissionModeModule = null;
  var TaskDisplayModule = null;

  function init(deps) {
    state = deps.state;
    escapeHtml = deps.escapeHtml;
    escapeRegExp = deps.escapeRegExp;
    openModal = deps.openModal;
    showToast = deps.showToast;
    PermissionModeModule = deps.PermissionModeModule;
    TaskDisplayModule = deps.TaskDisplayModule;
  }

  // ============================================================
  // Toolbar HTML Generation
  // ============================================================

  function generateToolbarHtml(oneOffId) {
    var permMode = state.permissionMode || 'plan';
    var modelValue = state.currentProjectModel || 'claude-sonnet-4-6';
    var fontSize = state.fontSize || 14;

    return '<div class="oneoff-toolbar flex items-center justify-between gap-2 p-2 border-b border-gray-700" data-oneoff-id="' + oneOffId + '">' +
      generateLeftSection(oneOffId) +
      generateRightSection(oneOffId, permMode, modelValue, fontSize) +
    '</div>';
  }

  /**
   * Generate only the one-off-specific buttons (Tasks, Search, Search controls)
   * to inject into the main conversation toolbar.
   */
  function generateToolbarButtons(oneOffId) {
    return generateTasksButton(oneOffId) +
      generateSearchButton(oneOffId) +
      generateSearchControls(oneOffId);
  }

  function generateLeftSection(oneOffId) {
    return '<div class="flex items-center gap-2">' +
      generateTasksButton(oneOffId) +
      generateSearchButton(oneOffId) +
    '</div>';
  }

  function generateTasksButton(oneOffId) {
    return '<button class="oneoff-toolbar-tasks bg-gray-700 hover:bg-gray-600 text-white py-1 px-2 rounded flex items-center gap-1 text-xs transition-colors relative" ' +
      'data-oneoff-id="' + oneOffId + '" title="View tasks for this tab">' +
      '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>' +
      '</svg>' +
      'Tasks' +
      '<span class="oneoff-tasks-badge hidden absolute -top-1 -right-1 bg-purple-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-medium" ' +
        'data-oneoff-id="' + oneOffId + '">0</span>' +
    '</button>';
  }

  function generateSearchButton(oneOffId) {
    return '<button class="oneoff-toolbar-search bg-gray-700 hover:bg-gray-600 text-white py-1 px-2 rounded flex items-center gap-1 text-xs transition-colors" ' +
      'data-oneoff-id="' + oneOffId + '" title="Search in this tab">' +
      '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>' +
      '</svg>' +
      'Search' +
    '</button>';
  }

  function generateRightSection(oneOffId, permMode, modelValue, fontSize) {
    return '<div class="flex items-center gap-2">' +
      generateSearchControls(oneOffId) +
      generatePermissionSelector(oneOffId, permMode) +
      generateModelSelector(oneOffId, modelValue) +
      '<div class="border-r border-gray-600 h-4"></div>' +
      generateFontSizeControls(oneOffId, fontSize) +
    '</div>';
  }

  function generateSearchControls(oneOffId) {
    return '<div class="oneoff-search-controls flex items-center gap-1 border-r border-gray-600 pr-2 hidden" data-oneoff-id="' + oneOffId + '">' +
      '<input type="text" class="oneoff-search-input bg-gray-700 text-white text-xs px-2 py-1 rounded w-32 border border-gray-600 focus:border-purple-500 focus:outline-none" ' +
        'placeholder="Search..." data-oneoff-id="' + oneOffId + '">' +
      '<span class="oneoff-search-counter text-xs text-gray-400 w-16 text-center" data-oneoff-id="' + oneOffId + '"></span>' +
      '<button class="oneoff-search-prev bg-gray-700 hover:bg-gray-600 text-white w-6 h-6 rounded flex items-center justify-center text-xs transition-colors disabled:opacity-50" ' +
        'data-oneoff-id="' + oneOffId + '" title="Previous match">' +
        '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>' +
      '</button>' +
      '<button class="oneoff-search-next bg-gray-700 hover:bg-gray-600 text-white w-6 h-6 rounded flex items-center justify-center text-xs transition-colors disabled:opacity-50" ' +
        'data-oneoff-id="' + oneOffId + '" title="Next match">' +
        '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>' +
      '</button>' +
      '<button class="oneoff-search-close bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white w-6 h-6 rounded flex items-center justify-center text-xs transition-colors" ' +
        'data-oneoff-id="' + oneOffId + '" title="Close search">' +
        '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
      '</button>' +
    '</div>';
  }

  function generatePermissionSelector(oneOffId, permMode) {
    var acceptActive = permMode === 'acceptEdits' ? ' perm-active' : '';
    var planActive = permMode === 'plan' ? ' perm-active' : '';

    return '<div class="flex items-center bg-gray-700 rounded overflow-hidden text-xs h-6">' +
      '<button class="oneoff-perm-btn h-full px-2 transition-colors perm-btn' + acceptActive + ' flex items-center justify-center gap-1" ' +
        'data-oneoff-id="' + oneOffId + '" data-mode="acceptEdits" title="Accept Edits">' +
        '<svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>' +
        '</svg>' +
        '<span class="hidden md:inline">Accept Edits</span>' +
      '</button>' +
      '<button class="oneoff-perm-btn h-full px-2 transition-colors perm-btn' + planActive + ' flex items-center justify-center gap-1" ' +
        'data-oneoff-id="' + oneOffId + '" data-mode="plan" title="Plan Mode">' +
        '<svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>' +
        '</svg>' +
        '<span class="hidden md:inline">Plan</span>' +
      '</button>' +
    '</div>';
  }

  function generateModelSelector(oneOffId, modelValue) {
    var models = [
      { value: 'claude-opus-4-6', label: 'Opus 4.6' },
      { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
      { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' }
    ];

    var options = '';

    for (var i = 0; i < models.length; i++) {
      var selected = models[i].value === modelValue ? ' selected' : '';
      options += '<option value="' + models[i].value + '" class="bg-gray-700 text-white"' + selected + '>' + models[i].label + '</option>';
    }

    return '<div class="flex items-center bg-gray-700 rounded text-xs h-6" title="Select Claude model">' +
      '<select class="oneoff-model-select bg-gray-700 text-white text-xs px-1.5 h-full rounded cursor-pointer focus:outline-none focus:ring-1 focus:ring-purple-500 appearance-none pr-5" ' +
        'data-oneoff-id="' + oneOffId + '" style="background-image: url(\'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%239ca3af%22 stroke-width=%222%22%3E%3Cpath stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22M19 9l-7 7-7-7%22/%3E%3C/svg%3E\'); background-repeat: no-repeat; background-position: right 0.25rem center; background-size: 0.75rem;">' +
        options +
      '</select>' +
    '</div>';
  }

  function generateFontSizeControls(oneOffId, fontSize) {
    return '<div class="flex items-center gap-1">' +
      '<button class="oneoff-font-decrease bg-gray-700 hover:bg-gray-600 text-white w-6 h-6 rounded flex items-center justify-center text-xs transition-colors" ' +
        'data-oneoff-id="' + oneOffId + '" title="Decrease font size">' +
        '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/></svg>' +
      '</button>' +
      '<span class="oneoff-font-size-display text-xs text-gray-400 w-8 text-center" data-oneoff-id="' + oneOffId + '">' + fontSize + 'px</span>' +
      '<button class="oneoff-font-increase bg-gray-700 hover:bg-gray-600 text-white w-6 h-6 rounded flex items-center justify-center text-xs transition-colors" ' +
        'data-oneoff-id="' + oneOffId + '" title="Increase font size">' +
        '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>' +
      '</button>' +
    '</div>';
  }

  // ============================================================
  // Per-Tab Tasks
  // ============================================================

  function getTab(oneOffId) {
    if (!state.oneOffTabs || !state.selectedProjectId) return null;

    var tabs = state.oneOffTabs[state.selectedProjectId];

    if (!tabs) return null;

    return tabs.find(function(t) { return t.oneOffId === oneOffId; }) || null;
  }

  function updateTabTodos(oneOffId, input) {
    var tab = getTab(oneOffId);

    if (!tab) return;

    var todoItems = input.todos;

    if (typeof input === 'string') {
      try {
        var parsed = JSON.parse(input);
        todoItems = parsed.todos;
      } catch (e) {
        return;
      }
    }

    if (Array.isArray(todoItems)) {
      tab.currentTodos = todoItems;
      updateTabTaskBadge(oneOffId);
    }
  }

  function updateTabTaskBadge(oneOffId) {
    var tab = getTab(oneOffId);

    if (!tab) return;

    var $badge = $('.oneoff-tasks-badge[data-oneoff-id="' + oneOffId + '"]');
    var todos = tab.currentTodos;

    if (!todos || todos.length === 0) {
      $badge.addClass('hidden');
      return;
    }

    var inProgress = todos.filter(function(t) { return t.status === 'in_progress'; }).length;
    var pending = todos.filter(function(t) { return t.status === 'pending'; }).length;
    var active = inProgress + pending;

    if (active > 0) {
      $badge.text(active).removeClass('hidden');
    } else {
      $badge.addClass('hidden');
    }
  }

  function openTabTasksModal(oneOffId) {
    var tab = getTab(oneOffId);

    if (!tab) return;

    if (TaskDisplayModule) {
      var content = TaskDisplayModule.renderModalContent(tab.currentTodos);
      $('#tasks-modal-content').html(content);
      openModal('modal-tasks');
    }
  }

  // ============================================================
  // Per-Tab Search
  // ============================================================

  function getTabSearch(oneOffId) {
    var tab = getTab(oneOffId);

    if (!tab) return null;

    if (!tab.search) {
      tab.search = { query: '', matches: [], currentIndex: -1, isOpen: false };
    }

    return tab.search;
  }

  function openTabSearch(oneOffId) {
    var search = getTabSearch(oneOffId);

    if (!search) return;

    search.isOpen = true;
    var $controls = $('.oneoff-search-controls[data-oneoff-id="' + oneOffId + '"]');
    $controls.removeClass('hidden');
    $controls.find('.oneoff-search-input').focus().select();
  }

  function closeTabSearch(oneOffId) {
    var search = getTabSearch(oneOffId);

    if (!search) return;

    search.isOpen = false;
    search.query = '';
    search.matches = [];
    search.currentIndex = -1;

    var $controls = $('.oneoff-search-controls[data-oneoff-id="' + oneOffId + '"]');
    $controls.addClass('hidden');
    $controls.find('.oneoff-search-input').val('');

    clearTabSearchHighlights(oneOffId);
    updateTabSearchCounter(oneOffId);
  }

  function performTabSearch(oneOffId, query) {
    var search = getTabSearch(oneOffId);

    if (!search) return;

    clearTabSearchHighlights(oneOffId);
    search.query = query;
    search.matches = [];
    search.currentIndex = -1;

    if (!query || query.length < 1) {
      updateTabSearchCounter(oneOffId);
      return;
    }

    var searchRegex;

    try {
      searchRegex = new RegExp(escapeRegExp(query), 'gi');
    } catch (e) {
      updateTabSearchCounter(oneOffId);
      return;
    }

    var $container = $('.oneoff-tab-conv[data-oneoff-id="' + oneOffId + '"] .oneoff-tab-messages');

    if (!$container.length) return;

    findAndHighlightInContainer($container[0], searchRegex, search);
    updateTabSearchCounter(oneOffId);

    if (search.matches.length > 0) {
      search.currentIndex = 0;
      highlightCurrentTabMatch(oneOffId);
    }
  }

  function findAndHighlightInContainer(container, regex, search) {
    var walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;

          var parent = node.parentElement;

          if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    var textNodes = [];
    var node;

    while (node = walker.nextNode()) {
      textNodes.push(node);
    }

    textNodes.reverse().forEach(function(textNode) {
      var text = textNode.textContent;
      var match;
      var lastIndex = 0;
      var fragments = [];

      regex.lastIndex = 0;

      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragments.push(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        var highlightSpan = document.createElement('span');
        highlightSpan.className = 'search-highlight';
        highlightSpan.textContent = match[0];
        fragments.push(highlightSpan);
        search.matches.push(highlightSpan);
        lastIndex = regex.lastIndex;
      }

      if (lastIndex < text.length) {
        fragments.push(document.createTextNode(text.substring(lastIndex)));
      }

      if (fragments.length > 0 && lastIndex > 0) {
        var parent = textNode.parentNode;

        fragments.forEach(function(fragment) {
          parent.insertBefore(fragment, textNode);
        });

        parent.removeChild(textNode);
      }
    });

    search.matches.reverse();
  }

  function clearTabSearchHighlights(oneOffId) {
    var $container = $('.oneoff-tab-conv[data-oneoff-id="' + oneOffId + '"]');
    $container.find('.search-highlight').each(function() {
      var $span = $(this);
      var textNode = document.createTextNode($span.text());
      $span.replaceWith(textNode);
    });

    $container.find('.oneoff-tab-messages')[0] && $container.find('.oneoff-tab-messages')[0].normalize();
  }

  function updateTabSearchCounter(oneOffId) {
    var search = getTabSearch(oneOffId);

    if (!search) return;

    var $counter = $('.oneoff-search-counter[data-oneoff-id="' + oneOffId + '"]');
    var total = search.matches.length;
    var current = search.currentIndex + 1;

    if (total === 0) {
      $counter.text('');
      $('.oneoff-search-prev[data-oneoff-id="' + oneOffId + '"], .oneoff-search-next[data-oneoff-id="' + oneOffId + '"]').prop('disabled', true);
    } else {
      $counter.text(current + ' of ' + total);
      $('.oneoff-search-prev[data-oneoff-id="' + oneOffId + '"], .oneoff-search-next[data-oneoff-id="' + oneOffId + '"]').prop('disabled', false);
    }
  }

  function highlightCurrentTabMatch(oneOffId) {
    var search = getTabSearch(oneOffId);

    if (!search) return;

    var $container = $('.oneoff-tab-conv[data-oneoff-id="' + oneOffId + '"]');
    $container.find('.search-highlight').removeClass('current');

    if (search.currentIndex >= 0 && search.currentIndex < search.matches.length) {
      var match = search.matches[search.currentIndex];
      $(match).addClass('current');
      scrollTabMatchIntoView(oneOffId, match);
    }

    updateTabSearchCounter(oneOffId);
  }

  function scrollTabMatchIntoView(oneOffId, element) {
    var $scrollContainer = $('#oneoff-conversation-container');

    if (!$scrollContainer.length) return;

    var $element = $(element);
    var containerTop = $scrollContainer.scrollTop();
    var containerHeight = $scrollContainer.height();
    var elementTop = $element.offset().top - $scrollContainer.offset().top + containerTop;
    var elementHeight = $element.outerHeight();

    var targetScroll = elementTop - (containerHeight / 2) + (elementHeight / 2);
    var maxScroll = $scrollContainer[0].scrollHeight - containerHeight;
    targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));

    $scrollContainer.animate({ scrollTop: targetScroll }, 150);
  }

  function goToNextTabMatch(oneOffId) {
    var search = getTabSearch(oneOffId);

    if (!search || search.matches.length === 0) return;

    search.currentIndex = (search.currentIndex + 1) % search.matches.length;
    highlightCurrentTabMatch(oneOffId);
  }

  function goToPrevTabMatch(oneOffId) {
    var search = getTabSearch(oneOffId);

    if (!search || search.matches.length === 0) return;

    search.currentIndex = search.currentIndex - 1;

    if (search.currentIndex < 0) {
      search.currentIndex = search.matches.length - 1;
    }

    highlightCurrentTabMatch(oneOffId);
  }

  // ============================================================
  // Shared Control Syncing
  // ============================================================

  function syncPermissionMode(mode) {
    $('.oneoff-perm-btn').removeClass('perm-active');

    if (mode === 'acceptEdits') {
      $('.oneoff-perm-btn[data-mode="acceptEdits"]').addClass('perm-active');
    } else {
      $('.oneoff-perm-btn[data-mode="plan"]').addClass('perm-active');
    }
  }

  function syncModel(modelValue) {
    $('.oneoff-model-select').val(modelValue || 'claude-sonnet-4-6');
  }

  function syncFontSize(size) {
    $('.oneoff-font-size-display').text(size + 'px');
  }

  // ============================================================
  // Event Handlers (delegated)
  // ============================================================

  function setupHandlers() {
    // Tasks button
    $(document).on('click', '.oneoff-toolbar-tasks', function() {
      var oneOffId = $(this).data('oneoff-id');

      if (oneOffId) {
        openTabTasksModal(oneOffId);
      }
    });

    // Search button (open)
    $(document).on('click', '.oneoff-toolbar-search', function() {
      var oneOffId = $(this).data('oneoff-id');

      if (oneOffId) {
        openTabSearch(oneOffId);
      }
    });

    // Search close
    $(document).on('click', '.oneoff-search-close', function() {
      var oneOffId = $(this).data('oneoff-id');

      if (oneOffId) {
        closeTabSearch(oneOffId);
      }
    });

    // Search input
    var searchDebounce = null;

    $(document).on('input', '.oneoff-search-input', function() {
      var oneOffId = $(this).data('oneoff-id');
      var query = $(this).val();

      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function() {
        if (oneOffId) {
          performTabSearch(oneOffId, query);
        }
      }, 150);
    });

    // Search prev/next
    $(document).on('click', '.oneoff-search-prev', function() {
      var oneOffId = $(this).data('oneoff-id');

      if (oneOffId) {
        goToPrevTabMatch(oneOffId);
      }
    });

    $(document).on('click', '.oneoff-search-next', function() {
      var oneOffId = $(this).data('oneoff-id');

      if (oneOffId) {
        goToNextTabMatch(oneOffId);
      }
    });

    // Permission mode buttons
    $(document).on('click', '.oneoff-perm-btn', function() {
      var mode = $(this).data('mode');

      if (mode && PermissionModeModule) {
        PermissionModeModule.setMode(mode);
      }
    });

    // Model selector
    $(document).on('change', '.oneoff-model-select', function() {
      var model = $(this).val() || null;

      if (state.handleProjectModelChange) {
        state.handleProjectModelChange(model);
      }
    });

    // Font size decrease
    $(document).on('click', '.oneoff-font-decrease', function() {
      if (state.fontSize > 10) {
        state.fontSize -= 2;

        if (state.updateFontSize) {
          state.updateFontSize();
        }
      }
    });

    // Font size increase
    $(document).on('click', '.oneoff-font-increase', function() {
      if (state.fontSize < 24) {
        state.fontSize += 2;

        if (state.updateFontSize) {
          state.updateFontSize();
        }
      }
    });

    // Search keyboard shortcuts within search input
    $(document).on('keydown', '.oneoff-search-input', function(e) {
      var oneOffId = $(this).data('oneoff-id');

      if (e.key === 'Enter') {
        e.preventDefault();

        if (e.shiftKey) {
          goToPrevTabMatch(oneOffId);
        } else {
          goToNextTabMatch(oneOffId);
        }
      }

      if (e.key === 'Escape') {
        closeTabSearch(oneOffId);
      }
    });
  }

  return {
    init: init,
    generateToolbarHtml: generateToolbarHtml,
    generateToolbarButtons: generateToolbarButtons,
    updateTabTodos: updateTabTodos,
    updateTabTaskBadge: updateTabTaskBadge,
    openTabTasksModal: openTabTasksModal,
    openTabSearch: openTabSearch,
    closeTabSearch: closeTabSearch,
    performTabSearch: performTabSearch,
    goToNextTabMatch: goToNextTabMatch,
    goToPrevTabMatch: goToPrevTabMatch,
    clearTabSearchHighlights: clearTabSearchHighlights,
    syncPermissionMode: syncPermissionMode,
    syncModel: syncModel,
    syncFontSize: syncFontSize,
    setupHandlers: setupHandlers
  };
}));
