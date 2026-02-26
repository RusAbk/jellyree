const API_BASE = 'http://localhost:3000'

export type AuthResult = {
  accessToken: string
  user: {
    id: string
    email: string
    displayName: string | null
  }
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
}

export type Tag = {
  id: string
  name: string
  ownerId: string
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
  me: (token: string) => request('/auth/me', { method: 'GET' }, token),
  listMedia: (token: string, query = '') => request<MediaItem[]>(`/media${query}`, {}, token),
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

      xhr.upload.onprogress = (event) => {
        if (!onProgress || !event.lengthComputable) return
        onProgress(event.loaded, event.total)
      }

      xhr.onload = () => {
        const raw = xhr.responseText || '{}'
        const data = JSON.parse(raw || '{}') as { message?: string; error?: string }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as { ok: boolean; created: MediaItem[] })
          return
        }

        reject(new Error(data?.message || data?.error || 'Upload failed'))
      }

      xhr.onerror = () => reject(new Error('Upload failed'))
      xhr.send(formData)
    })
  },
  updateMedia: (
    token: string,
    mediaId: string,
    payload: {
      filename?: string
      tags?: string[]
      isFavorite?: boolean
      capturedAt?: string | null
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
    adjustments: Record<string, number>,
  ) =>
    request<MediaItem>(
      `/media/${mediaId}/apply-edits`,
      {
        method: 'POST',
        body: JSON.stringify({ adjustments }),
      },
      token,
    ),
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
  fetchFileBlob: async (token: string, mediaId: string) => {
    const response = await fetch(`${API_BASE}/media/${mediaId}/file`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error('Cannot load image')
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
