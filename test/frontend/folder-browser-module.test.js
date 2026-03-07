/**
 * @jest-environment jsdom
 */

const FolderBrowserModule = require('../../public/js/modules/folder-browser-module');

describe('FolderBrowserModule', () => {
  let mockState;
  let mockApi;
  let mockEscapeHtml;
  let mockOpenModal;
  let mockCloseModal;
  let mockShowToast;

  function createMockJQuery() {
    const mockElement = {
      html: jest.fn().mockReturnThis(),
      empty: jest.fn().mockReturnThis(),
      append: jest.fn().mockReturnThis(),
      val: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      data: jest.fn(),
      prop: jest.fn().mockReturnThis(),
    };

    return jest.fn().mockReturnValue(mockElement);
  }

  beforeEach(() => {
    mockState = {
      folderBrowser: {
        currentPath: null
      }
    };

    mockApi = {
      getDrives: jest.fn().mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          this._doneCb = cb;
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      }),
      browseFolder: jest.fn().mockReturnValue({
        done: jest.fn().mockImplementation(function(cb) {
          this._doneCb = cb;
          return this;
        }),
        fail: jest.fn().mockReturnThis()
      })
    };

    mockEscapeHtml = jest.fn((str) => str);
    mockOpenModal = jest.fn();
    mockCloseModal = jest.fn();
    mockShowToast = jest.fn();

    global.$ = createMockJQuery();

    FolderBrowserModule.init({
      state: mockState,
      api: mockApi,
      escapeHtml: mockEscapeHtml,
      openModal: mockOpenModal,
      closeModal: mockCloseModal,
      showToast: mockShowToast
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getFolderIcon', () => {
    it('should return folder SVG with yellow color', () => {
      const icon = FolderBrowserModule.getFolderIcon();

      expect(icon).toContain('svg');
      expect(icon).toContain('text-yellow-500');
      expect(icon).toContain('M3 7v10');
    });
  });

  describe('getFileIcon', () => {
    it('should return file SVG with gray color', () => {
      const icon = FolderBrowserModule.getFileIcon();

      expect(icon).toContain('svg');
      expect(icon).toContain('text-gray-400');
      expect(icon).toContain('M9 12h6');
    });
  });

  describe('splitPath', () => {
    it('should split Windows path correctly', () => {
      const parts = FolderBrowserModule.splitPath('C:\\Users\\test\\folder');

      expect(parts).toEqual(['C:', 'Users', 'test', 'folder']);
    });

    it('should split Unix path correctly', () => {
      const parts = FolderBrowserModule.splitPath('/home/user/folder');

      expect(parts).toEqual(['home', 'user', 'folder']);
    });

    it('should filter empty parts', () => {
      const parts = FolderBrowserModule.splitPath('C:\\\\Users\\\\');

      expect(parts).toEqual(['C:', 'Users']);
    });
  });

  describe('extractFolderName', () => {
    it('should extract folder name from path', () => {
      const name = FolderBrowserModule.extractFolderName('C:\\Users\\test\\myproject');

      expect(name).toBe('myproject');
    });

    it('should return empty string for empty path', () => {
      const name = FolderBrowserModule.extractFolderName('');

      expect(name).toBe('');
    });

    it('should handle root drive', () => {
      const name = FolderBrowserModule.extractFolderName('C:');

      expect(name).toBe('C:');
    });
  });

  describe('updateSelectedPathDisplay', () => {
    it('should show current folder when path set', () => {
      mockState.folderBrowser.currentPath = 'C:\\test\\folder';
      const mockEl = global.$();

      FolderBrowserModule.updateSelectedPathDisplay();

      expect(global.$).toHaveBeenCalledWith('#selected-path');
      expect(mockEl.html).toHaveBeenCalledWith(
        expect.stringContaining('Current folder:')
      );
      expect(mockEscapeHtml).toHaveBeenCalledWith('C:\\test\\folder');
    });

    it('should enable new folder button when path set', () => {
      mockState.folderBrowser.currentPath = 'C:\\test\\folder';
      const mockEl = global.$();

      FolderBrowserModule.updateSelectedPathDisplay();

      expect(global.$).toHaveBeenCalledWith('#btn-folder-browser-new-folder');
      expect(mockEl.prop).toHaveBeenCalledWith('disabled', false);
    });

    it('should show placeholder when no path', () => {
      mockState.folderBrowser.currentPath = null;
      const mockEl = global.$();

      FolderBrowserModule.updateSelectedPathDisplay();

      expect(mockEl.html).toHaveBeenCalledWith(
        expect.stringContaining('Navigate to a folder')
      );
    });

    it('should disable new folder button when no path', () => {
      mockState.folderBrowser.currentPath = null;
      const mockEl = global.$();

      FolderBrowserModule.updateSelectedPathDisplay();

      expect(global.$).toHaveBeenCalledWith('#btn-folder-browser-new-folder');
      expect(mockEl.prop).toHaveBeenCalledWith('disabled', true);
    });
  });

  describe('renderFolderItem', () => {
    it('should render folder with folder icon', () => {
      const html = FolderBrowserModule.renderFolderItem('test', '/path/test', true);

      expect(html).toContain('folder-item');
      expect(html).toContain('data-path="/path/test"');
      expect(html).toContain('text-yellow-500');
      expect(mockEscapeHtml).toHaveBeenCalledWith('/path/test');
      expect(mockEscapeHtml).toHaveBeenCalledWith('test');
    });

    it('should render file with file icon', () => {
      const html = FolderBrowserModule.renderFolderItem('file.txt', '/path/file.txt', false);

      expect(html).toContain('text-gray-400');
      expect(mockEscapeHtml).toHaveBeenCalledWith('file.txt');
    });
  });

  describe('renderBreadcrumb', () => {
    it('should render only Drives when path is null', () => {
      const mockBreadcrumb = global.$();

      FolderBrowserModule.renderBreadcrumb(null);

      expect(global.$).toHaveBeenCalledWith('#folder-breadcrumb');
      expect(mockBreadcrumb.empty).toHaveBeenCalled();
      expect(mockBreadcrumb.append).toHaveBeenCalledWith(
        expect.stringContaining('Drives')
      );
    });

    it('should render path segments when path provided', () => {
      const mockBreadcrumb = global.$();

      FolderBrowserModule.renderBreadcrumb('C:\\Users\\test');

      // Should have multiple appends: Drives + separator + path parts
      expect(mockBreadcrumb.append).toHaveBeenCalledTimes(7);
    });
  });

  describe('renderFolderEntries', () => {
    it('should render empty message when no entries', () => {
      const mockBrowser = global.$();

      FolderBrowserModule.renderFolderEntries([], '/path');

      expect(mockBrowser.html).toHaveBeenCalledWith(
        expect.stringContaining('No subfolders')
      );
    });

    it('should render entries when provided', () => {
      const mockBrowser = {
        empty: jest.fn().mockReturnThis(),
        append: jest.fn().mockReturnThis(),
      };

      global.$ = jest.fn((selector) => {
        if (selector === '#folder-browser') {
          return mockBrowser;
        }

        return createMockJQuery()();
      });

      const entries = [
        { name: 'folder1', path: '/path/folder1', isDirectory: true },
        { name: 'folder2', path: '/path/folder2', isDirectory: true }
      ];

      FolderBrowserModule.renderFolderEntries(entries, '/path');

      expect(mockBrowser.append).toHaveBeenCalledTimes(2);
    });
  });

  describe('renderDrives', () => {
    it('should render drive list', () => {
      const mockBrowser = {
        empty: jest.fn().mockReturnThis(),
        append: jest.fn().mockReturnThis(),
      };

      global.$ = jest.fn((selector) => {
        if (selector === '#folder-browser') {
          return mockBrowser;
        }

        return createMockJQuery()();
      });

      const drives = [
        { name: 'C:', path: 'C:' },
        { name: 'D:', path: 'D:' }
      ];

      FolderBrowserModule.renderDrives(drives);

      expect(mockBrowser.empty).toHaveBeenCalled();
      expect(mockBrowser.append).toHaveBeenCalledTimes(2);
    });
  });

  describe('loadDrives', () => {
    it('should show loading message and call API', () => {
      const mockBrowser = global.$();

      FolderBrowserModule.loadDrives();

      expect(mockBrowser.html).toHaveBeenCalledWith(
        expect.stringContaining('Loading drives...')
      );
      expect(mockApi.getDrives).toHaveBeenCalled();
    });
  });

  describe('loadFolder', () => {
    it('should update state and call API', () => {
      FolderBrowserModule.loadFolder('/test/path');

      expect(mockState.folderBrowser.currentPath).toBe('/test/path');
      expect(mockApi.browseFolder).toHaveBeenCalledWith('/test/path');
    });

    it('should show loading message', () => {
      const mockBrowser = global.$();

      FolderBrowserModule.loadFolder('/test/path');

      expect(mockBrowser.html).toHaveBeenCalledWith(
        expect.stringContaining('Loading...')
      );
    });
  });

  describe('open', () => {
    it('should reset state and open modal', () => {
      mockState.folderBrowser.currentPath = '/some/path';

      FolderBrowserModule.open();

      expect(mockState.folderBrowser.currentPath).toBeNull();
      expect(mockOpenModal).toHaveBeenCalledWith('modal-folder-browser');
      expect(mockApi.getDrives).toHaveBeenCalled();
    });
  });

  describe('confirmSelection', () => {
    it('should show error when no path selected', () => {
      mockState.folderBrowser.currentPath = null;

      FolderBrowserModule.confirmSelection();

      expect(mockShowToast).toHaveBeenCalledWith(
        'Please navigate to a folder first',
        'error'
      );
      expect(mockCloseModal).not.toHaveBeenCalled();
    });

    it('should set path and close modal when path selected', () => {
      mockState.folderBrowser.currentPath = 'C:\\test\\project';
      const mockInput = global.$();

      FolderBrowserModule.confirmSelection();

      expect(global.$).toHaveBeenCalledWith('#input-project-path');
      expect(mockInput.val).toHaveBeenCalledWith('C:\\test\\project');
      expect(mockCloseModal).toHaveBeenCalledWith('modal-folder-browser');
    });

    it('should set project name from folder name if empty', () => {
      mockState.folderBrowser.currentPath = 'C:\\test\\myproject';

      // Mock val() to return empty string when called without args
      const mockNameInput = {
        val: jest.fn().mockReturnValueOnce(''),
      };
      const mockPathInput = {
        val: jest.fn().mockReturnThis(),
      };

      global.$ = jest.fn((selector) => {
        if (selector === '#input-project-name') {
          return mockNameInput;
        }

        if (selector === '#input-project-path') {
          return mockPathInput;
        }

        return createMockJQuery()();
      });

      FolderBrowserModule.confirmSelection();

      expect(mockNameInput.val).toHaveBeenCalledWith('myproject');
    });
  });

  describe('setupHandlers', () => {
    it('should register folder item click handler', () => {
      const mockBrowser = global.$();

      FolderBrowserModule.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#folder-browser');
      expect(mockBrowser.on).toHaveBeenCalledWith('click', '.folder-item', expect.any(Function));
    });

    it('should register breadcrumb click handler', () => {
      const mockBreadcrumb = global.$();

      FolderBrowserModule.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#folder-breadcrumb');
      expect(mockBreadcrumb.on).toHaveBeenCalledWith('click', '.folder-breadcrumb-item', expect.any(Function));
    });

    it('should register browse button handler', () => {
      const mockBtn = global.$();

      FolderBrowserModule.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#btn-browse-folder');
      expect(mockBtn.on).toHaveBeenCalledWith('click', expect.any(Function));
    });

    it('should register select folder button handler', () => {
      const mockBtn = global.$();

      FolderBrowserModule.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#btn-select-folder');
      expect(mockBtn.on).toHaveBeenCalledWith('click', expect.any(Function));
    });

    it('should register new folder button handler', () => {
      const mockBtn = global.$();

      FolderBrowserModule.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#btn-folder-browser-new-folder');
      expect(mockBtn.on).toHaveBeenCalledWith('click', expect.any(Function));
    });
  });
});
