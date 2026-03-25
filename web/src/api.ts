const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '')

export { API_BASE }

export type AuthResult = {
  accessToken: string
  user: {
    id: string
    email: string
    displayName: string | null
    isAdmin?: boolean
  }
}

export type MeProfile = {
  id: string
  email: string
  displayName: string | null
  isAdmin: boolean
  isFrozen: boolean
  deletedAt: string | null
  maxTotalSizeBytes: number | null
  maxFileCount: number | null
  maxAlbumCount: number | null
  createdAt: string
}

export type AdminUserOverview = {
  id: string
  email: string
  displayName: string | null
  isAdmin: boolean
  isFrozen: boolean
  deletedAt: string | null
  maxTotalSizeBytes: number | null
  maxFileCount: number | null
  maxAlbumCount: number | null
  fileCount: number
  albumCount: number
  totalSizeBytes: number
  createdAt: string
}

export type AccountStats = {
  fileCount: number
  albumCount: number
  totalSizeBytes: number
  dbTotalSizeBytes: number
  storageTotalSizeBytes: number | null
  statsSource: 'db' | 'r2'
  isBackfilled: boolean
}

export type MediaItem = {
  id: string
  ownerId: string
  filePath: string
  filename: string
  relativePath: string | null
  isFavorite: boolean
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  adjustments: Record<string, number> | null
  capturedAt: string | null
  metadataCreatedAt: string | null
  metadataModifiedAt: string | null
  latitude: number | null
  longitude: number | null
  revisionCount?: number
  isArchived?: boolean
  archivedAt?: string | null
  archivedFromOwnerId?: string | null
  archivedFromDisplayName?: string | null
  archivedFromEmail?: string | null
  createdAt: string
  updatedAt: string
  mediaTags: Array<{ tag: { id: string; name: string } }>
  albumMedia: Array<{ albumId: string; mediaId: string }>
}

export type Album = {
  id: string
  name: string
  description: string | null
  ownerId: string
  parentId: string | null
  mediaCount: number
  previewMedia: Array<{ id: string; filename: string; mimeType: string }>
}

export type Tag = {
  id: string
  name: string
  ownerId: string
}

export type MediaListResponse = {
  items: MediaItem[]
  page: number
  limit: number
  total: number
  hasMore: boolean
}

type MediaListLegacyResponse = MediaItem[]
type MediaListApiResponse = MediaListResponse | MediaListLegacyResponse

export type ShareSettings = {
  enabled: boolean
  accessMode: 'link' | 'password'
  hasPassword: boolean
  token: string | null
  expiresAt: string | null
}

type InitVideoUploadResponse = {
  ok: boolean
  uploadId: string
  chunkSizeBytes: number
  uploadedBytes: number
}

type UploadVideoChunkResponse = {
  ok: boolean
  uploadedBytes: number
  done: boolean
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data?.message || data?.error || 'Request failed')
  }

  return data as T
}

export const api = {
  register: (payload: { email: string; password: string; displayName?: string }) =>
    request<AuthResult>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  login: (payload: { email: string; password: string }) =>
    request<AuthResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminLogin: (payload: { email: string; password: string }) =>
    request<AuthResult>('/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  me: (token: string) => request<MeProfile>('/auth/me', { method: 'GET' }, token),
  accountStats: (token: string) => request<AccountStats>('/auth/stats', { method: 'GET' }, token),
  adminUsers: (token: string) => request<AdminUserOverview[]>('/auth/admin/users', { method: 'GET' }, token),
  updateUserLimits: (
    token: string,
    userId: string,
    payload: {
      maxTotalSizeBytes?: number | null
      maxFileCount?: number | null
      maxAlbumCount?: number | null
    },
  ) =>
    request<AdminUserOverview>(
      `/auth/admin/users/${encodeURIComponent(userId)}/limits`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
    ),
  freezeUser: (token: string, userId: string, frozen: boolean) =>
    request<AdminUserOverview[]>(
      `/auth/admin/users/${encodeURIComponent(userId)}/freeze`,
      {
        method: 'POST',
        body: JSON.stringify({ frozen }),
      },
      token,
    ),
  removeUser: (token: string, userId: string, mode: 'delete-files' | 'archive-files') =>
    request<AdminUserOverview[]>(
      `/auth/admin/users/${encodeURIComponent(userId)}/remove`,
      {
        method: 'POST',
        body: JSON.stringify({ mode }),
      },
      token,
    ),
  adminArchiveMedia: (token: string) =>
    request<MediaItem[]>('/media/admin/archive', { method: 'GET' }, token),
  adminBackfillThumbs: async (
    token: string,
    videosOnly: boolean,
    onProgress: (p: { total: number; done: number; skipped: number; errors: number; finished?: boolean }) => void,
  ) => {
    const url = `${API_BASE}/media/admin/backfill-thumbs${videosOnly ? '?videosOnly=1' : ''}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok || !response.body) {
      throw new Error('Backfill request failed')
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          if (typeof parsed.total === 'number') onProgress(parsed)
        } catch {
          // ignore malformed lines
        }
      }
    }
  },
  fetchAdminArchiveFileBlob: async (token: string, mediaId: string) => {
    const response = await fetch(`${API_BASE}/media/admin/archive/${encodeURIComponent(mediaId)}/file`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error('Cannot load archived file')
    }

    return response.blob()
  },
  listMedia: (
    token: string,
    params?: {
      page?: number
      limit?: number
      q?: string
      favorite?: boolean
      tag?: string
      albumId?: string
      includeNestedAlbums?: boolean
      sortBy?: 'date' | 'name'
      sortDir?: 'asc' | 'desc'
    },
  ): Promise<MediaListResponse> => {
    const searchParams = new URLSearchParams()
    if (params?.page) searchParams.set('page', String(params.page))
    if (params?.limit) searchParams.set('limit', String(params.limit))
    if (params?.q) searchParams.set('q', params.q)
    if (params?.favorite) searchParams.set('favorite', 'true')
    if (params?.tag) searchParams.set('tag', params.tag)
    if (params?.albumId) searchParams.set('albumId', params.albumId)
    if (params?.albumId && params?.includeNestedAlbums) searchParams.set('includeNestedAlbums', 'true')
    if (params?.sortBy) searchParams.set('sortBy', params.sortBy)
    if (params?.sortDir) searchParams.set('sortDir', params.sortDir)
    const query = searchParams.toString()
    return request<MediaListApiResponse>(`/media${query ? `?${query}` : ''}`, {}, token).then((response) => {
      if (Array.isArray(response)) {
        const page = params?.page ?? 1
        const limit = params?.limit ?? response.length
        return {
          items: response,
          page,
          limit,
          total: response.length,
          hasMore: response.length >= limit,
        }
      }

      const safeItems = Array.isArray(response.items) ? response.items : []
      return {
        items: safeItems,
        page: typeof response.page === 'number' ? response.page : params?.page ?? 1,
        limit: typeof response.limit === 'number' ? response.limit : params?.limit ?? safeItems.length,
        total: typeof response.total === 'number' ? response.total : safeItems.length,
        hasMore: typeof response.hasMore === 'boolean' ? response.hasMore : false,
      }
    })
  },
  uploadMedia: (
    token: string,
    files: File[],
    relativePaths: string[],
    options?: {
      albumId?: string
      createAlbumsFromFolders?: boolean
      fileLastModifieds?: number[]
    },
    onProgress?: (loaded: number, total: number) => void,
  ) => {
    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))
    formData.append('relativePaths', JSON.stringify(relativePaths))
    if (options?.fileLastModifieds && options.fileLastModifieds.length > 0) {
      formData.append('fileLastModifieds', JSON.stringify(options.fileLastModifieds))
    }
    if (options?.albumId) {
      formData.append('albumId', options.albumId)
    }
    if (options?.createAlbumsFromFolders) {
      formData.append('createAlbumsFromFolders', 'true')
    }

    return new Promise<{ ok: boolean; created: MediaItem[] }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API_BASE}/media/upload`)
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.timeout = 0

      xhr.upload.onprogress = (event) => {
        if (!onProgress || !event.lengthComputable) return
        onProgress(event.loaded, event.total)
      }

      xhr.onload = () => {
        const raw = xhr.responseText || '{}'
        let data: { message?: string; error?: string } = {}

        try {
          data = JSON.parse(raw || '{}') as { message?: string; error?: string }
        } catch {
          data = { message: raw?.trim() || `Upload failed (HTTP ${xhr.status})` }
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as { ok: boolean; created: MediaItem[] })
          return
        }

        reject(new Error(data?.message || data?.error || 'Upload failed'))
      }

      xhr.onerror = () => reject(new Error('Upload failed'))
      xhr.onabort = () => reject(new Error('Upload was aborted'))
      xhr.ontimeout = () => reject(new Error('Upload timed out while waiting for server response'))
      xhr.send(formData)
    })
  },
  uploadVideoResumable: async (
    token: string,
    file: File,
    options?: {
      relativePath?: string
      albumId?: string
      createAlbumsFromFolders?: boolean
      fileLastModified?: number
    },
    onProgress?: (loaded: number, total: number) => void,
  ) => {
    const init = await request<InitVideoUploadResponse>(
      '/media/video-upload/init',
      {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          relativePath: options?.relativePath || file.webkitRelativePath || file.name,
          albumId: options?.albumId,
          createAlbumsFromFolders: options?.createAlbumsFromFolders || false,
          fileLastModified: options?.fileLastModified ?? file.lastModified,
        }),
      },
      token,
    )

    const uploadId = init.uploadId
    const chunkSize = Math.max(1, init.chunkSizeBytes || 8 * 1024 * 1024)
    let uploadedBytes = Math.max(0, init.uploadedBytes || 0)

    while (uploadedBytes < file.size) {
      const nextEnd = Math.min(file.size, uploadedBytes + chunkSize)
      const chunk = file.slice(uploadedBytes, nextEnd)

      const chunkResponse = await fetch(`${API_BASE}/media/video-upload/${encodeURIComponent(uploadId)}/chunk`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'x-start-byte': String(uploadedBytes),
        },
        body: chunk,
      })

      const chunkData = await chunkResponse.json().catch(() => ({})) as {
        error?: string
        message?: string
        expectedStartByte?: number
      } & Partial<UploadVideoChunkResponse>

      if (!chunkResponse.ok) {
        if (chunkResponse.status === 409 && Number.isFinite(chunkData.expectedStartByte)) {
          uploadedBytes = Math.max(0, Number(chunkData.expectedStartByte))
          onProgress?.(uploadedBytes, file.size)
          continue
        }
        throw new Error(chunkData?.message || chunkData?.error || 'Video upload chunk failed')
      }

      uploadedBytes = Math.max(uploadedBytes, Number(chunkData.uploadedBytes || nextEnd))
      onProgress?.(uploadedBytes, file.size)
    }

    return request<{ ok: boolean; created: MediaItem[] }>(
      `/media/video-upload/${encodeURIComponent(uploadId)}/complete`,
      {
        method: 'POST',
      },
      token,
    )
  },
  updateMedia: (
    token: string,
    mediaId: string,
    payload: {
      filename?: string
      tags?: string[]
      isFavorite?: boolean
      capturedAt?: string | null
      metadataCreatedAt?: string | null
      metadataModifiedAt?: string | null
      latitude?: number | null
      longitude?: number | null
    },
  ) =>
    request<MediaItem>(
      `/media/${mediaId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      token,
    ),
  applyMediaEdits: (
    token: string,
    mediaId: string,
    payload: {
      adjustments: Record<string, number>
      deformation?: {
        liquifyStrokes?: Array<{
          fromX: number
          fromY: number
          toX: number
          toY: number
          radius: number
          strength: number
        }>
        stretch?: {
          axis: 'vertical' | 'horizontal'
          start: number
          end: number
          amount: number
        }
      }
    },
  ) =>
    request<MediaItem>(
      `/media/${mediaId}/apply-edits`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
    ),
  previewMediaEdits: async (
    token: string,
    mediaId: string,
    adjustments: Record<string, number>,
    signal?: AbortSignal,
  ) => {
    const response = await fetch(`${API_BASE}/media/${encodeURIComponent(mediaId)}/preview-render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ adjustments }),
      signal,
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error((data as { message?: string; error?: string })?.message || (data as { message?: string; error?: string })?.error || 'Preview render failed')
    }

    return response.blob()
  },
  revertMediaEdits: (token: string, mediaId: string) =>
    request<MediaItem>(
      `/media/${mediaId}/revert-edits`,
      {
        method: 'POST',
      },
      token,
    ),
  deleteMedia: (token: string, mediaId: string) =>
    request(`/media/${mediaId}`, { method: 'DELETE' }, token),
  copyMedia: (token: string, mediaId: string) =>
    request<MediaItem>(
      `/media/${mediaId}/copy`,
      {
        method: 'POST',
      },
      token,
    ),
  convertMediaToJpg: (token: string, mediaId: string) =>
    request<MediaItem>(
      `/media/${mediaId}/convert-jpg`,
      {
        method: 'POST',
      },
      token,
    ),
  bulkTag: (token: string, mediaIds: string[], tags: string[]) =>
    request(
      '/media/bulk/tag',
      {
        method: 'POST',
        body: JSON.stringify({ mediaIds, tags }),
      },
      token,
    ),
  bulkMoveAlbum: (token: string, mediaIds: string[], albumId: string) =>
    request(
      '/media/bulk/move-album',
      {
        method: 'POST',
        body: JSON.stringify({ mediaIds, albumId }),
      },
      token,
    ),
  bulkFavorite: (token: string, mediaIds: string[], isFavorite: boolean) =>
    request(
      '/media/bulk/favorite',
      {
        method: 'POST',
        body: JSON.stringify({ mediaIds, isFavorite }),
      },
      token,
    ),
  bulkDelete: (token: string, mediaIds: string[]) =>
    request(
      '/media/bulk/delete',
      {
        method: 'POST',
        body: JSON.stringify({ mediaIds }),
      },
      token,
    ),
  listAlbums: (token: string) => request<Album[]>('/albums', {}, token),
  getAlbumShareSettings: (token: string, albumId: string) =>
    request<{ ok: boolean; settings: ShareSettings }>(`/albums/${albumId}/share-settings`, {}, token),
  updateAlbumShareSettings: (
    token: string,
    albumId: string,
    payload: { enabled: boolean; accessMode: 'link' | 'password'; password?: string; expiresAt?: string | null },
  ) =>
    request<{ ok: boolean; settings: ShareSettings }>(
      `/albums/${albumId}/share-settings`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
    ),
  createAlbum: (token: string, name: string, description?: string, parentId?: string | null) =>
    request<Album>(
      '/albums',
      {
        method: 'POST',
        body: JSON.stringify({ name, description, parentId }),
      },
      token,
    ),
  updateAlbum: (
    token: string,
    albumId: string,
    payload: {
      name?: string
      parentId?: string | null
    },
  ) =>
    request<Album>(
      `/albums/${albumId}`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
    ),
  deleteAlbum: (token: string, albumId: string) =>
    request(
      `/albums/${albumId}`,
      {
        method: 'DELETE',
      },
      token,
    ),
  listTags: (token: string) => request<Tag[]>('/tags', {}, token),
  updateTag: (token: string, tagId: string, payload: { name: string }) =>
    request<Tag>(
      `/tags/${tagId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      token,
    ),
  getMediaShareSettings: (token: string, mediaId: string) =>
    request<{ ok: boolean; settings: ShareSettings }>(`/media/${mediaId}/share-settings`, {}, token),
  updateMediaShareSettings: (
    token: string,
    mediaId: string,
    payload: { enabled: boolean; accessMode: 'link' | 'password'; password?: string; expiresAt?: string | null },
  ) =>
    request<{ ok: boolean; settings: ShareSettings }>(
      `/media/${mediaId}/share-settings`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
    ),
  publicMedia: (token: string, password?: string) =>
    request<{ ok: boolean; media: MediaItem }>(
      `/public/media/${token}${password ? `?password=${encodeURIComponent(password)}` : ''}`,
    ),
  publicAlbum: (token: string, password?: string) =>
    request<{ ok: boolean; album: { id: string; name: string; description: string | null }; media: MediaItem[] }>(
      `/public/albums/${token}${password ? `?password=${encodeURIComponent(password)}` : ''}`,
    ),
  publicMediaFileUrl: (token: string, password?: string) =>
    `${API_BASE}/public/media/${token}/file${password ? `?password=${encodeURIComponent(password)}` : ''}`,
  publicAlbumMediaFileUrl: (token: string, mediaId: string, password?: string) =>
    `${API_BASE}/public/albums/${token}/media/${mediaId}/file${password ? `?password=${encodeURIComponent(password)}` : ''}`,
  fetchFileBlob: async (token: string, mediaId: string, signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE}/media/${mediaId}/file`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal,
    })

    if (!response.ok) {
      throw new Error('Cannot load image')
    }

    return response.blob()
  },
  fetchThumbBlob: async (token: string, mediaId: string, width = 640, version?: string | number) => {
    const versionParam = typeof version === 'number' || typeof version === 'string'
      ? `&v=${encodeURIComponent(String(version))}`
      : ''
    const thumbUrl = `${API_BASE}/media/${mediaId}/thumb?w=${encodeURIComponent(String(width))}${versionParam}`
    const request = new Request(thumbUrl)

    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await caches.open('jellyree-thumbs-v1')
        const cached = await cache.match(request)
        if (cached?.ok) {
          return cached.blob()
        }

        const response = await fetch(request, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (!response.ok) {
          throw new Error('Cannot load thumbnail')
        }

        await cache.put(request, response.clone())
        return response.blob()
      } catch {
        // fallback to direct fetch below
      }
    }

    const response = await fetch(request, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error('Cannot load thumbnail')
    }

    return response.blob()
  },
  downloadMediaBlob: async (token: string, mediaId: string) => {
    const response = await fetch(`${API_BASE}/media/${mediaId}/download`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error('Cannot download file')
    }

    const contentDisposition = response.headers.get('content-disposition') || ''
    const filenameMatch =
      /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition) ||
      /filename="?([^";]+)"?/i.exec(contentDisposition)
    const filename = filenameMatch?.[1] ? decodeURIComponent(filenameMatch[1]) : null

    return {
      blob: await response.blob(),
      filename,
    }
  },
  downloadBulkBlob: async (token: string, mediaIds: string[]) => {
    const response = await fetch(`${API_BASE}/media/bulk/download`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mediaIds }),
    })

    if (!response.ok) {
      throw new Error('Cannot download archive')
    }

    const contentDisposition = response.headers.get('content-disposition') || ''
    const filenameMatch =
      /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition) ||
      /filename="?([^";]+)"?/i.exec(contentDisposition)
    const filename = filenameMatch?.[1] ? decodeURIComponent(filenameMatch[1]) : 'jellyree-media.zip'

    return {
      blob: await response.blob(),
      filename,
    }
  },
}
