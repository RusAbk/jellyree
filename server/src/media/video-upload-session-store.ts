export type VideoUploadSessionData = {
  uploadId: string;
  ownerId: string;
  tempFileName: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  relativePath: string | null;
  lastModifiedAtIso: string | null;
  albumId: string | null;
  createAlbumsFromFolders: boolean;
  createdAt: number;
  uploadedBytes: number;
};

export type CasUploadedBytesResult =
  | { ok: true; uploadedBytes: number }
  | { ok: false; reason: 'not_found' | 'mismatch'; uploadedBytes: number };

type VideoUploadSessionStore = {
  create(session: VideoUploadSessionData): Promise<void>;
  get(uploadId: string): Promise<VideoUploadSessionData | null>;
  compareAndSetUploadedBytes(
    uploadId: string,
    expectedUploadedBytes: number,
    nextUploadedBytes: number,
  ): Promise<CasUploadedBytesResult>;
  remove(uploadId: string): Promise<void>;
};

/** In-process store with TTL-based expiration and periodic cleanup. */
class MemoryVideoUploadSessionStore implements VideoUploadSessionStore {
  private sessions = new Map<string, { data: VideoUploadSessionData; expiresAt: number }>();
  private readonly ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(ttlSeconds: number) {
    this.ttlMs = ttlSeconds * 1000;
    // Run cleanup every 10 minutes to evict expired sessions
    this.cleanupTimer = setInterval(() => this.evictExpired(), 10 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  private evictExpired() {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (entry.expiresAt <= now) {
        this.sessions.delete(id);
      }
    }
  }

  private getLive(uploadId: string): VideoUploadSessionData | null {
    const entry = this.sessions.get(uploadId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(uploadId);
      return null;
    }
    return entry.data;
  }

  async create(session: VideoUploadSessionData) {
    this.sessions.set(session.uploadId, {
      data: { ...session },
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  async get(uploadId: string) {
    const found = this.getLive(uploadId);
    return found ? { ...found } : null;
  }

  async compareAndSetUploadedBytes(
    uploadId: string,
    expectedUploadedBytes: number,
    nextUploadedBytes: number,
  ): Promise<CasUploadedBytesResult> {
    const found = this.getLive(uploadId);
    if (!found) {
      return { ok: false, reason: 'not_found', uploadedBytes: 0 };
    }

    if (Number(found.uploadedBytes) !== Number(expectedUploadedBytes)) {
      return { ok: false, reason: 'mismatch', uploadedBytes: Number(found.uploadedBytes || 0) };
    }

    found.uploadedBytes = Number(nextUploadedBytes || 0);
    // Refresh TTL on activity
    this.sessions.set(uploadId, { data: found, expiresAt: Date.now() + this.ttlMs });
    return { ok: true, uploadedBytes: found.uploadedBytes };
  }

  async remove(uploadId: string) {
    this.sessions.delete(uploadId);
  }
}

let cachedStore: VideoUploadSessionStore | null = null;

export function getVideoUploadSessionStore() {
  if (cachedStore) return cachedStore;

  const ttlSeconds = Math.max(60, Number(process.env.VIDEO_UPLOAD_SESSION_TTL_SECONDS || 24 * 60 * 60));
  cachedStore = new MemoryVideoUploadSessionStore(ttlSeconds);
  return cachedStore;
}
