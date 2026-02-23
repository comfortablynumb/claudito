/**
 * Message Renderer Module
 * Handles rendering of different message types in the conversation view
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MessageRenderer = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Dependencies injected via init()
  var escapeHtml;
  var ToolRenderer;
  var marked;
  var mermaid;

  // Context for tracking previous timestamps
  var renderingContext = {
    previousTimestamp: null
  };

  /**
   * Initialize the module with dependencies
   */
  function init(deps) {
    escapeHtml = deps.escapeHtml;
    ToolRenderer = deps.ToolRenderer;
    marked = deps.marked;
    mermaid = deps.mermaid;
  }

  /**
   * Process mermaid diagram direction - convert LR (left-right) to TD (top-down)
   * to avoid diagrams being too wide for the container
   */
  function processMermaidDirection(code) {
    // Replace common left-right orientations with top-down
    var processed = code
      .replace(/graph\s+LR\b/g, 'graph TD')
      .replace(/flowchart\s+LR\b/g, 'flowchart TD')
      .replace(/graph\s+RL\b/g, 'graph TD')
      .replace(/flowchart\s+RL\b/g, 'flowchart TD');

    // If no direction was specified for graph/flowchart, default to TD
    if (/^(graph|flowchart)\s*$/m.test(processed) || /^(graph|flowchart)\s+[^LRTB]/m.test(processed)) {
      processed = processed
        .replace(/^(graph)(\s*)$/m, '$1 TD$2')
        .replace(/^(flowchart)(\s*)$/m, '$1 TD$2')
        .replace(/^(graph)(\s+)([^LRTB])/m, '$1 TD$2$3')
        .replace(/^(flowchart)(\s+)([^LRTB])/m, '$1 TD$2$3');
    }

    return processed;
  }

  /**
   * Create custom marked renderer for mermaid support
   */
  function createMarkedRenderer() {
    if (!marked || !marked.Renderer) {
      return undefined;
    }
    var renderer = new marked.Renderer();

    // Override code block rendering
    renderer.code = function(token, language) {
      // Handle new marked API (token object) and old API (code, language)
      var code, lang;

      if (typeof token === 'object' && token !== null) {
        // New marked API - token is an object
        code = token.text || '';
        lang = token.lang || '';
      } else {
        // Old marked API - token is the code string
        code = token;
        lang = language || '';
      }

      if (lang === 'mermaid' && mermaid) {
        // Generate unique ID for the diagram
        var id = 'mermaid-' + Math.random().toString(36).substr(2, 9);

        // Process the mermaid code to switch from LR to TD if needed
        var processedCode = processMermaidDirection(code);

        // Add wrapper div for toolbar positioning
        return '<div class="mermaid-wrapper" data-diagram-id="' + id + '">' +
               '<div class="mermaid" id="' + id + '">' + escapeHtml(processedCode) + '</div>' +
               '</div>';
      }

      // Default code block rendering - use ToolRenderer if available for syntax highlighting
      if (ToolRenderer && ToolRenderer.highlightCode) {
        return '<pre><code class="language-' + (lang || '') + '">' +
               ToolRenderer.highlightCode(code, lang) +
               '</code></pre>';
      }
      return '<pre><code class="language-' + (lang || '') + '">' +
             escapeHtml(code) +
             '</code></pre>';
    };

    return renderer;
  }

  /**
   * Render markdown content to HTML
   */
  function renderMarkdown(content) {
    if (typeof marked === 'undefined' || !marked) {
      return '<pre class="whitespace-pre-wrap">' + escapeHtml(content) + '</pre>';
    }

    try {
      var renderer = createMarkedRenderer();
      var options = {
        breaks: true,
        gfm: true
      };

      if (renderer) {
        options.renderer = renderer;
      }

      marked.setOptions(options);

      var html = marked.parse(content);

      // Schedule mermaid rendering after DOM update
      if (mermaid && html.includes('class="mermaid"')) {
        setTimeout(function() {
          mermaid.run();
          // Inject toolbars after rendering
          injectMermaidToolbars();
        }, 0);
      }

      return html;
    } catch (e) {
      return '<pre class="whitespace-pre-wrap">' + escapeHtml(content) + '</pre>';
    }
  }

  /**
   * Get user icon SVG
   */
  function getUserIcon() {
    return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
      'd="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>' +
      '</svg>';
  }

  /**
   * Get Claude icon SVG
   */
  function getClaudeIcon() {
    return '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>' +
      '</svg>';
  }

  /**
   * Format timestamp for display with time difference
   */
  function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    try {
      var date = new Date(timestamp);
      var timeStr = date.toLocaleTimeString();

      // Calculate time difference if previous timestamp is available
      var diffStr = '';
      if (renderingContext.previousTimestamp) {
        try {
          var prevDate = new Date(renderingContext.previousTimestamp);
          var diffMs = date.getTime() - prevDate.getTime();
          if (diffMs > 0) {
            diffStr = ' <span class="text-xs text-gray-400 ml-1">+' + formatTimeDifference(diffMs) + '</span>';
          }
        } catch (e) {
          // Ignore error calculating difference
        }
      }

      // Update context for next message
      renderingContext.previousTimestamp = timestamp;

      return '<span class="text-xs text-gray-500 ml-2">' + timeStr + diffStr + '</span>';
    } catch (e) {
      return '';
    }
  }

  /**
   * Format time difference in a human readable way
   */
  function formatTimeDifference(diffMs) {
    if (diffMs < 1000) {
      return diffMs + 'ms';
    } else if (diffMs < 60000) {
      return Math.round(diffMs / 1000) + 's';
    } else if (diffMs < 3600000) {
      var minutes = Math.floor(diffMs / 60000);
      var seconds = Math.round((diffMs % 60000) / 1000);
      return minutes + 'm' + (seconds > 0 ? ' ' + seconds + 's' : '');
    } else {
      var hours = Math.floor(diffMs / 3600000);
      var minutes = Math.round((diffMs % 3600000) / 60000);
      return hours + 'h' + (minutes > 0 ? ' ' + minutes + 'm' : '');
    }
  }

  /**
   * Get question icon SVG
   */
  function getQuestionIcon() {
    return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
      'd="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>' +
      '</svg>';
  }

  /**
   * Get permission icon SVG
   */
  function getPermissionIcon() {
    return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
      'd="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>' +
      '</svg>';
  }

  /**
   * Get compaction icon SVG
   */
  function getCompactionIcon() {
    return '<svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
      'd="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>' +
      '</svg>';
  }

  /**
   * Render a user message
   */
  function renderUserMessage(msg) {
    var isSlack = msg.source === 'slack';
    var senderName = isSlack
      ? ('Slack' + (msg.slackUsername ? ': @' + msg.slackUsername : ''))
      : 'You';
    var iconHtml = isSlack
      ? '<span class="message-icon" title="From Slack">💬</span>'
      : getUserIcon();

    var html = '<div class="conversation-message user" data-msg-type="user">' +
      '<div class="message-header">' +
      iconHtml +
      '<span class="message-sender">' + senderName + '</span>' +
      formatTimestamp(msg.timestamp) +
      '</div>';

    if (msg.images && msg.images.length > 0) {
      html += '<div class="flex flex-wrap gap-2 mb-2">';

      msg.images.forEach(function(img) {
        html += '<img src="' + img.dataUrl + '" alt="Attached image" ' +
          'class="conversation-image" onclick="window.showImageModal(this.src)">';
      });

      html += '</div>';
    }

    if (msg.content) {
      var renderedContent = renderMarkdown(msg.content);
      html += '<div class="message-content markdown-content">' + renderedContent + '</div>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Render an assistant/stdout message
   */
  function renderAssistantMessage(msg, typeClass) {
    var renderedContent = renderMarkdown(msg.content);
    var senderName = 'Claude';

    // Check if this is a Ralph Loop message
    if (msg.ralphLoopPhase) {
      senderName = msg.ralphLoopPhase === 'worker' ? 'Worker' : 'Reviewer';
    }

    return '<div class="conversation-message ' + typeClass + ' markdown-content" data-msg-type="assistant">' +
      '<div class="message-header claude-header">' +
      getClaudeIcon() +
      '<span class="message-sender">' + senderName + '</span>' +
      formatTimestamp(msg.timestamp) +
      '</div>' +
      '<div class="message-content">' + renderedContent + '</div>' +
      '</div>';
  }

  /**
   * Render a question message
   */
  function renderQuestionMessage(msg) {
    var info = msg.questionInfo || {};
    var question = info.question || msg.content;
    var options = info.options || [];
    var header = info.header || 'Question';

    var html = '<div class="conversation-message question" data-msg-type="system">' +
      '<div class="question-header">' +
      getQuestionIcon() +
      '<span class="question-label">' + escapeHtml(header) + '</span>' +
      formatTimestamp(msg.timestamp) +
      '</div>' +
      '<div class="question-text">' + escapeHtml(question) + '</div>';

    if (options.length > 0) {
      html += '<div class="question-options">';

      options.forEach(function(opt, index) {
        html += '<button class="question-option" data-option-index="' + index +
          '" data-option-label="' + escapeHtml(opt.label) + '">' +
          '<span class="option-label">' + escapeHtml(opt.label) + '</span>';

        if (opt.description) {
          html += '<span class="option-description">' + escapeHtml(opt.description) + '</span>';
        }

        html += '</button>';
      });

      html += '<button class="question-option question-option-other" data-option-index="-1">' +
        '<span class="option-label">Other...</span>' +
        '<span class="option-description">Type a custom response</span>' +
        '</button>';

      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Render a permission request message
   */
  function renderPermissionMessage(msg) {
    var info = msg.permissionInfo || {};
    var tool = info.tool || 'Unknown';
    var action = info.action || msg.content;
    var details = info.details || {};

    var html = '<div class="conversation-message permission" data-msg-type="system">' +
      '<div class="permission-header">' +
      getPermissionIcon() +
      '<span class="permission-label">Permission Request</span>' +
      '<span class="permission-tool">' + escapeHtml(tool) + '</span>' +
      formatTimestamp(msg.timestamp) +
      '</div>' +
      '<div class="permission-action">' + escapeHtml(action) + '</div>';

    if (details.file_path) {
      html += '<div class="permission-detail"><span class="detail-label">File:</span> ' +
        '<code>' + escapeHtml(details.file_path) + '</code></div>';
    }

    if (details.command) {
      html += '<div class="permission-detail"><span class="detail-label">Command:</span> ' +
        '<pre>' + escapeHtml(details.command) + '</pre></div>';
    }

    html += '<div class="permission-actions">' +
      '<button class="permission-btn approve" data-response="yes">Approve</button>' +
      '<button class="permission-btn deny" data-response="no">Deny</button>' +
      '<button class="permission-btn always" data-response="always">Always Allow</button>' +
      '</div>';

    html += '</div>';
    return html;
  }

  /**
   * Render a plan mode message
   */
  function renderPlanModeMessage(msg) {
    var info = msg.planModeInfo || {};
    var action = info.action || 'enter';
    var isEnter = action === 'enter';

    var iconPath = isEnter
      ? 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01'
      : 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';

    var label = isEnter ? 'Plan Mode' : 'Plan Ready';
    var bgClass = isEnter ? 'bg-blue-900/40 border-blue-500' : 'bg-green-900/40 border-green-500';
    var iconClass = isEnter ? 'text-blue-400' : 'text-green-400';

    var html = '<div class="conversation-message plan-mode ' + bgClass +
      ' border-l-2 p-3 rounded" data-msg-type="system">' +
      '<div class="flex items-center gap-2 mb-2">' +
      '<svg class="w-5 h-5 ' + iconClass + '" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + iconPath + '"/>' +
      '</svg>' +
      '<span class="font-medium text-white">' + label + '</span>' +
      formatTimestamp(msg.timestamp) +
      '</div>' +
      '<div class="text-gray-300 text-sm">' + escapeHtml(msg.content) + '</div>';

    if (!isEnter) {
      html += '<div class="plan-content-container mt-3 mb-3"></div>';

      html += '<div class="plan-mode-actions flex gap-2 mt-3">' +
        '<button class="plan-approve-btn bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors">' +
        'Yes' +
        '</button>' +
        '<button class="plan-request-changes-btn bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors">' +
        'I want to change something' +
        '</button>' +
        '<button class="plan-reject-btn bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors">' +
        'No' +
        '</button>' +
        '</div>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Render a compaction message
   */
  function renderCompactionMessage(msg) {
    var html = '<div class="conversation-message compaction bg-amber-900/30 border-l-2 border-amber-500 p-3 rounded" data-msg-type="system">' +
      '<div class="flex items-center gap-2 mb-2">' +
      getCompactionIcon() +
      '<span class="font-medium text-amber-300">Context Compacted</span>' +
      formatTimestamp(msg.timestamp) +
      '</div>' +
      '<div class="text-gray-300 text-sm">' +
      'The conversation history was summarized to reduce token usage. Previous context has been condensed.' +
      '</div>';

    if (msg.content && msg.content !== 'Context was compacted to reduce token usage.') {
      html += '<details class="mt-2">' +
        '<summary class="text-amber-400 text-xs cursor-pointer hover:text-amber-300">View Summary</summary>' +
        '<div class="mt-2 text-gray-400 text-xs bg-gray-800/50 p-2 rounded max-h-40 overflow-y-auto">' +
        '<pre class="whitespace-pre-wrap">' + escapeHtml(msg.content) + '</pre>' +
        '</div>' +
        '</details>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Get result icon
   */
  function getResultIcon(isError) {
    if (isError) {
      return '<svg class="w-5 h-5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>' +
        '</svg>';
    }

    return '<svg class="w-5 h-5 text-cyan-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>' +
      '</svg>';
  }

  /**
   * Check if result is an unknown built-in command
   */
  function isUnknownBuiltinCommand(content) {
    if (!content) return null;

    var match = content.match(/^Unknown skill: (\w+)$/);
    if (match) {
      return match[1];
    }

    return null;
  }

  /**
   * Get warning icon for unknown commands
   */
  function getWarningIcon() {
    return '<svg class="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>' +
      '</svg>';
  }

  /**
   * Render a result message (command output like /usage, /help)
   */
  function renderResultMessage(msg) {
    var isError = msg.resultInfo && msg.resultInfo.isError;
    var unknownCommand = isUnknownBuiltinCommand(msg.content);

    // Handle "Unknown skill: X" messages specially
    if (unknownCommand) {
      return '<div class="conversation-message result bg-amber-900/20 border-l-2 border-amber-500 p-3 rounded" data-msg-type="result">' +
        '<div class="flex items-center gap-2 mb-2">' +
        getWarningIcon() +
        '<span class="font-medium text-amber-300">Built-in Command Not Available</span>' +
        formatTimestamp(msg.timestamp) +
        '</div>' +
        '<div class="flex-1 min-w-0">' +
        '<div class="text-gray-300 text-sm">' +
        '<p>The <code class="bg-gray-700 px-1 rounded">/' + escapeHtml(unknownCommand) + '</code> command is a built-in Claude Code command that only works in interactive terminal mode.</p>' +
        '<p class="mt-2 text-gray-400 text-xs">Built-in commands like /usage, /help, /compact, /context, /config, /clear, and /model are UI commands that cannot be used via the API.</p>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>';
    }

    var borderColor = isError ? 'border-red-500' : 'border-cyan-500';
    var bgColor = isError ? 'bg-red-900/20' : 'bg-cyan-900/20';
    var titleColor = isError ? 'text-red-300' : 'text-cyan-300';
    var title = isError ? 'Command Error' : 'Command Result';

    var html = '<div class="conversation-message result ' + bgColor + ' border-l-2 ' + borderColor + ' p-3 rounded" data-msg-type="result">' +
      '<div class="flex items-center gap-2 mb-2">' +
      getResultIcon(isError) +
      '<span class="font-medium ' + titleColor + '">' + title + '</span>' +
      formatTimestamp(msg.timestamp) +
      '</div>' +
      '<div class="flex-1 min-w-0">' +
      '<div class="text-gray-300 text-sm">' +
      '<pre class="whitespace-pre-wrap break-words">' + escapeHtml(msg.content) + '</pre>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    return html;
  }

  /**
   * Render a status change message (compacting, etc.)
   */
  function renderStatusChangeMessage(msg) {
    var status = msg.statusChangeInfo ? msg.statusChangeInfo.status : 'unknown';
    var isCompacting = status === 'compacting';

    if (isCompacting) {
      return '<div class="conversation-message status-change bg-purple-900/20 border-l-2 border-purple-500 p-3 rounded" data-msg-type="status_change" data-status="' + escapeHtml(status) + '">' +
        '<div class="flex items-center gap-2">' +
        '<svg class="w-5 h-5 text-purple-400 animate-spin" fill="none" viewBox="0 0 24 24">' +
        '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
        '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>' +
        '</svg>' +
        '<span class="text-purple-300 font-medium">Compacting Context</span>' +
        formatTimestamp(msg.timestamp) +
        '</div>' +
        '<div class="text-gray-400 text-sm mt-1">Summarizing conversation to reduce token usage...</div>' +
        '</div>';
    }

    // Generic status message
    return '<div class="conversation-message status-change bg-gray-800/50 border-l-2 border-gray-500 p-3 rounded" data-msg-type="status_change" data-status="' + escapeHtml(status) + '">' +
      '<div class="flex items-center gap-2 mb-1">' +
      '<span class="text-gray-300 font-medium">Status Change</span>' +
      formatTimestamp(msg.timestamp) +
      '</div>' +
      '<div class="text-gray-400 text-sm">' + escapeHtml(msg.content) + '</div>' +
      '</div>';
  }

  /**
   * Render a system/fallback message
   */
  function renderSystemMessage(msg, typeClass) {
    var timestampHtml = formatTimestamp(msg.timestamp);

    return '<div class="conversation-message ' + typeClass + '" data-msg-type="system">' +
      '<div class="message-header">' +
      '<span class="message-sender text-gray-400">System</span>' +
      timestampHtml +
      '</div>' +
      '<pre class="whitespace-pre-wrap">' + escapeHtml(msg.content) + '</pre>' +
      '</div>';
  }

  /**
   * Main render function - dispatches to appropriate renderer
   */
  function renderMessage(msg) {
    var typeClass = msg.type || 'system';

    if (msg.type === 'tool_use') {
      return ToolRenderer.renderToolMessage(msg);
    }

    if (msg.type === 'question') {
      return renderQuestionMessage(msg);
    }

    if (msg.type === 'permission') {
      return renderPermissionMessage(msg);
    }

    if (msg.type === 'plan_mode') {
      return renderPlanModeMessage(msg);
    }

    if (msg.type === 'compaction') {
      return renderCompactionMessage(msg);
    }

    if (msg.type === 'result') {
      return renderResultMessage(msg);
    }

    if (msg.type === 'status_change') {
      return renderStatusChangeMessage(msg);
    }

    if (msg.type === 'user') {
      return renderUserMessage(msg);
    }

    if (msg.type === 'stdout' || msg.type === 'assistant') {
      return renderAssistantMessage(msg, typeClass);
    }

    return renderSystemMessage(msg, typeClass);
  }

  /**
   * Reset the rendering context (clears previous timestamp)
   */
  function resetRenderingContext() {
    renderingContext.previousTimestamp = null;
  }

  /**
   * Set the starting timestamp for difference calculations
   */
  function setStartingTimestamp(timestamp) {
    renderingContext.previousTimestamp = timestamp;
  }

  /**
   * Inject toolbars into mermaid diagram wrappers
   */
  function injectMermaidToolbars() {
    $('.mermaid-wrapper').each(function() {
      var $wrapper = $(this);
      if ($wrapper.find('.mermaid-toolbar').length === 0) {
        // Clone the toolbar template's inner content
        var $toolbar = $('#mermaid-toolbar-template').children().first().clone();
        $wrapper.append($toolbar);
      }
    });
  }

  // Public API
  return {
    init: init,
    renderMessage: renderMessage,
    renderMarkdown: renderMarkdown,
    renderQuestionMessage: renderQuestionMessage,
    renderPermissionMessage: renderPermissionMessage,
    renderPlanModeMessage: renderPlanModeMessage,
    renderCompactionMessage: renderCompactionMessage,
    renderResultMessage: renderResultMessage,
    renderStatusChangeMessage: renderStatusChangeMessage,
    renderUserMessage: renderUserMessage,
    renderAssistantMessage: renderAssistantMessage,
    renderSystemMessage: renderSystemMessage,
    // Context management for timestamp differences
    resetRenderingContext: resetRenderingContext,
    setStartingTimestamp: setStartingTimestamp,
    // Mermaid toolbar injection
    injectMermaidToolbars: injectMermaidToolbars,
    // Expose icon helpers for testing
    getUserIcon: getUserIcon,
    getClaudeIcon: getClaudeIcon,
    getQuestionIcon: getQuestionIcon,
    getPermissionIcon: getPermissionIcon,
    getCompactionIcon: getCompactionIcon,
    getResultIcon: getResultIcon,
    // Expose formatTimestamp for tool renderer
    formatTimestamp: formatTimestamp
  };
}));
