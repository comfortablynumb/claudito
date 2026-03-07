/**
 * Folder Browser Module
 * Handles folder selection dialog functionality for project creation
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FolderBrowserModule = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Dependencies (injected via init)
  var state;
  var api;
  var escapeHtml;
  var openModal;
  var closeModal;
  var showToast;

  /**
   * Initialize the module with dependencies
   * @param {Object} deps - Dependencies object
   */
  function init(deps) {
    state = deps.state;
    api = deps.api;
    escapeHtml = deps.escapeHtml;
    openModal = deps.openModal;
    closeModal = deps.closeModal;
    showToast = deps.showToast;
  }

  /**
   * Get folder icon SVG
   * @returns {string} SVG HTML
   */
  function getFolderIcon() {
    return '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="text-yellow-500">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
      'd="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>';
  }

  /**
   * Get file icon SVG
   * @returns {string} SVG HTML
   */
  function getFileIcon() {
    return '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="text-gray-400">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
      'd="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>';
  }

  /**
   * Split a path string into parts
   * @param {string} pathStr - Path string
   * @returns {string[]} Path parts
   */
  function splitPath(pathStr) {
    return pathStr.split(/[\\\/]/).filter(function(p) {
      return p.length > 0;
    });
  }

  /**
   * Extract folder name from path
   * @param {string} folderPath - Full folder path
   * @returns {string} Folder name
   */
  function extractFolderName(folderPath) {
    var parts = splitPath(folderPath);
    return parts.length > 0 ? parts[parts.length - 1] : '';
  }

  /**
   * Update selected path display
   */
  function updateSelectedPathDisplay() {
    var currentPath = state.folderBrowser.currentPath;

    if (currentPath) {
      $('#selected-path').html(
        '<span class="text-gray-300">Current folder:</span> ' +
        '<span class="text-purple-400">' + escapeHtml(currentPath) + '</span>'
      );
      $('#btn-folder-browser-new-folder').prop('disabled', false);
    } else {
      $('#selected-path').html(
        '<span class="text-gray-500">Navigate to a folder to select it</span>'
      );
      $('#btn-folder-browser-new-folder').prop('disabled', true);
    }
  }

  /**
   * Render breadcrumb navigation
   * @param {string|null} currentPath - Current path
   */
  function renderBreadcrumb(currentPath) {
    var $breadcrumb = $('#folder-breadcrumb');
    $breadcrumb.empty();

    $breadcrumb.append('<span class="folder-breadcrumb-item" data-path="">Drives</span>');

    if (currentPath) {
      var parts = splitPath(currentPath);
      var accumulated = '';

      parts.forEach(function(part, index) {
        accumulated += (index === 0) ? part : '\\' + part;
        $breadcrumb.append('<span class="folder-breadcrumb-separator">/</span>');
        $breadcrumb.append(
          '<span class="folder-breadcrumb-item" data-path="' +
          escapeHtml(accumulated) + '">' + escapeHtml(part) + '</span>'
        );
      });
    }

    updateSelectedPathDisplay();
  }

  /**
   * Render a folder/file item
   * @param {string} name - Item name
   * @param {string} itemPath - Item path
   * @param {boolean} isDirectory - Whether item is a directory
   * @returns {string} HTML string
   */
  function renderFolderItem(name, itemPath, isDirectory) {
    var icon = isDirectory ? getFolderIcon() : getFileIcon();

    return '<div class="folder-item" data-path="' + escapeHtml(itemPath) + '">' +
      '<span class="folder-icon">' + icon + '</span>' +
      '<span class="folder-name">' + escapeHtml(name) + '</span>' +
    '</div>';
  }

  /**
   * Render folder entries
   * @param {Array} entries - Folder entries
   * @param {string} currentPath - Current path
   */
  function renderFolderEntries(entries, currentPath) {
    var $browser = $('#folder-browser');
    $browser.empty();

    if (entries.length === 0) {
      $browser.html('<div class="p-3 text-gray-500 text-xs">No subfolders</div>');
    } else {
      entries.forEach(function(entry) {
        $browser.append(renderFolderItem(entry.name, entry.path, entry.isDirectory));
      });
    }

    renderBreadcrumb(currentPath);
  }

  /**
   * Render drives list
   * @param {Array} drives - Available drives
   */
  function renderDrives(drives) {
    var $browser = $('#folder-browser');
    $browser.empty();

    drives.forEach(function(drive) {
      $browser.append(renderFolderItem(drive.name, drive.path, true));
    });

    renderBreadcrumb(null);
  }

  /**
   * Load a folder's contents
   * @param {string} folderPath - Path to load
   */
  function loadFolder(folderPath) {
    state.folderBrowser.currentPath = folderPath;
    $('#folder-browser').html('<div class="p-3 text-gray-400 text-xs">Loading...</div>');

    api.browseFolder(folderPath)
      .done(function(entries) {
        renderFolderEntries(entries, folderPath);
      })
      .fail(function() {
        $('#folder-browser').html('<div class="p-3 text-red-400 text-xs">Failed to load folder</div>');
      });
  }

  /**
   * Load available drives
   */
  function loadDrives() {
    $('#folder-browser').html('<div class="p-3 text-gray-400 text-xs">Loading drives...</div>');
    $('#folder-breadcrumb').empty();

    api.getDrives()
      .done(function(drives) {
        renderDrives(drives);
      })
      .fail(function() {
        $('#folder-browser').html('<div class="p-3 text-red-400 text-xs">Failed to load drives</div>');
      });
  }

  /**
   * Open the folder browser modal
   */
  function open() {
    state.folderBrowser.currentPath = null;
    openModal('modal-folder-browser');
    loadDrives();
  }

  /**
   * Confirm folder selection and close modal
   */
  function confirmSelection() {
    var selected = state.folderBrowser.currentPath;

    if (selected) {
      if (typeof state.folderBrowserCallback === 'function') {
        state.folderBrowserCallback(selected);
        state.folderBrowserCallback = null;
      } else {
        $('#input-project-path').val(selected);
        var folderName = extractFolderName(selected);

        if (folderName && !$('#input-project-name').val()) {
          $('#input-project-name').val(folderName);
        }
      }

      closeModal('modal-folder-browser');
    } else {
      showToast('Please navigate to a folder first', 'error');
    }
  }

  /**
   * Create a new folder inside the current path
   */
  function createNewFolder() {
    var currentPath = state.folderBrowser.currentPath;

    if (!currentPath) {
      return;
    }

    var folderName = prompt('Enter folder name:');

    if (!folderName || !folderName.trim()) {
      return;
    }

    folderName = folderName.trim();
    var newPath = currentPath + '\\' + folderName;

    api.createFolder(newPath)
      .done(function() {
        showToast('Folder created: ' + folderName, 'success');
        loadFolder(currentPath);
      })
      .fail(function(xhr) {
        var msg = xhr.responseJSON && xhr.responseJSON.error
          ? xhr.responseJSON.error
          : 'Failed to create folder';
        showToast(msg, 'error');
      });
  }

  /**
   * Setup event handlers for folder browser
   */
  function setupHandlers() {
    $('#folder-browser').on('click', '.folder-item', function() {
      var itemPath = $(this).data('path');
      loadFolder(itemPath);
    });

    $('#folder-breadcrumb').on('click', '.folder-breadcrumb-item', function() {
      var itemPath = $(this).data('path');

      if (itemPath === '') {
        loadDrives();
      } else {
        loadFolder(itemPath);
      }
    });

    $('#btn-browse-folder').on('click', function() {
      open();
    });

    $('#btn-select-folder').on('click', function() {
      confirmSelection();
    });

    $('#btn-folder-browser-new-folder').on('click', function() {
      createNewFolder();
    });
  }

  // Public API
  return {
    init: init,
    getFolderIcon: getFolderIcon,
    getFileIcon: getFileIcon,
    splitPath: splitPath,
    extractFolderName: extractFolderName,
    updateSelectedPathDisplay: updateSelectedPathDisplay,
    renderBreadcrumb: renderBreadcrumb,
    renderFolderItem: renderFolderItem,
    renderFolderEntries: renderFolderEntries,
    renderDrives: renderDrives,
    loadFolder: loadFolder,
    loadDrives: loadDrives,
    open: open,
    confirmSelection: confirmSelection,
    setupHandlers: setupHandlers
  };
}));
