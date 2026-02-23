/**
 * Slack Project Module
 * Handles per-project Slack notification configuration
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SlackProjectModule = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var state = null;
  var api = null;
  var escapeHtml = null;
  var showToast = null;
  var openModal = null;
  var closeAllModals = null;

  var currentProjectId = null;
  var currentProjectName = null;
  var channels = [];
  var currentConfig = null;
  var isSaving = false;

  var EVENTS = [
    { id: 'agent_completed', label: 'Agent completed' },
    { id: 'agent_failed', label: 'Agent failed' },
    { id: 'agent_waiting', label: 'Agent waiting for input' },
    { id: 'ralph_loop_complete', label: 'Ralph Loop iteration complete' },
    { id: 'ralph_loop_error', label: 'Ralph Loop error' },
    { id: 'milestone_completed', label: 'Milestone completed' },
    { id: 'milestone_failed', label: 'Milestone failed' },
  ];

  function init(deps) {
    state = deps.state;
    api = deps.api;
    escapeHtml = deps.escapeHtml;
    showToast = deps.showToast;
    openModal = deps.openModal;
    closeAllModals = deps.closeAllModals;

    setupHandlers();
  }

  function openSlackModal(projectId, projectName) {
    currentProjectId = projectId;
    currentProjectName = projectName;
    channels = [];
    currentConfig = null;

    $('#slack-project-name').text(projectName);
    $('#slack-channel-select').html('<option value="">Loading channels...</option>').prop('disabled', true);
    $('#slack-events-list').html('');
    $('#slack-mention-users').val('');
    $('#slack-thread-replies').prop('checked', false);
    $('#btn-save-project-slack').prop('disabled', true);

    $.when(loadConfig(), loadChannels())
      .done(function(configResult, channelsResult) {
        currentConfig = configResult[0];
        channels = channelsResult[0] || [];
        renderForm();
        openModal('modal-project-slack');
      })
      .fail(function() {
        showToast('Failed to load Slack settings', 'error');
      });
  }

  function loadConfig() {
    return $.get('/api/projects/' + currentProjectId + '/slack/');
  }

  function loadChannels() {
    var deferred = $.Deferred();
    $.get('/api/integrations/slack/channels')
      .done(function(data) { deferred.resolve(data); })
      .fail(function() { deferred.resolve([]); });
    return deferred.promise();
  }

  function renderForm() {
    renderChannelDropdown();
    renderEventCheckboxes();

    if (currentConfig) {
      $('#slack-mention-users').val((currentConfig.mentionUsers || []).join(', '));
      $('#slack-thread-replies').prop('checked', currentConfig.threadReplies === true);
    }

    $('#btn-save-project-slack').prop('disabled', false);
  }

  function renderChannelDropdown() {
    var selectedId = currentConfig && currentConfig.channelId;
    var html = '<option value="">No channel (disabled)</option>';

    channels.forEach(function(ch) {
      var selected = ch.id === selectedId ? ' selected' : '';
      html += '<option value="' + escapeHtml(ch.id) + '"' + selected + '>#' + escapeHtml(ch.name) + '</option>';
    });

    $('#slack-channel-select').html(html).prop('disabled', false);
  }

  function renderEventCheckboxes() {
    var enabledEvents = (currentConfig && currentConfig.events) ? currentConfig.events : [];
    var html = '';

    EVENTS.forEach(function(ev) {
      var checked = enabledEvents.indexOf(ev.id) !== -1 ? ' checked' : '';
      html += '<label class="flex items-center gap-2 cursor-pointer">' +
        '<input type="checkbox" class="slack-event-checkbox rounded" value="' + ev.id + '"' + checked + '>' +
        '<span class="text-sm">' + escapeHtml(ev.label) + '</span>' +
        '</label>';
    });

    $('#slack-events-list').html(html);
  }

  function collectEvents() {
    var events = [];
    $('.slack-event-checkbox:checked').each(function() {
      events.push($(this).val());
    });
    return events;
  }

  function collectMentionUsers() {
    var raw = $('#slack-mention-users').val().trim();
    if (!raw) return [];
    return raw.split(',').map(function(u) { return u.trim(); }).filter(Boolean);
  }

  function save() {
    if (isSaving) return;

    var channelId = $('#slack-channel-select').val();

    if (!channelId) {
      clearConfig();
      return;
    }

    isSaving = true;
    $('#btn-save-project-slack').prop('disabled', true).text('Saving...');

    var config = {
      channelId: channelId,
      events: collectEvents(),
      mentionUsers: collectMentionUsers(),
      threadReplies: $('#slack-thread-replies').is(':checked'),
    };

    $.ajax({
      url: '/api/projects/' + currentProjectId + '/slack/',
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(config),
    })
      .done(function() {
        closeAllModals();
        showToast('Slack notifications saved', 'success');
      })
      .fail(function(xhr) {
        var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Unknown error';
        showToast('Failed to save: ' + msg, 'error');
      })
      .always(function() {
        isSaving = false;
        $('#btn-save-project-slack').prop('disabled', false).text('Save');
      });
  }

  function clearConfig() {
    if (!currentProjectId) return;

    if (!confirm('Remove Slack notification config for this project?')) {
      return;
    }

    $.ajax({
      url: '/api/projects/' + currentProjectId + '/slack/',
      method: 'DELETE',
    })
      .done(function() {
        closeAllModals();
        showToast('Slack notifications cleared', 'success');
      })
      .fail(function(xhr) {
        var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Unknown error';
        showToast('Failed to clear: ' + msg, 'error');
      });
  }

  function setupHandlers() {
    $('#btn-save-project-slack').on('click', function() {
      save();
    });

    $('#btn-clear-project-slack').on('click', function() {
      clearConfig();
    });
  }

  return {
    init: init,
    openSlackModal: openSlackModal,
  };
}));
