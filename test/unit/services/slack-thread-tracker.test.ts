import { DefaultSlackThreadTracker } from '../../../src/services/slack-thread-tracker';

describe('DefaultSlackThreadTracker', () => {
  it('returns projectId after registering', () => {
    const tracker = new DefaultSlackThreadTracker();
    tracker.register('proj-1', 'C_CHANNEL', 'ts-123');

    expect(tracker.find('C_CHANNEL', 'ts-123')).toBe('proj-1');
  });

  it('returns null for unknown thread', () => {
    const tracker = new DefaultSlackThreadTracker();

    expect(tracker.find('C_CHANNEL', 'unknown-ts')).toBeNull();
  });

  it('returns null for known channel but unknown threadTs', () => {
    const tracker = new DefaultSlackThreadTracker();
    tracker.register('proj-1', 'C_CHANNEL', 'ts-123');

    expect(tracker.find('C_CHANNEL', 'other-ts')).toBeNull();
  });

  it('latest registration wins for same channel+threadTs key', () => {
    const tracker = new DefaultSlackThreadTracker();
    tracker.register('proj-1', 'C_CHANNEL', 'ts-123');
    tracker.register('proj-2', 'C_CHANNEL', 'ts-123');

    expect(tracker.find('C_CHANNEL', 'ts-123')).toBe('proj-2');
  });

  it('different channels with same threadTs are independent', () => {
    const tracker = new DefaultSlackThreadTracker();
    tracker.register('proj-1', 'C_CHANNEL_A', 'ts-same');
    tracker.register('proj-2', 'C_CHANNEL_B', 'ts-same');

    expect(tracker.find('C_CHANNEL_A', 'ts-same')).toBe('proj-1');
    expect(tracker.find('C_CHANNEL_B', 'ts-same')).toBe('proj-2');
  });

  it('multiple threads in the same channel are independent', () => {
    const tracker = new DefaultSlackThreadTracker();
    tracker.register('proj-1', 'C_CHANNEL', 'ts-aaa');
    tracker.register('proj-2', 'C_CHANNEL', 'ts-bbb');

    expect(tracker.find('C_CHANNEL', 'ts-aaa')).toBe('proj-1');
    expect(tracker.find('C_CHANNEL', 'ts-bbb')).toBe('proj-2');
  });
});

describe('DefaultSlackThreadTracker setLatest / getLatest', () => {
  it('returns latest thread after setLatest', () => {
    const tracker = new DefaultSlackThreadTracker();
    tracker.setLatest('proj-1', 'C_CHANNEL', 'ts-abc');

    expect(tracker.getLatest('proj-1')).toEqual({ channelId: 'C_CHANNEL', threadTs: 'ts-abc' });
  });

  it('returns null when no latest is set', () => {
    const tracker = new DefaultSlackThreadTracker();

    expect(tracker.getLatest('proj-unknown')).toBeNull();
  });

  it('latest registration overwrites previous for the same project', () => {
    const tracker = new DefaultSlackThreadTracker();
    tracker.setLatest('proj-1', 'C_CHANNEL', 'ts-old');
    tracker.setLatest('proj-1', 'C_CHANNEL', 'ts-new');

    expect(tracker.getLatest('proj-1')).toEqual({ channelId: 'C_CHANNEL', threadTs: 'ts-new' });
  });

  it('different projects have independent latest entries', () => {
    const tracker = new DefaultSlackThreadTracker();
    tracker.setLatest('proj-1', 'C_A', 'ts-1');
    tracker.setLatest('proj-2', 'C_B', 'ts-2');

    expect(tracker.getLatest('proj-1')).toEqual({ channelId: 'C_A', threadTs: 'ts-1' });
    expect(tracker.getLatest('proj-2')).toEqual({ channelId: 'C_B', threadTs: 'ts-2' });
  });
});
