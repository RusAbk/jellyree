<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { api, type Album, type MediaItem, type Tag } from './api'

type AlbumTreeNode = {
  album: Album
  depth: number
  hasChildren: boolean
}

const token = ref(localStorage.getItem('jellyree_token') || '')
const userName = ref(localStorage.getItem('jellyree_user') || '')
const mode = ref<'login' | 'register'>('register')
const authForm = reactive({
  email: '',
  password: '',
  displayName: '',
})

const media = ref<MediaItem[]>([])
const albums = ref<Album[]>([])
const tags = ref<Tag[]>([])
const thumbs = ref<Record<string, string>>({})
const activeMediaId = ref<string | null>(null)
const activeSection = ref<'all' | 'favorites'>('all')
const activeAlbumId = ref('')
const search = ref('')
const loading = ref(false)
const saving = ref(false)
const message = ref('')

const fileInput = ref<HTMLInputElement | null>(null)
const lightboxOpen = ref(false)
const editModeOpen = ref(false)
const createAlbumName = ref('')
const createAlbumBusy = ref(false)
const fabMenuOpen = ref(false)
const createAlbumDialogOpen = ref(false)
const pinnedAlbumIds = ref<string[]>(JSON.parse(localStorage.getItem('jellyree_pins') || '[]'))
const draggedPinnedId = ref<string | null>(null)
const draggedAlbumId = ref<string | null>(null)
const albumDropTargetId = ref<string | null>(null)
const draggedMediaIds = ref<string[]>([])
const mediaDropTargetAlbumId = ref<string | null>(null)
const expandedAlbumIds = ref<string[]>(
  JSON.parse(localStorage.getItem('jellyree_album_expanded') || '[]'),
)
const targetAlbumId = ref('')
const bulkTargetAlbumId = ref('')
const editorCropStage = ref<HTMLDivElement | null>(null)
const masonryRef = ref<HTMLElement | null>(null)
const selectedMediaIds = ref<string[]>([])
const suppressClickUntil = ref(0)

const albumContextMenu = reactive({
  open: false,
  albumId: null as string | null,
  x: 0,
  y: 0,
})

const mediaContextMenu = reactive({
  open: false,
  mediaId: null as string | null,
  x: 0,
  y: 0,
})

const marquee = reactive({
  active: false,
  additive: false,
  seedIds: [] as string[],
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
})

const uploadProgress = reactive({
  active: false,
  count: 0,
  loaded: 0,
  total: 0,
  percent: 0,
})

let heicConverterModulePromise: Promise<typeof import('heic2any')> | null = null

const editor = reactive({
  filename: '',
  tagsInput: '',
  brightness: 0,
  contrast: 0,
  saturation: 0,
  grayscale: 0,
  sepia: 0,
  cropZoom: 0,
  rotate: 0,
  flipX: false,
  flipY: false,
  cropX: 0,
  cropY: 0,
  cropWidth: 100,
  cropHeight: 100,
})

const cropDrag = reactive({
  active: false,
  mode: 'move' as 'move' | 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se',
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
  originWidth: 100,
  originHeight: 100,
})

const activeMedia = computed(() => media.value.find((item) => item.id === activeMediaId.value) || null)
const activeAlbum = computed(() => albums.value.find((album) => album.id === activeAlbumId.value) || null)

const albumsByParent = computed(() => {
  const map = new Map<string | null, Album[]>()
  albums.value.forEach((album) => {
    const key = album.parentId || null
    const bucket = map.get(key) || []
    bucket.push(album)
    map.set(key, bucket)
  })

  for (const [key, bucket] of map.entries()) {
    map.set(key, [...bucket].sort((a, b) => a.name.localeCompare(b.name)))
  }

  return map
})

const albumTree = computed<AlbumTreeNode[]>(() => {
  const result: AlbumTreeNode[] = []

  const walk = (parentId: string | null, depth: number) => {
    const children = albumsByParent.value.get(parentId) || []
    for (const album of children) {
      const hasChildren = (albumsByParent.value.get(album.id) || []).length > 0
      result.push({ album, depth, hasChildren })
      if (expandedAlbumIds.value.includes(album.id)) {
        walk(album.id, depth + 1)
      }
    }
  }

  walk(null, 0)
  return result
})

const pinnedAlbums = computed(() => {
  const byId = new Map(albums.value.map((album) => [album.id, album]))
  return pinnedAlbumIds.value
    .map((id) => byId.get(id))
    .filter((album): album is Album => Boolean(album))
})

const filteredMedia = computed(() => {
  const q = search.value.trim().toLowerCase()
  let base = media.value

  if (activeSection.value === 'favorites') {
    base = base.filter((item) => item.isFavorite)
  }

  const filtered = !q
    ? base
    : base.filter((item) => {
    const nameMatch = item.filename.toLowerCase().includes(q)
    const tagMatch = item.mediaTags.some((entry) => entry.tag.name.includes(q))
    return nameMatch || tagMatch
  })

  return [...filtered].sort((a, b) => getMediaTimestamp(b) - getMediaTimestamp(a))
})

const lightboxItems = computed(() => filteredMedia.value)
const lightboxIndex = computed(() => {
  if (!activeMediaId.value) return -1
  return lightboxItems.value.findIndex((item) => item.id === activeMediaId.value)
})

const activeMediaAlbums = computed(() => {
  if (!activeMedia.value) return []
  const ids = activeMedia.value.albumMedia.map((item) => item.albumId)
  return albums.value.filter((album) => ids.includes(album.id))
})

const activeMediaAlbum = computed(() => activeMediaAlbums.value[0] || null)
const undoCount = computed(() => activeMedia.value?.revisionCount ?? 0)
const selectedCount = computed(() => selectedMediaIds.value.length)
const selectedMediaSet = computed(() => new Set(selectedMediaIds.value))
const activeMediaMetadataCreatedLabel = computed(() => {
  if (!activeMedia.value) return '—'
  return formatDateLabel(activeMedia.value.metadataCreatedAt || activeMedia.value.capturedAt)
})
const activeMediaMetadataModifiedLabel = computed(() => {
  if (!activeMedia.value) return '—'
  return formatDateLabel(activeMedia.value.metadataModifiedAt)
})
const activeMediaLocationLabel = computed(() => {
  if (!activeMedia.value) return '—'
  const latitude = activeMedia.value.latitude
  const longitude = activeMedia.value.longitude
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return '—'
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
})

const marqueeStyle = computed(() => {
  const left = Math.min(marquee.startX, marquee.currentX)
  const top = Math.min(marquee.startY, marquee.currentY)
  const width = Math.abs(marquee.currentX - marquee.startX)
  const height = Math.abs(marquee.currentY - marquee.startY)
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  }
})

const editorCropRectStyle = computed(() => ({
  left: `${editor.cropX}%`,
  top: `${editor.cropY}%`,
  width: `${editor.cropWidth}%`,
  height: `${editor.cropHeight}%`,
}))

function authHeaders() {
  return token.value
}

function getMediaTimestamp(item: MediaItem) {
  const source = item.metadataCreatedAt || item.capturedAt || item.createdAt
  const timestamp = source ? Date.parse(source) : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : 0
}

function formatDateLabel(value: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString()
}

function savePins() {
  localStorage.setItem('jellyree_pins', JSON.stringify(pinnedAlbumIds.value))
}

function saveExpandedAlbums() {
  localStorage.setItem('jellyree_album_expanded', JSON.stringify(expandedAlbumIds.value))
}

function togglePin(albumId: string) {
  if (pinnedAlbumIds.value.includes(albumId)) {
    pinnedAlbumIds.value = pinnedAlbumIds.value.filter((id) => id !== albumId)
  } else {
    pinnedAlbumIds.value = [...pinnedAlbumIds.value, albumId]
  }
  savePins()
}

function toggleAlbumExpanded(albumId: string) {
  if (expandedAlbumIds.value.includes(albumId)) {
    expandedAlbumIds.value = expandedAlbumIds.value.filter((id) => id !== albumId)
  } else {
    expandedAlbumIds.value = [...expandedAlbumIds.value, albumId]
  }
  saveExpandedAlbums()
}

function onPinnedDragStart(albumId: string) {
  draggedPinnedId.value = albumId
}

function onPinnedDrop(targetAlbumId: string) {
  if (!draggedPinnedId.value || draggedPinnedId.value === targetAlbumId) return

  const ordered = [...pinnedAlbumIds.value]
  const from = ordered.indexOf(draggedPinnedId.value)
  const to = ordered.indexOf(targetAlbumId)
  if (from === -1 || to === -1) return

  const [moved] = ordered.splice(from, 1)
  if (!moved) return
  ordered.splice(to, 0, moved)
  pinnedAlbumIds.value = ordered
  savePins()
  draggedPinnedId.value = null
}

function onPinnedDragEnd() {
  draggedPinnedId.value = null
}

function onAlbumDragStart(albumId: string) {
  draggedAlbumId.value = albumId
}

function isMediaDragEvent(event?: DragEvent) {
  if (draggedMediaIds.value.length > 0) return true
  const types = Array.from(event?.dataTransfer?.types || [])
  return types.includes('application/x-jellyree-media-ids')
}

function isExternalFilesDropEvent(event?: DragEvent) {
  const types = Array.from(event?.dataTransfer?.types || [])
  return types.includes('Files')
}

function getDraggedMediaIds(event?: DragEvent) {
  if (draggedMediaIds.value.length > 0) return [...draggedMediaIds.value]
  const raw = event?.dataTransfer?.getData('application/x-jellyree-media-ids')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => String(item)).filter(Boolean)
  } catch {
    return []
  }
}

function onAlbumDragOver(targetAlbumId: string | null, event?: DragEvent) {
  if (isMediaDragEvent(event)) {
    mediaDropTargetAlbumId.value = targetAlbumId
    albumDropTargetId.value = null
    return
  }

  albumDropTargetId.value = targetAlbumId
  mediaDropTargetAlbumId.value = null
}

function onAlbumDragEnd() {
  draggedAlbumId.value = null
  albumDropTargetId.value = null
  mediaDropTargetAlbumId.value = null
}

function onMediaDragEnd() {
  draggedMediaIds.value = []
  mediaDropTargetAlbumId.value = null
}

function onMediaDragStart(mediaId: string, event: DragEvent) {
  const ids = selectedMediaSet.value.has(mediaId)
    ? [...selectedMediaIds.value]
    : [mediaId]

  selectedMediaIds.value = ids
  activeMediaId.value = mediaId
  draggedMediaIds.value = ids

  event.dataTransfer?.setData('application/x-jellyree-media-ids', JSON.stringify(ids))
  event.dataTransfer?.setData('text/plain', ids.join(','))
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function isAlbumDescendant(targetAlbumId: string, potentialAncestorId: string) {
  let cursor = albums.value.find((album) => album.id === targetAlbumId)
  while (cursor?.parentId) {
    if (cursor.parentId === potentialAncestorId) return true
    cursor = albums.value.find((album) => album.id === cursor?.parentId)
  }
  return false
}

async function onAlbumDrop(targetAlbumId: string | null, event?: DragEvent) {
  const mediaIds = getDraggedMediaIds(event)
  if (mediaIds.length > 0) {
    if (!token.value) return
    if (!targetAlbumId) {
      message.value = 'Drop photos onto a specific album'
      onMediaDragEnd()
      return
    }

    try {
      await api.bulkMoveAlbum(authHeaders(), mediaIds, targetAlbumId)
      selectedMediaIds.value = mediaIds
      message.value = `Moved ${mediaIds.length} photo(s) to album`
      await loadAll()
    } catch (error) {
      message.value = (error as Error).message
    } finally {
      onMediaDragEnd()
    }
    return
  }

  if (!draggedAlbumId.value) return
  if (targetAlbumId === draggedAlbumId.value) {
    onAlbumDragEnd()
    return
  }

  if (targetAlbumId && isAlbumDescendant(targetAlbumId, draggedAlbumId.value)) {
    message.value = 'Cannot move album into its child'
    onAlbumDragEnd()
    return
  }

  await moveAlbumToParent(draggedAlbumId.value, targetAlbumId)
  onAlbumDragEnd()
}

function closeContextMenus() {
  albumContextMenu.open = false
  albumContextMenu.albumId = null
  mediaContextMenu.open = false
  mediaContextMenu.mediaId = null
}

function openAlbumContextMenu(event: MouseEvent, albumId: string) {
  event.preventDefault()
  event.stopPropagation()
  albumContextMenu.open = true
  albumContextMenu.albumId = albumId
  albumContextMenu.x = event.clientX
  albumContextMenu.y = event.clientY
  mediaContextMenu.open = false
  mediaContextMenu.mediaId = null
}

function openMediaContextMenu(event: MouseEvent, mediaId: string) {
  event.preventDefault()
  event.stopPropagation()
  selectMedia(mediaId, event)
  mediaContextMenu.open = true
  mediaContextMenu.mediaId = mediaId
  mediaContextMenu.x = event.clientX
  mediaContextMenu.y = event.clientY
  albumContextMenu.open = false
  albumContextMenu.albumId = null
}

function selectedAlbumFromContext() {
  if (!albumContextMenu.albumId) return null
  return albums.value.find((album) => album.id === albumContextMenu.albumId) || null
}

async function contextRenameAlbum() {
  const album = selectedAlbumFromContext()
  closeContextMenus()
  if (!album) return
  await renameAlbum(album)
}

async function contextDeleteAlbum() {
  const album = selectedAlbumFromContext()
  closeContextMenus()
  if (!album) return
  await deleteAlbum(album)
}

async function contextMoveAlbumToRoot() {
  const album = selectedAlbumFromContext()
  closeContextMenus()
  if (!album) return
  await moveAlbumToParent(album.id, null)
}

function contextToggleAlbumPin() {
  const album = selectedAlbumFromContext()
  closeContextMenus()
  if (!album) return
  togglePin(album.id)
}

function contextOpenAlbum() {
  const album = selectedAlbumFromContext()
  closeContextMenus()
  if (!album) return
  activeSection.value = 'all'
  openAlbum(album.id)
}

function mediaFromContext() {
  if (!mediaContextMenu.mediaId) return null
  return media.value.find((item) => item.id === mediaContextMenu.mediaId) || null
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function downloadMediaFile(mediaId: string) {
  if (!token.value) return
  const item = media.value.find((entry) => entry.id === mediaId)
  if (!item) return

  try {
    const payload = await api.downloadMediaBlob(authHeaders(), mediaId)
    triggerDownload(payload.blob, payload.filename || item.filename || 'download')
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function contextDownloadMedia() {
  const item = mediaFromContext()
  closeContextMenus()
  if (!item) return
  await downloadMediaFile(item.id)
}

function contextOpenMedia() {
  const item = mediaFromContext()
  closeContextMenus()
  if (!item) return
  openLightbox(item.id)
}

function contextEditMedia() {
  const item = mediaFromContext()
  closeContextMenus()
  if (!item) return
  openEditMode(item.id)
}

function contextToggleMediaFavorite() {
  const item = mediaFromContext()
  closeContextMenus()
  if (!item) return
  void toggleFavorite(item.id)
}

function contextDeleteMedia() {
  const item = mediaFromContext()
  closeContextMenus()
  if (!item) return
  void deleteMedia(item.id)
}

async function downloadSelectedAsZip() {
  if (!token.value || selectedMediaIds.value.length === 0) return

  try {
    const payload = await api.downloadBulkBlob(authHeaders(), selectedMediaIds.value)
    triggerDownload(payload.blob, payload.filename || 'jellyree-media.zip')
  } catch (error) {
    message.value = (error as Error).message
  }
}

function onGlobalPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (!target) {
    closeContextMenus()
    return
  }

  if (target.closest('.context-menu-floating') || target.closest('.menu-dots-btn')) {
    return
  }

  closeContextMenus()
}
function getFileExtension(filename: string) {
  const trimmed = filename.trim().toLowerCase()
  const index = trimmed.lastIndexOf('.')
  return index >= 0 ? trimmed.slice(index + 1) : ''
}

function isHeicFile(item: MediaItem) {
  const mime = item.mimeType.toLowerCase()
  if (mime.includes('heic') || mime.includes('heif')) return true
  const ext = getFileExtension(item.filename)
  return ext === 'heic' || ext === 'heif'
}

function isLikelyImageFile(item: MediaItem) {
  const mime = item.mimeType.toLowerCase()
  if (mime.startsWith('image/')) return true

  const ext = getFileExtension(item.filename)
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'avif'].includes(ext)
}

function canPreviewInBrowser(item: MediaItem) {
  if (!isLikelyImageFile(item)) return false
  if (isHeicFile(item)) {
    return Boolean(thumbs.value[item.id])
  }
  return true
}

function onThumbError(mediaId: string) {
  thumbs.value[mediaId] = ''
}

function clearThumb(mediaId: string) {
  const previous = thumbs.value[mediaId]
  if (previous && previous.startsWith('blob:')) {
    URL.revokeObjectURL(previous)
  }
  delete thumbs.value[mediaId]
}

async function loadThumb(mediaId: string) {
  if (thumbs.value[mediaId] || !token.value) return
  try {
    const blob = await api.fetchFileBlob(token.value, mediaId)
    const item = media.value.find((entry) => entry.id === mediaId)
    const mime = item?.mimeType.toLowerCase() || ''
    const isHeic = item ? isHeicFile(item) : false

    if (isHeic || mime.includes('heic') || mime.includes('heif')) {
      if (!heicConverterModulePromise) {
        heicConverterModulePromise = import('heic2any')
      }
      const heicConverterModule = await heicConverterModulePromise
      const heicConverter = heicConverterModule.default

      const converted = await heicConverter({
        blob,
        toType: 'image/jpeg',
        quality: 0.9,
      })
      const convertedBlob = Array.isArray(converted) ? converted[0] : converted
      thumbs.value[mediaId] = URL.createObjectURL(convertedBlob as Blob)
      return
    }

    thumbs.value[mediaId] = URL.createObjectURL(blob)
  } catch {
    thumbs.value[mediaId] = ''
  }
}

function applyMediaToEditor(item: MediaItem | null) {
  if (!item) return
  editor.filename = item.filename
  editor.tagsInput = item.mediaTags.map((entry) => entry.tag.name).join(', ')
  resetEditorAdjustments()
  targetAlbumId.value = item.albumMedia[0]?.albumId || ''
}

async function loadAll() {
  if (!token.value) return
  loading.value = true
  message.value = ''

  try {
    const queryParts = []
    if (activeAlbumId.value) queryParts.push(`albumId=${encodeURIComponent(activeAlbumId.value)}`)
    if (activeSection.value === 'favorites') queryParts.push('favorite=true')
    if (search.value.trim()) queryParts.push(`q=${encodeURIComponent(search.value.trim())}`)
    const query = queryParts.length ? `?${queryParts.join('&')}` : ''

    const [mediaResult, albumResult, tagResult] = await Promise.all([
      api.listMedia(token.value, query),
      api.listAlbums(token.value),
      api.listTags(token.value),
    ])

    media.value = mediaResult
    albums.value = albumResult
    tags.value = tagResult

    const firstMedia = mediaResult.length > 0 ? mediaResult[0] : undefined
    if (firstMedia && !activeMedia.value) {
      activeMediaId.value = firstMedia.id
    }

    await Promise.all(mediaResult.slice(0, 32).map((item) => loadThumb(item.id)))
  } catch (error) {
    message.value = (error as Error).message
  } finally {
    loading.value = false
  }
}

function openAlbum(albumId: string) {
  activeSection.value = 'all'
  activeAlbumId.value = albumId

  const parentChain: string[] = []
  let cursor = albums.value.find((a) => a.id === albumId)
  while (cursor?.parentId) {
    parentChain.push(cursor.parentId)
    cursor = albums.value.find((a) => a.id === cursor?.parentId)
  }

  expandedAlbumIds.value = Array.from(new Set([...expandedAlbumIds.value, ...parentChain]))
  saveExpandedAlbums()
}

function goRoot() {
  activeAlbumId.value = ''
}

function selectMedia(mediaId: string, event?: MouseEvent) {
  if (Date.now() - suppressClickUntil.value < 180) return

  if (event?.shiftKey && activeMediaId.value) {
    const ids = filteredMedia.value.map((item) => item.id)
    const from = ids.indexOf(activeMediaId.value)
    const to = ids.indexOf(mediaId)
    if (from >= 0 && to >= 0) {
      const [start, end] = from < to ? [from, to] : [to, from]
      selectedMediaIds.value = ids.slice(start, end + 1)
      activeMediaId.value = mediaId
      closeContextMenus()
      void loadThumb(mediaId)
      return
    }
  }

  if (event?.metaKey || event?.ctrlKey) {
    if (selectedMediaSet.value.has(mediaId)) {
      selectedMediaIds.value = selectedMediaIds.value.filter((id) => id !== mediaId)
      if (activeMediaId.value === mediaId) {
        activeMediaId.value = selectedMediaIds.value[0] || null
      }
    } else {
      selectedMediaIds.value = [...selectedMediaIds.value, mediaId]
      activeMediaId.value = mediaId
    }
    closeContextMenus()
    void loadThumb(mediaId)
    return
  }

  selectedMediaIds.value = [mediaId]
  activeMediaId.value = mediaId
  closeContextMenus()
  void loadThumb(mediaId)
}

function openLightbox(mediaId: string) {
  selectMedia(mediaId)
  lightboxOpen.value = true
}

function closeLightbox() {
  lightboxOpen.value = false
}

function openEditMode(mediaId?: string) {
  if (mediaId) {
    selectMedia(mediaId)
  }
  if (!activeMedia.value) return
  editModeOpen.value = true
  closeContextMenus()
}

function closeEditMode() {
  editModeOpen.value = false
}

function setActiveMediaByIndex(index: number) {
  if (lightboxItems.value.length === 0) return
  const normalized = (index + lightboxItems.value.length) % lightboxItems.value.length
  const next = lightboxItems.value[normalized]
  if (!next) return
  selectMedia(next.id)
}

function nextLightbox() {
  if (lightboxItems.value.length <= 1) return
  setActiveMediaByIndex(lightboxIndex.value + 1)
}

function prevLightbox() {
  if (lightboxItems.value.length <= 1) return
  setActiveMediaByIndex(lightboxIndex.value - 1)
}

function openUploader() {
  fileInput.value?.click()
}

function toggleFabMenu() {
  fabMenuOpen.value = !fabMenuOpen.value
}

function closeFabMenu() {
  fabMenuOpen.value = false
}

function openCreateAlbumDialog() {
  closeFabMenu()
  createAlbumDialogOpen.value = true
}

function closeCreateAlbumDialog() {
  createAlbumDialogOpen.value = false
  createAlbumName.value = ''
}

function uploadFromFab() {
  closeFabMenu()
  openUploader()
}

function startUploadProgress(fileCount: number) {
  uploadProgress.active = true
  uploadProgress.count = fileCount
  uploadProgress.loaded = 0
  uploadProgress.total = 0
  uploadProgress.percent = 0
}

function updateUploadProgress(loaded: number, total: number) {
  uploadProgress.loaded = loaded
  uploadProgress.total = total
  uploadProgress.percent = total > 0 ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : 0
}

function finishUploadProgress() {
  uploadProgress.percent = 100
  setTimeout(() => {
    uploadProgress.active = false
  }, 350)
}

async function uploadFiles(files: FileList | null) {
  if (!files || files.length === 0 || !token.value) return
  const list = Array.from(files)
  const relativePaths = list.map((file) => file.webkitRelativePath || file.name)
  startUploadProgress(list.length)
  message.value = `Uploading ${list.length} files...`

  try {
    await api.uploadMedia(authHeaders(), list, relativePaths, {
      albumId: activeAlbumId.value || undefined,
      fileLastModifieds: list.map((file) => file.lastModified),
    }, updateUploadProgress)
    finishUploadProgress()
    message.value = `Uploaded ${list.length} file(s)`
    await loadAll()
  } catch (error) {
    uploadProgress.active = false
    message.value = (error as Error).message
  }
}

function readEntries(reader: any): Promise<any[]> {
  return new Promise((resolve) => {
    const all: any[] = []
    const pump = () => {
      reader.readEntries((entries: any[]) => {
        if (!entries || entries.length === 0) {
          resolve(all)
          return
        }
        all.push(...entries)
        pump()
      })
    }
    pump()
  })
}

async function walkDroppedEntry(entry: any, prefix = ''): Promise<Array<{ file: File; relativePath: string }>> {
  if (!entry) return []

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      entry.file((f: File) => resolve(f), reject)
    })
    const relativePath = prefix ? `${prefix}/${file.name}` : file.name
    return [{ file, relativePath }]
  }

  if (entry.isDirectory) {
    const dirPrefix = prefix ? `${prefix}/${entry.name}` : entry.name
    const reader = entry.createReader()
    const entries = await readEntries(reader)
    const results = await Promise.all(entries.map((child: any) => walkDroppedEntry(child, dirPrefix)))
    return results.flat()
  }

  return []
}

async function collectDroppedFiles(event: DragEvent) {
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) return { files: [] as File[], relativePaths: [] as string[], hasFolders: false }

  const deduplicateDropped = (items: Array<{ file: File; relativePath: string }>) => {
    const unique = new Map<string, { file: File; relativePath: string }>()
    for (const item of items) {
      const key = `${item.relativePath}|${item.file.size}|${item.file.lastModified}`
      if (!unique.has(key)) {
        unique.set(key, item)
      }
    }
    return Array.from(unique.values())
  }

  const items = Array.from(dataTransfer.items || [])
  const entries = items
    .map((item) => (item as any).webkitGetAsEntry?.())
    .filter(Boolean)

  if (entries.length === 0) {
    const list = Array.from(dataTransfer.files || [])
    const deduped = deduplicateDropped(
      list.map((file) => ({ file, relativePath: file.webkitRelativePath || file.name })),
    )
    return {
      files: deduped.map((item) => item.file),
      relativePaths: deduped.map((item) => item.relativePath),
      hasFolders: false,
    }
  }

  const flattened = (await Promise.all(entries.map((entry) => walkDroppedEntry(entry)))).flat()
  const deduped = deduplicateDropped(flattened)
  const files = deduped.map((item) => item.file)
  const relativePaths = deduped.map((item) => item.relativePath)
  const hasFolders = entries.some((entry: any) => entry.isDirectory)
  return { files, relativePaths, hasFolders }
}

async function handleDrop(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (!token.value) return
  if (uploadProgress.active) return
  if (isMediaDragEvent(event) || draggedAlbumId.value || draggedPinnedId.value) return
  if (!isExternalFilesDropEvent(event)) return

  const { files, relativePaths, hasFolders } = await collectDroppedFiles(event)
  if (files.length === 0) return
  startUploadProgress(files.length)
  message.value = `Uploading ${files.length} files...`

  try {
    await api.uploadMedia(authHeaders(), files, relativePaths, {
      albumId: activeAlbumId.value || undefined,
      createAlbumsFromFolders: hasFolders,
      fileLastModifieds: files.map((file) => file.lastModified),
    }, updateUploadProgress)
    finishUploadProgress()
    message.value = `Uploaded ${files.length} file(s)`
    await loadAll()
  } catch (error) {
    uploadProgress.active = false
    message.value = (error as Error).message
  }
}

function clearSelection() {
  selectedMediaIds.value = []
}

function startMarqueeSelect(event: PointerEvent) {
  if (event.button !== 0) return
  const target = event.target as HTMLElement
  if (!target) return
  if (target.closest('.photo-card')) return
  if (target.closest('.gallery-head, .gallery-toolbar, .upload-progress, .drop-hint, .fab-wrap')) return
  if (target.closest('button, input, select, textarea, a, label')) return

  marquee.active = true
  marquee.additive = Boolean(event.ctrlKey || event.metaKey)
  marquee.seedIds = marquee.additive ? [...selectedMediaIds.value] : []
  marquee.startX = event.clientX
  marquee.startY = event.clientY
  marquee.currentX = event.clientX
  marquee.currentY = event.clientY
}

function updateMarqueeSelection() {
  if (!marquee.active || !masonryRef.value) return
  const left = Math.min(marquee.startX, marquee.currentX)
  const right = Math.max(marquee.startX, marquee.currentX)
  const top = Math.min(marquee.startY, marquee.currentY)
  const bottom = Math.max(marquee.startY, marquee.currentY)

  const selected: string[] = []
  const cards = Array.from(masonryRef.value.querySelectorAll<HTMLElement>('.photo-card[data-media-id]'))
  for (const card of cards) {
    const rect = card.getBoundingClientRect()
    const intersects = rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top
    if (intersects) {
      const id = card.dataset.mediaId
      if (id) selected.push(id)
    }
  }

  if (marquee.additive) {
    const union = Array.from(new Set([...marquee.seedIds, ...selected]))
    selectedMediaIds.value = union
    if (!activeMediaId.value && union.length > 0) {
      activeMediaId.value = union[0] || null
    }
    return
  }

  selectedMediaIds.value = selected
  activeMediaId.value = selected[0] || null
}

function onWindowPointerMove(event: PointerEvent) {
  if (!marquee.active) return
  marquee.currentX = event.clientX
  marquee.currentY = event.clientY
  updateMarqueeSelection()
}

function onWindowPointerUp() {
  if (!marquee.active) return
  marquee.active = false
  marquee.additive = false
  marquee.seedIds = []
  suppressClickUntil.value = Date.now()
}

function onFileInput(event: Event) {
  const target = event.target as HTMLInputElement
  void uploadFiles(target.files)
}

async function createAlbum() {
  if (!createAlbumName.value.trim() || !token.value) return
  createAlbumBusy.value = true
  try {
    await api.createAlbum(authHeaders(), createAlbumName.value.trim(), undefined, activeAlbumId.value || null)
    createAlbumName.value = ''
    createAlbumDialogOpen.value = false
    closeFabMenu()
    await loadAll()
  } catch (error) {
    message.value = (error as Error).message
  } finally {
    createAlbumBusy.value = false
  }
}

async function moveAlbumToParent(albumId: string, parentId: string | null) {
  if (!token.value) return
  try {
    await api.updateAlbum(authHeaders(), albumId, { parentId })
    await loadAll()
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function renameAlbum(album: Album) {
  const nextName = window.prompt('Album name', album.name)
  if (!nextName || !nextName.trim() || nextName.trim() === album.name) return

  try {
    await api.updateAlbum(authHeaders(), album.id, { name: nextName.trim() })
    await loadAll()
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function deleteAlbum(album: Album) {
  if (!token.value) return
  const ok = window.confirm(`Delete album "${album.name}"? Photos will stay in library.`)
  if (!ok) return

  try {
    await api.deleteAlbum(authHeaders(), album.id)
    pinnedAlbumIds.value = pinnedAlbumIds.value.filter((id) => id !== album.id)
    expandedAlbumIds.value = expandedAlbumIds.value.filter((id) => id !== album.id)
    savePins()
    saveExpandedAlbums()
    if (activeAlbumId.value === album.id) {
      activeAlbumId.value = ''
    }
    await loadAll()
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function saveMediaInfo() {
  if (!activeMedia.value || !token.value) return
  saving.value = true

  try {
    const tagsValue = editor.tagsInput.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean)
    await api.updateMedia(authHeaders(), activeMedia.value.id, {
      filename: editor.filename,
      tags: tagsValue,
    })
    message.value = 'Photo info saved'
    await loadAll()
  } catch (error) {
    message.value = (error as Error).message
  } finally {
    saving.value = false
  }
}

async function addActiveToAlbum() {
  if (!activeMedia.value || !token.value || !targetAlbumId.value) return
  try {
    await api.bulkMoveAlbum(authHeaders(), [activeMedia.value.id], targetAlbumId.value)
    message.value = 'Moved to album'
    await loadAll()
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function bulkMoveSelectedToAlbum() {
  if (!token.value || selectedMediaIds.value.length === 0 || !bulkTargetAlbumId.value) return

  try {
    await api.bulkMoveAlbum(authHeaders(), selectedMediaIds.value, bulkTargetAlbumId.value)
    message.value = `Moved ${selectedMediaIds.value.length} photo(s) to album`
    await loadAll()
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function bulkSetFavorite(value: boolean) {
  if (!token.value || selectedMediaIds.value.length === 0) return

  try {
    await api.bulkFavorite(authHeaders(), selectedMediaIds.value, value)
    message.value = value
      ? `Added ${selectedMediaIds.value.length} photo(s) to favorites`
      : `Removed ${selectedMediaIds.value.length} photo(s) from favorites`
    await loadAll()
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function bulkDeleteSelected() {
  if (!token.value || selectedMediaIds.value.length === 0) return
  const ok = window.confirm(`Delete ${selectedMediaIds.value.length} selected photo(s)?`)
  if (!ok) return

  try {
    await api.bulkDelete(authHeaders(), selectedMediaIds.value)
    selectedMediaIds.value = []
    activeMediaId.value = null
    message.value = 'Selected photos deleted'
    await loadAll()
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function toggleFavorite(mediaId: string, value?: boolean) {
  if (!token.value) return
  const item = media.value.find((entry) => entry.id === mediaId)
  if (!item) return
  const nextValue = typeof value === 'boolean' ? value : !item.isFavorite

  try {
    await api.updateMedia(authHeaders(), mediaId, { isFavorite: nextValue })
    media.value = media.value.map((entry) =>
      entry.id === mediaId ? { ...entry, isFavorite: nextValue } : entry,
    )
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function deleteMedia(mediaId: string) {
  if (!token.value) return
  try {
    await api.deleteMedia(authHeaders(), mediaId)
    if (activeMediaId.value === mediaId) {
      activeMediaId.value = null
      lightboxOpen.value = false
      editModeOpen.value = false
    }
    closeContextMenus()
    await loadAll()
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function applyImageEditsPermanently() {
  if (!activeMedia.value || !token.value) return
  saving.value = true

  try {
    const mediaId = activeMedia.value.id
    await api.applyMediaEdits(authHeaders(), mediaId, {
      brightness: editor.brightness,
      contrast: editor.contrast,
      saturation: editor.saturation,
      grayscale: editor.grayscale,
      sepia: editor.sepia,
      cropZoom: editor.cropZoom,
      rotate: editor.rotate,
      flipX: editor.flipX ? 1 : 0,
      flipY: editor.flipY ? 1 : 0,
      cropX: editor.cropX,
      cropY: editor.cropY,
      cropWidth: editor.cropWidth,
      cropHeight: editor.cropHeight,
    })
    clearThumb(mediaId)
    await loadThumb(mediaId)
    message.value = 'Edits permanently applied'
    await loadAll()
    closeEditMode()
  } catch (error) {
    message.value = (error as Error).message
  } finally {
    saving.value = false
  }
}

async function undoLastPermanentEdit() {
  if (!activeMedia.value || !token.value) return
  saving.value = true

  try {
    const mediaId = activeMedia.value.id
    await api.revertMediaEdits(authHeaders(), mediaId)
    clearThumb(mediaId)
    await loadThumb(mediaId)
    message.value = 'Last permanent edit was undone'
    await loadAll()
    closeEditMode()
  } catch (error) {
    message.value = (error as Error).message
  } finally {
    saving.value = false
  }
}

function mediaFilterStyle(_item?: MediaItem) {
  return {}
}

function mediaFilterStyleFromEditor() {
  const brightness = 100 + Number(editor.brightness || 0)
  const contrast = 100 + Number(editor.contrast || 0)
  const saturation = 100 + Number(editor.saturation || 0)
  const zoom = 1 + Number(editor.cropZoom || 0) / 100
  const rotate = Number(editor.rotate || 0)
  const flipX = editor.flipX ? -1 : 1
  const flipY = editor.flipY ? -1 : 1
  const grayscale = Number(editor.grayscale || 0)
  const sepia = Number(editor.sepia || 0)
  return {
    filter: `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%) sepia(${sepia}%)`,
    transform: `scale(${zoom}) rotate(${rotate}deg) scaleX(${flipX}) scaleY(${flipY})`,
    clipPath: `inset(${editor.cropY}% ${100 - editor.cropX - editor.cropWidth}% ${100 - editor.cropY - editor.cropHeight}% ${editor.cropX}%)`,
  }
}

function mediaDetailsStyle(_item?: MediaItem) {
  return {}
}

function resetEditorAdjustments() {
  editor.brightness = 0
  editor.contrast = 0
  editor.saturation = 0
  editor.grayscale = 0
  editor.sepia = 0
  editor.cropZoom = 0
  editor.rotate = 0
  editor.flipX = false
  editor.flipY = false
  editor.cropX = 0
  editor.cropY = 0
  editor.cropWidth = 100
  editor.cropHeight = 100
}

function startCropDrag(event: PointerEvent, mode: 'move' | 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se') {
  event.preventDefault()
  cropDrag.active = true
  cropDrag.mode = mode
  cropDrag.startX = event.clientX
  cropDrag.startY = event.clientY
  cropDrag.originX = editor.cropX
  cropDrag.originY = editor.cropY
  cropDrag.originWidth = editor.cropWidth
  cropDrag.originHeight = editor.cropHeight
}

function stopCropDrag() {
  cropDrag.active = false
}

function clampCropRect() {
  editor.cropWidth = Math.max(5, Math.min(100, editor.cropWidth))
  editor.cropHeight = Math.max(5, Math.min(100, editor.cropHeight))
  editor.cropX = Math.max(0, Math.min(100 - editor.cropWidth, editor.cropX))
  editor.cropY = Math.max(0, Math.min(100 - editor.cropHeight, editor.cropY))
}

function onCropPointerMove(event: PointerEvent) {
  if (!cropDrag.active || !editorCropStage.value) return
  const rect = editorCropStage.value.getBoundingClientRect()
  if (!rect.width || !rect.height) return

  const dx = ((event.clientX - cropDrag.startX) / rect.width) * 100
  const dy = ((event.clientY - cropDrag.startY) / rect.height) * 100
  const minSize = 5

  let x = cropDrag.originX
  let y = cropDrag.originY
  let width = cropDrag.originWidth
  let height = cropDrag.originHeight

  if (cropDrag.mode === 'move') {
    x = cropDrag.originX + dx
    y = cropDrag.originY + dy
  }
  if (cropDrag.mode.includes('e')) {
    width = cropDrag.originWidth + dx
  }
  if (cropDrag.mode.includes('s')) {
    height = cropDrag.originHeight + dy
  }
  if (cropDrag.mode.includes('w')) {
    x = cropDrag.originX + dx
    width = cropDrag.originWidth - dx
  }
  if (cropDrag.mode.includes('n')) {
    y = cropDrag.originY + dy
    height = cropDrag.originHeight - dy
  }

  if (width < minSize) {
    if (cropDrag.mode.includes('w')) x -= minSize - width
    width = minSize
  }
  if (height < minSize) {
    if (cropDrag.mode.includes('n')) y -= minSize - height
    height = minSize
  }

  editor.cropX = x
  editor.cropY = y
  editor.cropWidth = width
  editor.cropHeight = height
  clampCropRect()
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && (albumContextMenu.open || mediaContextMenu.open)) {
    closeContextMenus()
    return
  }

  if (createAlbumDialogOpen.value) {
    if (event.key === 'Escape') closeCreateAlbumDialog()
    return
  }

  if (editModeOpen.value) {
    if (event.key === 'Escape') closeEditMode()
    return
  }

  if (event.key === 'Escape' && fabMenuOpen.value) {
    closeFabMenu()
  }

  if (!lightboxOpen.value) return
  if (event.key === 'Escape') closeLightbox()
  if (event.key === 'ArrowRight') nextLightbox()
  if (event.key === 'ArrowLeft') prevLightbox()
}

async function submitAuth() {
  message.value = ''
  try {
    const payload =
      mode.value === 'register'
        ? await api.register({
            email: authForm.email,
            password: authForm.password,
            displayName: authForm.displayName,
          })
        : await api.login({
            email: authForm.email,
            password: authForm.password,
          })

    token.value = payload.accessToken
    userName.value = payload.user.displayName || payload.user.email
    localStorage.setItem('jellyree_token', payload.accessToken)
    localStorage.setItem('jellyree_user', userName.value)
    await loadAll()
  } catch (error) {
    message.value = (error as Error).message
  }
}

function logout() {
  Object.keys(thumbs.value).forEach((mediaId) => clearThumb(mediaId))
  closeContextMenus()
  token.value = ''
  userName.value = ''
  media.value = []
  activeMediaId.value = null
  lightboxOpen.value = false
  editModeOpen.value = false
  localStorage.removeItem('jellyree_token')
  localStorage.removeItem('jellyree_user')
}

watch([activeAlbumId, activeSection, search], () => {
  if (!token.value) return
  if (activeSection.value === 'favorites') {
    activeAlbumId.value = ''
  }
  void loadAll()
})

watch(activeMedia, (item) => {
  applyMediaToEditor(item)
  if (item) {
    void loadThumb(item.id)
  }
})

watch(filteredMedia, (items) => {
  const allowed = new Set(items.map((item) => item.id))
  selectedMediaIds.value = selectedMediaIds.value.filter((id) => allowed.has(id))
  if (activeMediaId.value && !allowed.has(activeMediaId.value)) {
    activeMediaId.value = selectedMediaIds.value[0] || null
  }
})

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('pointerup', stopCropDrag)
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointerdown', onGlobalPointerDown)
  if (!token.value) return

  try {
    const me = await api.me(token.value)
    userName.value = (me as { displayName?: string; email?: string }).displayName ||
      (me as { email?: string }).email ||
      'user'
    await loadAll()
  } catch {
    logout()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('pointerup', stopCropDrag)
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointerdown', onGlobalPointerDown)
})
</script>

<template>
  <div class="app">
    <div v-if="!token" class="auth-wrap">
      <div class="auth-card">
        <div class="brand-name">Jellyree</div>
        <div class="brand-sub">cloud storage + photo gallery</div>
        <div class="auth-switch">
          <button class="chip" :class="{ active: mode === 'register' }" @click="mode = 'register'">
            Register
          </button>
          <button class="chip" :class="{ active: mode === 'login' }" @click="mode = 'login'">
            Login
          </button>
        </div>
        <input v-model="authForm.email" class="input" placeholder="Email" />
        <input v-model="authForm.password" class="input" type="password" placeholder="Password" />
        <input
          v-if="mode === 'register'"
          v-model="authForm.displayName"
          class="input"
          placeholder="Display name"
        />
        <button class="btn full" @click="submitAuth">
          {{ mode === 'register' ? 'Create account' : 'Sign in' }}
        </button>
        <div v-if="message" class="muted">{{ message }}</div>
      </div>
    </div>

    <template v-else>
      <header class="topbar">
        <div class="topbar-left">
          <div class="brand">
            <span class="brand-mark">jr</span>
            <div>
              <div class="brand-name">Jellyree</div>
              <div class="brand-sub">{{ userName }}</div>
            </div>
          </div>
          <div class="topbar-badge">{{ filteredMedia.length }} photos</div>
        </div>
        <div class="search shell">
          <input v-model="search" placeholder="Search in current view" />
        </div>
        <div class="topbar-right">
          <button class="btn ghost" @click="logout">Logout</button>
          <input
            ref="fileInput"
            type="file"
            multiple
            hidden
            @change="onFileInput"
          />
        </div>
      </header>

      <div class="workspace" @dragover.prevent @drop.prevent.stop="handleDrop">
        <aside class="sidebar">
          <div class="side-group">
            <div class="side-title">Library</div>
            <button
              class="nav-item"
              :class="{ active: activeSection === 'favorites' }"
              @click="activeSection = 'favorites'"
            >
              ★ Favorites
            </button>
            <button
              class="nav-item"
              :class="{ active: activeSection === 'all' && !activeAlbumId, 'media-drop-target': mediaDropTargetAlbumId === null && draggedMediaIds.length > 0 }"
              @dragover.prevent="onAlbumDragOver(null, $event)"
              @drop.prevent.stop="onAlbumDrop(null, $event)"
              @click="activeSection = 'all'; goRoot()"
            >
              All photos
            </button>
          </div>

          <div class="side-group">
            <div class="side-title">Pinned</div>
            <div
              v-for="album in pinnedAlbums"
              :key="`pin-${album.id}`"
              class="nav-item row album-row"
              :class="{ active: activeAlbumId === album.id && activeSection === 'all' }"
              @click="activeSection = 'all'; openAlbum(album.id)"
              @contextmenu.prevent="openAlbumContextMenu($event, album.id)"
              draggable="true"
              @dragstart="onPinnedDragStart(album.id)"
              @dragover.prevent
              @drop.stop="onPinnedDrop(album.id)"
              @dragend="onPinnedDragEnd"
            >
              <span>📁 {{ album.name }}</span>
              <button class="menu-dots-btn" @click.stop="openAlbumContextMenu($event, album.id)">⋯</button>
            </div>
          </div>

          <div class="side-group">
            <div class="side-title">Albums tree</div>
            <div
              v-for="node in albumTree"
              :key="node.album.id"
              class="nav-item row album-row"
              :class="{ active: activeAlbumId === node.album.id && activeSection === 'all', 'drop-target': albumDropTargetId === node.album.id, 'media-drop-target': mediaDropTargetAlbumId === node.album.id }"
              :style="{ paddingLeft: `${10 + node.depth * 16}px` }"
              draggable="true"
              @dragstart="onAlbumDragStart(node.album.id)"
              @dragover.prevent="onAlbumDragOver(node.album.id, $event)"
              @drop.prevent.stop="onAlbumDrop(node.album.id, $event)"
              @dragend="onAlbumDragEnd"
              @contextmenu.prevent="openAlbumContextMenu($event, node.album.id)"
              @click="activeSection = 'all'; openAlbum(node.album.id)"
            >
              <span class="row-main">
                <button
                  v-if="node.hasChildren"
                  class="tree-toggle"
                  @click.stop="toggleAlbumExpanded(node.album.id)"
                >
                  {{ expandedAlbumIds.includes(node.album.id) ? '▾' : '▸' }}
                </button>
                <span v-else class="tree-toggle ghost">·</span>
                <span>📁 {{ node.album.name }}</span>
              </span>
              <button class="menu-dots-btn" @click.stop="openAlbumContextMenu($event, node.album.id)">⋯</button>
            </div>
          </div>
        </aside>

        <main class="gallery-main" @pointerdown="startMarqueeSelect">
          <div class="gallery-head">
            <div>
              <div class="gallery-title">
                {{ activeSection === 'favorites' ? 'Favorites' : (activeAlbum ? activeAlbum.name : 'All photos') }}
              </div>
              <div class="muted">{{ filteredMedia.length }} items · {{ selectedCount }} selected</div>
            </div>
          </div>

          <div class="gallery-toolbar shell">
            <div class="row-actions">
              <select v-model="bulkTargetAlbumId" class="input bulk-select">
                <option value="">Move selected to album…</option>
                <option v-for="album in albums" :key="`bulk-${album.id}`" :value="album.id">
                  {{ album.name }}
                </option>
              </select>
              <button class="btn ghost" :disabled="selectedCount === 0 || !bulkTargetAlbumId" @click="bulkMoveSelectedToAlbum">
                Move selected
              </button>
              <button class="btn ghost" :disabled="selectedCount === 0" @click="bulkSetFavorite(true)">Favorite selected</button>
              <button class="btn ghost" :disabled="selectedCount === 0" @click="bulkSetFavorite(false)">Unfavorite selected</button>
              <button class="btn ghost" :disabled="selectedCount === 0" @click="downloadSelectedAsZip">Download selected</button>
              <button class="btn ghost danger" :disabled="selectedCount === 0" @click="bulkDeleteSelected">Delete selected</button>
              <button class="btn ghost" :disabled="selectedCount === 0" @click="clearSelection">Clear selection</button>
              <div class="muted" v-if="loading">Loading...</div>
            </div>
          </div>

          <div v-if="uploadProgress.active" class="upload-progress">
            <div class="upload-progress-label">
              Uploading {{ uploadProgress.count }} file(s) · {{ uploadProgress.percent }}%
            </div>
            <div class="upload-progress-track">
              <div class="upload-progress-fill" :style="{ width: `${uploadProgress.percent}%` }"></div>
            </div>
          </div>

          <div class="drop-hint">Drag photos to album tree on the left to move</div>

          <div ref="masonryRef" class="masonry">
            <article
              v-for="item in filteredMedia"
              :key="item.id"
              class="photo-card"
              :data-media-id="item.id"
              :class="{ active: activeMediaId === item.id, selected: selectedMediaSet.has(item.id) }"
              draggable="true"
              @dragstart="onMediaDragStart(item.id, $event)"
              @dragend="onMediaDragEnd"
              @click="selectMedia(item.id, $event)"
              @contextmenu.prevent="openMediaContextMenu($event, item.id)"
              @dblclick="openLightbox(item.id)"
            >
              <button class="card-menu-btn menu-dots-btn" @click.stop="openMediaContextMenu($event, item.id)">
                ⋯
              </button>

              <img
                v-if="thumbs[item.id] && canPreviewInBrowser(item)"
                class="photo-img"
                :src="thumbs[item.id]"
                :alt="item.filename"
                :style="mediaFilterStyle(item)"
                loading="lazy"
                @error="onThumbError(item.id)"
              />
              <div v-else class="photo-fallback">
                {{ item.mimeType }}
              </div>
              <div class="fav-indicator" v-if="item.isFavorite">★</div>
            </article>
          </div>
          <div v-if="marquee.active" class="marquee-box" :style="marqueeStyle"></div>

          <div class="fab-wrap" @click.stop>
            <div v-if="fabMenuOpen" class="fab-menu">
              <button class="fab-option" @click="openCreateAlbumDialog">Create album</button>
              <button class="fab-option" @click="uploadFromFab">Upload</button>
            </div>
            <button class="fab-create" @click="toggleFabMenu">+</button>
          </div>
        </main>

        <aside class="details" v-if="activeMedia">
          <div class="details-title">Photo details</div>
          <div class="details-preview">
            <img
              v-if="thumbs[activeMedia.id] && canPreviewInBrowser(activeMedia)"
              :src="thumbs[activeMedia.id]"
              :alt="activeMedia.filename"
              :style="mediaDetailsStyle(activeMedia)"
            />
            <div v-else class="photo-fallback">Preview unavailable</div>
          </div>

          <div class="field">
            <label>Name</label>
            <input v-model="editor.filename" class="input" />
          </div>
          <div class="field">
            <label>Metadata created</label>
            <div class="muted meta-value">{{ activeMediaMetadataCreatedLabel }}</div>
          </div>
          <div class="field">
            <label>Metadata modified</label>
            <div class="muted meta-value">{{ activeMediaMetadataModifiedLabel }}</div>
          </div>
          <div class="field">
            <label>Tags</label>
            <input v-model="editor.tagsInput" class="input" placeholder="tag1, tag2" />
          </div>

          <div class="field">
            <label>Album</label>
            <select v-model="targetAlbumId" class="input">
              <option value="">Select album</option>
              <option v-for="album in albums" :key="album.id" :value="album.id">{{ album.name }}</option>
            </select>
            <button class="btn ghost" @click="addActiveToAlbum" :disabled="!targetAlbumId">Move to album</button>
          </div>

          <div class="field" v-if="activeMediaAlbum">
            <label>Current album</label>
            <div class="chips">
              <span class="chip-lite">{{ activeMediaAlbum.name }}</span>
            </div>
          </div>

          <div class="field">
            <label>Metadata location</label>
            <div class="muted meta-value">{{ activeMediaLocationLabel }}</div>
          </div>

          <div class="detail-actions">
            <button class="btn" :disabled="saving" @click="saveMediaInfo">Save info</button>
            <button class="btn ghost" @click="openEditMode(activeMedia.id)">Edit photo</button>
            <button class="btn ghost" @click="toggleFavorite(activeMedia.id)">
              {{ activeMedia.isFavorite ? 'Unfavorite' : 'Favorite' }}
            </button>
            <button class="btn ghost" @click="downloadMediaFile(activeMedia.id)">Download</button>
            <button class="btn ghost danger" @click="deleteMedia(activeMedia.id)">Delete</button>
          </div>

          <div v-if="message" class="muted">{{ message }}</div>
        </aside>
      </div>

      <div
        v-if="albumContextMenu.open"
        class="context-menu-floating"
        :style="{ left: `${albumContextMenu.x}px`, top: `${albumContextMenu.y}px` }"
      >
        <button @click="contextOpenAlbum">Open album</button>
        <button @click="contextToggleAlbumPin">{{ pinnedAlbumIds.includes(albumContextMenu.albumId || '') ? 'Unpin album' : 'Pin album' }}</button>
        <button v-if="selectedAlbumFromContext()?.parentId" @click="contextMoveAlbumToRoot">Move to root</button>
        <button @click="contextRenameAlbum">Rename</button>
        <button class="danger" @click="contextDeleteAlbum">Delete</button>
      </div>

      <div
        v-if="mediaContextMenu.open"
        class="context-menu-floating"
        :style="{ left: `${mediaContextMenu.x}px`, top: `${mediaContextMenu.y}px` }"
      >
        <button @click="contextOpenMedia">Open</button>
        <button @click="contextEditMedia">Edit photo</button>
        <button @click="contextDownloadMedia">Download</button>
        <button @click="contextToggleMediaFavorite">
          {{ mediaFromContext()?.isFavorite ? 'Remove favorite' : 'Add favorite' }}
        </button>
        <button class="danger" @click="contextDeleteMedia">Delete</button>
      </div>

      <div v-if="lightboxOpen && activeMedia" class="overlay" @click.self="closeLightbox">
        <button class="overlay-close" @click="closeLightbox">×</button>
        <button v-if="lightboxItems.length > 1" class="overlay-arrow left" @click.stop="prevLightbox">‹</button>

        <div class="overlay-content">
          <div class="lightbox-actions">
            <button class="btn ghost" @click.stop="openEditMode(activeMedia.id)">Edit</button>
            <button class="btn ghost" @click.stop="toggleFavorite(activeMedia.id)">
              {{ activeMedia.isFavorite ? '★ Favorited' : '☆ Favorite' }}
            </button>
            <button class="btn ghost danger" @click.stop="deleteMedia(activeMedia.id)">Delete</button>
          </div>

          <img
            v-if="thumbs[activeMedia.id] && canPreviewInBrowser(activeMedia)"
            class="overlay-image"
            :src="thumbs[activeMedia.id]"
            :alt="activeMedia.filename"
            :style="mediaFilterStyle(activeMedia)"
            @error="onThumbError(activeMedia.id)"
          />
          <div v-else class="overlay-fallback">{{ activeMedia.filename }} · {{ activeMedia.mimeType }}</div>

          <div class="overlay-meta">
            <span>{{ activeMedia.filename }}</span>
            <span v-if="lightboxIndex >= 0">{{ lightboxIndex + 1 }} / {{ lightboxItems.length }}</span>
          </div>

          <div v-if="lightboxItems.length > 1" class="lightbox-strip">
            <button
              v-for="item in lightboxItems"
              :key="item.id"
              class="lightbox-thumb"
              :class="{ active: item.id === activeMedia.id }"
              @click.stop="openLightbox(item.id)"
            >
              <img
                v-if="thumbs[item.id] && canPreviewInBrowser(item)"
                :src="thumbs[item.id]"
                :alt="item.filename"
                loading="lazy"
                @error="onThumbError(item.id)"
              />
              <span v-else>{{ item.mimeType.split('/')[1] || 'file' }}</span>
            </button>
          </div>
        </div>

        <button v-if="lightboxItems.length > 1" class="overlay-arrow right" @click.stop="nextLightbox">›</button>
      </div>

      <div v-if="editModeOpen && activeMedia" class="overlay" @click.self="closeEditMode">
        <div class="editor-modal">
          <div class="editor-head">
            <div class="details-title">Photo editor</div>
            <button class="chip" @click="closeEditMode">Close</button>
          </div>

          <div class="editor-preview">
            <div
              v-if="thumbs[activeMedia.id] && canPreviewInBrowser(activeMedia)"
              class="editor-crop-stage"
              @pointermove="onCropPointerMove"
              @pointerup="stopCropDrag"
              @pointerleave="stopCropDrag"
            >
              <div ref="editorCropStage" class="editor-image-frame">
                <img
                  class="overlay-image editor-image"
                  :src="thumbs[activeMedia.id]"
                  :alt="activeMedia.filename"
                  :style="mediaFilterStyleFromEditor()"
                />
                <div class="crop-rect" :style="editorCropRectStyle" @pointerdown="startCropDrag($event, 'move')">
                  <span class="crop-grid v1"></span>
                  <span class="crop-grid v2"></span>
                  <span class="crop-grid h1"></span>
                  <span class="crop-grid h2"></span>
                  <span class="crop-handle nw" @pointerdown.stop="startCropDrag($event, 'nw')"></span>
                  <span class="crop-handle ne" @pointerdown.stop="startCropDrag($event, 'ne')"></span>
                  <span class="crop-handle sw" @pointerdown.stop="startCropDrag($event, 'sw')"></span>
                  <span class="crop-handle se" @pointerdown.stop="startCropDrag($event, 'se')"></span>
                  <span class="crop-handle n" @pointerdown.stop="startCropDrag($event, 'n')"></span>
                  <span class="crop-handle s" @pointerdown.stop="startCropDrag($event, 's')"></span>
                  <span class="crop-handle w" @pointerdown.stop="startCropDrag($event, 'w')"></span>
                  <span class="crop-handle e" @pointerdown.stop="startCropDrag($event, 'e')"></span>
                </div>
              </div>
            </div>
            <div v-else class="overlay-fallback">Preview unavailable for this format</div>
          </div>

          <div class="editor-controls">
            <div class="slider-row">
              <span>Brightness</span>
              <input v-model="editor.brightness" type="range" min="-60" max="60" />
            </div>
            <div class="slider-row">
              <span>Contrast</span>
              <input v-model="editor.contrast" type="range" min="-60" max="60" />
            </div>
            <div class="slider-row">
              <span>Color</span>
              <input v-model="editor.saturation" type="range" min="-60" max="60" />
            </div>
            <div class="slider-row">
              <span>Grayscale</span>
              <input v-model="editor.grayscale" type="range" min="0" max="100" />
            </div>
            <div class="slider-row">
              <span>Sepia</span>
              <input v-model="editor.sepia" type="range" min="0" max="100" />
            </div>
            <div class="slider-row">
              <span>Crop zoom</span>
              <input v-model="editor.cropZoom" type="range" min="0" max="60" />
            </div>
            <div class="slider-row">
              <span>Rotate</span>
              <input v-model="editor.rotate" type="range" min="-180" max="180" />
            </div>
            <div class="slider-row switches">
              <span>Mirror</span>
              <div class="switch-group">
                <label><input v-model="editor.flipX" type="checkbox" /> Horizontal</label>
                <label><input v-model="editor.flipY" type="checkbox" /> Vertical</label>
              </div>
            </div>
          </div>

          <div class="editor-actions">
            <button class="btn ghost" @click="resetEditorAdjustments">Reset</button>
            <button class="btn ghost" @click="closeEditMode">Cancel</button>
            <button class="btn ghost" :disabled="saving || undoCount === 0" @click="undoLastPermanentEdit">
              Undo apply ({{ undoCount }})
            </button>
            <button class="btn" :disabled="saving" @click="applyImageEditsPermanently">Apply permanently</button>
          </div>
        </div>
      </div>

      <div v-if="createAlbumDialogOpen" class="overlay" @click.self="closeCreateAlbumDialog">
        <div class="album-dialog">
          <div class="details-title">Create album</div>
          <input
            v-model="createAlbumName"
            class="input"
            placeholder="Album name"
            @keyup.enter="createAlbum"
          />
          <div class="dialog-actions">
            <button class="btn ghost" @click="closeCreateAlbumDialog">Cancel</button>
            <button class="btn" :disabled="createAlbumBusy || !createAlbumName.trim()" @click="createAlbum">
              Create
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
