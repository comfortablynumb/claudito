// ============================================================================
// SlackThreadTracker
// ============================================================================

export interface SlackThreadTracker {
  register(projectId: string, channelId: string, threadTs: string): void;
  find(channelId: string, threadTs: string): string | null;
  setLatest(projectId: string, channelId: string, threadTs: string): void;
  getLatest(projectId: string): { channelId: string; threadTs: string } | null;
  registerOneOff(channelId: string, threadTs: string, oneOffId: string): void;
  findOneOffId(channelId: string, threadTs: string): string | null;
}

// ============================================================================
// DefaultSlackThreadTracker
// ============================================================================

export class DefaultSlackThreadTracker implements SlackThreadTracker {
  private readonly map = new Map<string, string>();
  private readonly latestMap = new Map<string, { channelId: string; threadTs: string }>();
  private readonly oneOffMap = new Map<string, string>();

  register(projectId: string, channelId: string, threadTs: string): void {
    this.map.set(`${channelId}:${threadTs}`, projectId);
  }

  find(channelId: string, threadTs: string): string | null {
    return this.map.get(`${channelId}:${threadTs}`) ?? null;
  }

  setLatest(projectId: string, channelId: string, threadTs: string): void {
    this.latestMap.set(projectId, { channelId, threadTs });
  }

  getLatest(projectId: string): { channelId: string; threadTs: string } | null {
    return this.latestMap.get(projectId) ?? null;
  }

  registerOneOff(channelId: string, threadTs: string, oneOffId: string): void {
    this.oneOffMap.set(`${channelId}:${threadTs}`, oneOffId);
  }

  findOneOffId(channelId: string, threadTs: string): string | null {
    return this.oneOffMap.get(`${channelId}:${threadTs}`) ?? null;
  }
}
