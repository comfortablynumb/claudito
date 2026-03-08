/**
 * Agent Profiles Module
 * Manages CRUD for agent profiles in the Settings modal.
 */
(function() {
  'use strict';

  function generateId() {
    return 'profile-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
  }

  function getProfiles(settings) {
    return (settings && settings.agentProfiles) || [];
  }

  function buildProfileLabel(profile) {
    if (profile.provider === 'opencode') {
      return 'OpenCode';
    }

    var runtimeLabel = profile.anthropicConfig && profile.anthropicConfig.runtime === 'sdk' ? 'SDK' : 'CLI';
    var authInfo = '';

    if (profile.anthropicConfig && profile.anthropicConfig.runtime === 'sdk') {
      var authMode = profile.anthropicConfig.authMode || 'pro-plan';
      authInfo = ' &middot; ' + (authMode === 'api-key' ? 'API Key' : 'Pro/Max Plan');
    }

    return 'Anthropic &middot; ' + runtimeLabel + authInfo;
  }

  function renderProfilesList(profiles) {
    var $list = $('#agent-profiles-list');
    $list.empty();

    if (!profiles || profiles.length === 0) {
      $list.html('<p class="text-xs text-gray-500">No profiles configured.</p>');
      return;
    }

    profiles.forEach(function(profile) {
      var label = buildProfileLabel(profile);
      var defaultBadge = profile.isDefault
        ? '<span class="px-1.5 py-0.5 bg-purple-600/30 text-purple-300 rounded text-xs">Default</span>'
        : '';

      var card = $(
        '<div class="flex items-center justify-between bg-gray-800 border border-gray-700 rounded p-2">' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-sm text-gray-200 font-medium">' + escapeHtml(profile.name) + '</span>' +
            '<span class="text-xs text-gray-400">' + label + '</span>' +
            defaultBadge +
          '</div>' +
          '<div class="flex gap-1">' +
            (profile.isDefault ? '' : '<button type="button" class="btn-set-default-profile text-xs text-purple-400 hover:text-purple-300 px-1" data-id="' + profile.id + '" title="Set as default">Default</button>') +
            '<button type="button" class="btn-edit-profile text-xs text-blue-400 hover:text-blue-300 px-1" data-id="' + profile.id + '">Edit</button>' +
            (profile.isDefault ? '' : '<button type="button" class="btn-delete-profile text-xs text-red-400 hover:text-red-300 px-1" data-id="' + profile.id + '">Delete</button>') +
          '</div>' +
        '</div>'
      );

      $list.append(card);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showProviderOptions(provider) {
    if (provider === 'opencode') {
      $('#profile-editor-anthropic-options').addClass('hidden');
      $('#profile-editor-opencode-options').removeClass('hidden');
    } else {
      $('#profile-editor-anthropic-options').removeClass('hidden');
      $('#profile-editor-opencode-options').addClass('hidden');
    }
  }

  function openEditor(profile) {
    var $editor = $('#agent-profile-editor');
    $editor.removeClass('hidden');

    if (profile) {
      var provider = profile.provider || 'anthropic';
      $('#profile-editor-id').val(profile.id);
      $('#profile-editor-name').val(profile.name);
      $('#profile-editor-provider').val(provider);
      showProviderOptions(provider);

      if (provider === 'opencode') {
        var oc = profile.opencodeConfig || {};
        $('#profile-editor-opencode-config').val(oc.configPath || '');
      } else {
        var ac = profile.anthropicConfig || {};
        $('#profile-editor-runtime').val(ac.runtime || 'claude-binary');

        if (ac.runtime === 'sdk') {
          $('#profile-editor-sdk-options').removeClass('hidden');
          $('#profile-editor-auth-mode').val(ac.authMode || 'pro-plan');

          if (ac.authMode === 'api-key') {
            $('#profile-editor-api-key-group').removeClass('hidden');
            $('#profile-editor-api-key').val(ac.apiKey || '');
          } else {
            $('#profile-editor-api-key-group').addClass('hidden');
            $('#profile-editor-api-key').val('');
          }
        } else {
          $('#profile-editor-sdk-options').addClass('hidden');
        }
      }
    } else {
      // New profile
      $('#profile-editor-id').val('');
      $('#profile-editor-name').val('');
      $('#profile-editor-provider').val('anthropic');
      showProviderOptions('anthropic');
      $('#profile-editor-runtime').val('claude-binary');
      $('#profile-editor-sdk-options').addClass('hidden');
      $('#profile-editor-auth-mode').val('pro-plan');
      $('#profile-editor-api-key-group').addClass('hidden');
      $('#profile-editor-api-key').val('');
      $('#profile-editor-opencode-config').val('');
    }
  }

  function closeEditor() {
    $('#agent-profile-editor').addClass('hidden');
  }

  function collectProfileData() {
    var id = $('#profile-editor-id').val() || generateId();
    var name = $('#profile-editor-name').val() || '';
    var provider = $('#profile-editor-provider').val() || 'anthropic';

    var result = {
      id: id,
      name: name,
      provider: provider,
      isDefault: false
    };

    if (provider === 'opencode') {
      var configPath = $('#profile-editor-opencode-config').val() || '';
      result.opencodeConfig = configPath ? { configPath: configPath } : {};
    } else {
      var runtime = $('#profile-editor-runtime').val();
      var config = { runtime: runtime };

      if (runtime === 'sdk') {
        config.authMode = $('#profile-editor-auth-mode').val() || 'pro-plan';

        if (config.authMode === 'api-key') {
          config.apiKey = $('#profile-editor-api-key').val() || '';
        }
      }

      result.anthropicConfig = config;
    }

    return result;
  }

  function setupEventHandlers() {
    // Provider selector toggles provider-specific options
    $('#profile-editor-provider').on('change', function() {
      showProviderOptions($(this).val());
    });

    // Runtime selector toggles SDK options
    $('#profile-editor-runtime').on('change', function() {
      if ($(this).val() === 'sdk') {
        $('#profile-editor-sdk-options').removeClass('hidden');
      } else {
        $('#profile-editor-sdk-options').addClass('hidden');
      }
    });

    // Auth mode toggles API key field
    $('#profile-editor-auth-mode').on('change', function() {
      if ($(this).val() === 'api-key') {
        $('#profile-editor-api-key-group').removeClass('hidden');
      } else {
        $('#profile-editor-api-key-group').addClass('hidden');
      }
    });

    // Add profile button
    $('#btn-add-agent-profile').on('click', function() {
      openEditor(null);
    });

    // Cancel editor
    $('#btn-cancel-profile').on('click', function() {
      closeEditor();
    });

    // Save profile
    $('#btn-save-profile').on('click', function() {
      var profileData = collectProfileData();

      if (!profileData.name.trim()) {
        window.showToast && window.showToast('Profile name is required', 'error');
        return;
      }

      if (profileData.provider === 'anthropic' &&
          profileData.anthropicConfig &&
          profileData.anthropicConfig.runtime === 'sdk' &&
          profileData.anthropicConfig.authMode === 'api-key' &&
          !profileData.anthropicConfig.apiKey) {
        window.showToast && window.showToast('API key is required', 'error');
        return;
      }

      // Get current profiles from settings cache
      var currentSettings = window._cachedSettings || {};
      var profiles = getProfiles(currentSettings).slice();

      var existingIdx = profiles.findIndex(function(p) { return p.id === profileData.id; });

      if (existingIdx >= 0) {
        // Preserve isDefault
        profileData.isDefault = profiles[existingIdx].isDefault;
        profiles[existingIdx] = profileData;
      } else {
        // If no profiles exist yet, make this the default
        if (profiles.length === 0) {
          profileData.isDefault = true;
        }

        profiles.push(profileData);
      }

      saveProfiles(profiles);
      closeEditor();
    });

    // Edit profile (delegated)
    $(document).on('click', '.btn-edit-profile', function() {
      var id = $(this).data('id');
      var currentSettings = window._cachedSettings || {};
      var profiles = getProfiles(currentSettings);
      var profile = profiles.find(function(p) { return p.id === id; });

      if (profile) {
        openEditor(profile);
      }
    });

    // Delete profile (delegated)
    $(document).on('click', '.btn-delete-profile', function() {
      var id = $(this).data('id');

      if (!confirm('Delete this agent profile?')) return;

      var currentSettings = window._cachedSettings || {};
      var profiles = getProfiles(currentSettings).filter(function(p) { return p.id !== id; });

      saveProfiles(profiles);
    });

    // Set default (delegated)
    $(document).on('click', '.btn-set-default-profile', function() {
      var id = $(this).data('id');
      var currentSettings = window._cachedSettings || {};
      var profiles = getProfiles(currentSettings).map(function(p) {
        return Object.assign({}, p, { isDefault: p.id === id });
      });

      saveProfiles(profiles);
    });
  }

  function saveProfiles(profiles) {
    if (typeof window.ApiClient === 'undefined') return;

    window.ApiClient.updateSettings({ agentProfiles: profiles })
      .then(function(updated) {
        window._cachedSettings = updated;
        renderProfilesList(profiles);
        window.showToast && window.showToast('Agent profiles saved', 'success');

        // Refresh project profile selectors if available
        if (window.AgentProfilesModule && window.AgentProfilesModule.refreshProjectSelector) {
          window.AgentProfilesModule.refreshProjectSelector();
        }
      })
      .catch(function(err) {
        var msg = (err && err.responseJSON && err.responseJSON.error) || 'Failed to save profiles';
        window.showToast && window.showToast(msg, 'error');
      });
  }

  function loadProfiles(settings) {
    var profiles = getProfiles(settings);
    renderProfilesList(profiles);
  }

  function refreshProjectSelector() {
    var currentSettings = window._cachedSettings || {};
    var profiles = getProfiles(currentSettings);
    var $select = $('#project-profile-select');
    var currentVal = $select.val();
    $select.empty();

    profiles.forEach(function(p) {
      var label = p.name + (p.isDefault ? ' (default)' : '');
      $select.append('<option value="' + p.id + '">' + escapeHtml(label) + '</option>');
    });

    // Restore selection if still valid
    if (currentVal && profiles.some(function(p) { return p.id === currentVal; })) {
      $select.val(currentVal);
    }
  }

  // Expose module
  window.AgentProfilesModule = {
    setupEventHandlers: setupEventHandlers,
    loadProfiles: loadProfiles,
    renderProfilesList: renderProfilesList,
    getProfiles: getProfiles,
    refreshProjectSelector: refreshProjectSelector,
  };
})();
