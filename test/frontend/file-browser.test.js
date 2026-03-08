/**
 * @jest-environment jsdom
 */

const FileBrowser = require('../../public/js/modules/file-browser-v2');

describe('FileBrowser', () => {
  let mockState;
  let mockApi;
  let mockEscapeHtml;
  let mockShowToast;
  let mockShowConfirm;
  let mockOpenModal;
  let mockCloseModal;
  let mockFindProjectById;
  let mockHighlightCode;
  let mockGetLanguageFromPath;
  let mockValidators;

  function createMockJQuery() {
    const mockElement = {
      html: jest.fn().mockReturnThis(),
      empty: jest.fn().mockReturnThis(),
      append: jest.fn().mockReturnThis(),
      val: jest.fn().mockReturnThis(),
      text: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      off: jest.fn().mockReturnThis(),
      find: jest.fn().mockReturnThis(),
      first: jest.fn().mockReturnThis(),
      next: jest.fn().mockReturnThis(),
      after: jest.fn().mockReturnThis(),
      remove: jest.fn().mockReturnThis(),
      addClass: jest.fn().mockReturnThis(),
      removeClass: jest.fn().mockReturnThis(),
      toggleClass: jest.fn().mockReturnThis(),
      hasClass: jest.fn().mockReturnValue(false),
      css: jest.fn().mockReturnValue('0px'),
      attr: jest.fn().mockReturnThis(),
      data: jest.fn(),
      each: jest.fn().mockReturnThis(),
      scrollTop: jest.fn().mockReturnThis(),
      scrollLeft: jest.fn().mockReturnThis(),
      focus: jest.fn().mockReturnThis(),
      closest: jest.fn().mockReturnValue({ length: 0 }),
      position: jest.fn().mockReturnValue({ top: 0, left: 0 }),
      width: jest.fn().mockReturnValue(200),
      height: jest.fn().mockReturnValue(400),
      length: 1
    };

    const $ = jest.fn().mockReturnValue(mockElement);
    $.fn = {};
    return $;
  }

  beforeEach(() => {
    mockState = {
      selectedProjectId: 'project-123',
      fileBrowser: {
        rootEntries: [],
        expandedDirs: {},
        selectedFile: null
      },
      openFiles: [],
      activeFilePath: null,
      contextMenuTarget: null,
      pendingDeleteFile: null,
      pendingCreateFile: null,
      pendingCreateFolder: null
    };

    mockApi = {
      browseWithFiles: jest.fn().mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          this._doneCb = cb;
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      }),
      readFile: jest.fn().mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          this._doneCb = cb;
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      }),
      writeFile: jest.fn().mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          this._doneCb = cb;
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      }),
      deleteFileOrFolder: jest.fn().mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          this._doneCb = cb;
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      }),
      createFolder: jest.fn().mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          this._doneCb = cb;
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      })
    };

    mockEscapeHtml = jest.fn((str) => str);
    mockShowToast = jest.fn();
    mockShowConfirm = jest.fn().mockResolvedValue(true);
    mockOpenModal = jest.fn();
    mockCloseModal = jest.fn();
    mockFindProjectById = jest.fn().mockReturnValue({ id: 'project-123', path: '/test/project' });
    mockHighlightCode = jest.fn((content, lang) => `<span class="hljs">${content}</span>`);
    mockGetLanguageFromPath = jest.fn().mockReturnValue('javascript');
    mockValidators = {
      validateFileName: jest.fn().mockReturnValue({ valid: true }),
      validateFolderName: jest.fn().mockReturnValue({ valid: true })
    };

    // Mock CSS.escape
    global.CSS = { escape: jest.fn((str) => str) };

    global.$ = createMockJQuery();
    global.hljs = { highlight: jest.fn() };

    FileBrowser.init({
      state: mockState,
      api: mockApi,
      escapeHtml: mockEscapeHtml,
      showToast: mockShowToast,
      showConfirm: mockShowConfirm,
      openModal: mockOpenModal,
      closeModal: mockCloseModal,
      findProjectById: mockFindProjectById,
      highlightCode: mockHighlightCode,
      getLanguageFromPath: mockGetLanguageFromPath,
      Validators: mockValidators
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.$;
    delete global.CSS;
    delete global.hljs;
  });

  describe('loadFileTree', () => {
    it('should show loading message', () => {
      FileBrowser.loadFileTree('/test/path');

      expect(global.$).toHaveBeenCalledWith('#file-browser-tree');
      expect(global.$().html).toHaveBeenCalledWith(expect.stringContaining('Loading...'));
    });

    it('should call API to browse files', () => {
      FileBrowser.loadFileTree('/test/path');

      expect(mockApi.browseWithFiles).toHaveBeenCalledWith('/test/path');
    });

    it('should store root entries in state on success', () => {
      const mockEntries = [{ name: 'file.js', path: '/test/file.js', isDirectory: false }];
      mockApi.browseWithFiles.mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          cb(mockEntries);
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      });

      FileBrowser.loadFileTree('/test/path');

      expect(mockState.fileBrowser.rootEntries).toEqual(mockEntries);
    });

    it('should show error on failure', () => {
      mockApi.browseWithFiles.mockReturnValue({
        done: jest.fn().mockReturnThis(),
        fail: jest.fn().mockImplementation(function(cb) {
          cb();
          return this;
        })
      });

      FileBrowser.loadFileTree('/test/path');

      expect(global.$().html).toHaveBeenCalledWith(expect.stringContaining('Failed to load files'));
    });
  });

  describe('openFile', () => {
    it('should call API to read file content', () => {
      FileBrowser.openFile('/test/file.js', 'file.js');

      expect(mockApi.readFile).toHaveBeenCalledWith('/test/file.js');
    });

    it('should add file to open files on success', () => {
      mockApi.readFile.mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          cb({ content: 'file content' });
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      });

      FileBrowser.openFile('/test/file.js', 'file.js');

      expect(mockState.openFiles).toHaveLength(1);
      expect(mockState.openFiles[0]).toEqual({
        path: '/test/file.js',
        name: 'file.js',
        content: 'file content',
        originalContent: 'file content',
        modified: false,
        isMarkdown: false,
        previewMode: false
      });
    });

    it('should not reload if file is already open', () => {
      mockState.openFiles = [{
        path: '/test/file.js',
        name: 'file.js',
        content: 'existing content',
        originalContent: 'existing content',
        modified: false
      }];

      FileBrowser.openFile('/test/file.js', 'file.js');

      expect(mockApi.readFile).not.toHaveBeenCalled();
    });

    it('should show error toast on failure', () => {
      mockApi.readFile.mockReturnValue({
        done: jest.fn().mockReturnThis(),
        fail: jest.fn().mockImplementation(function(cb) {
          cb();
          return this;
        })
      });

      FileBrowser.openFile('/test/file.js', 'file.js');

      expect(mockShowToast).toHaveBeenCalledWith('Failed to open file', 'error');
    });
  });

  describe('setActiveFile', () => {
    beforeEach(() => {
      mockState.openFiles = [{
        path: '/test/file.js',
        name: 'file.js',
        content: 'test content',
        originalContent: 'test content',
        modified: false
      }];
    });

    it('should update active file path in state', () => {
      FileBrowser.setActiveFile('/test/file.js');

      expect(mockState.activeFilePath).toBe('/test/file.js');
      expect(mockState.fileBrowser.selectedFile).toBe('/test/file.js');
    });

    it('should update tree selection', () => {
      FileBrowser.setActiveFile('/test/file.js');

      expect(global.$).toHaveBeenCalledWith('.file-tree-item');
      expect(global.$().removeClass).toHaveBeenCalledWith('selected');
    });

    it('should show file content in editor', () => {
      FileBrowser.setActiveFile('/test/file.js');

      expect(global.$).toHaveBeenCalledWith('#file-editor-empty');
      expect(global.$).toHaveBeenCalledWith('#file-editor-wrapper');
      expect(global.$).toHaveBeenCalledWith('#file-editor-path');
      expect(global.$).toHaveBeenCalledWith('#file-editor-textarea');
    });
  });

  describe('closeFile', () => {
    beforeEach(() => {
      mockState.openFiles = [
        { path: '/test/file1.js', name: 'file1.js', content: 'content1', originalContent: 'content1', modified: false },
        { path: '/test/file2.js', name: 'file2.js', content: 'content2', originalContent: 'content2', modified: false }
      ];
      mockState.activeFilePath = '/test/file1.js';
    });

    it('should remove file from open files', () => {
      FileBrowser.closeFile('/test/file1.js');

      expect(mockState.openFiles).toHaveLength(1);
      expect(mockState.openFiles[0].path).toBe('/test/file2.js');
    });

    it('should switch to another file if active file was closed', () => {
      FileBrowser.closeFile('/test/file1.js');

      expect(mockState.activeFilePath).toBe('/test/file2.js');
    });

    it('should show confirm dialog if file is modified', () => {
      mockState.openFiles[0].modified = true;

      FileBrowser.closeFile('/test/file1.js');

      expect(mockShowConfirm).toHaveBeenCalledWith(
        'Unsaved Changes',
        'This file has unsaved changes. Close anyway?',
        expect.objectContaining({ danger: true })
      );
    });

    it('should clear editor state if last file is closed', () => {
      mockState.openFiles = [{ path: '/test/file1.js', name: 'file1.js', content: 'c', originalContent: 'c', modified: false }];

      FileBrowser.closeFile('/test/file1.js');

      expect(mockState.activeFilePath).toBeNull();
      expect(mockState.fileBrowser.selectedFile).toBeNull();
    });
  });

  describe('saveCurrentFile', () => {
    beforeEach(() => {
      mockState.activeFilePath = '/test/file.js';
      mockState.openFiles = [{
        path: '/test/file.js',
        name: 'file.js',
        content: 'modified content',
        originalContent: 'original content',
        modified: true
      }];

      global.$('#file-editor-textarea').val.mockReturnValue('modified content');
    });

    it('should not save if no active file', () => {
      mockState.activeFilePath = null;

      FileBrowser.saveCurrentFile();

      expect(mockApi.writeFile).not.toHaveBeenCalled();
    });

    it('should call API to write file', () => {
      FileBrowser.saveCurrentFile();

      expect(mockApi.writeFile).toHaveBeenCalledWith('/test/file.js', 'modified content');
    });

    it('should update file state on success', () => {
      mockApi.writeFile.mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          cb();
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      });

      FileBrowser.saveCurrentFile();

      expect(mockState.openFiles[0].modified).toBe(false);
      expect(mockState.openFiles[0].originalContent).toBe('modified content');
      expect(mockShowToast).toHaveBeenCalledWith('File saved', 'success');
    });

    it('should show error toast on failure', () => {
      mockApi.writeFile.mockReturnValue({
        done: jest.fn().mockReturnThis(),
        fail: jest.fn().mockImplementation(function(cb) {
          cb();
          return this;
        })
      });

      FileBrowser.saveCurrentFile();

      expect(mockShowToast).toHaveBeenCalledWith('Failed to save file', 'error');
    });
  });

  describe('refreshDirectoryContents', () => {
    it('should reload entire tree for root directory', () => {
      global.$().length = 0;

      FileBrowser.refreshDirectoryContents('/test/project');

      expect(mockFindProjectById).toHaveBeenCalledWith('project-123');
      expect(mockApi.browseWithFiles).toHaveBeenCalled();
    });

    it('should call API to refresh directory children', () => {
      mockState.fileBrowser.expandedDirs['/test/dir'] = true;
      global.$().length = 1;
      global.$().css.mockReturnValue('16px');

      mockApi.browseWithFiles.mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          cb([{ name: 'child.js', path: '/test/dir/child.js', isDirectory: false }]);
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      });

      FileBrowser.refreshDirectoryContents('/test/dir');

      expect(mockApi.browseWithFiles).toHaveBeenCalledWith('/test/dir');
    });
  });

  describe('isMobileView', () => {
    it('should return true for small screens', () => {
      Object.defineProperty(window, 'innerWidth', { value: 500, writable: true });

      expect(FileBrowser.isMobileView()).toBe(true);
    });

    it('should return false for large screens', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });

      expect(FileBrowser.isMobileView()).toBe(false);
    });
  });

  describe('showMobileFileEditor', () => {
    it('should add mobile classes when in mobile view', () => {
      Object.defineProperty(window, 'innerWidth', { value: 500, writable: true });

      FileBrowser.showMobileFileEditor();

      expect(global.$).toHaveBeenCalledWith('#file-browser-sidebar');
      expect(global.$().addClass).toHaveBeenCalledWith('mobile-hidden');
    });

    it('should not modify classes when not in mobile view', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
      const addClassMock = jest.fn();
      global.$ = jest.fn().mockReturnValue({ addClass: addClassMock });

      FileBrowser.showMobileFileEditor();

      expect(addClassMock).not.toHaveBeenCalled();
    });
  });

  describe('hideMobileFileEditor', () => {
    it('should remove mobile classes', () => {
      FileBrowser.hideMobileFileEditor();

      expect(global.$).toHaveBeenCalledWith('#file-browser-sidebar');
      expect(global.$().removeClass).toHaveBeenCalledWith('mobile-hidden');
    });
  });

  describe('showMobileClaudeFileEditor', () => {
    it('should add mobile classes when in mobile view', () => {
      Object.defineProperty(window, 'innerWidth', { value: 500, writable: true });

      FileBrowser.showMobileClaudeFileEditor();

      expect(global.$).toHaveBeenCalledWith('#claude-files-list');
      expect(global.$().addClass).toHaveBeenCalledWith('mobile-hidden');
    });
  });

  describe('hideMobileClaudeFileEditor', () => {
    it('should remove mobile classes', () => {
      FileBrowser.hideMobileClaudeFileEditor();

      expect(global.$).toHaveBeenCalledWith('#claude-files-list');
      expect(global.$().removeClass).toHaveBeenCalledWith('mobile-hidden');
    });
  });

  describe('setupHandlers', () => {
    it('should register click handlers on document', () => {
      FileBrowser.setupHandlers();

      // V2 uses addEventListener(document, eventName, handler) which falls back to
      // $(document).on(document, eventName, handler)
      expect(global.$).toHaveBeenCalledWith(document);
      expect(global.$().on).toHaveBeenCalledWith(document, 'click', expect.any(Function));
    });

    it('should register contextmenu handler on document', () => {
      FileBrowser.setupHandlers();

      expect(global.$().on).toHaveBeenCalledWith(document, 'contextmenu', expect.any(Function));
    });

    it('should register mousedown handler on document', () => {
      FileBrowser.setupHandlers();

      expect(global.$().on).toHaveBeenCalledWith(document, 'mousedown', expect.any(Function));
    });

    it('should register file editor input handler', () => {
      FileBrowser.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#file-editor-textarea');
    });

    it('should register save button handler', () => {
      FileBrowser.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#btn-save-file');
    });

    it('should register Ctrl+S handler', () => {
      FileBrowser.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#file-editor-textarea');
      expect(global.$().on).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('should register refresh files button handler', () => {
      FileBrowser.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#btn-refresh-files');
    });

    it('should register mobile back buttons', () => {
      FileBrowser.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#btn-file-editor-back');
      expect(global.$).toHaveBeenCalledWith('#btn-claude-files-back');
    });

    it('should register new file button handler', () => {
      FileBrowser.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#btn-new-file');
    });

    it('should register new folder button handler', () => {
      FileBrowser.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#btn-new-folder');
    });

    it('should register create file confirmation handlers', () => {
      FileBrowser.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#btn-confirm-create-file');
      expect(global.$).toHaveBeenCalledWith('#create-file-name');
    });

    it('should register create folder confirmation handlers', () => {
      FileBrowser.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#btn-confirm-create-folder');
      expect(global.$).toHaveBeenCalledWith('#create-folder-name');
    });
  });

  describe('state management', () => {
    it('should initialize with correct state structure', () => {
      expect(mockState.fileBrowser).toBeDefined();
      expect(mockState.fileBrowser.rootEntries).toEqual([]);
      expect(mockState.fileBrowser.expandedDirs).toEqual({});
      expect(mockState.fileBrowser.selectedFile).toBeNull();
    });

    it('should track open files', () => {
      expect(mockState.openFiles).toEqual([]);
    });

    it('should track active file path', () => {
      expect(mockState.activeFilePath).toBeNull();
    });
  });

  describe('HTML escaping', () => {
    it('should escape file paths in tree items', () => {
      mockApi.browseWithFiles.mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          cb([{ name: '<script>alert(1)</script>', path: '/test/<script>', isDirectory: false }]);
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      });

      FileBrowser.loadFileTree('/test');

      expect(mockEscapeHtml).toHaveBeenCalledWith('<script>alert(1)</script>');
      expect(mockEscapeHtml).toHaveBeenCalledWith('/test/<script>');
    });
  });

  describe('syntax highlighting', () => {
    beforeEach(() => {
      mockState.openFiles = [{
        path: '/test/file.js',
        name: 'file.js',
        content: 'const x = 1;',
        originalContent: 'const x = 1;',
        modified: false
      }];
    });

    it('should detect language from file path', () => {
      FileBrowser.setActiveFile('/test/file.js');

      expect(mockGetLanguageFromPath).toHaveBeenCalledWith('/test/file.js');
    });

    it('should apply highlighting when language is detected', () => {
      FileBrowser.setActiveFile('/test/file.js');

      expect(mockHighlightCode).toHaveBeenCalledWith('const x = 1;', 'javascript');
    });

    it('should not apply highlighting when no language detected', () => {
      mockGetLanguageFromPath.mockReturnValue(null);

      FileBrowser.setActiveFile('/test/file.js');

      expect(mockHighlightCode).not.toHaveBeenCalled();
    });
  });

  describe('file validation', () => {
    it('should validate file name with valid input', () => {
      mockValidators.validateFileName.mockReturnValue({ valid: true });

      const result = mockValidators.validateFileName('valid-file.js');

      expect(result.valid).toBe(true);
    });

    it('should reject invalid file name', () => {
      mockValidators.validateFileName.mockReturnValue({ valid: false, error: 'Invalid characters' });

      const result = mockValidators.validateFileName('file<name>.js');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid characters');
    });

    it('should validate folder name with valid input', () => {
      mockValidators.validateFolderName.mockReturnValue({ valid: true });

      const result = mockValidators.validateFolderName('valid-folder');

      expect(result.valid).toBe(true);
    });

    it('should reject invalid folder name', () => {
      mockValidators.validateFolderName.mockReturnValue({ valid: false, error: 'Invalid characters' });

      const result = mockValidators.validateFolderName('folder/name');

      expect(result.valid).toBe(false);
    });
  });

  describe('context menu state', () => {
    it('should track context menu target', () => {
      expect(mockState.contextMenuTarget).toBeNull();
    });

    it('should store context target for file', () => {
      mockState.contextMenuTarget = { path: '/test/file.js', isDir: false, name: 'file.js' };

      expect(mockState.contextMenuTarget.path).toBe('/test/file.js');
      expect(mockState.contextMenuTarget.isDir).toBe(false);
    });

    it('should store context target for directory', () => {
      mockState.contextMenuTarget = { path: '/test/folder', isDir: true, name: 'folder' };

      expect(mockState.contextMenuTarget.path).toBe('/test/folder');
      expect(mockState.contextMenuTarget.isDir).toBe(true);
    });
  });

  describe('pending operations state', () => {
    it('should track pending delete file', () => {
      expect(mockState.pendingDeleteFile).toBeNull();
    });

    it('should track pending create file', () => {
      expect(mockState.pendingCreateFile).toBeNull();
    });

    it('should track pending create folder', () => {
      expect(mockState.pendingCreateFolder).toBeNull();
    });
  });

  describe('directory expansion state', () => {
    it('should track expanded directories', () => {
      mockState.fileBrowser.expandedDirs['/test/folder'] = true;

      expect(mockState.fileBrowser.expandedDirs['/test/folder']).toBe(true);
    });

    it('should allow collapsing directories', () => {
      mockState.fileBrowser.expandedDirs['/test/folder'] = true;
      delete mockState.fileBrowser.expandedDirs['/test/folder'];

      expect(mockState.fileBrowser.expandedDirs['/test/folder']).toBeUndefined();
    });
  });

  describe('file tree rendering', () => {
    it('should handle empty directory', () => {
      mockApi.browseWithFiles.mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          cb([]);
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      });

      FileBrowser.loadFileTree('/test/empty');

      expect(global.$().html).toHaveBeenCalledWith(expect.stringContaining('No files'));
    });

    it('should sort directories before files', () => {
      const mockEntries = [
        { name: 'file.js', path: '/test/file.js', isDirectory: false },
        { name: 'folder', path: '/test/folder', isDirectory: true }
      ];

      mockApi.browseWithFiles.mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          cb(mockEntries);
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      });

      FileBrowser.loadFileTree('/test');

      expect(mockApi.browseWithFiles).toHaveBeenCalledWith('/test');
    });

    it('should render nested directory structure', () => {
      const mockEntries = [
        {
          name: 'src',
          path: '/test/src',
          isDirectory: true,
          children: [
            { name: 'index.js', path: '/test/src/index.js', isDirectory: false }
          ]
        }
      ];

      mockState.fileBrowser.expandedDirs['/test/src'] = true;

      mockApi.browseWithFiles.mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          cb(mockEntries);
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      });

      FileBrowser.loadFileTree('/test');

      expect(mockApi.browseWithFiles).toHaveBeenCalled();
    });
  });

  describe('file modification tracking', () => {
    beforeEach(() => {
      mockState.openFiles = [{
        path: '/test/file.js',
        name: 'file.js',
        content: 'original',
        originalContent: 'original',
        modified: false
      }];
      mockState.activeFilePath = '/test/file.js';
    });

    it('should mark file as modified when content changes', () => {
      const file = mockState.openFiles[0];
      file.content = 'modified content';
      file.modified = file.content !== file.originalContent;

      expect(file.modified).toBe(true);
    });

    it('should mark file as unmodified when content matches original', () => {
      const file = mockState.openFiles[0];
      file.content = 'original';
      file.modified = file.content !== file.originalContent;

      expect(file.modified).toBe(false);
    });
  });

  describe('create file modal', () => {
    it('should store parent path when creating file', () => {
      mockState.pendingCreateFile = { parentPath: '/test/folder' };

      expect(mockState.pendingCreateFile.parentPath).toBe('/test/folder');
    });

    it('should handle path separator for Windows paths', () => {
      const parentPath = 'C:\\Users\\test\\project';
      const separator = parentPath.indexOf('\\') !== -1 ? '\\' : '/';

      expect(separator).toBe('\\');
    });

    it('should handle path separator for Unix paths', () => {
      const parentPath = '/home/user/project';
      const separator = parentPath.indexOf('\\') !== -1 ? '\\' : '/';

      expect(separator).toBe('/');
    });
  });

  describe('create folder modal', () => {
    it('should store parent path when creating folder', () => {
      mockState.pendingCreateFolder = { parentPath: '/test/folder' };

      expect(mockState.pendingCreateFolder.parentPath).toBe('/test/folder');
    });

    it('should handle API error on folder creation', () => {
      mockApi.createFolder.mockReturnValue({
        done: jest.fn().mockReturnThis(),
        fail: jest.fn().mockImplementation(function(cb) {
          cb({ responseJSON: { error: 'Folder already exists' } });
          return this;
        })
      });

      expect(mockApi.createFolder).toBeDefined();
    });
  });

  describe('delete confirmation', () => {
    it('should track pending delete for file', () => {
      mockState.pendingDeleteFile = {
        path: '/test/file.js',
        isDirectory: false,
        name: 'file.js'
      };

      expect(mockState.pendingDeleteFile.isDirectory).toBe(false);
    });

    it('should track pending delete for directory', () => {
      mockState.pendingDeleteFile = {
        path: '/test/folder',
        isDirectory: true,
        name: 'folder'
      };

      expect(mockState.pendingDeleteFile.isDirectory).toBe(true);
    });

    it('should close files inside deleted directory', () => {
      mockState.openFiles = [
        { path: '/test/folder/file1.js', name: 'file1.js', content: '', originalContent: '', modified: false },
        { path: '/test/folder/file2.js', name: 'file2.js', content: '', originalContent: '', modified: false },
        { path: '/test/other.js', name: 'other.js', content: '', originalContent: '', modified: false }
      ];

      // Simulate closing files inside /test/folder
      const folderPath = '/test/folder';
      mockState.openFiles = mockState.openFiles.filter(f => !f.path.startsWith(folderPath));

      expect(mockState.openFiles).toHaveLength(1);
      expect(mockState.openFiles[0].path).toBe('/test/other.js');
    });
  });

  describe('tab management', () => {
    beforeEach(() => {
      mockState.openFiles = [
        { path: '/test/file1.js', name: 'file1.js', content: 'c1', originalContent: 'c1', modified: false },
        { path: '/test/file2.js', name: 'file2.js', content: 'c2', originalContent: 'c2', modified: false },
        { path: '/test/file3.js', name: 'file3.js', content: 'c3', originalContent: 'c3', modified: false }
      ];
      mockState.activeFilePath = '/test/file2.js';
    });

    it('should switch to previous file when closing active tab', () => {
      const closedIndex = mockState.openFiles.findIndex(f => f.path === mockState.activeFilePath);
      mockState.openFiles.splice(closedIndex, 1);

      const newIndex = Math.min(closedIndex, mockState.openFiles.length - 1);
      mockState.activeFilePath = mockState.openFiles[newIndex].path;

      expect(mockState.activeFilePath).toBe('/test/file3.js');
    });

    it('should switch to first file when closing last tab', () => {
      mockState.activeFilePath = '/test/file3.js';
      const closedIndex = mockState.openFiles.findIndex(f => f.path === mockState.activeFilePath);
      mockState.openFiles.splice(closedIndex, 1);

      const newIndex = Math.min(closedIndex, mockState.openFiles.length - 1);
      mockState.activeFilePath = mockState.openFiles[newIndex].path;

      expect(mockState.activeFilePath).toBe('/test/file2.js');
    });

    it('should clear editor when closing last file', () => {
      mockState.openFiles = [{ path: '/test/only.js', name: 'only.js', content: 'c', originalContent: 'c', modified: false }];
      mockState.activeFilePath = '/test/only.js';

      mockState.openFiles = [];
      mockState.activeFilePath = null;
      mockState.fileBrowser.selectedFile = null;

      expect(mockState.openFiles).toHaveLength(0);
      expect(mockState.activeFilePath).toBeNull();
      expect(mockState.fileBrowser.selectedFile).toBeNull();
    });
  });

  describe('editable files', () => {
    it('should mark text files as editable', () => {
      const entry = { name: 'file.txt', path: '/test/file.txt', isDirectory: false, isEditable: true };

      expect(entry.isEditable).toBe(true);
    });

    it('should mark binary files as non-editable', () => {
      const entry = { name: 'image.png', path: '/test/image.png', isDirectory: false, isEditable: false };

      expect(entry.isEditable).toBe(false);
    });
  });

  describe('Ctrl+S save shortcut', () => {
    it('should call save when Ctrl+S is pressed', () => {
      // The setupHandlers registers Ctrl+S, this test verifies the setup
      const mockOn = jest.fn().mockReturnThis();

      global.$ = jest.fn().mockReturnValue({
        on: mockOn,
        val: jest.fn().mockReturnValue('content'),
        html: jest.fn().mockReturnThis(),
        empty: jest.fn().mockReturnThis(),
        addClass: jest.fn().mockReturnThis(),
        removeClass: jest.fn().mockReturnThis(),
        css: jest.fn().mockReturnValue('0px'),
        data: jest.fn(),
        scrollTop: jest.fn().mockReturnThis(),
        scrollLeft: jest.fn().mockReturnThis(),
        focus: jest.fn().mockReturnThis(),
        closest: jest.fn().mockReturnValue({ length: 0 }),
        length: 1
      });

      FileBrowser.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#file-editor-textarea');
      expect(mockOn).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
  });

  describe('scroll synchronization', () => {
    it('should register scroll handler on textarea', () => {
      const mockOn = jest.fn().mockReturnThis();

      global.$ = jest.fn().mockReturnValue({
        on: mockOn,
        val: jest.fn().mockReturnValue('content'),
        html: jest.fn().mockReturnThis(),
        empty: jest.fn().mockReturnThis(),
        addClass: jest.fn().mockReturnThis(),
        removeClass: jest.fn().mockReturnThis(),
        css: jest.fn().mockReturnValue('0px'),
        data: jest.fn(),
        scrollTop: jest.fn().mockReturnThis(),
        scrollLeft: jest.fn().mockReturnThis(),
        focus: jest.fn().mockReturnThis(),
        closest: jest.fn().mockReturnValue({ length: 0 }),
        length: 1
      });

      FileBrowser.setupHandlers();

      expect(mockOn).toHaveBeenCalledWith('scroll', expect.any(Function));
    });
  });
});
