/**
 * @module DockerModule
 * @description Frontend module for Docker sandboxed execution management.
 * Handles Docker availability display, image management UI, and container status.
 */

(function(root, factory) {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DockerModule = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var api = null;
  var state = null;
  var showToast = null;
  var showErrorToast = null;

  function init(deps) {
    api = deps.api;
    state = deps.state;
    showToast = deps.showToast;
    showErrorToast = deps.showErrorToast;
    bindEvents();
  }

  function bindEvents() {
    $(document).on('click', '#btn-check-docker', handleCheckAvailability);
    $(document).on('click', '#btn-refresh-images', handleRefreshImages);
    $(document).on('click', '#btn-build-image', handleBuildImage);
    $(document).on('click', '.btn-remove-image', handleRemoveImage);
  }

  // ============================================================
  // Docker Availability
  // ============================================================

  function checkAndRenderAvailability() {
    var $status = $('#docker-availability-status');
    $status.html('<span class="text-gray-400 text-xs">Checking...</span>');

    api.getDockerAvailability()
      .done(function(result) {
        renderAvailabilityStatus(result);
      })
      .fail(function() {
        $status.html(
          '<span class="inline-block w-2 h-2 rounded-full bg-gray-500 mr-1.5 align-middle"></span>' +
          '<span class="text-xs text-gray-400 align-middle">Unable to check Docker status</span>'
        );
      });
  }

  function renderAvailabilityStatus(availability) {
    var $status = $('#docker-availability-status');
    var html = '';

    if (!availability.installed) {
      html = renderStatusDot('red') +
        '<span class="text-xs text-gray-300 align-middle">Docker not installed</span>';
    } else if (!availability.running) {
      html = renderStatusDot('yellow') +
        '<span class="text-xs text-gray-300 align-middle">Docker installed (v' +
        escapeHtml(availability.version || '?') + ') but not running</span>';
    } else {
      html = renderStatusDot('green') +
        '<span class="text-xs text-gray-300 align-middle">Docker v' +
        escapeHtml(availability.version || '?') + ' running</span>';
    }

    $status.html(html);
  }

  function renderStatusDot(color) {
    return '<span class="inline-block w-2 h-2 rounded-full bg-' + color +
      '-500 mr-1.5 align-middle"></span>';
  }

  function handleCheckAvailability(e) {
    e.preventDefault();
    checkAndRenderAvailability();
  }

  // ============================================================
  // Image Management
  // ============================================================

  function loadAndRenderImages() {
    var $list = $('#docker-images-list');
    $list.html('<div class="text-xs text-gray-400">Loading images...</div>');

    api.getDockerImages()
      .done(function(result) {
        if (result.daemonNotRunning) {
          handleDaemonNotRunning(result.warning);
          return;
        }

        renderImageList(result.images || []);
      })
      .fail(function() {
        $list.html('<div class="text-xs text-gray-500">Failed to load images</div>');
      });
  }

  function handleDaemonNotRunning(warning) {
    var $list = $('#docker-images-list');
    var message = warning || 'Docker engine not running. Falling back to host execution. Docker has been disabled.';

    showToast(message, 'warning');
    $list.html('<div class="text-xs text-yellow-400">' +
      'Docker engine does not appear to be running. Docker has been disabled.' +
      '</div>');
    $('#input-docker-enabled').prop('checked', false);
  }

  function renderImageList(images) {
    var $list = $('#docker-images-list');

    if (!images.length) {
      $list.html(
        '<div class="text-xs text-gray-500">No Claudito images found. Build one to get started.</div>'
      );
      return;
    }

    var html = images.map(function(img) {
      return '<div class="flex items-center justify-between bg-gray-800/50 rounded px-3 py-2">' +
        '<div class="flex-1 min-w-0">' +
        '<span class="text-sm text-gray-200">' + escapeHtml(img.name) + '</span>' +
        '<span class="text-xs text-gray-500 ml-1">:' + escapeHtml(img.tag) + '</span>' +
        '<span class="text-xs text-gray-500 ml-3">' + escapeHtml(img.size) + '</span>' +
        '</div>' +
        '<button type="button" class="btn-remove-image text-red-400 hover:text-red-300 text-xs ml-2" ' +
        'data-name="' + escapeHtml(img.name + ':' + img.tag) + '" title="Remove image">' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>' +
        '</svg>' +
        '</button>' +
        '</div>';
    }).join('');

    $list.html(html);
  }

  function handleRefreshImages(e) {
    e.preventDefault();
    loadAndRenderImages();
  }

  function setDockerButtonsDisabled(disabled) {
    var $btns = $('#btn-build-image, #btn-refresh-images, #btn-check-docker, #docker-variant-select');
    $btns.prop('disabled', disabled);
    $('#btn-build-image').text(disabled ? 'Building...' : 'Build');
  }

  function showBuildOutput() {
    var $container = $('#docker-build-output');

    if (!$container.length) {
      var $parent = $('#docker-images-list').parent();
      $parent.append(
        '<div id="docker-build-output" class="mt-3 bg-gray-900 rounded p-2 text-xs font-mono ' +
        'max-h-48 overflow-y-auto border border-gray-700"></div>'
      );
    } else {
      $container.empty().removeClass('hidden');
    }
  }

  function appendBuildLine(line, phase) {
    var $output = $('#docker-build-output');

    if (!$output.length) return;

    var colorClass = 'text-gray-400';

    if (phase === 'error') colorClass = 'text-red-400';
    else if (phase === 'done') colorClass = 'text-green-400';

    $output.append('<div class="' + colorClass + '">' + escapeHtml(line) + '</div>');
    $output.scrollTop($output[0].scrollHeight);
  }

  function handleBuildProgress(data) {
    showBuildOutput();
    appendBuildLine(data.line, data.phase);

    if (data.phase === 'done' || data.phase === 'error') {
      setDockerButtonsDisabled(false);

      if (data.phase === 'done') {
        loadAndRenderImages();
      }
    }
  }

  function handleBuildImage(e) {
    e.preventDefault();
    var $select = $('#docker-variant-select');
    var variantName = $select.val();

    if (!variantName) {
      showToast('Select a variant to build', 'warning');
      return;
    }

    setDockerButtonsDisabled(true);
    showBuildOutput();

    api.buildDockerImage(variantName)
      .done(function(result) {
        showToast('Image ' + result.imageName + ' built successfully', 'success');
      })
      .fail(function(xhr) {
        showErrorToast(xhr, 'Failed to build image');
        appendBuildLine('Build failed', 'error');
        setDockerButtonsDisabled(false);
      });
  }

  function handleRemoveImage(e) {
    e.preventDefault();
    var name = $(e.currentTarget).data('name');

    if (!name) return;

    if (!confirm('Remove Docker image ' + name + '?')) return;

    api.removeDockerImage(name)
      .done(function() {
        showToast('Image removed', 'success');
        loadAndRenderImages();
      })
      .fail(function(xhr) {
        showErrorToast(xhr, 'Failed to remove image');
      });
  }

  // ============================================================
  // Variants Dropdown
  // ============================================================

  function loadVariants() {
    var $select = $('#docker-variant-select');
    $select.html('<option value="">Loading...</option>');

    api.getDockerVariants()
      .done(function(result) {
        renderVariantOptions(result.variants || []);
      })
      .fail(function() {
        $select.html('<option value="">Failed to load</option>');
      });
  }

  function renderVariantOptions(variants) {
    var $select = $('#docker-variant-select');
    var html = '<option value="">Select variant...</option>';

    html += variants.map(function(v) {
      return '<option value="' + escapeHtml(v.name) + '">' +
        escapeHtml(v.displayName) + ' - ' + escapeHtml(v.description) +
        '</option>';
    }).join('');

    $select.html(html);
  }

  // ============================================================
  // Settings Tab Lifecycle
  // ============================================================

  function onSettingsTabOpen() {
    checkAndRenderAvailability();
    loadVariants();
    loadAndRenderImages();
  }

  function populateSettingsFields(settings) {
    var docker = settings.docker || {};
    $('#input-docker-enabled').prop('checked', docker.enabled || false);
    $('#input-docker-base-image').val(docker.baseImage || 'claudito-agent:latest');
    $('#input-docker-cpus').val(docker.resourceLimits?.cpus || 2.0);
    $('#input-docker-memory').val(docker.resourceLimits?.memoryMb || 4096);
    $('#input-docker-network').val(docker.networkMode || 'bridge');
  }

  function collectSettingsFields() {
    return {
      enabled: $('#input-docker-enabled').is(':checked'),
      baseImage: $('#input-docker-base-image').val() || 'claudito-agent:latest',
      resourceLimits: {
        cpus: parseFloat($('#input-docker-cpus').val()) || 2.0,
        memoryMb: parseInt($('#input-docker-memory').val(), 10) || 4096,
      },
      networkMode: $('#input-docker-network').val() || 'bridge',
    };
  }

  // ============================================================
  // Helpers
  // ============================================================

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  return {
    init: init,
    onSettingsTabOpen: onSettingsTabOpen,
    populateSettingsFields: populateSettingsFields,
    collectSettingsFields: collectSettingsFields,
    loadAndRenderImages: loadAndRenderImages,
    checkAndRenderAvailability: checkAndRenderAvailability,
    handleBuildProgress: handleBuildProgress,
  };
}));
