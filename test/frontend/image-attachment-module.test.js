/**
 * @jest-environment jsdom
 */

const ImageAttachmentModule = require('../../public/js/modules/image-attachment-module');

describe('ImageAttachmentModule', () => {
  let mockState;
  let mockShowToast;
  let mockScrollConversationToBottom;

  function createMockJQuery() {
    const mockElement = {
      html: jest.fn().mockReturnThis(),
      empty: jest.fn().mockReturnThis(),
      append: jest.fn().mockReturnThis(),
      addClass: jest.fn().mockReturnThis(),
      removeClass: jest.fn().mockReturnThis(),
      hasClass: jest.fn().mockReturnValue(false),
      on: jest.fn().mockReturnThis(),
      click: jest.fn().mockReturnThis(),
      val: jest.fn().mockReturnThis(),
      find: jest.fn().mockReturnThis(),
      attr: jest.fn().mockReturnThis(),
      data: jest.fn(),
      remove: jest.fn().mockReturnThis(),
      length: 1
    };

    return jest.fn().mockReturnValue(mockElement);
  }

  beforeEach(() => {
    mockState = {
      pendingImages: []
    };

    mockShowToast = jest.fn();
    mockScrollConversationToBottom = jest.fn();

    global.$ = createMockJQuery();

    // Mock Image constructor for compressImage
    global.Image = jest.fn(function() {
      const img = this;
      img.width = 100;
      img.height = 100;
      Object.defineProperty(img, 'src', {
        set() {
          // Trigger onload synchronously for tests
          if (img.onload) img.onload();
        }
      });
    });

    // Mock canvas for compressImage
    const mockCtx = { drawImage: jest.fn() };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: jest.fn().mockReturnValue(mockCtx),
      toDataURL: jest.fn().mockReturnValue('data:image/jpeg;base64,Y29tcHJlc3NlZA==')
    };
    document.createElement = jest.fn((tag) => {
      if (tag === 'canvas') return mockCanvas;
      return {};
    });

    ImageAttachmentModule.init({
      state: mockState,
      showToast: mockShowToast,
      scrollConversationToBottom: mockScrollConversationToBottom
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handlePaste', () => {
    it('should process image from clipboard', () => {
      const mockFile = new File([''], 'test.png', { type: 'image/png' });
      const mockEvent = {
        originalEvent: {
          clipboardData: {
            items: [{
              type: 'image/png',
              getAsFile: () => mockFile
            }]
          }
        },
        preventDefault: jest.fn()
      };

      // Mock FileReader
      const mockFileReader = {
        onload: null,
        onerror: null,
        readAsDataURL: jest.fn(function() {
          this.result = 'data:image/png;base64,test';
          this.onload({ target: this });
        })
      };
      global.FileReader = jest.fn(() => mockFileReader);

      ImageAttachmentModule.handlePaste(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockFileReader.readAsDataURL).toHaveBeenCalledWith(mockFile);
      expect(mockState.pendingImages).toHaveLength(1);
      // After compression, mimeType is always image/jpeg
      expect(mockState.pendingImages[0].mimeType).toBe('image/jpeg');
    });

    it('should ignore non-image clipboard items', () => {
      const mockEvent = {
        originalEvent: {
          clipboardData: {
            items: [{
              type: 'text/plain',
              getAsFile: () => null
            }]
          }
        },
        preventDefault: jest.fn()
      };

      ImageAttachmentModule.handlePaste(mockEvent);

      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      expect(mockState.pendingImages).toHaveLength(0);
    });

    it('should handle missing clipboard data', () => {
      const mockEvent = {
        originalEvent: {},
        preventDefault: jest.fn()
      };

      ImageAttachmentModule.handlePaste(mockEvent);

      expect(mockState.pendingImages).toHaveLength(0);
    });
  });

  describe('processFile', () => {
    it('should reject files larger than 10MB', () => {
      const largeFile = {
        size: 11 * 1024 * 1024, // 11MB
        type: 'image/png'
      };

      ImageAttachmentModule.processFile(largeFile);

      expect(mockShowToast).toHaveBeenCalledWith('Image too large (max 10MB)', 'error');
      expect(mockState.pendingImages).toHaveLength(0);
    });

    it('should add valid images to pending after compression', () => {
      const validFile = {
        size: 100 * 1024, // 100KB
        type: 'image/jpeg'
      };

      const mockFileReader = {
        onload: null,
        onerror: null,
        readAsDataURL: jest.fn(function() {
          this.result = 'data:image/jpeg;base64,test';
          this.onload({ target: this });
        })
      };
      global.FileReader = jest.fn(() => mockFileReader);

      ImageAttachmentModule.processFile(validFile);

      expect(mockState.pendingImages).toHaveLength(1);
      // After compression, mimeType is always image/jpeg
      expect(mockState.pendingImages[0].mimeType).toBe('image/jpeg');
      // originalSize tracks the original file size
      expect(mockState.pendingImages[0].originalSize).toBe(100 * 1024);
    });

    it('should handle read errors', () => {
      const validFile = {
        size: 100 * 1024,
        type: 'image/png'
      };

      const mockFileReader = {
        onload: null,
        onerror: null,
        readAsDataURL: jest.fn(function() {
          this.onerror();
        })
      };
      global.FileReader = jest.fn(() => mockFileReader);

      ImageAttachmentModule.processFile(validFile);

      expect(mockShowToast).toHaveBeenCalledWith('Failed to read image', 'error');
    });
  });

  describe('renderPreviews', () => {
    it('should hide container when no images', () => {
      mockState.pendingImages = [];
      const mockContainer = global.$();

      ImageAttachmentModule.renderPreviews();

      expect(global.$).toHaveBeenCalledWith('#image-preview-container');
      expect(mockContainer.addClass).toHaveBeenCalledWith('hidden');
      expect(mockContainer.empty).toHaveBeenCalled();
    });

    it('should show container when images exist', () => {
      mockState.pendingImages = [{
        id: 'img-1',
        dataUrl: 'data:image/png;base64,test',
        mimeType: 'image/png',
        size: 1024
      }];
      const mockContainer = global.$();

      ImageAttachmentModule.renderPreviews();

      expect(mockContainer.removeClass).toHaveBeenCalledWith('hidden');
      expect(mockContainer.append).toHaveBeenCalled();
    });

    it('should format size in KB for small images', () => {
      mockState.pendingImages = [{
        id: 'img-1',
        dataUrl: 'data:image/png;base64,test',
        mimeType: 'image/png',
        size: 500 * 1024 // 500KB
      }];

      const mockPreviews = {
        empty: jest.fn().mockReturnThis(),
        append: jest.fn().mockReturnThis()
      };

      global.$ = jest.fn((selector) => {
        if (selector === '#image-previews') {
          return mockPreviews;
        }

        return createMockJQuery()();
      });

      ImageAttachmentModule.renderPreviews();

      expect(mockPreviews.append).toHaveBeenCalledWith(
        expect.stringContaining('500 KB')
      );
    });

    it('should format size in MB for large images', () => {
      mockState.pendingImages = [{
        id: 'img-1',
        dataUrl: 'data:image/png;base64,test',
        mimeType: 'image/png',
        size: 2 * 1024 * 1024 // 2MB
      }];

      const mockPreviews = {
        empty: jest.fn().mockReturnThis(),
        append: jest.fn().mockReturnThis()
      };

      global.$ = jest.fn((selector) => {
        if (selector === '#image-previews') {
          return mockPreviews;
        }

        return createMockJQuery()();
      });

      ImageAttachmentModule.renderPreviews();

      expect(mockPreviews.append).toHaveBeenCalledWith(
        expect.stringContaining('2.0 MB')
      );
    });
  });

  describe('removeImage', () => {
    it('should remove image by id', () => {
      mockState.pendingImages = [
        { id: 'img-1', dataUrl: 'test1' },
        { id: 'img-2', dataUrl: 'test2' },
        { id: 'img-3', dataUrl: 'test3' }
      ];

      ImageAttachmentModule.removeImage('img-2');

      expect(mockState.pendingImages).toHaveLength(2);
      expect(mockState.pendingImages.find(img => img.id === 'img-2')).toBeUndefined();
    });

    it('should handle removing non-existent id', () => {
      mockState.pendingImages = [
        { id: 'img-1', dataUrl: 'test1' }
      ];

      ImageAttachmentModule.removeImage('non-existent');

      expect(mockState.pendingImages).toHaveLength(1);
    });
  });

  describe('clearAll', () => {
    it('should clear all pending images', () => {
      mockState.pendingImages = [
        { id: 'img-1', dataUrl: 'test1' },
        { id: 'img-2', dataUrl: 'test2' }
      ];

      ImageAttachmentModule.clearAll();

      expect(mockState.pendingImages).toHaveLength(0);
    });
  });

  describe('showWaitingIndicator', () => {
    it('should append waiting indicator to conversation', () => {
      const mockConversation = global.$();

      ImageAttachmentModule.showWaitingIndicator();

      expect(global.$).toHaveBeenCalledWith('#conversation');
      expect(mockConversation.append).toHaveBeenCalledWith(
        expect.stringContaining('waiting-indicator')
      );
      expect(mockScrollConversationToBottom).toHaveBeenCalled();
    });

    it('should remove existing indicator first', () => {
      const mockIndicator = {
        remove: jest.fn()
      };

      global.$ = jest.fn((selector) => {
        if (selector === '#waiting-indicator') {
          return mockIndicator;
        }

        return createMockJQuery()();
      });

      ImageAttachmentModule.showWaitingIndicator();

      expect(mockIndicator.remove).toHaveBeenCalled();
    });
  });

  describe('removeWaitingIndicator', () => {
    it('should remove waiting indicator element', () => {
      const mockIndicator = {
        remove: jest.fn()
      };

      global.$ = jest.fn((selector) => {
        if (selector === '#waiting-indicator') {
          return mockIndicator;
        }

        return createMockJQuery()();
      });

      ImageAttachmentModule.removeWaitingIndicator();

      expect(global.$).toHaveBeenCalledWith('#waiting-indicator');
      expect(mockIndicator.remove).toHaveBeenCalled();
    });
  });

  describe('showModal', () => {
    it('should create modal if not exists', () => {
      let callCount = 0;
      const mockModalNotExists = {
        length: 0,
        find: jest.fn().mockReturnThis(),
        attr: jest.fn().mockReturnThis(),
        removeClass: jest.fn().mockReturnThis(),
        on: jest.fn().mockReturnThis()
      };
      const mockModalExists = {
        length: 1,
        find: jest.fn().mockReturnThis(),
        attr: jest.fn().mockReturnThis(),
        removeClass: jest.fn().mockReturnThis(),
        on: jest.fn().mockReturnThis()
      };
      const mockBody = {
        append: jest.fn()
      };

      global.$ = jest.fn((selector) => {
        if (selector === '#image-modal') {
          callCount++;
          // First call: doesn't exist, second call: exists
          return callCount === 1 ? mockModalNotExists : mockModalExists;
        }

        if (selector === 'body') {
          return mockBody;
        }

        if (selector === document) {
          return { on: jest.fn() };
        }

        return createMockJQuery()();
      });

      ImageAttachmentModule.showModal('test-src.png');

      expect(mockBody.append).toHaveBeenCalledWith(
        expect.stringContaining('image-modal')
      );
    });

    it('should set image source and show modal', () => {
      const mockModal = {
        length: 1,
        find: jest.fn().mockReturnThis(),
        attr: jest.fn().mockReturnThis(),
        removeClass: jest.fn().mockReturnThis(),
        on: jest.fn().mockReturnThis()
      };

      global.$ = jest.fn((selector) => {
        if (selector === '#image-modal') {
          return mockModal;
        }

        return createMockJQuery()();
      });

      ImageAttachmentModule.showModal('test-image.png');

      expect(mockModal.find).toHaveBeenCalledWith('img');
      expect(mockModal.attr).toHaveBeenCalledWith('src', 'test-image.png');
      expect(mockModal.removeClass).toHaveBeenCalledWith('hidden');
    });
  });

  describe('setupHandlers', () => {
    it('should register paste handler on message input', () => {
      const mockInput = global.$();

      ImageAttachmentModule.setupHandlers();

      expect(global.$).toHaveBeenCalledWith('#input-message');
      expect(mockInput.on).toHaveBeenCalledWith('paste', expect.any(Function));
    });

    it('should expose showImageModal globally', () => {
      ImageAttachmentModule.setupHandlers();

      expect(window.showImageModal).toBeDefined();
      expect(typeof window.showImageModal).toBe('function');
    });
  });
});
