/**
 * @module ApiClient
 * @description HTTP API wrapper for all backend endpoints
 * @requires jquery
 */

(function(root, factory) {
  'use strict';

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.ApiClient = factory();
  }
})(typeof window !== 'undefined' ? window : global, function() {
  'use strict';

  var ApiClient = {};

  // Base URL for API calls (can be overridden for testing)
  var baseUrl = '';

  /**
   * Set the base URL for all API calls
   * @param {string} url - Base URL (e.g., 'http://localhost:3000')
   */
  ApiClient.setBaseUrl = function(url) {
    baseUrl = url || '';
  };

  /**
   * Get the current base URL
   * @returns {string} Current base URL
   */
  ApiClient.getBaseUrl = function() {
    return baseUrl;
  };

  // ============================================================
  // Health & System
  // ============================================================

  /**
   * Get health status of the server
   * @function getHealth
   * @memberof module:ApiClient
   * @returns {JQueryXHR<Claudito.API.HealthResponse>} Health check response
   * @example
   * const health = await ApiClient.getHealth();
   * console.log(health.status); // 'ok' or 'degraded'
   */
  ApiClient.getHealth = function() {
    return $.get(baseUrl + '/api/health');
  };

  /**
   * Get development mode status
   * @function getDevStatus
   * @memberof module:ApiClient
   * @returns {Promise<{devMode: boolean}>} Development mode status
   */
  ApiClient.getDevStatus = function() {
    return $.get(baseUrl + '/api/dev');
  };

  /**
   * Shutdown the server (dev mode only)
   * @function shutdownServer
   * @memberof module:ApiClient
   * @returns {Promise<void>} Resolves when shutdown initiated
   * @throws {Error} If not in development mode
   */
  ApiClient.shutdownServer = function() {
    return $.post(baseUrl + '/api/dev/shutdown');
  };

  /**
   * Get agent resource status across all projects
   * @function getAgentResourceStatus
   * @memberof module:ApiClient
   * @returns {Promise<Claudito.API.ResourceStatus>} Resource usage information
   * @example
   * const status = await ApiClient.getAgentResourceStatus();
   * console.log(`Running: ${status.runningCount}/${status.maxConcurrent}`);
   */
  ApiClient.getAgentResourceStatus = function() {
    return $.get(baseUrl + '/api/agents/status');
  };

  /**
   * Get global server logs
   * @function getGlobalLogs
   * @memberof module:ApiClient
   * @param {number} [limit=100] - Maximum number of log entries to retrieve
   * @returns {Promise<Array<{timestamp: string, level: string, message: string, context?: Object}>>} Log entries
   */
  ApiClient.getGlobalLogs = function(limit) {
    var url = baseUrl + '/api/logs';

    if (limit) {
      url += '?limit=' + limit;
    }

    return $.get(url);
  };

  // ============================================================
  // Projects
  // ============================================================

  /**
   * Get all projects
   * @function getProjects
   * @memberof module:ApiClient
   * @returns {Promise<Array<Claudito.API.Project>>} Array of projects
   * @example
   * const projects = await ApiClient.getProjects();
   * projects.forEach(p => console.log(p.name, p.path));
   */
  ApiClient.getProjects = function() {
    return $.get(baseUrl + '/api/projects');
  };

  /**
   * Add a new project
   * @function addProject
   * @memberof module:ApiClient
   * @param {Object} data - Project data
   * @param {string} data.name - Project name
   * @param {string} data.path - Absolute path to project directory
   * @returns {Promise<Claudito.API.Project>} Created project
   * @throws {Error} If project already exists at path
   * @throws {Error} If path is invalid or not accessible
   * @example
   * const project = await ApiClient.addProject({
   *   name: 'My Project',
   *   path: '/home/user/projects/myproject'
   * });
   */
  ApiClient.addProject = function(data) {
    return $.ajax({
      url: baseUrl + '/api/projects',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(data),
    });
  };

  /**
   * Delete a project
   * @function deleteProject
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @returns {Promise<void>} Resolves when project is deleted
   * @throws {Error} If project not found
   * @throws {Error} If agent is running for this project
   */
  ApiClient.deleteProject = function(id) {
    return $.ajax({ url: baseUrl + '/api/projects/' + id, method: 'DELETE' });
  };

  /**
   * Discover and register projects in a directory
   * @function discoverProjects
   * @memberof module:ApiClient
   * @param {Object} data - Discovery parameters
   * @param {string} data.searchPath - Directory path to search for projects
   * @returns {Promise<{discovered: number, registered: number, alreadyRegistered: number, failed: number, projects: Array}>} Discovery results
   */
  ApiClient.discoverProjects = function(data) {
    return $.ajax({
      url: baseUrl + '/api/projects/discover',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(data)
    });
  };

  /**
   * Get debug information for a project
   * @function getDebugInfo
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @returns {Promise<{agent: Object, logs: Array, processes: Array, ralphLoop: Object}>} Debug information
   */
  ApiClient.getDebugInfo = function(id) {
    return $.get(baseUrl + '/api/projects/' + id + '/debug');
  };

  // ============================================================
  // Roadmap
  // ============================================================

  /**
   * Get project roadmap content and parsed structure
   * @function getProjectRoadmap
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @returns {Promise<{content: string, parsed: Claudito.API.Roadmap}>} Roadmap data
   * @throws {Error} If project not found or roadmap doesn't exist
   */
  ApiClient.getProjectRoadmap = function(id) {
    return $.get(baseUrl + '/api/projects/' + id + '/roadmap');
  };

  /**
   * Generate a new roadmap via Claude
   * @function generateRoadmap
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @param {string} prompt - Instructions for roadmap generation
   * @returns {Promise<void>} Streams output via WebSocket
   * @throws {Error} If agent is already running
   * @example
   * await ApiClient.generateRoadmap(projectId, 'Create a roadmap for a React todo app');
   * // Listen for 'roadmap_message' WebSocket events for real-time output
   */
  ApiClient.generateRoadmap = function(id, prompt) {
    return $.post(baseUrl + '/api/projects/' + id + '/roadmap/generate', { prompt: prompt });
  };

  /**
   * Modify existing roadmap via Claude prompt
   * @function modifyRoadmap
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @param {string} prompt - Instructions for modifying the roadmap
   * @returns {Promise<void>} Streams output via WebSocket
   * @throws {Error} If roadmap doesn't exist
   * @example
   * await ApiClient.modifyRoadmap(projectId, 'Add a phase for performance optimization');
   */
  ApiClient.modifyRoadmap = function(id, prompt) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + id + '/roadmap',
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({ prompt: prompt })
    });
  };

  /**
   * Send response to Claude when it asks a question during roadmap operations
   * @function sendRoadmapResponse
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @param {string} response - User's response to Claude's question
   * @returns {Promise<void>} Resolves when response is sent
   */
  ApiClient.sendRoadmapResponse = function(id, response) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + id + '/roadmap/respond',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ response: response })
    });
  };

  /**
   * Delete a specific task from the roadmap
   * @function deleteRoadmapTask
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @param {string} phaseId - Phase identifier
   * @param {string} milestoneId - Milestone identifier
   * @param {number} taskIndex - Task index within the milestone
   * @returns {Promise<void>} Resolves when task is deleted
   * @throws {Error} If task not found
   */
  ApiClient.deleteRoadmapTask = function(id, phaseId, milestoneId, taskIndex) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + id + '/roadmap/task',
      method: 'DELETE',
      contentType: 'application/json',
      data: JSON.stringify({ phaseId: phaseId, milestoneId: milestoneId, taskIndex: taskIndex })
    });
  };

  /**
   * Delete an entire milestone from the roadmap
   * @function deleteRoadmapMilestone
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @param {string} phaseId - Phase identifier
   * @param {string} milestoneId - Milestone identifier
   * @returns {Promise<void>} Resolves when milestone is deleted
   * @throws {Error} If milestone not found
   */
  ApiClient.deleteRoadmapMilestone = function(id, phaseId, milestoneId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + id + '/roadmap/milestone',
      method: 'DELETE',
      contentType: 'application/json',
      data: JSON.stringify({ phaseId: phaseId, milestoneId: milestoneId })
    });
  };

  /**
   * Delete an entire phase from the roadmap
   * @function deleteRoadmapPhase
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @param {string} phaseId - Phase identifier
   * @returns {Promise<void>} Resolves when phase is deleted
   * @throws {Error} If phase not found
   */
  ApiClient.deleteRoadmapPhase = function(id, phaseId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + id + '/roadmap/phase',
      method: 'DELETE',
      contentType: 'application/json',
      data: JSON.stringify({ phaseId: phaseId })
    });
  };

  // ============================================================
  // Agent
  // ============================================================

  /**
   * Start an autonomous agent for a project
   * @function startAgent
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @returns {Promise<void>} Resolves when agent starts
   * @throws {Error} If agent is already running
   * @deprecated Use startInteractiveAgent instead
   */
  ApiClient.startAgent = function(id) {
    return $.post(baseUrl + '/api/projects/' + id + '/agent/start');
  };

  /**
   * Stop the running agent for a project
   * @function stopAgent
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @returns {Promise<void>} Resolves when agent stops
   */
  ApiClient.stopAgent = function(id) {
    return $.post(baseUrl + '/api/projects/' + id + '/agent/stop');
  };

  /**
   * Get current agent status for a project
   * @function getAgentStatus
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @returns {Promise<Claudito.API.AgentStatus>} Agent status information
   * @example
   * const status = await ApiClient.getAgentStatus(projectId);
   * if (status.running && status.waitingForResponse) {
   *   console.log('Agent is waiting for input');
   * }
   */
  ApiClient.getAgentStatus = function(id) {
    return $.get(baseUrl + '/api/projects/' + id + '/agent/status');
  };

  /**
   * Get autonomous loop status
   * @function getLoopStatus
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @returns {Promise<{active: boolean, currentMilestone?: string}>} Loop status
   */
  ApiClient.getLoopStatus = function(id) {
    return $.get(baseUrl + '/api/projects/' + id + '/agent/loop');
  };

  /**
   * Start an interactive agent session
   * @function startInteractiveAgent
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @param {string} [message=''] - Initial message to send
   * @param {Array<{dataUrl: string, mimeType: string}>} [images] - Images to include
   * @param {string} [sessionId] - Session ID for resumption
   * @param {('acceptEdits'|'plan')} [permissionMode] - Permission mode
   * @returns {Promise<{sessionId: string}>} Session information
   * @throws {Error} If agent is already running
   * @example
   * // Start new session with message
   * const session = await ApiClient.startInteractiveAgent(
   *   projectId,
   *   'Help me implement user authentication',
   *   [], // no images
   *   null, // new session
   *   'plan' // plan mode
   * );
   */
  ApiClient.startInteractiveAgent = function(id, message, images, sessionId, permissionMode) {
    var payload = { message: message || '' };

    if (images && images.length > 0) {
      payload.images = images.map(function(img) {
        return {
          type: img.mimeType,
          data: img.dataUrl.split(',')[1] // Remove data:image/xxx;base64, prefix
        };
      });
    }

    if (sessionId) {
      payload.sessionId = sessionId;
    }

    if (permissionMode) {
      payload.permissionMode = permissionMode;
    }

    return $.ajax({
      url: baseUrl + '/api/projects/' + id + '/agent/interactive',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    });
  };

  /**
   * Send a message to the running agent
   * @function sendAgentMessage
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @param {string} message - Message text
   * @param {Array<{dataUrl: string, mimeType: string}>} [images] - Images to include
   * @returns {Promise<void>} Resolves when message is sent
   * @throws {Error} If no agent is running
   * @example
   * // Send text message
   * await ApiClient.sendAgentMessage(projectId, 'Fix the failing tests');
   *
   * // Send with images
   * await ApiClient.sendAgentMessage(projectId, 'What is this error?', [
   *   { dataUrl: 'data:image/png;base64,...', mimeType: 'image/png' }
   * ]);
   */
  ApiClient.sendAgentMessage = function(id, message, images, planFeedback) {
    var payload = { message: message };

    if (images && images.length > 0) {
      payload.images = images.map(function(img) {
        return {
          type: img.mimeType,
          data: img.dataUrl.split(',')[1] // Remove data:image/xxx;base64, prefix
        };
      });
    }

    if (planFeedback) {
      payload.planFeedback = true;
    }

    return $.ajax({
      url: baseUrl + '/api/projects/' + id + '/agent/send',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    });
  };

  /**
   * Stop a one-off agent
   * @function stopOneOffAgent
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} oneOffId - One-off agent ID
   * @returns {Promise<void>} Resolves when agent stopped
   */
  ApiClient.stopOneOffAgent = function(projectId, oneOffId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/agent/oneoff/' + encodeURIComponent(oneOffId) + '/stop',
      method: 'POST'
    });
  };

  /**
   * Send a message to a one-off agent
   * @param {string} projectId - Project UUID
   * @param {string} oneOffId - One-off agent ID
   * @param {string} message - Message to send
   * @param {Array} [images] - Optional images
   * @returns {Promise<void>}
   */
  ApiClient.sendOneOffMessage = function(projectId, oneOffId, message, images) {
    var payload = { message: message };

    if (images && images.length > 0) {
      payload.images = images.map(function(img) {
        return {
          type: img.mimeType,
          data: img.dataUrl.split(',')[1]
        };
      });
    }

    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/agent/oneoff/' + encodeURIComponent(oneOffId) + '/send',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    });
  };

  /**
   * Get one-off agent status
   * @param {string} projectId - Project UUID
   * @param {string} oneOffId - One-off agent ID
   * @returns {Promise<Object>}
   */
  ApiClient.getOneOffStatus = function(projectId, oneOffId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/agent/oneoff/' + encodeURIComponent(oneOffId) + '/status');
  };

  /**
   * Get one-off agent context usage
   * @param {string} projectId - Project UUID
   * @param {string} oneOffId - One-off agent ID
   * @returns {Promise<Object>}
   */
  ApiClient.getOneOffContext = function(projectId, oneOffId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/agent/oneoff/' + encodeURIComponent(oneOffId) + '/context');
  };

  /**
   * Answer an AskUserQuestion from the agent
   * @param {string} projectId - Project UUID
   * @param {string} toolUseId - The tool_use_id for the AskUserQuestion
   * @param {Object} answers - Map of question index to selected answer(s)
   * @returns {Promise<Object>}
   */
  ApiClient.answerAgentQuestion = function(projectId, toolUseId, answers) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/agent/answer',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ toolUseId: toolUseId, answers: answers })
    });
  };

  // ============================================================
  // Queue
  // ============================================================

  /**
   * Get queued messages waiting to be sent to agent
   * @function getQueuedMessages
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @returns {Promise<Array<string>>} Array of queued message texts
   */
  ApiClient.getQueuedMessages = function(id) {
    return $.get(baseUrl + '/api/projects/' + id + '/agent/queue');
  };

  /**
   * Remove project from agent startup queue
   * @function removeFromQueue
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @returns {Promise<void>} Resolves when project is removed from queue
   */
  ApiClient.removeFromQueue = function(id) {
    return $.ajax({ url: baseUrl + '/api/projects/' + id + '/agent/queue', method: 'DELETE' });
  };

  /**
   * Remove a specific queued message by index
   * @function removeQueuedMessage
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @param {number} index - Zero-based index of message to remove
   * @returns {Promise<void>} Resolves when message is removed
   * @throws {Error} If index is out of bounds
   */
  ApiClient.removeQueuedMessage = function(id, index) {
    return $.ajax({ url: baseUrl + '/api/projects/' + id + '/agent/queue/' + index, method: 'DELETE' });
  };

  // ============================================================
  // Conversations
  // ============================================================

  /**
   * Get list of conversations for a project
   * @function getConversations
   * @memberof module:ApiClient
   * @param {string} id - Project UUID
   * @returns {Promise<Array<{id: string, label?: string, messageCount: number, lastMessageAt: string}>>} Conversation summaries
   * @example
   * const conversations = await ApiClient.getConversations(projectId);
   * conversations.forEach(conv => {
   *   console.log(`${conv.label || conv.id}: ${conv.messageCount} messages`);
   * });
   */
  ApiClient.getConversations = function(id) {
    return $.get(baseUrl + '/api/projects/' + id + '/conversations');
  };

  /**
   * Get full conversation with messages
   * @function getConversation
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} conversationId - Conversation UUID
   * @returns {Promise<Claudito.API.Conversation>} Conversation with all messages
   * @throws {Error} If conversation not found
   * @example
   * const conv = await ApiClient.getConversation(projectId, conversationId);
   * console.log(`Loaded ${conv.messages.length} messages`);
   */
  ApiClient.getConversation = function(projectId, conversationId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/conversation', { conversationId: conversationId });
  };

  /**
   * Search conversation history
   * @function searchConversationHistory
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} query - Search query text
   * @returns {Promise<Array<{conversationId: string, messageId: string, content: string, timestamp: string}>>} Search results
   * @example
   * const results = await ApiClient.searchConversationHistory(projectId, 'authentication');
   * results.forEach(r => console.log(`Found in ${r.conversationId}: ${r.content}`));
   */
  ApiClient.searchConversationHistory = function(projectId, query) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/conversations/search', { q: query });
  };

  /**
   * Rename a conversation with custom label
   * @function renameConversation
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} conversationId - Conversation UUID
   * @param {string} label - New label for the conversation
   * @returns {Promise<void>} Resolves when renamed
   * @throws {Error} If conversation not found
   * @example
   * await ApiClient.renameConversation(projectId, conversationId, 'Auth Implementation');
   */
  ApiClient.renameConversation = function(projectId, conversationId, label) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/conversations/' + conversationId,
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({ label: label })
    });
  };

  /**
   * Set the current active conversation
   * @function setCurrentConversation
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} conversationId - Conversation UUID
   * @returns {Promise<void>} Resolves when set
   * @deprecated Frontend manages current conversation locally
   */
  ApiClient.setCurrentConversation = function(projectId, conversationId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/conversation/current',
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({ conversationId: conversationId })
    });
  };

  // ============================================================
  // Claude Files
  // ============================================================

  /**
   * Get CLAUDE.md files for a project (global and project-specific)
   * @function getClaudeFiles
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<Array<{filePath: string, content: string, exists: boolean}>>} Claude instruction files
   * @example
   * const files = await ApiClient.getClaudeFiles(projectId);
   * files.forEach(f => {
   *   console.log(`${f.filePath}: ${f.exists ? 'exists' : 'not found'}`);
   * });
   */
  ApiClient.getClaudeFiles = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/claude-files');
  };

  /**
   * Save content to a CLAUDE.md file
   * @function saveClaudeFile
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} filePath - Absolute path to CLAUDE.md file
   * @param {string} content - File content to save
   * @returns {Promise<void>} Resolves when saved
   * @throws {Error} If file path is invalid or write fails
   * @example
   * await ApiClient.saveClaudeFile(
   *   projectId,
   *   '/home/user/.claude/CLAUDE.md',
   *   '# Global Claude Instructions\n\n...'
   * );
   */
  ApiClient.saveClaudeFile = function(projectId, filePath, content) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/claude-files',
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({ filePath: filePath, content: content })
    });
  };

  /**
   * Optimize a Claude file using a dedicated optimization agent
   * @function optimizeClaudeFile
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} filePath - Absolute path to CLAUDE.md file
   * @param {string} content - Current content to optimize
   * @param {Array<string>} [optimizationGoals] - Optional specific optimization goals
   * @returns {Promise<{success: boolean, message: string}>} Optimization status
   * @example
   * await ApiClient.optimizeClaudeFile(
   *   projectId,
   *   '/home/user/.claude/CLAUDE.md',
   *   currentContent,
   *   ['Remove duplicates', 'Improve clarity']
   * );
   */
  ApiClient.optimizeClaudeFile = function(projectId, filePath, content, optimizationGoals) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/optimize-file',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        filePath: filePath,
        content: content,
        optimizationGoals: optimizationGoals
      })
    });
  };

  /**
   * Get optimization suggestions for CLAUDE.md and ROADMAP.md files
   * @function getOptimizations
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<{suggestions: Array<{file: string, issue: string, recommendation: string}>}>} Optimization suggestions
   * @example
   * const opts = await ApiClient.getOptimizations(projectId);
   * opts.suggestions.forEach(s => {
   *   console.log(`${s.file}: ${s.issue} - ${s.recommendation}`);
   * });
   */
  ApiClient.getOptimizations = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/optimizations');
  };

  // ============================================================
  // Settings
  // ============================================================

  /**
   * Get global application settings
   * @function getSettings
   * @memberof module:ApiClient
   * @returns {Promise<Claudito.API.Settings>} Global settings object
   * @example
   * const settings = await ApiClient.getSettings();
   * console.log(`Max agents: ${settings.maxConcurrentAgents}`);
   * console.log(`Default model: ${settings.defaultModel}`);
   */
  ApiClient.getSettings = function() {
    return $.get(baseUrl + '/api/settings');
  };

  /**
   * Update global application settings
   * @function updateSettings
   * @memberof module:ApiClient
   * @param {Partial<Claudito.API.Settings>} settings - Settings to update
   * @returns {Promise<Claudito.API.Settings>} Updated settings
   * @throws {Error} If validation fails
   * @example
   * // Update multiple settings
   * const updated = await ApiClient.updateSettings({
   *   maxConcurrentAgents: 5,
   *   sendWithCtrlEnter: false,
   *   defaultModel: 'claude-opus-4-6'
   * });
   */
  ApiClient.updateSettings = function(settings) {
    return $.ajax({
      url: baseUrl + '/api/settings',
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(settings)
    });
  };

  /**
   * Get available Claude models
   * @function getAvailableModels
   * @memberof module:ApiClient
   * @returns {Promise<{models: Array<{id: string, displayName: string}>}>} Available models
   * @example
   * const result = await ApiClient.getAvailableModels();
   * result.models.forEach(m => {
   *   console.log(`${m.displayName} (${m.id})`);
   * });
   */
  ApiClient.getAvailableModels = function() {
    return $.get(baseUrl + '/api/settings/models');
  };

  /**
   * Wipe all Claudito data (factory reset)
   * @function wipeAllData
   * @memberof module:ApiClient
   * @returns {Promise<{projectsWiped: number, globalDataDeleted: boolean, mcpTempDeleted: boolean}>}
   */
  ApiClient.wipeAllData = function() {
    return $.ajax({ url: baseUrl + '/api/settings/wipe-all-data', method: 'POST' });
  };

  // ============================================================
  // Project Model
  // ============================================================

  /**
   * Get project model configuration
   * @function getProjectModel
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<{projectModel: string|null, effectiveModel: string, globalDefault: string}>} Model configuration
   * @example
   * const config = await ApiClient.getProjectModel(projectId);
   * console.log(`Using: ${config.effectiveModel}`);
   * console.log(`Override: ${config.projectModel || 'none'}`);
   * console.log(`Default: ${config.globalDefault}`);
   */
  ApiClient.getProjectModel = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/model');
  };

  /**
   * Set project-specific model override
   * @function setProjectModel
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string|null} model - Model ID or null to clear override
   * @returns {Promise<void>} Resolves when updated
   * @example
   * // Set project to use Opus
   * await ApiClient.setProjectModel(projectId, 'claude-opus-4-6');
   *
   * // Clear override to use global default
   * await ApiClient.setProjectModel(projectId, null);
   */
  ApiClient.setProjectModel = function(projectId, model) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/model',
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({ model: model })
    });
  };

  /**
   * Get project MCP overrides
   * @function getProjectMcpOverrides
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<{enabled: boolean, serverOverrides: Object}>} MCP overrides
   * @example
   * const overrides = await ApiClient.getProjectMcpOverrides(projectId);
   * console.log(`MCP enabled: ${overrides.enabled}`);
   */
  ApiClient.getProjectMcpOverrides = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/mcp-overrides');
  };

  /**
   * Update project MCP overrides
   * @function updateProjectMcpOverrides
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {Object} overrides - MCP override configuration
   * @returns {Promise<{overrides: Object, agentRestarted: boolean}>} Update result
   * @example
   * const result = await ApiClient.updateProjectMcpOverrides(projectId, {
   *   enabled: true,
   *   serverOverrides: { 'server-1': { enabled: false } }
   * });
   * if (result.agentRestarted) {
   *   console.log('Agent was restarted');
   * }
   */
  ApiClient.updateProjectMcpOverrides = function(projectId, overrides) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/mcp-overrides',
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(overrides)
    });
  };

  // ============================================================
  // Filesystem
  // ============================================================

  /**
   * Get available drives on the system
   * @function getDrives
   * @memberof module:ApiClient
   * @returns {Promise<Array<{name: string, path: string}>>} Available drives
   * @example
   * const drives = await ApiClient.getDrives();
   * // On Windows: [{name: 'C:', path: 'C:\\'}, {name: 'D:', path: 'D:\\'}]
   * // On Unix: [{name: '/', path: '/'}]
   */
  ApiClient.getDrives = function() {
    return $.get(baseUrl + '/api/fs/drives');
  };

  /**
   * Browse directory contents (directories only)
   * @function browseFolder
   * @memberof module:ApiClient
   * @param {string} path - Directory path to browse
   * @returns {Promise<Array<{name: string, path: string, isDirectory: true}>>} Directory entries
   * @throws {Error} If path doesn't exist or isn't accessible
   * @example
   * const dirs = await ApiClient.browseFolder('/home/user/projects');
   * dirs.forEach(d => console.log(d.name));
   */
  ApiClient.browseFolder = function(path) {
    return $.get(baseUrl + '/api/fs/browse', { path: path });
  };

  /**
   * Browse directory contents with files included
   * @function browseWithFiles
   * @memberof module:ApiClient
   * @param {string} path - Directory path to browse
   * @returns {Promise<Array<{name: string, path: string, isDirectory: boolean, isEditable?: boolean}>>} All entries
   * @throws {Error} If path doesn't exist or isn't accessible
   * @example
   * const entries = await ApiClient.browseWithFiles('/project');
   * entries.forEach(e => {
   *   console.log(`${e.name} (${e.isDirectory ? 'dir' : 'file'})`);
   * });
   */
  ApiClient.browseWithFiles = function(path) {
    return $.get(baseUrl + '/api/fs/browse-with-files', { path: path });
  };

  /**
   * Read file contents
   * @function readFile
   * @memberof module:ApiClient
   * @param {string} path - File path to read
   * @returns {Promise<string>} File contents as text
   * @throws {Error} If file doesn't exist or isn't readable
   * @example
   * const content = await ApiClient.readFile('/project/README.md');
   * console.log(content);
   */
  ApiClient.readFile = function(path) {
    return $.get(baseUrl + '/api/fs/read', { path: path });
  };

  /**
   * Write content to a file
   * @function writeFile
   * @memberof module:ApiClient
   * @param {string} path - File path to write
   * @param {string} content - Content to write
   * @returns {Promise<void>} Resolves when written
   * @throws {Error} If path is invalid or write fails
   * @example
   * await ApiClient.writeFile(
   *   '/project/config.json',
   *   JSON.stringify({debug: true}, null, 2)
   * );
   */
  ApiClient.writeFile = function(path, content) {
    return $.ajax({
      url: baseUrl + '/api/fs/write',
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({ path: path, content: content })
    });
  };

  /**
   * Create a new directory
   * @function createFolder
   * @memberof module:ApiClient
   * @param {string} path - Directory path to create
   * @returns {Promise<void>} Resolves when created
   * @throws {Error} If directory already exists or parent doesn't exist
   * @example
   * await ApiClient.createFolder('/project/src/components');
   */
  ApiClient.createFolder = function(path) {
    return $.ajax({
      url: baseUrl + '/api/fs/mkdir',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ path: path })
    });
  };

  /**
   * Delete a file or directory
   * @function deleteFileOrFolder
   * @memberof module:ApiClient
   * @param {string} targetPath - Path to delete
   * @param {boolean} isDirectory - True if deleting a directory
   * @returns {Promise<void>} Resolves when deleted
   * @throws {Error} If path doesn't exist or deletion fails
   * @example
   * // Delete a file
   * await ApiClient.deleteFileOrFolder('/project/old.txt', false);
   *
   * // Delete a directory
   * await ApiClient.deleteFileOrFolder('/project/temp', true);
   */
  ApiClient.deleteFileOrFolder = function(targetPath, isDirectory) {
    return $.ajax({
      url: baseUrl + '/api/fs/delete',
      method: 'DELETE',
      contentType: 'application/json',
      data: JSON.stringify({ path: targetPath, isDirectory: isDirectory })
    });
  };

  // ============================================================
  // Git
  // ============================================================

  /**
   * Get Git repository status
   * @function getGitStatus
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<Claudito.API.GitStatus>} Git status information
   * @example
   * const status = await ApiClient.getGitStatus(projectId);
   * console.log(`On branch: ${status.branch}`);
   * console.log(`${status.staged.length} staged files`);
   * console.log(`${status.unstaged.length} unstaged changes`);
   */
  ApiClient.getGitStatus = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/git/status');
  };

  /**
   * Get list of Git branches
   * @function getGitBranches
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<{current: string, local: Array<string>, remote: Array<string>}>} Branch information
   * @example
   * const branches = await ApiClient.getGitBranches(projectId);
   * console.log(`Current: ${branches.current}`);
   * branches.local.forEach(b => console.log(`Local: ${b}`));
   */
  ApiClient.getGitBranches = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/git/branches');
  };

  /**
   * Get git user name from git config
   * @param {string} projectId - Project UUID
   * @returns {Promise<{name: string|null}>}
   */
  ApiClient.getGitUserName = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/git/user-name');
  };

  /**
   * Get Git diff for staged or unstaged changes
   * @function getGitDiff
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {boolean} staged - True for staged diff, false for unstaged
   * @returns {Promise<string>} Diff output in unified format
   * @example
   * // Get unstaged changes
   * const diff = await ApiClient.getGitDiff(projectId, false);
   *
   * // Get staged changes
   * const stagedDiff = await ApiClient.getGitDiff(projectId, true);
   */
  ApiClient.getGitDiff = function(projectId, staged) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/git/diff', { staged: staged ? 'true' : 'false' });
  };

  /**
   * Get Git diff for a specific file
   * @function getGitFileDiff
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} filePath - File path relative to repository root
   * @param {boolean} staged - True for staged diff, false for unstaged
   * @returns {Promise<string>} File diff in unified format
   * @example
   * const diff = await ApiClient.getGitFileDiff(
   *   projectId,
   *   'src/main.js',
   *   false // unstaged
   * );
   */
  ApiClient.getGitFileDiff = function(projectId, filePath, staged) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/git/file-diff', {
      path: filePath,
      staged: staged ? 'true' : 'false'
    });
  };

  /**
   * Get list of Git tags
   * @function getGitTags
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<Array<{name: string, commit: string, date: string}>>} Tag information
   * @example
   * const tags = await ApiClient.getGitTags(projectId);
   * tags.forEach(t => console.log(`${t.name} at ${t.commit}`));
   */
  ApiClient.getGitTags = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/git/tags');
  };

  /**
   * Stage specific files for commit
   * @function gitStage
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {Array<string>} paths - File paths to stage
   * @returns {Promise<void>} Resolves when staged
   * @throws {Error} If files not found or staging fails
   * @example
   * await ApiClient.gitStage(projectId, ['src/app.js', 'README.md']);
   */
  ApiClient.gitStage = function(projectId, paths) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/stage',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ paths: paths })
    });
  };

  /**
   * Stage all changes for commit
   * @function gitStageAll
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<void>} Resolves when all changes staged
   */
  ApiClient.gitStageAll = function(projectId) {
    return $.post(baseUrl + '/api/projects/' + projectId + '/git/stage-all');
  };

  /**
   * Unstage specific files
   * @function gitUnstage
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {Array<string>} paths - File paths to unstage
   * @returns {Promise<void>} Resolves when unstaged
   * @example
   * await ApiClient.gitUnstage(projectId, ['src/test.js']);
   */
  ApiClient.gitUnstage = function(projectId, paths) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/unstage',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ paths: paths })
    });
  };

  /**
   * Unstage all changes
   * @function gitUnstageAll
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<void>} Resolves when all changes unstaged
   */
  ApiClient.gitUnstageAll = function(projectId) {
    return $.post(baseUrl + '/api/projects/' + projectId + '/git/unstage-all');
  };

  /**
   * Create a Git commit
   * @function gitCommit
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} message - Commit message
   * @returns {Promise<{hash: string}>} Commit hash
   * @throws {Error} If no changes staged or commit fails
   * @example
   * const result = await ApiClient.gitCommit(
   *   projectId,
   *   'feat: Add user authentication'
   * );
   * console.log(`Created commit: ${result.hash}`);
   */
  ApiClient.gitCommit = function(projectId, message) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/commit',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ message: message })
    });
  };

  /**
   * Create a new Git branch
   * @function gitCreateBranch
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} name - Branch name
   * @param {boolean} checkout - Whether to checkout the new branch
   * @returns {Promise<void>} Resolves when branch created
   * @throws {Error} If branch already exists
   * @example
   * // Create and checkout new branch
   * await ApiClient.gitCreateBranch(projectId, 'feature/auth', true);
   */
  ApiClient.gitCreateBranch = function(projectId, name, checkout) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/branch',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ name: name, checkout: checkout })
    });
  };

  /**
   * Checkout a Git branch
   * @function gitCheckout
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} branch - Branch name to checkout
   * @returns {Promise<void>} Resolves when checked out
   * @throws {Error} If branch doesn't exist or checkout fails
   * @example
   * await ApiClient.gitCheckout(projectId, 'main');
   */
  ApiClient.gitCheckout = function(projectId, branch) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/checkout',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ branch: branch })
    });
  };

  /**
   * Push commits to remote repository
   * @function gitPush
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} remote - Remote name (e.g., 'origin')
   * @param {string} branch - Branch to push
   * @param {boolean} [setUpstream] - Set upstream tracking
   * @returns {Promise<void>} Resolves when pushed
   * @throws {Error} If push fails (e.g., authentication, conflicts)
   * @example
   * // Push with upstream
   * await ApiClient.gitPush(projectId, 'origin', 'feature/auth', true);
   */
  ApiClient.gitPush = function(projectId, remote, branch, setUpstream) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/push',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ remote: remote, branch: branch, setUpstream: setUpstream })
    });
  };

  /**
   * Pull commits from remote repository
   * @function gitPull
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} remote - Remote name (e.g., 'origin')
   * @param {string} branch - Branch to pull
   * @returns {Promise<void>} Resolves when pulled
   * @throws {Error} If pull fails (e.g., conflicts, authentication)
   * @example
   * await ApiClient.gitPull(projectId, 'origin', 'main');
   */
  ApiClient.gitPull = function(projectId, remote, branch, rebase) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/pull',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ remote: remote, branch: branch, rebase: rebase })
    });
  };

  /**
   * Discard changes to specific files
   * @function gitDiscard
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {Array<string>} paths - File paths to discard changes
   * @returns {Promise<void>} Resolves when changes discarded
   * @warning This permanently removes uncommitted changes
   * @example
   * await ApiClient.gitDiscard(projectId, ['src/test.js']);
   */
  ApiClient.gitDiscard = function(projectId, paths) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/discard',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ paths: paths })
    });
  };

  /**
   * Create a Git tag
   * @function gitCreateTag
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} name - Tag name
   * @param {string} [message] - Annotated tag message
   * @returns {Promise<void>} Resolves when tag created
   * @throws {Error} If tag already exists
   * @example
   * // Create annotated tag
   * await ApiClient.gitCreateTag(projectId, 'v1.0.0', 'Initial release');
   */
  ApiClient.gitCreateTag = function(projectId, name, message) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/tags',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ name: name, message: message })
    });
  };

  /**
   * Push a tag to remote repository
   * @function gitPushTag
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} name - Tag name to push
   * @param {string} remote - Remote name (e.g., 'origin')
   * @returns {Promise<void>} Resolves when tag pushed
   * @throws {Error} If tag doesn't exist or push fails
   * @example
   * await ApiClient.gitPushTag(projectId, 'v1.0.0', 'origin');
   */
  ApiClient.gitPushTag = function(projectId, name, remote) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/tags/' + encodeURIComponent(name) + '/push',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ remote: remote })
    });
  };

  /**
   * Delete a local git tag
   * @function gitDeleteTag
   * @memberof module:ApiClient
   * @param {string} projectId - Project ID
   * @param {string} name - Tag name to delete
   * @returns {Promise<void>} Resolves when tag deleted
   */
  ApiClient.gitDeleteTag = function(projectId, name) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/tags/' + encodeURIComponent(name),
      method: 'DELETE'
    });
  };

  /**
   * Generate a commit message using a one-off Claude agent
   * @function generateCommitMessage
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<{message: string}>} Generated commit message
   */
  ApiClient.generateCommitMessage = function(projectId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/generate-commit-message',
      method: 'POST',
      contentType: 'application/json',
      timeout: 90000
    });
  };

  // ============================================================
  // Shell
  // ============================================================

  /**
   * Check if shell feature is enabled
   * @function isShellEnabled
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<{enabled: boolean}>} Shell availability
   * @example
   * const result = await ApiClient.isShellEnabled(projectId);
   * if (result.enabled) {
   *   console.log('Shell is available');
   * }
   */
  ApiClient.isShellEnabled = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/shell/enabled');
  };

  /**
   * Start an interactive shell session
   * @function startShell
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<{pid: number}>} Shell process information
   * @throws {Error} If shell is already running
   * @example
   * const shell = await ApiClient.startShell(projectId);
   * console.log(`Started shell with PID: ${shell.pid}`);
   */
  ApiClient.startShell = function(projectId) {
    return $.post(baseUrl + '/api/projects/' + projectId + '/shell/start');
  };

  /**
   * Get shell session status
   * @function getShellStatus
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<{running: boolean, pid?: number}>} Shell status
   */
  ApiClient.getShellStatus = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/shell/status');
  };

  /**
   * Send input to the shell
   * @function sendShellInput
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} input - Command or text to send
   * @returns {Promise<void>} Resolves when input sent
   * @throws {Error} If shell not running
   * @example
   * await ApiClient.sendShellInput(projectId, 'ls -la\n');
   */
  ApiClient.sendShellInput = function(projectId, input) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/shell/input',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ input: input })
    });
  };

  /**
   * Resize the shell terminal
   * @function resizeShell
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {number} cols - Number of columns
   * @param {number} rows - Number of rows
   * @returns {Promise<void>} Resolves when resized
   * @example
   * // Resize to 120x30
   * await ApiClient.resizeShell(projectId, 120, 30);
   */
  ApiClient.resizeShell = function(projectId, cols, rows) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/shell/resize',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ cols: cols, rows: rows })
    });
  };

  /**
   * Stop the shell session
   * @function stopShell
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<void>} Resolves when shell stopped
   */
  ApiClient.stopShell = function(projectId) {
    return $.post(baseUrl + '/api/projects/' + projectId + '/shell/stop');
  };

  // ============================================================
  // Ralph Loop
  // ============================================================

  /**
   * Start a new Ralph Loop for a project
   * @function startRalphLoop
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {Object} config - Loop configuration
   * @param {string} config.taskDescription - Task description for the worker
   * @param {number} [config.maxTurns=5] - Maximum iterations
   * @param {string} [config.workerModel] - Model for worker agent
   * @param {string} [config.reviewerModel] - Model for reviewer agent
   * @returns {Promise<Claudito.API.RalphLoopState>} New Ralph Loop state
   * @throws {Error} If agent is already running
   * @example
   * const loop = await ApiClient.startRalphLoop(projectId, {
   *   taskDescription: 'Implement user authentication with JWT',
   *   maxTurns: 10,
   *   workerModel: 'claude-opus-4-6',
   *   reviewerModel: 'claude-sonnet-4-5-20250929'
   * });
   * console.log(`Started loop ${loop.taskId}`);
   */
  ApiClient.startRalphLoop = function(projectId, config) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/ralph-loop/start',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(config)
    });
  };

  /**
   * Stop a running Ralph Loop
   * @function stopRalphLoop
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} taskId - Task ID of the loop to stop
   * @returns {Promise<void>} Resolves when stopped
   * @throws {Error} If loop not found
   * @example
   * await ApiClient.stopRalphLoop(projectId, taskId);
   */
  ApiClient.stopRalphLoop = function(projectId, taskId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/ralph-loop/' + taskId + '/stop',
      method: 'POST'
    });
  };

  /**
   * Pause a running Ralph Loop
   * @function pauseRalphLoop
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} taskId - Task ID of the loop to pause
   * @returns {Promise<void>} Resolves when paused
   * @throws {Error} If loop not running
   * @example
   * await ApiClient.pauseRalphLoop(projectId, taskId);
   */
  ApiClient.pauseRalphLoop = function(projectId, taskId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/ralph-loop/' + taskId + '/pause',
      method: 'POST'
    });
  };

  /**
   * Resume a paused Ralph Loop
   * @function resumeRalphLoop
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} taskId - Task ID of the loop to resume
   * @returns {Promise<void>} Resolves when resumed
   * @throws {Error} If loop not paused
   * @example
   * await ApiClient.resumeRalphLoop(projectId, taskId);
   */
  ApiClient.resumeRalphLoop = function(projectId, taskId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/ralph-loop/' + taskId + '/resume',
      method: 'POST'
    });
  };

  /**
   * Get all Ralph Loops for a project
   * @function getRalphLoops
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @returns {Promise<Array<Claudito.API.RalphLoopState>>} Array of Ralph Loop states
   * @example
   * const loops = await ApiClient.getRalphLoops(projectId);
   * loops.forEach(loop => {
   *   console.log(`${loop.taskId}: ${loop.status} (${loop.currentIteration}/${loop.maxTurns})`);
   * });
   */
  ApiClient.getRalphLoops = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/ralph-loop');
  };

  /**
   * Get a specific Ralph Loop state
   * @function getRalphLoopState
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} taskId - Task ID of the loop
   * @returns {Promise<Claudito.API.RalphLoopState>} Ralph Loop state
   * @throws {Error} If loop not found
   * @example
   * const state = await ApiClient.getRalphLoopState(projectId, taskId);
   * if (state.status === 'completed') {
   *   console.log(`Final result: ${state.finalResult}`);
   * }
   */
  ApiClient.getRalphLoopState = function(projectId, taskId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/ralph-loop/' + taskId);
  };

  /**
   * Delete a Ralph Loop
   * @function deleteRalphLoop
   * @memberof module:ApiClient
   * @param {string} projectId - Project UUID
   * @param {string} taskId - Task ID of the loop to delete
   * @returns {Promise<void>} Resolves when deleted
   * @throws {Error} If loop is still running
   * @example
   * await ApiClient.deleteRalphLoop(projectId, taskId);
   */
  ApiClient.deleteRalphLoop = function(projectId, taskId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/ralph-loop/' + taskId,
      method: 'DELETE'
    });
  };

  // ============================================================
  // Error Logging
  // ============================================================

  /**
   * Log a frontend error to the backend
   * @function logFrontendError
   * @memberof module:ApiClient
   * @param {string} message - Error message
   * @param {string} source - Source file where error occurred
   * @param {number} line - Line number of error
   * @param {number} column - Column number of error
   * @param {Error} errorObj - JavaScript Error object
   * @param {string} [projectId] - Current project UUID for context
   * @returns {Promise<void>} Resolves when logged (fails silently)
   * @example
   * window.onerror = function(msg, url, line, col, error) {
   *   ApiClient.logFrontendError(
   *     msg,
   *     url,
   *     line,
   *     col,
   *     error,
   *     state.selectedProjectId
   *   );
   * };
   */
  ApiClient.logFrontendError = function(message, source, line, column, errorObj, projectId, additionalData) {
    var errorData = {
      message: message,
      source: source,
      line: line,
      column: column,
      stack: errorObj && errorObj.stack ? errorObj.stack : null,
      projectId: projectId,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null
    };

    // Merge additional data if provided
    if (additionalData) {
      errorData.clientId = additionalData.clientId;
      errorData.errorType = additionalData.errorType;
    }

    // Send to backend silently (don't show errors if this fails)
    return $.ajax({
      url: baseUrl + '/api/log/error',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(errorData)
    });
  };

  // ============================================================
  // Authentication
  // ============================================================

  /**
   * Initialize global 401 handler to redirect to login on unauthorized
   * @function init
   * @memberof module:ApiClient
   * @description Sets up automatic redirect to login page on 401 responses.
   * Should be called once when the app starts.
   * @example
   * $(document).ready(function() {
   *   ApiClient.init();
   * });
   */
  ApiClient.init = function() {
    if (typeof $ !== 'undefined' && typeof document !== 'undefined') {
      $(document).ajaxError(function(_event, jqXHR) {
        if (jqXHR.status === 401) {
          window.location.href = '/login';
        }
      });
    }
  };

  /**
   * Check authentication status
   * @function getAuthStatus
   * @memberof module:ApiClient
   * @returns {Promise<{authenticated: boolean}>} Authentication status
   * @example
   * const auth = await ApiClient.getAuthStatus();
   * if (!auth.authenticated) {
   *   window.location.href = '/login';
   * }
   */
  ApiClient.getAuthStatus = function() {
    return $.get(baseUrl + '/api/auth/status');
  };

  /**
   * Logout and redirect to login page
   * @function logout
   * @memberof module:ApiClient
   * @returns {Promise<void>} Redirects to login after logout
   * @example
   * $('#logout-button').click(function() {
   *   ApiClient.logout();
   * });
   */
  ApiClient.logout = function() {
    return $.post(baseUrl + '/api/auth/logout').done(function() {
      window.location.href = '/login';
    });
  };

  // =========================================================================
  // GitHub Integration
  // =========================================================================

  ApiClient.getGitHubStatus = function() {
    return $.get(baseUrl + '/api/integrations/github/status');
  };

  ApiClient.getGitHubRepos = function(params) {
    return $.get(baseUrl + '/api/integrations/github/repos', params);
  };

  ApiClient.searchGitHubRepos = function(params) {
    return $.get(baseUrl + '/api/integrations/github/repos/search', params);
  };

  ApiClient.cloneGitHubRepo = function(data) {
    return $.ajax({
      url: baseUrl + '/api/integrations/github/clone',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(data),
    });
  };

  // =========================================================================
  // GitHub Issues
  // =========================================================================

  ApiClient.getGitHubIssues = function(params) {
    return $.get(baseUrl + '/api/integrations/github/issues', params);
  };

  ApiClient.getGitHubIssueDetail = function(issueNumber, repo) {
    return $.get(baseUrl + '/api/integrations/github/issues/' + issueNumber, { repo: repo });
  };

  ApiClient.closeGitHubIssue = function(issueNumber, repo) {
    return $.ajax({
      url: baseUrl + '/api/integrations/github/issues/' + issueNumber + '/close?repo=' + encodeURIComponent(repo),
      method: 'POST',
    });
  };

  ApiClient.commentOnGitHubIssue = function(issueNumber, repo, body) {
    return $.ajax({
      url: baseUrl + '/api/integrations/github/issues/' + issueNumber + '/comment?repo=' + encodeURIComponent(repo),
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ body: body }),
    });
  };

  ApiClient.createGitHubIssue = function(data) {
    return $.ajax({
      url: baseUrl + '/api/integrations/github/issues',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(data),
    });
  };

  ApiClient.getGitHubLabels = function(repo) {
    return $.get(baseUrl + '/api/integrations/github/labels', { repo: repo });
  };

  ApiClient.getGitHubMilestones = function(repo) {
    return $.get(baseUrl + '/api/integrations/github/milestones', { repo: repo });
  };

  ApiClient.getGitHubCollaborators = function(repo) {
    return $.get(baseUrl + '/api/integrations/github/collaborators', { repo: repo });
  };

  ApiClient.getGitHubRepoId = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/git/github-repo');
  };

  // =========================================================================
  // GitHub Pull Requests
  // =========================================================================

  ApiClient.createGitHubPR = function(data) {
    return $.ajax({
      url: baseUrl + '/api/integrations/github/pr',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(data),
    });
  };

  ApiClient.getGitHubPulls = function(params) {
    return $.get(baseUrl + '/api/integrations/github/pulls', params);
  };

  ApiClient.getGitHubPRDetail = function(prNumber, repo) {
    return $.get(baseUrl + '/api/integrations/github/pulls/' + prNumber, {
      repo: repo,
    });
  };

  ApiClient.commentOnGitHubPR = function(prNumber, repo, body) {
    return $.ajax({
      url: baseUrl + '/api/integrations/github/pulls/' + prNumber + '/comment?repo=' + encodeURIComponent(repo),
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ body: body }),
    });
  };

  ApiClient.mergeGitHubPR = function(prNumber, repo, options) {
    var opts = options || {};

    return $.ajax({
      url: baseUrl + '/api/integrations/github/pulls/' + prNumber + '/merge?repo=' + encodeURIComponent(repo),
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        method: opts.method || 'merge',
        isDraft: opts.isDraft || false,
      }),
    });
  };

  ApiClient.generatePRDescription = function(projectId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/git/generate-pr-description',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({}),
    });
  };

  // =========================================================================
  // Roadmap Task Addition
  // =========================================================================

  ApiClient.addRoadmapTask = function(projectId, data) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/roadmap/task',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(data),
    });
  };

  // =========================================================================
  // Run Configurations
  // =========================================================================

  ApiClient.getRunConfigs = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/run-configs');
  };

  /**
   * Scan for importable run configurations from project files
   * @param {string} projectId - Project UUID
   * @returns {Promise<Object>} Scan result with importable configs
   */
  ApiClient.getImportableRunConfigs = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/run-configs/importable');
  };

  ApiClient.createRunConfig = function(projectId, data) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/run-configs',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(data),
    });
  };

  ApiClient.updateRunConfig = function(projectId, configId, data) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/run-configs/' + configId,
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(data),
    });
  };

  ApiClient.deleteRunConfig = function(projectId, configId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/run-configs/' + configId,
      method: 'DELETE',
    });
  };

  ApiClient.startRunConfig = function(projectId, configId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/run-configs/' + configId + '/start',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({}),
    });
  };

  ApiClient.stopRunConfig = function(projectId, configId) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/run-configs/' + configId + '/stop',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({}),
    });
  };

  ApiClient.getRunConfigStatus = function(projectId, configId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/run-configs/' + configId + '/status');
  };

  // =========================================================================
  // Inventify
  // =========================================================================

  ApiClient.startInventify = function(data) {
    return $.ajax({
      url: baseUrl + '/api/projects/inventify/start',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(data),
    });
  };

  ApiClient.getInventifyIdeas = function() {
    return $.ajax({
      url: baseUrl + '/api/projects/inventify/ideas',
      method: 'GET',
    });
  };

  ApiClient.cancelInventify = function() {
    return $.ajax({
      url: baseUrl + '/api/projects/inventify/cancel',
      method: 'POST',
    });
  };

  ApiClient.suggestInventifyNames = function(selectedIndex) {
    return $.ajax({
      url: baseUrl + '/api/projects/inventify/suggest-names',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ selectedIndex: selectedIndex }),
    });
  };

  ApiClient.getInventifyNameSuggestions = function() {
    return $.ajax({
      url: baseUrl + '/api/projects/inventify/name-suggestions',
      method: 'GET',
    });
  };

  ApiClient.selectInventifyIdea = function(selectedIndex, projectName) {
    return $.ajax({
      url: baseUrl + '/api/projects/inventify/select',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        selectedIndex: selectedIndex,
        projectName: projectName,
      }),
    });
  };

  ApiClient.getInventifyBuildResult = function() {
    return $.ajax({
      url: baseUrl + '/api/projects/inventify/build-result',
      method: 'GET',
    });
  };

  ApiClient.completeInventifyBuild = function(projectId) {
    return $.ajax({
      url: baseUrl + '/api/projects/inventify/complete-build',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ projectId: projectId }),
    });
  };

  // =========================================================================
  // Docker
  // =========================================================================

  ApiClient.getDockerAvailability = function() {
    return $.get(baseUrl + '/api/docker/availability');
  };

  ApiClient.getDockerContainers = function() {
    return $.get(baseUrl + '/api/docker/containers');
  };

  ApiClient.getProjectContainer = function(projectId) {
    return $.get(baseUrl + '/api/docker/containers/' + projectId);
  };

  ApiClient.restartContainer = function(projectId) {
    return $.ajax({
      url: baseUrl + '/api/docker/containers/' + projectId + '/restart',
      method: 'POST',
    });
  };

  ApiClient.getDockerImages = function() {
    return $.get(baseUrl + '/api/docker/images');
  };

  ApiClient.buildDockerImage = function(variantName, imageName) {
    var data = { variantName: variantName };

    if (imageName) {
      data.imageName = imageName;
    }

    return $.ajax({
      url: baseUrl + '/api/docker/images/build',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(data),
    });
  };

  ApiClient.removeDockerImage = function(name) {
    return $.ajax({
      url: baseUrl + '/api/docker/images/' + encodeURIComponent(name),
      method: 'DELETE',
    });
  };

  ApiClient.getDockerVariants = function() {
    return $.get(baseUrl + '/api/docker/variants');
  };

  ApiClient.getProjectDocker = function(projectId) {
    return $.get(baseUrl + '/api/projects/' + projectId + '/docker');
  };

  ApiClient.setProjectDocker = function(projectId, body) {
    return $.ajax({
      url: baseUrl + '/api/projects/' + projectId + '/docker',
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(body),
    });
  };

  return ApiClient;
});
