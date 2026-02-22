/**
 * File Browser Module
 * Handles file tree navigation, file editing, create/delete operations
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FileBrowser = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Dependencies injected via init()
  var state = null;
  var api = null;
  var escapeHtml = null;
  var showToast = null;
  var showConfirm = null;
  var openModal = null;
  var closeModal = null;
  var findProjectById = null;
  var highlightCode = null;
  var getLanguageFromPath = null;
  var Validators = null;

  // Resize functionality variables
  var isResizing = false;
  var startX = 0;
  var startWidth = 0;
  var MIN_WIDTH = 200;
  var MAX_WIDTH = 600;

  function init(deps) {
    state = deps.state;
    api = deps.api;
    escapeHtml = deps.escapeHtml;
    showToast = deps.showToast;
    showConfirm = deps.showConfirm;
    openModal = deps.openModal;
    closeModal = deps.closeModal;
    findProjectById = deps.findProjectById;
    highlightCode = deps.highlightCode;
    getLanguageFromPath = deps.getLanguageFromPath;
    Validators = deps.Validators;

    // Initialize resize functionality
    initializeResize();
  }

  function loadFileTree(rootPath) {
    var $tree = $('#file-browser-tree');
    $tree.html('<div class="text-gray-500 text-center py-4">Loading...</div>');

    api.browseWithFiles(rootPath)
      .done(function(entries) {
        state.fileBrowser.rootEntries = entries;
        renderFileTree(rootPath, entries);
      })
      .fail(function() {
        $tree.html('<div class="text-red-400 text-center py-4">Failed to load files</div>');
      });
  }

  function renderFileTree(basePath, entries) {
    var $tree = $('#file-browser-tree');
    $tree.empty();

    if (entries.length === 0) {
      $tree.html('<div class="text-gray-500 text-center py-4">No files in this directory</div>');
      return;
    }

    entries.forEach(function(entry) {
      $tree.append(renderFileTreeItem(entry, 0));
    });
  }

  function renderFileTreeItem(entry, depth) {
    var indent = depth * 16;
    var isExpanded = state.fileBrowser.expandedDirs[entry.path];
    var isSelected = state.fileBrowser.selectedFile === entry.path;
    var deleteBtn = '<button class="btn-delete-file" data-path="' + escapeHtml(entry.path) + '" data-is-dir="' + (entry.isDirectory ? 'true' : 'false') + '" data-name="' + escapeHtml(entry.name) + '" title="Delete">' +
      '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>' +
      '</svg>' +
    '</button>';

    if (entry.isDirectory) {
      var chevronClass = isExpanded ? 'tree-chevron expanded' : 'tree-chevron';
      var html = '<div class="file-tree-item directory' + (isSelected ? ' selected' : '') + '" data-path="' + escapeHtml(entry.path) + '" data-is-dir="true" draggable="true" style="padding-left: ' + indent + 'px;">' +
        '<svg class="' + chevronClass + '" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>' +
        '</svg>' +
        '<svg class="tree-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>' +
        '</svg>' +
        '<span class="tree-name">' + escapeHtml(entry.name) + '</span>' +
        deleteBtn +
      '</div>';

      if (isExpanded && entry.children) {
        html += '<div class="tree-children">';
        entry.children.forEach(function(child) {
          html += renderFileTreeItem(child, depth + 1);
        });
        html += '</div>';
      }

      return html;
    } else {
      var editableClass = entry.isEditable ? ' editable' : '';
      return '<div class="file-tree-item file' + editableClass + (isSelected ? ' selected' : '') + '" data-path="' + escapeHtml(entry.path) + '" data-is-dir="false" data-editable="' + (entry.isEditable ? 'true' : 'false') + '" draggable="true" style="padding-left: ' + indent + 'px;">' +
        '<svg class="tree-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>' +
        '</svg>' +
        '<span class="tree-name">' + escapeHtml(entry.name) + '</span>' +
        deleteBtn +
      '</div>';
    }
  }

  function toggleDirectory(dirPath) {
    if (state.fileBrowser.expandedDirs[dirPath]) {
      // Collapse
      delete state.fileBrowser.expandedDirs[dirPath];
      var $item = $('.file-tree-item[data-path="' + CSS.escape(dirPath) + '"]');
      $item.find('.tree-chevron').first().removeClass('expanded');
      $item.next('.tree-children').remove();
    } else {
      // Expand - load children
      state.fileBrowser.expandedDirs[dirPath] = true;
      var $item = $('.file-tree-item[data-path="' + CSS.escape(dirPath) + '"]');
      $item.find('.tree-chevron').first().addClass('expanded');

      // Load children
      api.browseWithFiles(dirPath)
        .done(function(children) {
          var childrenHtml = '<div class="tree-children">';
          children.forEach(function(child) {
            var depth = (parseInt($item.css('padding-left')) / 16) + 1;
            childrenHtml += renderFileTreeItem(child, depth);
          });
          childrenHtml += '</div>';
          $item.after(childrenHtml);
        });
    }
  }

  function isMarkdownFile(filePath) {
    return /\.(md|markdown)$/i.test(filePath);
  }

  function openFile(filePath, fileName) {
    // Check if file is already open
    var existingFile = state.openFiles.find(function(f) { return f.path === filePath; });

    if (existingFile) {
      setActiveFile(filePath);
      return;
    }

    // Load file content
    api.readFile(filePath)
      .done(function(data) {
        var isMarkdown = isMarkdownFile(filePath);
        state.openFiles.push({
          path: filePath,
          name: fileName,
          content: data.content,
          originalContent: data.content,
          modified: false,
          isMarkdown: isMarkdown,
          previewMode: isMarkdown // Default to preview mode for markdown
        });
        renderOpenFileTabs();
        setActiveFile(filePath);
      })
      .fail(function() {
        showToast('Failed to open file', 'error');
      });
  }

  function setActiveFile(filePath) {
    state.activeFilePath = filePath;
    state.fileBrowser.selectedFile = filePath;

    // Update tree selection
    $('.file-tree-item').removeClass('selected');
    $('.file-tree-item[data-path="' + CSS.escape(filePath) + '"]').addClass('selected');

    // Update tab selection
    renderOpenFileTabs();

    // Show file content
    var file = state.openFiles.find(function(f) { return f.path === filePath; });

    if (file) {
      $('#file-editor-empty').addClass('hidden');
      $('#file-editor-wrapper').removeClass('hidden');
      $('#file-editor-path').text(filePath);

      if (file.isMarkdown && file.previewMode) {
        renderMarkdownPreview(file);
      } else {
        $('#code-editor-container').removeClass('hidden');
        $('#file-editor-textarea').removeClass('hidden').val(file.content);
        $('#markdown-preview-container').remove();
        updateFileModifiedState(file);
        updateEditorSyntaxHighlighting(filePath, file.content);
      }

      // Show editor in mobile view
      showMobileFileEditor();
    }
  }

  function updateEditorSyntaxHighlighting(filePath, content) {
    var language = getLanguageFromPath(filePath);
    var $container = $('#code-editor-container');
    var $highlight = $('#code-editor-highlight');

    if (language && typeof hljs !== 'undefined') {
      $container.addClass('highlighting');
      var highlighted = highlightCode(content, language);
      // Add trailing newline to ensure proper alignment with textarea
      $highlight.html(highlighted + '\n');
      syncEditorScroll();
    } else {
      $container.removeClass('highlighting');
      $highlight.empty();
    }
  }

  function syncEditorScroll() {
    var $textarea = $('#file-editor-textarea');
    var $backdrop = $('#code-editor-backdrop');
    $backdrop.scrollTop($textarea.scrollTop());
    $backdrop.scrollLeft($textarea.scrollLeft());
  }

  function updateFileModifiedState(file) {
    if (file.modified) {
      $('#file-editor-modified').removeClass('hidden');
      $('#btn-save-file').removeClass('hidden');
    } else {
      $('#file-editor-modified').addClass('hidden');
      $('#btn-save-file').addClass('hidden');
    }
    renderOpenFileTabs();
  }

  function renderOpenFileTabs() {
    var $tabs = $('#open-file-tabs');
    $tabs.empty();

    state.openFiles.forEach(function(file) {
      var activeClass = file.path === state.activeFilePath ? ' active' : '';
      var modifiedIndicator = file.modified ? '<span class="tab-modified"></span>' : '';

      var markdownToggle = '';
      if (file.isMarkdown) {
        markdownToggle = '<button class="tab-preview-toggle ml-1 text-gray-400 hover:text-gray-200" onclick="toggleMarkdownPreview(\'' + escapeHtml(file.path).replace(/'/g, "\\'") + '\')" title="' + (file.previewMode ? 'Edit' : 'Preview') + '">' +
          (file.previewMode ?
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>' :
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>'
          ) +
        '</button>';
      }

      var html = '<div class="file-tab' + activeClass + '" data-path="' + escapeHtml(file.path) + '">' +
        modifiedIndicator +
        '<span class="tab-name">' + escapeHtml(file.name) + '</span>' +
        markdownToggle +
        '<button class="tab-close" data-path="' + escapeHtml(file.path) + '" title="Close">' +
          '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>' +
          '</svg>' +
        '</button>' +
      '</div>';

      $tabs.append(html);
    });
  }

  function closeFile(filePath) {
    var fileIndex = state.openFiles.findIndex(function(f) { return f.path === filePath; });

    if (fileIndex === -1) return;

    var file = state.openFiles[fileIndex];

    function doClose() {
      // Remove from open files
      state.openFiles.splice(fileIndex, 1);

      // If this was the active file, switch to another or show empty state
      if (state.activeFilePath === filePath) {
        if (state.openFiles.length > 0) {
          var newIndex = Math.min(fileIndex, state.openFiles.length - 1);
          setActiveFile(state.openFiles[newIndex].path);
        } else {
          state.activeFilePath = null;
          state.fileBrowser.selectedFile = null;
          $('#file-editor-empty').removeClass('hidden');
          $('#file-editor-wrapper').addClass('hidden');
          $('.file-tree-item').removeClass('selected');
        }
      }

      renderOpenFileTabs();
    }

    // Warn if modified
    if (file.modified) {
      showConfirm('Unsaved Changes', 'This file has unsaved changes. Close anyway?', { danger: true, confirmText: 'Close' })
        .then(function(confirmed) {
          if (confirmed) {
            doClose();
          }
        });
    } else {
      doClose();
    }
  }

  function showDeleteFileConfirmation(filePath, isDirectory, fileName) {
    state.pendingDeleteFile = {
      path: filePath,
      isDirectory: isDirectory,
      name: fileName
    };

    $('#delete-file-type').text(isDirectory ? 'folder' : 'file');
    $('#delete-file-name').text(fileName);
    $('#delete-folder-warning').toggleClass('hidden', !isDirectory);

    openModal('modal-confirm-delete-file');
  }

  function confirmDeleteFile() {
    if (!state.pendingDeleteFile) return;

    var pending = state.pendingDeleteFile;

    api.deleteFileOrFolder(pending.path, pending.isDirectory)
      .done(function() {
        closeModal('modal-confirm-delete-file');

        // If this file was open, close it
        if (!pending.isDirectory) {
          closeFileWithoutConfirm(pending.path);
        } else {
          // If it's a directory, close any files that were inside it
          state.openFiles.forEach(function(f) {
            if (f.path.startsWith(pending.path)) {
              closeFileWithoutConfirm(f.path);
            }
          });
        }

        // Remove from tree and refresh parent
        var $item = $('.file-tree-item[data-path="' + CSS.escape(pending.path) + '"]');

        if (pending.isDirectory) {
          $item.next('.tree-children').remove();
        }

        $item.remove();

        // Clean up expanded dirs state
        delete state.fileBrowser.expandedDirs[pending.path];

        showToast((pending.isDirectory ? 'Folder' : 'File') + ' deleted', 'success');
        state.pendingDeleteFile = null;
      })
      .fail(function() {
        showToast('Failed to delete ' + (pending.isDirectory ? 'folder' : 'file'), 'error');
      });
  }

  function showCreateFileModal(parentPath) {
    state.pendingCreateFile = { parentPath: parentPath };

    $('#create-file-name').val('');
    $('#create-file-error').addClass('hidden').text('');
    $('#create-file-parent-path').text(parentPath);

    openModal('modal-create-file');

    // Focus the input after modal opens
    setTimeout(function() {
      $('#create-file-name').focus();
    }, 100);
  }

  function confirmCreateFile() {
    if (!state.pendingCreateFile) return;

    var fileName = $('#create-file-name').val();
    var validation = Validators.validateFileName(fileName);

    if (!validation.valid) {
      $('#create-file-error').removeClass('hidden').text(validation.error);
      return;
    }

    var parentPath = state.pendingCreateFile.parentPath;
    var separator = parentPath.indexOf('\\') !== -1 ? '\\' : '/';
    var filePath = parentPath + (parentPath.endsWith(separator) ? '' : separator) + fileName.trim();

    api.writeFile(filePath, '')
      .done(function() {
        closeModal('modal-create-file');
        state.pendingCreateFile = null;

        // Refresh the parent directory to show the new file
        refreshDirectoryContents(parentPath);

        // Open the newly created file
        openFile(filePath, fileName.trim());

        showToast('File created', 'success');
      })
      .fail(function() {
        $('#create-file-error').removeClass('hidden').text('Failed to create file');
      });
  }

  function showCreateFolderModal(parentPath) {
    state.pendingCreateFolder = { parentPath: parentPath };

    $('#create-folder-name').val('');
    $('#create-folder-error').addClass('hidden').text('');
    $('#create-folder-parent-path').text(parentPath);

    openModal('modal-create-folder');

    // Focus the input after modal opens
    setTimeout(function() {
      $('#create-folder-name').focus();
    }, 100);
  }

  function confirmCreateFolder() {
    if (!state.pendingCreateFolder) return;

    var folderName = $('#create-folder-name').val();
    var validation = Validators.validateFolderName(folderName);

    if (!validation.valid) {
      $('#create-folder-error').removeClass('hidden').text(validation.error);
      return;
    }

    var parentPath = state.pendingCreateFolder.parentPath;
    var separator = parentPath.indexOf('\\') !== -1 ? '\\' : '/';
    var folderPath = parentPath + (parentPath.endsWith(separator) ? '' : separator) + folderName.trim();

    api.createFolder(folderPath)
      .done(function() {
        closeModal('modal-create-folder');
        state.pendingCreateFolder = null;

        // Refresh the parent directory to show the new folder
        refreshDirectoryContents(parentPath);

        showToast('Folder created', 'success');
      })
      .fail(function(xhr) {
        var error = 'Failed to create folder';

        if (xhr.responseJSON && xhr.responseJSON.error) {
          error = xhr.responseJSON.error;
        }

        $('#create-folder-error').removeClass('hidden').text(error);
      });
  }

  function refreshDirectoryContents(dirPath) {
    var $item = $('.file-tree-item[data-path="' + CSS.escape(dirPath) + '"]');

    if ($item.length === 0) {
      // It's the root directory, reload entire tree
      var project = findProjectById(state.selectedProjectId);

      if (project && project.path) {
        loadFileTree(project.path);
      }

      return;
    }

    var $children = $item.next('.tree-children');

    // If directory is not expanded, expand it first
    if (!state.fileBrowser.expandedDirs[dirPath]) {
      toggleDirectory(dirPath);
      return;
    }

    // Refresh the directory contents
    api.browseWithFiles(dirPath)
      .done(function(children) {
        if ($children.length) {
          $children.remove();
        }

        var depth = Math.floor(parseInt($item.css('padding-left')) / 16) + 1;
        var childrenHtml = '<div class="tree-children">';
        children.forEach(function(child) {
          childrenHtml += renderFileTreeItem(child, depth);
        });
        childrenHtml += '</div>';
        $item.after(childrenHtml);
      });
  }

  function closeFileWithoutConfirm(filePath) {
    var fileIndex = state.openFiles.findIndex(function(f) { return f.path === filePath; });

    if (fileIndex === -1) return;

    state.openFiles.splice(fileIndex, 1);

    if (state.activeFilePath === filePath) {
      if (state.openFiles.length > 0) {
        var newIndex = Math.min(fileIndex, state.openFiles.length - 1);
        setActiveFile(state.openFiles[newIndex].path);
      } else {
        state.activeFilePath = null;
        state.fileBrowser.selectedFile = null;
        $('#file-editor-empty').removeClass('hidden');
        $('#file-editor-wrapper').addClass('hidden');
        $('.file-tree-item').removeClass('selected');
      }
    }

    renderOpenFileTabs();
  }

  function saveCurrentFile() {
    if (!state.activeFilePath) return;

    var file = state.openFiles.find(function(f) { return f.path === state.activeFilePath; });

    if (!file) return;

    // Get content based on whether we're in preview mode or not
    var content;
    if (file.isMarkdown && file.previewMode) {
      content = file.content; // Use the stored content when in preview mode
    } else {
      content = $('#file-editor-textarea').val();
    }

    api.writeFile(file.path, content)
      .done(function() {
        file.content = content;
        file.originalContent = content;
        file.modified = false;
        updateFileModifiedState(file);
        showToast('File saved', 'success');
      })
      .fail(function() {
        showToast('Failed to save file', 'error');
      });
  }

  function isMobileView() {
    return window.innerWidth <= 768;
  }

  function showMobileFileEditor() {
    if (!isMobileView()) return;

    $('#file-browser-sidebar').addClass('mobile-hidden');
    $('#file-editor-area').addClass('mobile-visible');
    $('#file-editor-mobile-header').removeClass('hidden');
  }

  function hideMobileFileEditor() {
    $('#file-browser-sidebar').removeClass('mobile-hidden');
    $('#file-editor-area').removeClass('mobile-visible');
    $('#file-editor-mobile-header').addClass('hidden');
  }

  function showMobileClaudeFileEditor() {
    if (!isMobileView()) return;

    $('#claude-files-list').addClass('mobile-hidden');
    $('#claude-file-editor-area').addClass('mobile-visible');
    $('#btn-claude-files-back').removeClass('hidden');
  }

  function hideMobileClaudeFileEditor() {
    $('#claude-files-list').removeClass('mobile-hidden');
    $('#claude-file-editor-area').removeClass('mobile-visible');
    $('#btn-claude-files-back').addClass('hidden');
  }

  function searchFiles(searchTerm) {
    if (!searchTerm || !state.fileBrowser.rootEntries) {
      return [];
    }

    var results = [];
    var lowerSearchTerm = searchTerm.toLowerCase();

    function searchInEntries(entries, parentPath) {
      entries.forEach(function(entry) {
        if (entry.name.toLowerCase().indexOf(lowerSearchTerm) !== -1) {
          results.push({
            name: entry.name,
            path: entry.path,
            isDirectory: entry.isDirectory,
            parentPath: parentPath
          });
        }

        if (entry.isDirectory && entry.children) {
          searchInEntries(entry.children, entry.path);
        }
      });
    }

    searchInEntries(state.fileBrowser.rootEntries, '');
    return results;
  }

  function renderSearchResults(results, searchTerm) {
    var $results = $('#file-search-results');
    $results.empty();

    if (results.length === 0) {
      $results.html('<div class="text-gray-500 text-center py-4">No files found for "' + escapeHtml(searchTerm) + '"</div>');
      return;
    }

    $results.html('<div class="text-gray-400 text-xs px-2 py-1 border-b border-gray-700">Found ' + results.length + ' result' + (results.length > 1 ? 's' : '') + '</div>');

    results.forEach(function(result) {
      var icon = result.isDirectory ?
        '<svg class="tree-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>' +
        '</svg>' :
        '<svg class="tree-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>' +
        '</svg>';

      var highlightedName = highlightSearchMatch(result.name, searchTerm);
      var relativePath = result.parentPath ? result.parentPath.replace(/^.*[\\\/]/, '') + '/' : '';

      var $item = $('<div class="file-search-result" data-path="' + escapeHtml(result.path) + '" data-is-dir="' + result.isDirectory + '">' +
        icon +
        '<div class="flex-1 min-w-0">' +
          '<div class="tree-name">' + highlightedName + '</div>' +
          '<div class="text-xs text-gray-500 truncate">' + escapeHtml(relativePath) + '</div>' +
        '</div>' +
      '</div>');

      $results.append($item);
    });
  }

  function highlightSearchMatch(text, searchTerm) {
    if (!searchTerm) return escapeHtml(text);

    var escaped = escapeHtml(text);
    var regex = new RegExp('(' + escapeHtml(searchTerm).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return escaped.replace(regex, '<mark class="bg-yellow-600/30 text-yellow-300">$1</mark>');
  }

  function showSearchMode() {
    $('#file-browser-tree').addClass('hidden');
    $('#file-search-results').removeClass('hidden');
    $('#btn-clear-file-search').removeClass('hidden');
  }

  function hideSearchMode() {
    $('#file-search-results').addClass('hidden');
    $('#file-browser-tree').removeClass('hidden');
    $('#btn-clear-file-search').addClass('hidden');
    $('#file-search-input').val('');
  }

  function expandPathInTree(targetPath) {
    // Split the path and expand each parent directory
    var pathParts = targetPath.split(/[\\\/]/);
    var currentPath = '';
    var separator = targetPath.indexOf('\\') !== -1 ? '\\' : '/';

    // Build and expand each parent path
    for (var i = 0; i < pathParts.length - 1; i++) {
      currentPath += (i > 0 ? separator : '') + pathParts[i];
      if (!state.fileBrowser.expandedDirs[currentPath]) {
        toggleDirectory(currentPath);
      }
    }

    // Select the target item
    state.fileBrowser.selectedFile = targetPath;
    updateTreeSelection();

    // Scroll to the item
    setTimeout(function() {
      var $item = $('.file-tree-item[data-path="' + CSS.escape(targetPath) + '"]');
      if ($item.length) {
        var $container = $('#file-browser-tree');
        var itemTop = $item.position().top;
        var containerHeight = $container.height();

        if (itemTop < 0 || itemTop > containerHeight) {
          $container.scrollTop($container.scrollTop() + itemTop - containerHeight / 2);
        }
      }
    }, 100);
  }

  function setupHandlers() {
    // Click on file tree item (but not on delete button)
    $(document).on('click', '.file-tree-item', function(e) {
      if ($(e.target).closest('.btn-delete-file').length) {
        return; // Handled by delete button handler
      }

      var $item = $(this);
      var path = $item.data('path');
      var isDir = $item.data('is-dir');
      var isEditable = $item.data('editable') === true || $item.data('editable') === 'true';

      if (isDir) {
        toggleDirectory(path);
      } else if (isEditable) {
        var name = $item.find('.tree-name').text();
        openFile(path, name);
      } else {
        showToast('This file type cannot be edited', 'info');
      }
    });

    // Click on delete file/folder button
    $(document).on('click', '.btn-delete-file', function(e) {
      e.stopPropagation();
      var path = $(this).data('path');
      var isDir = $(this).data('is-dir') === true || $(this).data('is-dir') === 'true';
      var name = $(this).data('name');
      showDeleteFileConfirmation(path, isDir, name);
    });

    // Right-click context menu on file tree items
    $(document).on('contextmenu', '.file-tree-item', function(e) {
      e.preventDefault();
      var $item = $(this);
      var path = $item.data('path');
      var isDir = $item.data('is-dir') === true || $item.data('is-dir') === 'true';
      var name = $item.find('.tree-name').text();

      // Store context for delete action
      state.contextMenuTarget = { path: path, isDir: isDir, name: name };

      // Show/hide New File and New Folder options based on whether it's a directory
      if (isDir) {
        $('#context-menu-new-file').removeClass('hidden');
        $('#context-menu-new-folder').removeClass('hidden');
      } else {
        $('#context-menu-new-file').addClass('hidden');
        $('#context-menu-new-folder').addClass('hidden');
      }

      // Position and show context menu
      var $menu = $('#file-context-menu');
      $menu.css({
        top: e.pageY + 'px',
        left: e.pageX + 'px'
      }).removeClass('hidden');

      // Close menu when clicking elsewhere
      $(document).one('click', function() {
        $menu.addClass('hidden');
      });
    });

    // Context menu delete action
    $('#context-menu-delete').on('click', function(e) {
      e.stopPropagation();
      $('#file-context-menu').addClass('hidden');

      if (state.contextMenuTarget) {
        showDeleteFileConfirmation(
          state.contextMenuTarget.path,
          state.contextMenuTarget.isDir,
          state.contextMenuTarget.name
        );
      }
    });

    // Confirm delete file/folder
    $('#btn-confirm-delete-file').on('click', function() {
      confirmDeleteFile();
    });

    // New file button in toolbar
    $('#btn-new-file').on('click', function() {
      var project = findProjectById(state.selectedProjectId);

      if (project && project.path) {
        showCreateFileModal(project.path);
      }
    });

    // Context menu - New File option
    $('#context-menu-new-file').on('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      $('#file-context-menu').addClass('hidden');

      if (state.contextMenuTarget && state.contextMenuTarget.isDir) {
        showCreateFileModal(state.contextMenuTarget.path);
      }
    });

    // Confirm create file button
    $('#btn-confirm-create-file').on('click', function() {
      confirmCreateFile();
    });

    // Enter key in create file input
    $('#create-file-name').on('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmCreateFile();
      }
    });

    // New folder button in toolbar
    $('#btn-new-folder').on('click', function() {
      var project = findProjectById(state.selectedProjectId);

      if (project && project.path) {
        showCreateFolderModal(project.path);
      }
    });

    // Context menu - New Folder option
    $('#context-menu-new-folder').on('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      $('#file-context-menu').addClass('hidden');

      if (state.contextMenuTarget && state.contextMenuTarget.isDir) {
        showCreateFolderModal(state.contextMenuTarget.path);
      }
    });

    // Confirm create folder button
    $('#btn-confirm-create-folder').on('click', function() {
      confirmCreateFolder();
    });

    // Enter key in create folder input
    $('#create-folder-name').on('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmCreateFolder();
      }
    });

    // Click on file tab
    $(document).on('click', '.file-tab', function(e) {
      if ($(e.target).closest('.tab-close').length) return;
      var path = $(this).data('path');
      setActiveFile(path);
    });

    // Click on tab close button
    $(document).on('click', '.tab-close', function(e) {
      e.stopPropagation();
      var path = $(this).data('path');
      closeFile(path);
    });

    // Middle-click on file tab to close it
    $(document).on('mousedown', '.file-tab', function(e) {
      if (e.button === 1) {
        e.preventDefault();
        var path = $(this).data('path');
        closeFile(path);
      }
    });

    // File editor content change
    $('#file-editor-textarea').on('input', function() {
      if (!state.activeFilePath) return;

      var file = state.openFiles.find(function(f) { return f.path === state.activeFilePath; });

      if (!file) return;

      var currentContent = $(this).val();
      file.content = currentContent;
      file.modified = currentContent !== file.originalContent;
      updateFileModifiedState(file);
      updateEditorSyntaxHighlighting(state.activeFilePath, currentContent);
    });

    // Sync scroll between textarea and highlighted backdrop
    $('#file-editor-textarea').on('scroll', function() {
      syncEditorScroll();
    });

    // Save file button
    $('#btn-save-file').on('click', function() {
      saveCurrentFile();
    });

    // Ctrl+S to save
    $('#file-editor-textarea').on('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFile();
      }
    });

    // Refresh files button
    $('#btn-refresh-files').on('click', function() {
      var project = findProjectById(state.selectedProjectId);

      if (project && project.path) {
        state.fileBrowser.expandedDirs = {};
        loadFileTree(project.path);
      }
    });

    // Mobile file editor back button
    $('#btn-file-editor-back').on('click', function() {
      hideMobileFileEditor();
    });

    // Mobile Claude files back button
    $('#btn-claude-files-back').on('click', function() {
      hideMobileClaudeFileEditor();
    });

    // File search input
    var searchTimeout;
    $('#file-search-input').on('input', function() {
      clearTimeout(searchTimeout);
      var searchTerm = $(this).val().trim();

      if (!searchTerm) {
        hideSearchMode();
        return;
      }

      searchTimeout = setTimeout(function() {
        showSearchMode();
        var results = searchFiles(searchTerm);
        renderSearchResults(results, searchTerm);
      }, 300);
    });

    // Clear search button
    $('#btn-clear-file-search').on('click', function() {
      hideSearchMode();
    });

    // Click on search result
    $(document).on('click', '.file-search-result', function() {
      var filePath = $(this).data('path');
      var isDir = $(this).data('is-dir') === true;

      if (!isDir) {
        openFile(filePath);
        if (isMobileView()) {
          showMobileFileEditor();
        }
      } else {
        // For directories, expand the path in the tree and hide search
        expandPathInTree(filePath);
        hideSearchMode();
      }
    });
  }

  function setupDragAndDrop() {
    var draggedElement = null;
    var draggedPath = null;

    // Drag start
    $(document).on('dragstart', '.file-tree-item', function(e) {
      draggedElement = this;
      draggedPath = $(this).attr('data-path');
      e.originalEvent.dataTransfer.effectAllowed = 'move';
      e.originalEvent.dataTransfer.setData('text/plain', draggedPath);
      $(this).addClass('dragging');
    });

    // Drag over - only directories can be drop targets
    $(document).on('dragover', '.file-tree-item.directory', function(e) {
      e.preventDefault();
      e.originalEvent.dataTransfer.dropEffect = 'move';

      var targetPath = $(this).attr('data-path');
      if (isValidDropTarget(draggedPath, targetPath)) {
        $(this).addClass('drag-over');
      }
    });

    // Drag leave
    $(document).on('dragleave', '.file-tree-item.directory', function() {
      $(this).removeClass('drag-over');
    });

    // Drop
    $(document).on('drop', '.file-tree-item.directory', function(e) {
      e.preventDefault();
      e.stopPropagation();

      var targetPath = $(this).attr('data-path');
      $(this).removeClass('drag-over');

      if (draggedPath && isValidDropTarget(draggedPath, targetPath)) {
        moveFileOrFolder(draggedPath, targetPath);
      }
    });

    // Drag end
    $(document).on('dragend', '.file-tree-item', function() {
      $(this).removeClass('dragging');
      $('.drag-over').removeClass('drag-over');
      draggedElement = null;
      draggedPath = null;
    });
  }

  // Validate drop target (prevent dropping parent into child)
  function isValidDropTarget(sourcePath, targetPath) {
    if (!sourcePath || !targetPath) return false;
    if (sourcePath === targetPath) return false;
    if (targetPath.startsWith(sourcePath + '/')) return false;
    return true;
  }

  // Move file/folder via API
  function moveFileOrFolder(sourcePath, targetPath) {
    var fileName = sourcePath.split('/').pop();
    var newPath = targetPath + '/' + fileName;

    $.ajax({
      url: '/api/fs/move',
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({
        sourcePath: sourcePath,
        targetPath: newPath
      })
    }).done(function() {
      showToast('Moved successfully', 'success');
      loadFileTree(state.fileBrowser.rootPath);
    }).fail(function(xhr) {
      showToast('Failed to move: ' + getErrorMessage(xhr), 'error');
    });
  }

  function getErrorMessage(xhr) {
    if (xhr.responseJSON && xhr.responseJSON.error) {
      return xhr.responseJSON.error;
    }
    return xhr.statusText || 'Unknown error';
  }

  function renderMarkdownPreview(file) {
    // Hide code editor container (hides textarea and syntax highlight backdrop)
    $('#code-editor-container').addClass('hidden');

    // Remove existing preview if any
    $('#markdown-preview-container').remove();

    // Create preview container
    var previewHtml = '<div id="markdown-preview-container" class="markdown-preview markdown-content p-4 overflow-auto" style="height: calc(100% - 4rem); background-color: #1f2937; border-radius: 0.375rem;">';

    // Use MessageRenderer to render markdown if available
    if (window.MessageRenderer && MessageRenderer.renderMarkdown) {
      previewHtml += MessageRenderer.renderMarkdown(file.content);
    } else {
      // Fallback to basic rendering
      previewHtml += '<pre>' + escapeHtml(file.content) + '</pre>';
    }

    previewHtml += '</div>';

    // Insert preview after toolbar
    $('#file-editor-toolbar').after(previewHtml);
  }

  function toggleMarkdownPreview(filePath) {
    var file = state.openFiles.find(function(f) { return f.path === filePath; });
    if (file && file.isMarkdown) {
      file.previewMode = !file.previewMode;
      renderOpenFileTabs();
      if (state.activeFilePath === filePath) {
        setActiveFile(filePath);
      }
    }
  }

  // Make toggleMarkdownPreview globally available for onclick
  window.toggleMarkdownPreview = toggleMarkdownPreview;

  function initializeResize() {
    var $sidebar = $('#file-browser-sidebar');
    var $resizeHandle = $('<div class="resize-handle"></div>');
    var $collapseBtn = $('<button class="sidebar-collapse-btn"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg></button>');

    // Add resize handle and collapse button
    $sidebar.append($resizeHandle);
    $sidebar.append($collapseBtn);

    // Get saved width from localStorage
    var savedWidth = localStorage.getItem('file-browser-width');
    if (savedWidth) {
      var width = parseInt(savedWidth, 10);
      if (width >= MIN_WIDTH && width <= MAX_WIDTH) {
        $sidebar.css('width', width + 'px');
      }
    }

    // Handle mouse down on resize handle
    $resizeHandle.on('mousedown', function(e) {
      isResizing = true;
      startX = e.clientX;
      startWidth = parseInt($sidebar.width(), 10);
      $('body').addClass('resizing');
      e.preventDefault();
    });

    // Handle mouse move
    $(document).on('mousemove', function(e) {
      if (!isResizing) return;

      var width = startWidth + (e.clientX - startX);
      width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
      $sidebar.css('width', width + 'px');
    });

    // Handle mouse up
    $(document).on('mouseup', function() {
      if (!isResizing) return;

      isResizing = false;
      $('body').removeClass('resizing');

      // Save width to localStorage
      var width = $('#file-browser-sidebar').width();
      localStorage.setItem('file-browser-width', width);
    });

    // Handle collapse button click
    $collapseBtn.on('click', function() {
      $sidebar.toggleClass('sidebar-collapsed');
      var isCollapsed = $sidebar.hasClass('sidebar-collapsed');
      localStorage.setItem('file-browser-collapsed', isCollapsed ? 'true' : 'false');
    });

    // Restore collapsed state
    var isCollapsed = localStorage.getItem('file-browser-collapsed') === 'true';
    if (isCollapsed && isMobileView()) {
      $sidebar.addClass('sidebar-collapsed');
    }

    // Touch support for resize
    var touchStartX = 0;
    var touchStartWidth = 0;

    $resizeHandle.on('touchstart', function(e) {
      var touch = e.originalEvent.touches[0];
      touchStartX = touch.clientX;
      touchStartWidth = parseInt($sidebar.width(), 10);
      $('body').addClass('resizing');
      e.preventDefault();
    });

    $(document).on('touchmove', function(e) {
      if (touchStartX === 0) return;

      var touch = e.originalEvent.touches[0];
      var width = touchStartWidth + (touch.clientX - touchStartX);
      width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
      $sidebar.css('width', width + 'px');
    });

    $(document).on('touchend touchcancel', function() {
      if (touchStartX === 0) return;

      touchStartX = 0;
      $('body').removeClass('resizing');

      // Save width to localStorage
      var width = $('#file-browser-sidebar').width();
      localStorage.setItem('file-browser-width', width);
    });
  }

  return {
    init: init,
    loadFileTree: loadFileTree,
    openFile: openFile,
    setActiveFile: setActiveFile,
    closeFile: closeFile,
    saveCurrentFile: saveCurrentFile,
    refreshDirectoryContents: refreshDirectoryContents,
    showMobileFileEditor: showMobileFileEditor,
    hideMobileFileEditor: hideMobileFileEditor,
    showMobileClaudeFileEditor: showMobileClaudeFileEditor,
    hideMobileClaudeFileEditor: hideMobileClaudeFileEditor,
    isMobileView: isMobileView,
    setupHandlers: setupHandlers,
    setupDragAndDrop: setupDragAndDrop
  };
}));
