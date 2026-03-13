import { PendingOperationsTracker, WriteQueueManager } from '../../../src/utils/operation-tracking';

jest.mock('../../../src/utils/logger', () => ({
  getLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('operation-tracking', () => {
  describe('PendingOperationsTracker', () => {
    it('should track and automatically remove operations', async () => {
      const tracker = new PendingOperationsTracker('test');

      expect(tracker.size).toBe(0);

      const promise = Promise.resolve('result');
      const tracked = tracker.track(promise);

      expect(await tracked).toBe('result');

      // Wait a tick for finally to execute
      await new Promise((r) => setTimeout(r, 0));

      expect(tracker.size).toBe(0);
    });

    it('should track multiple operations and count them', async () => {
      const tracker = new PendingOperationsTracker('test');

      let resolve1!: () => void;
      let resolve2!: () => void;
      const p1 = new Promise<void>((r) => { resolve1 = r; });
      const p2 = new Promise<void>((r) => { resolve2 = r; });

      void tracker.track(p1);
      void tracker.track(p2);

      expect(tracker.size).toBe(2);

      resolve1();
      await new Promise((r) => setTimeout(r, 10));
      expect(tracker.size).toBe(1);

      resolve2();
      await new Promise((r) => setTimeout(r, 10));
      expect(tracker.size).toBe(0);
    });

    it('should flush all pending operations', async () => {
      const tracker = new PendingOperationsTracker('test');
      let resolved = false;

      const promise = new Promise<void>((resolve) => {
        setTimeout(() => {
          resolved = true;
          resolve();
        }, 10);
      });

      void tracker.track(promise);

      expect(tracker.size).toBe(1);

      await tracker.flush();

      expect(resolved).toBe(true);
      expect(tracker.size).toBe(0);
    });

    it('should flush immediately when no operations', async () => {
      const tracker = new PendingOperationsTracker('test');

      await tracker.flush();

      expect(tracker.size).toBe(0);
    });

    it('should clear all pending operations', () => {
      const tracker = new PendingOperationsTracker('test');
      const neverResolve = new Promise(() => {});

      void tracker.track(neverResolve);

      expect(tracker.size).toBe(1);

      tracker.clear();

      expect(tracker.size).toBe(0);
    });
  });

  describe('WriteQueueManager', () => {
    it('should execute operations with exclusive lock', async () => {
      const manager = new WriteQueueManager('test');
      const order: number[] = [];

      await manager.withLock('key1', () => {
        order.push(1);
        return Promise.resolve('result1');
      });

      expect(order).toEqual([1]);
    });

    it('should serialize operations on the same key', async () => {
      const manager = new WriteQueueManager('test');
      const order: number[] = [];

      const op1 = manager.withLock('key1', async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(1);
      });

      const op2 = manager.withLock('key1', () => {
        order.push(2);
        return Promise.resolve();
      });

      await Promise.all([op1, op2]);

      expect(order).toEqual([1, 2]);
    });

    it('should allow parallel operations on different keys', async () => {
      const manager = new WriteQueueManager('test');
      const order: string[] = [];

      const op1 = manager.withLock('key1', async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('key1');
      });

      const op2 = manager.withLock('key2', () => {
        order.push('key2');
        return Promise.resolve();
      });

      await Promise.all([op1, op2]);

      // key2 should complete before key1 since it doesn't have a delay
      expect(order).toEqual(['key2', 'key1']);
    });

    it('should return result from operation', async () => {
      const manager = new WriteQueueManager('test');

      const result = await manager.withLock('key1', () => {
        return Promise.resolve({ id: 1, name: 'test' });
      });

      expect(result).toEqual({ id: 1, name: 'test' });
    });

    it('should flush all queued operations', async () => {
      const manager = new WriteQueueManager('test');
      let completed = false;

      void manager.withLock('key1', async () => {
        await new Promise((r) => setTimeout(r, 10));
        completed = true;
      });

      await manager.flush();

      expect(completed).toBe(true);
    });

    it('should flush immediately when no operations', async () => {
      const manager = new WriteQueueManager('test');

      await manager.flush();

      expect(manager.size).toBe(0);
    });

    it('should report size correctly', async () => {
      const manager = new WriteQueueManager('test');

      expect(manager.size).toBe(0);

      const op = manager.withLock('key1', async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Size should be 1 while operation is pending
      expect(manager.size).toBe(1);

      await op;

      // Wait a tick for cleanup
      await new Promise((r) => setTimeout(r, 0));
    });

    it('should clear all write queues', () => {
      const manager = new WriteQueueManager('test');
      const neverResolve = new Promise<void>(() => {});

      void manager.withLock('key1', () => neverResolve);

      expect(manager.size).toBe(1);

      manager.clear();

      expect(manager.size).toBe(0);
    });

  });
});
