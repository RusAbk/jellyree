<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { api, type Album, type MediaItem, type Tag } from './api'

type AlbumTreeNode = {
  album: Album
  depth: number
  hasChildren: boolean
}

type MobileMenuScreen = 'main' | 'library' | 'bulk'

type PersistedAppViewState = {
  activeSection: 'all' | 'favorites' | 'tags'
  activeAlbumId: string
  activeTagId: string
  search: string
  activeMediaId: string | null
  lightboxOpen: boolean
}

const APP_VIEW_STATE_KEY = 'jellyree_app_view_state'

const token = ref(localStorage.getItem('jellyree_token') || '')
const userName = ref(localStorage.getItem('jellyree_user') || '')
const mode = ref<'login' | 'register'>('login')
const authForm = reactive({
  email: '',
  password: '',
  displayName: '',
})

const media = ref<MediaItem[]>([])
const albums = ref<Album[]>([])
const tags = ref<Tag[]>([])
const thumbs = ref<Record<string, string>>({})
const lightboxFullImage = ref<{ mediaId: string; url: string } | null>(null)
const activeMediaId = ref<string | null>(null)
const activeSection = ref<'all' | 'favorites' | 'tags'>('all')
const activeAlbumId = ref('')
const activeTagId = ref('')
const search = ref('')
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const routeMode = ref<'app' | 'public-media' | 'public-album'>('app')
const routeToken = ref('')
const routeAlbumId = ref<string | null>(null)
const routeMediaId = ref<string | null>(null)
const syncingFromRoute = ref(false)
const sharedLoading = ref(false)
const sharedAlbum = ref<{ id: string; name: string; description: string | null } | null>(null)
const sharedMedia = ref<MediaItem | null>(null)
const sharedAlbumMedia = ref<MediaItem[]>([])
const sharedPassword = ref('')
const sharedPasswordInput = ref('')
const mediaShareEnabled = ref<Record<string, boolean>>({})
const albumShareEnabled = ref<Record<string, boolean>>({})

const fileInput = ref<HTMLInputElement | null>(null)
const lightboxStripRef = ref<HTMLDivElement | null>(null)
const lightboxOpen = ref(false)
const editModeOpen = ref(false)
const createAlbumName = ref('')
const createAlbumBusy = ref(false)
const fabMenuOpen = ref(false)
const createAlbumDialogOpen = ref(false)
const mobileDetailsOpen = ref(false)
const mobileSelectMode = ref(false)
const mobileUserMenuOpen = ref(false)
const mobileMenuScreen = ref<MobileMenuScreen>('main')
const isMobileViewport = ref(false)
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
const tagsInputRef = ref<HTMLInputElement | null>(null)
const lightboxTagsInputRef = ref<HTMLInputElement | null>(null)
const selectedMediaIds = ref<string[]>([])
const suppressClickUntil = ref(0)
const isTouchUi = ref(false)
const suppressTagsCommitOnBlur = ref(false)
const lightboxTagsEditing = ref(false)
const lightboxTagsInput = ref('')

const touchGesture = reactive({
  timer: null as ReturnType<typeof setTimeout> | null,
  target: null as 'media' | 'album' | null,
  id: null as string | null,
  x: 0,
  y: 0,
  moved: false,
  longPressTriggered: false,
})

const lightboxSwipe = reactive({
  active: false,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  startedAt: 0,
  horizontalIntent: false,
})

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
const activeDetailsField = ref<'filename' | 'tags' | 'album' | 'metadataCreatedAt' | 'metadataModifiedAt' | 'location' | null>(null)
const toast = reactive({
  visible: false,
  text: '',
})
const shareDialog = reactive({
  open: false,
  resourceType: 'media' as 'media' | 'album',
  resourceId: '',
  enabled: false,
  accessMode: 'link' as 'link' | 'password',
  password: '',
  hasPassword: false,
  token: null as string | null,
  expiresPreset: 'never' as 'never' | '1m' | '5m' | '1h' | '24h' | '7d' | '30d',
  loading: false,
  saving: false,
})

let toastTimer: ReturnType<typeof setTimeout> | null = null
let popStateHandler: (() => void) | null = null
const thumbLoadsInFlight = new Map<string, Promise<void>>()
const thumbQueue = {
  active: 0,
  limit: 6,
  waiters: [] as Array<() => void>,
}

const editor = reactive({
  filename: '',
  tagsInput: '',
  metadataCreatedAtInput: '',
  metadataModifiedAtInput: '',
  locationInput: '',
  temperature: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  toneDepth: 0,
  shadowsLevel: 0,
  highlightsLevel: 0,
  sharpness: 0,
  definition: 0,
  vignette: 0,
  glamour: 0,
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

type EditorMobileTab =
  | 'previewScale'
  | 'temperature'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'toneDepth'
  | 'shadowsLevel'
  | 'highlightsLevel'
  | 'sharpness'
  | 'definition'
  | 'vignette'
  | 'glamour'
  | 'grayscale'
  | 'sepia'
  | 'cropZoom'
  | 'rotate'
  | 'mirror'

const activeEditorMobileTab = ref<EditorMobileTab>('temperature')
const editorMobileTabs: Array<{ key: EditorMobileTab; label: string }> = [
  { key: 'previewScale', label: 'Scale' },
  { key: 'temperature', label: 'Temp' },
  { key: 'brightness', label: 'Bright' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Sat' },
  { key: 'toneDepth', label: 'Depth' },
  { key: 'shadowsLevel', label: 'Shadows' },
  { key: 'highlightsLevel', label: 'Highlights' },
  { key: 'sharpness', label: 'Sharp' },
  { key: 'definition', label: 'Def' },
  { key: 'vignette', label: 'Vignette' },
  { key: 'glamour', label: 'Glamour' },
  { key: 'grayscale', label: 'Gray' },
  { key: 'sepia', label: 'Sepia' },
  { key: 'cropZoom', label: 'Zoom' },
  { key: 'rotate', label: 'Rotate' },
  { key: 'mirror', label: 'Mirror' },
]

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
const lightboxActiveImageSrc = computed(() => {
  const item = activeMedia.value
  if (!item) return ''
  if (lightboxFullImage.value?.mediaId === item.id) {
    return lightboxFullImage.value.url
  }
  return thumbs.value[item.id] || ''
})
const activeAlbum = computed(() => albums.value.find((album) => album.id === activeAlbumId.value) || null)
const isPublicRoute = computed(() => routeMode.value !== 'app')

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

const sortedTags = computed(() =>
  [...tags.value].sort((a, b) => a.name.localeCompare(b.name)),
)

const activeTag = computed(() => tags.value.find((tag) => tag.id === activeTagId.value) || null)
const parsedTagsInput = computed(() => {
  const raw = editor.tagsInput
  const parts = raw.split(',')
  const draftRaw = parts.pop() ?? ''
  const selected = new Set(
    parts
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  )
  return {
    selected,
    draftRaw,
    draft: draftRaw.trim().toLowerCase(),
  }
})

const tagSuggestions = computed(() => {
  if (activeDetailsField.value !== 'tags') return []
  const { draft, selected } = parsedTagsInput.value
  if (!draft) return []

  return sortedTags.value.filter((tag) => {
    const name = tag.name.toLowerCase()
    return name.startsWith(draft) && !selected.has(name)
  })
})

const filteredMedia = computed(() => {
  const q = search.value.trim().toLowerCase()
  let base = media.value

  if (activeSection.value === 'favorites') {
    base = base.filter((item) => item.isFavorite)
  }

  if (activeSection.value === 'tags' && activeTagId.value) {
    base = base.filter((item) => item.mediaTags.some((entry) => entry.tag.id === activeTagId.value))
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
const visibleSubalbums = computed(() => {
  if (activeSection.value !== 'all') return []
  const parentId = activeAlbumId.value || null
  const q = search.value.trim().toLowerCase()
  return albums.value
    .filter((album) => (album.parentId || null) === parentId)
    .filter((album) => !q || album.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
})
const visibleSubalbumPreviewMedia = computed(() =>
  visibleSubalbums.value.flatMap((album) => album.previewMedia || []).slice(0, 32),
)
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

const editorPreviewScale = ref(100)
const editorPreviewFrameStyle = computed(() => ({
  transform: `scale(${editorPreviewScale.value / 100})`,
  transformOrigin: 'top left',
}))

function authHeaders() {
  return token.value
}

function readPersistedAppViewState(): PersistedAppViewState | null {
  try {
    const raw = localStorage.getItem(APP_VIEW_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedAppViewState>
    if (!parsed || typeof parsed !== 'object') return null

    const section = parsed.activeSection
    if (section !== 'all' && section !== 'favorites' && section !== 'tags') return null

    return {
      activeSection: section,
      activeAlbumId: typeof parsed.activeAlbumId === 'string' ? parsed.activeAlbumId : '',
      activeTagId: typeof parsed.activeTagId === 'string' ? parsed.activeTagId : '',
      search: typeof parsed.search === 'string' ? parsed.search : '',
      activeMediaId: typeof parsed.activeMediaId === 'string' && parsed.activeMediaId ? parsed.activeMediaId : null,
      lightboxOpen: parsed.lightboxOpen === true,
    }
  } catch {
    return null
  }
}

function persistAppViewState() {
  if (routeMode.value !== 'app' || !token.value) return
  const snapshot: PersistedAppViewState = {
    activeSection: activeSection.value,
    activeAlbumId: activeAlbumId.value,
    activeTagId: activeTagId.value,
    search: search.value,
    activeMediaId: activeMediaId.value,
    lightboxOpen: lightboxOpen.value,
  }
  localStorage.setItem(APP_VIEW_STATE_KEY, JSON.stringify(snapshot))
}

function clearPersistedAppViewState() {
  localStorage.removeItem(APP_VIEW_STATE_KEY)
}

function readRouteFromLocation() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  const sharedMediaMatch = path.match(/^\/shared\/media\/([^/]+)$/)
  if (sharedMediaMatch) {
    return { mode: 'public-media' as const, token: decodeURIComponent(sharedMediaMatch[1] || '') }
  }

  const sharedAlbumMatch = path.match(/^\/shared\/album\/([^/]+)$/)
  if (sharedAlbumMatch) {
    return { mode: 'public-album' as const, token: decodeURIComponent(sharedAlbumMatch[1] || '') }
  }

  const albumMatch = path.match(/^\/albums\/([^/]+)$/)
  if (albumMatch) {
    return { mode: 'app' as const, albumId: decodeURIComponent(albumMatch[1] || ''), mediaId: null as string | null }
  }

  const mediaMatch = path.match(/^\/media\/([^/]+)$/)
  if (mediaMatch) {
    return { mode: 'app' as const, albumId: null as string | null, mediaId: decodeURIComponent(mediaMatch[1] || '') }
  }

  return { mode: 'app' as const, albumId: null as string | null, mediaId: null as string | null }
}

function pushPath(path: string, replace = false) {
  const next = path || '/'
  if (window.location.pathname === next) return
  if (replace) {
    window.history.replaceState({}, '', next)
  } else {
    window.history.pushState({}, '', next)
  }
}

async function loadPublicRoute() {
  if (!routeToken.value) return
  sharedLoading.value = true
  message.value = ''

  try {
    if (routeMode.value === 'public-media') {
      const payload = await api.publicMedia(routeToken.value, sharedPassword.value || undefined)
      sharedMedia.value = payload.media
      sharedAlbum.value = null
      sharedAlbumMedia.value = []
      return
    }

    if (routeMode.value === 'public-album') {
      const payload = await api.publicAlbum(routeToken.value, sharedPassword.value || undefined)
      sharedAlbum.value = payload.album
      sharedAlbumMedia.value = payload.media
      sharedMedia.value = null
      return
    }
  } catch (error) {
    message.value = (error as Error).message
    sharedMedia.value = null
    sharedAlbum.value = null
    sharedAlbumMedia.value = []
  } finally {
    sharedLoading.value = false
  }
}

async function applyRouteFromLocation() {
  const route = readRouteFromLocation()

  if (route.mode !== 'app') {
    routeMode.value = route.mode
    routeToken.value = route.token
    routeAlbumId.value = null
    routeMediaId.value = null
    sharedPassword.value = ''
    sharedPasswordInput.value = ''
    await loadPublicRoute()
    return
  }

  routeMode.value = 'app'
  routeToken.value = ''
  routeAlbumId.value = route.albumId || null
  routeMediaId.value = route.mediaId || null
  sharedMedia.value = null
  sharedAlbum.value = null
  sharedAlbumMedia.value = []

  if (!token.value) return

  syncingFromRoute.value = true
  lightboxOpen.value = false
  activeSection.value = 'all'
  activeTagId.value = ''
  activeAlbumId.value = routeAlbumId.value || ''

  if (routeMediaId.value) {
    activeMediaId.value = routeMediaId.value
    const persisted = readPersistedAppViewState()
    if (persisted?.lightboxOpen && persisted.activeMediaId === routeMediaId.value) {
      lightboxOpen.value = true
    }
  } else if (routeAlbumId.value) {
    activeMediaId.value = null
    const persisted = readPersistedAppViewState()
    if (persisted) {
      search.value = persisted.search
    }
  } else {
    const persisted = readPersistedAppViewState()
    if (persisted) {
      search.value = persisted.search
      activeSection.value = persisted.activeSection
      if (persisted.activeSection === 'all') {
        activeAlbumId.value = persisted.activeAlbumId
        activeTagId.value = ''
      } else if (persisted.activeSection === 'tags') {
        activeAlbumId.value = ''
        activeTagId.value = persisted.activeTagId
      } else {
        activeAlbumId.value = ''
        activeTagId.value = ''
      }
      activeMediaId.value = persisted.activeMediaId
      lightboxOpen.value = persisted.lightboxOpen && Boolean(persisted.activeMediaId)
    } else {
      activeMediaId.value = null
    }
  }
  syncingFromRoute.value = false
  await loadAll()
}

function mediaShareUrl(tokenValue: string) {
  return `${window.location.origin}/shared/media/${encodeURIComponent(tokenValue)}`
}

function albumShareUrl(tokenValue: string) {
  return `${window.location.origin}/shared/album/${encodeURIComponent(tokenValue)}`
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
}

function isAlbumShareEnabled(albumId: string) {
  return albumShareEnabled.value[albumId] === true
}

function isMediaShareEnabled(mediaId: string) {
  return mediaShareEnabled.value[mediaId] === true
}

function closeShareDialog() {
  shareDialog.open = false
  shareDialog.resourceId = ''
  shareDialog.password = ''
  shareDialog.token = null
  shareDialog.expiresPreset = 'never'
  shareDialog.loading = false
  shareDialog.saving = false
}

function deriveExpiresPreset(expiresAt: string | null) {
  if (!expiresAt) return 'never' as const
  const diff = new Date(expiresAt).getTime() - Date.now()
  const minute = 60 * 1000
  const hour = 60 * 60 * 1000
  const day = 24 * hour
  if (diff <= 2 * minute) return '1m' as const
  if (diff <= 8 * minute) return '5m' as const
  if (diff <= 2 * hour) return '1h' as const
  if (diff <= 2 * day) return '24h' as const
  if (diff <= 8 * day) return '7d' as const
  return '30d' as const
}

function computeExpiresAtFromPreset() {
  if (shareDialog.expiresPreset === 'never') return null
  const now = Date.now()
  const minute = 60 * 1000
  const hour = 60 * 60 * 1000
  const day = 24 * hour
  const ttl = shareDialog.expiresPreset === '1m'
    ? minute
    : shareDialog.expiresPreset === '5m'
      ? 5 * minute
      : shareDialog.expiresPreset === '1h'
        ? hour
        : shareDialog.expiresPreset === '24h'
          ? day
          : shareDialog.expiresPreset === '7d'
            ? 7 * day
            : 30 * day
  return new Date(now + ttl).toISOString()
}

function publicFileUrl(mediaId: string) {
  if (!routeToken.value) return ''
  if (routeMode.value === 'public-media') {
    return api.publicMediaFileUrl(routeToken.value, sharedPassword.value || undefined)
  }
  if (routeMode.value === 'public-album') {
    return api.publicAlbumMediaFileUrl(routeToken.value, mediaId, sharedPassword.value || undefined)
  }
  return ''
}

function submitSharedPassword() {
  sharedPassword.value = sharedPasswordInput.value.trim()
  void loadPublicRoute()
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

function toDateTimeLocalInput(value: string | null) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const offsetMs = parsed.getTimezoneOffset() * 60_000
  const local = new Date(parsed.getTime() - offsetMs)
  return local.toISOString().slice(0, 16)
}

function fromDateTimeLocalInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function formatLocationInput(latitude: number | null, longitude: number | null) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return ''
  return `${latitude}, ${longitude}`
}

function parseLocationInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return { latitude: null as number | null, longitude: null as number | null }
  }

  const parts = trimmed.split(',').map((item) => item.trim())
  if (parts.length !== 2) return null

  const latitude = Number(parts[0])
  const longitude = Number(parts[1])
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null

  return { latitude, longitude }
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

function openAlbumContextMenuAt(albumId: string, x: number, y: number) {
  albumContextMenu.open = true
  albumContextMenu.albumId = albumId
  albumContextMenu.x = x
  albumContextMenu.y = y
  mediaContextMenu.open = false
  mediaContextMenu.mediaId = null
  void preloadAlbumShareState(albumId)
}

function openAlbumContextMenu(event: MouseEvent, albumId: string) {
  event.preventDefault()
  event.stopPropagation()
  openAlbumContextMenuAt(albumId, event.clientX, event.clientY)
}

function openMediaContextMenuAt(mediaId: string, x: number, y: number) {
  selectMedia(mediaId)
  mediaContextMenu.open = true
  mediaContextMenu.mediaId = mediaId
  mediaContextMenu.x = x
  mediaContextMenu.y = y
  albumContextMenu.open = false
  albumContextMenu.albumId = null
  void preloadMediaShareState(mediaId)
}

function openMediaContextMenu(event: MouseEvent, mediaId: string) {
  event.preventDefault()
  event.stopPropagation()
  selectMedia(mediaId, event)
  openMediaContextMenuAt(mediaId, event.clientX, event.clientY)
}

function cancelTouchGesture() {
  if (touchGesture.timer) {
    clearTimeout(touchGesture.timer)
    touchGesture.timer = null
  }
  touchGesture.target = null
  touchGesture.id = null
  touchGesture.moved = false
  touchGesture.longPressTriggered = false
}

function startTouchGesture(target: 'media' | 'album', id: string, event: TouchEvent) {
  if (!isTouchUi.value || event.touches.length !== 1) return
  cancelTouchGesture()

  const touch = event.touches[0]
  if (!touch) return

  touchGesture.target = target
  touchGesture.id = id
  touchGesture.x = touch.clientX
  touchGesture.y = touch.clientY
  touchGesture.moved = false
  touchGesture.longPressTriggered = false
  touchGesture.timer = setTimeout(() => {
    if (touchGesture.moved || !touchGesture.id || !touchGesture.target) return
    touchGesture.longPressTriggered = true
    suppressClickUntil.value = Date.now()

    if (touchGesture.target === 'media') {
      openMediaContextMenuAt(touchGesture.id, touchGesture.x, touchGesture.y)
    } else {
      openAlbumContextMenuAt(touchGesture.id, touchGesture.x, touchGesture.y)
    }
  }, 520)
}

function moveTouchGesture(event: TouchEvent) {
  if (!touchGesture.timer || event.touches.length !== 1) return
  const touch = event.touches[0]
  if (!touch) return

  const dx = Math.abs(touch.clientX - touchGesture.x)
  const dy = Math.abs(touch.clientY - touchGesture.y)
  if (dx > 10 || dy > 10) {
    touchGesture.moved = true
    if (touchGesture.timer) {
      clearTimeout(touchGesture.timer)
      touchGesture.timer = null
    }
  }
}

function finishMediaTouch(mediaId: string) {
  if (!isTouchUi.value) return
  const skipTapAction = touchGesture.longPressTriggered || touchGesture.moved
  cancelTouchGesture()
  if (skipTapAction) return

  if (isMobileViewport.value && mobileSelectMode.value) {
    if (selectedMediaSet.value.has(mediaId)) {
      selectedMediaIds.value = selectedMediaIds.value.filter((id) => id !== mediaId)
      if (activeMediaId.value === mediaId) {
        activeMediaId.value = selectedMediaIds.value[0] || null
      }
      if (selectedMediaIds.value.length === 0) {
        mobileSelectMode.value = false
      }
    } else {
      selectedMediaIds.value = [...selectedMediaIds.value, mediaId]
      activeMediaId.value = mediaId
      void loadThumb(mediaId)
    }
    return
  }

  openLightbox(mediaId)
}

function finishAlbumTouch(albumId: string) {
  if (!isTouchUi.value) return
  const skipTapAction = touchGesture.longPressTriggered || touchGesture.moved
  cancelTouchGesture()
  if (skipTapAction) return

  suppressClickUntil.value = Date.now()
  activeSection.value = 'all'
  openAlbum(albumId)
}

function onMediaCardClick(mediaId: string, event: MouseEvent) {
  if (isTouchUi.value) return

  if (isMobileViewport.value && mobileSelectMode.value) {
    if (selectedMediaSet.value.has(mediaId)) {
      selectedMediaIds.value = selectedMediaIds.value.filter((id) => id !== mediaId)
      if (activeMediaId.value === mediaId) {
        activeMediaId.value = selectedMediaIds.value[0] || null
      }
      if (selectedMediaIds.value.length === 0) {
        mobileSelectMode.value = false
      }
    } else {
      selectedMediaIds.value = [...selectedMediaIds.value, mediaId]
      activeMediaId.value = mediaId
      void loadThumb(mediaId)
    }
    return
  }

  selectMedia(mediaId, event)
}

function onMediaCardDoubleClick(mediaId: string) {
  if (isTouchUi.value) return
  openLightbox(mediaId)
}

function onAlbumCardClick(albumId: string) {
  if (Date.now() - suppressClickUntil.value < 260) return
  activeSection.value = 'all'
  openAlbum(albumId)
}

function isLongPressPending(target: 'media' | 'album', id: string) {
  return (
    isTouchUi.value &&
    touchGesture.target === target &&
    touchGesture.id === id &&
    Boolean(touchGesture.timer) &&
    !touchGesture.moved &&
    !touchGesture.longPressTriggered
  )
}

async function preloadAlbumShareState(albumId: string) {
  if (!token.value) return
  try {
    const current = await api.getAlbumShareSettings(authHeaders(), albumId)
    albumShareEnabled.value = {
      ...albumShareEnabled.value,
      [albumId]: current.settings.enabled,
    }
  } catch {
    albumShareEnabled.value = {
      ...albumShareEnabled.value,
      [albumId]: false,
    }
  }
}

async function preloadMediaShareState(mediaId: string) {
  if (!token.value) return
  try {
    const current = await api.getMediaShareSettings(authHeaders(), mediaId)
    mediaShareEnabled.value = {
      ...mediaShareEnabled.value,
      [mediaId]: current.settings.enabled,
    }
  } catch {
    mediaShareEnabled.value = {
      ...mediaShareEnabled.value,
      [mediaId]: false,
    }
  }
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

async function contextShareAlbum() {
  const album = selectedAlbumFromContext()
  closeContextMenus()
  if (!album) return
  await configureAlbumShare(album.id)
}

async function contextCopyAlbumShareLink() {
  const album = selectedAlbumFromContext()
  closeContextMenus()
  if (!album) return
  await copyAlbumShareLink(album.id)
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

function contextOpenMediaDetails() {
  const item = mediaFromContext()
  closeContextMenus()
  if (!item) return
  selectMedia(item.id)
  mobileDetailsOpen.value = true
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

async function contextShareMedia() {
  const item = mediaFromContext()
  closeContextMenus()
  if (!item) return
  await configureMediaShare(item.id)
}

async function contextCopyMediaShareLink() {
  const item = mediaFromContext()
  closeContextMenus()
  if (!item) return
  await copyMediaShareLink(item.id)
}

function contextCopyMedia() {
  const item = mediaFromContext()
  closeContextMenus()
  if (!item) return
  void duplicateMedia(item.id)
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
    closeMobileUserMenu()
    return
  }

  if (!target.closest('.mobile-menu-fullscreen') && !target.closest('.hamburger-btn')) {
    closeMobileUserMenu()
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

function splitFilenameParts(filename: string) {
  const trimmed = filename.trim()
  const index = trimmed.lastIndexOf('.')
  if (index <= 0 || index === trimmed.length - 1) {
    return { baseName: trimmed, extension: '' }
  }
  return {
    baseName: trimmed.slice(0, index),
    extension: trimmed.slice(index),
  }
}

function activeFilenameExtension() {
  if (!activeMedia.value) return ''
  return splitFilenameParts(activeMedia.value.filename).extension
}

function displayEditorFilename() {
  const baseName = editor.filename.trim()
  if (!baseName) return '—'
  return `${baseName}${activeFilenameExtension()}`
}

function isHeicFile(item: MediaItem) {
  const mime = item.mimeType.toLowerCase()
  if (mime.includes('heic') || mime.includes('heif')) return true
  const ext = getFileExtension(item.filename)
  return ext === 'heic' || ext === 'heif'
}

function isHeicLike(mimeType: string, filename: string) {
  const mime = mimeType.toLowerCase()
  if (mime.includes('heic') || mime.includes('heif')) return true
  const ext = getFileExtension(filename)
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

function canPreviewFromMeta(mediaId: string, mimeType: string, filename: string) {
  const mime = mimeType.toLowerCase()
  if (!mime.startsWith('image/')) {
    const ext = getFileExtension(filename)
    if (!['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'avif'].includes(ext)) {
      return false
    }
  }
  if (isHeicLike(mimeType, filename)) {
    return Boolean(thumbs.value[mediaId])
  }
  return true
}

function onThumbError(mediaId: string) {
  if (lightboxFullImage.value?.mediaId === mediaId) {
    clearLightboxFullImage()
    return
  }
  thumbs.value[mediaId] = ''
}

function clearThumb(mediaId: string) {
  const previous = thumbs.value[mediaId]
  if (previous && previous.startsWith('blob:')) {
    URL.revokeObjectURL(previous)
  }
  delete thumbs.value[mediaId]
}

function clearLightboxFullImage() {
  const current = lightboxFullImage.value
  if (current?.url?.startsWith('blob:')) {
    URL.revokeObjectURL(current.url)
  }
  lightboxFullImage.value = null
}

async function loadActiveLightboxFullImage() {
  if (!lightboxOpen.value || !activeMedia.value || !token.value) return
  const item = activeMedia.value

  if (isHeicFile(item)) {
    clearLightboxFullImage()
    return
  }

  const mediaId = item.id

  try {
    const blob = await api.fetchFileBlob(token.value, mediaId)
    const objectUrl = URL.createObjectURL(blob)

    if (!lightboxOpen.value || activeMediaId.value !== mediaId) {
      URL.revokeObjectURL(objectUrl)
      return
    }

    clearLightboxFullImage()
    lightboxFullImage.value = { mediaId, url: objectUrl }
  } catch {
    if (lightboxFullImage.value?.mediaId === mediaId) {
      clearLightboxFullImage()
    }
  }
}

async function loadThumb(mediaId: string) {
  if (thumbs.value[mediaId] || !token.value) return

  const existing = thumbLoadsInFlight.get(mediaId)
  if (existing) {
    await existing
    return
  }

  const task = (async () => {
    if (thumbQueue.active >= thumbQueue.limit) {
      await new Promise<void>((resolve) => {
        thumbQueue.waiters.push(resolve)
      })
    }

    thumbQueue.active += 1

    try {
      const targetBase = isMobileViewport.value ? 280 : 420
      const width = Math.max(
        180,
        Math.min(960, Math.round(targetBase * Math.max(1, Math.min(2, window.devicePixelRatio || 1)))),
      )
      const blob = await api.fetchThumbBlob(token.value as string, mediaId, width)
      thumbs.value[mediaId] = URL.createObjectURL(blob)
    } catch {
      try {
        const blob = await api.fetchFileBlob(token.value as string, mediaId)
        thumbs.value[mediaId] = URL.createObjectURL(blob)
      } catch {
        thumbs.value[mediaId] = ''
      }
    } finally {
      thumbQueue.active = Math.max(0, thumbQueue.active - 1)
      const next = thumbQueue.waiters.shift()
      if (next) next()
    }
  })()

  thumbLoadsInFlight.set(mediaId, task)

  try {
    await task
  } finally {
    thumbLoadsInFlight.delete(mediaId)
  }
}

function applyMediaToEditor(item: MediaItem | null) {
  if (!item) return
  editor.filename = splitFilenameParts(item.filename).baseName
  editor.tagsInput = item.mediaTags.map((entry) => entry.tag.name).join(', ')
  editor.metadataCreatedAtInput = toDateTimeLocalInput(item.metadataCreatedAt)
  editor.metadataModifiedAtInput = toDateTimeLocalInput(item.metadataModifiedAt)
  editor.locationInput = formatLocationInput(item.latitude, item.longitude)
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
    const canAutoSelectFirstMedia =
      !activeMedia.value &&
      !routeMediaId.value &&
      !routeAlbumId.value &&
      activeSection.value === 'all' &&
      !activeAlbumId.value &&
      !activeTagId.value

    if (firstMedia && canAutoSelectFirstMedia) {
      activeMediaId.value = firstMedia.id
    }

    await Promise.all(mediaResult.slice(0, 16).map((item) => loadThumb(item.id)))
  } catch (error) {
    message.value = (error as Error).message
  } finally {
    loading.value = false
  }
}

function openAlbum(albumId: string, pushRoute = true) {
  activeSection.value = 'all'
  activeTagId.value = ''
  activeAlbumId.value = albumId
  activeMediaId.value = null
  if (pushRoute && routeMode.value === 'app') {
    pushPath(`/albums/${encodeURIComponent(albumId)}`)
  }

  const parentChain: string[] = []
  let cursor = albums.value.find((a) => a.id === albumId)
  while (cursor?.parentId) {
    parentChain.push(cursor.parentId)
    cursor = albums.value.find((a) => a.id === cursor?.parentId)
  }

  expandedAlbumIds.value = Array.from(new Set([...expandedAlbumIds.value, ...parentChain]))
  saveExpandedAlbums()
}

function goRoot(pushRoute = true) {
  activeAlbumId.value = ''
  activeTagId.value = ''
  activeMediaId.value = null
  if (pushRoute && routeMode.value === 'app') {
    pushPath('/')
  }
}

function openTag(tagId: string) {
  activeSection.value = 'tags'
  activeAlbumId.value = ''
  activeTagId.value = tagId
  activeMediaId.value = null
  closeContextMenus()
}

function applyTagSuggestion(tagName: string) {
  const parts = editor.tagsInput.split(',')
  const draftRaw = parts.pop() ?? ''
  const prefixSpaces = draftRaw.match(/^\s*/)?.[0] ?? ''
  const base = parts.map((part) => part.trim()).filter(Boolean)
  const next = [...base, `${prefixSpaces}${tagName}`]
  editor.tagsInput = `${next.join(', ')}, `

  suppressTagsCommitOnBlur.value = true
  setTimeout(() => {
    tagsInputRef.value?.focus()
    suppressTagsCommitOnBlur.value = false
  }, 0)
}

async function renameTagFromSidebar(tag: Tag) {
  if (!token.value) return
  const nextName = window.prompt('Rename tag', tag.name)?.trim()
  if (!nextName || nextName.toLowerCase() === tag.name.toLowerCase()) return

  try {
    await api.updateTag(authHeaders(), tag.id, { name: nextName })
    await loadAll()
    showToast('Tag renamed')
  } catch (error) {
    message.value = (error as Error).message
  }
}

function selectMedia(mediaId: string, event?: MouseEvent, pushRoute = true) {
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
  if (pushRoute && routeMode.value === 'app') {
    pushPath(`/media/${encodeURIComponent(mediaId)}`)
  }
  closeContextMenus()
  void loadThumb(mediaId)
}

function openLightbox(mediaId: string) {
  mobileDetailsOpen.value = false
  selectMedia(mediaId)
  lightboxOpen.value = true
}

async function scrollActiveMediaCardIntoView() {
  const activeId = activeMediaId.value
  if (!activeId) return
  await nextTick()
  const masonry = masonryRef.value
  if (!masonry) return
  const target = Array.from(masonry.querySelectorAll<HTMLElement>('[data-media-id]')).find(
    (element) => element.dataset.mediaId === activeId,
  )
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
}

function closeLightbox() {
  lightboxOpen.value = false
  clearLightboxFullImage()
  lightboxTagsEditing.value = false
  if (activeMediaId.value) {
    selectedMediaIds.value = [activeMediaId.value]
  }
  void scrollActiveMediaCardIntoView()
}

function scrollActiveLightboxThumbIntoView() {
  if (!lightboxOpen.value || !activeMediaId.value) return
  const strip = lightboxStripRef.value
  if (!strip) return
  const target = strip.querySelector<HTMLElement>(`[data-lightbox-thumb-id="${activeMediaId.value}"]`)
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
}

function resetLightboxSwipe() {
  lightboxSwipe.active = false
  lightboxSwipe.horizontalIntent = false
}

function onLightboxTouchStart(event: TouchEvent) {
  if (event.touches.length !== 1) {
    resetLightboxSwipe()
    return
  }

  const target = event.target as HTMLElement | null
  if (target?.closest('.lightbox-header, .lightbox-tag-editor, .lightbox-strip, .overlay-arrow')) {
    resetLightboxSwipe()
    return
  }

  const touch = event.touches[0]
  if (!touch) return
  lightboxSwipe.active = true
  lightboxSwipe.startX = touch.clientX
  lightboxSwipe.startY = touch.clientY
  lightboxSwipe.lastX = touch.clientX
  lightboxSwipe.lastY = touch.clientY
  lightboxSwipe.startedAt = Date.now()
  lightboxSwipe.horizontalIntent = false
}

function onLightboxTouchMove(event: TouchEvent) {
  if (!lightboxSwipe.active || event.touches.length !== 1) return
  const touch = event.touches[0]
  if (!touch) return

  lightboxSwipe.lastX = touch.clientX
  lightboxSwipe.lastY = touch.clientY

  const dx = touch.clientX - lightboxSwipe.startX
  const dy = touch.clientY - lightboxSwipe.startY
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)

  if (absX > 12 && absX > absY * 1.1) {
    lightboxSwipe.horizontalIntent = true
    event.preventDefault()
  }
}

function onLightboxTouchEnd() {
  if (!lightboxSwipe.active) return

  const dx = lightboxSwipe.lastX - lightboxSwipe.startX
  const dy = lightboxSwipe.lastY - lightboxSwipe.startY
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  const elapsed = Date.now() - lightboxSwipe.startedAt
  const fastFlick = absX >= 24 && elapsed <= 220 && absX > absY
  const longSwipe = absX >= 44 && absX > absY * 1.15

  const shouldSwipe = (lightboxSwipe.horizontalIntent && (fastFlick || longSwipe))
  resetLightboxSwipe()

  if (!shouldSwipe || lightboxItems.value.length <= 1) return
  if (dx < 0) {
    nextLightbox()
  } else {
    prevLightbox()
  }
}

function onLightboxTouchCancel() {
  if (!lightboxSwipe.active) return
  resetLightboxSwipe()
}

function openEditMode(mediaId?: string) {
  if (mediaId) {
    selectMedia(mediaId)
  }
  if (!activeMedia.value) return
  editorPreviewScale.value = 100
  mobileDetailsOpen.value = false
  activeEditorMobileTab.value = 'temperature'
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

function toggleMobileSelectMode() {
  mobileSelectMode.value = !mobileSelectMode.value
  if (!mobileSelectMode.value) {
    selectedMediaIds.value = []
  }
}

function cancelMobileSelection() {
  mobileSelectMode.value = false
  selectedMediaIds.value = []
}

function toggleMobileUserMenu() {
  if (mobileUserMenuOpen.value) {
    mobileUserMenuOpen.value = false
    mobileMenuScreen.value = 'main'
    return
  }

  mobileMenuScreen.value = 'main'
  mobileUserMenuOpen.value = true
}

function closeMobileUserMenu() {
  mobileUserMenuOpen.value = false
  mobileMenuScreen.value = 'main'
}

function openMobileMenuScreen(screen: MobileMenuScreen) {
  mobileMenuScreen.value = screen
}

function updateLayoutFlags() {
  isTouchUi.value =
    window.matchMedia('(pointer: coarse)').matches ||
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0
  isMobileViewport.value = window.innerWidth <= 1080
  if (!isMobileViewport.value) {
    mobileSelectMode.value = false
    closeMobileUserMenu()
  }
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
  const rawPercent = total > 0 ? Math.round((loaded / total) * 100) : 0
  uploadProgress.percent = Math.max(0, Math.min(99, rawPercent))
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
  if (isMobileViewport.value) {
    mobileSelectMode.value = false
  }
}

function startMarqueeSelect(event: PointerEvent) {
  if (event.pointerType === 'touch') return
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

function showToast(text: string) {
  toast.text = text
  toast.visible = true
  if (toastTimer) {
    clearTimeout(toastTimer)
  }
  toastTimer = setTimeout(() => {
    toast.visible = false
  }, 1800)
}

function normalizeTags(input: string) {
  const unique = new Set(
    input
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  )
  return [...unique].sort()
}

function beginLightboxTagsEdit() {
  if (!activeMedia.value || !lightboxOpen.value) return
  lightboxTagsInput.value = activeMedia.value.mediaTags.map((entry) => entry.tag.name).join(', ')
  lightboxTagsEditing.value = true
  nextTick(() => lightboxTagsInputRef.value?.focus())
}

function cancelLightboxTagsEdit() {
  if (activeMedia.value) {
    lightboxTagsInput.value = activeMedia.value.mediaTags.map((entry) => entry.tag.name).join(', ')
  } else {
    lightboxTagsInput.value = ''
  }
  lightboxTagsEditing.value = false
}

async function commitLightboxTagsEdit() {
  if (!activeMedia.value || !token.value) return
  if (saving.value) return

  const mediaId = activeMedia.value.id
  const nextTags = normalizeTags(lightboxTagsInput.value)
  const currentTags = normalizeTags(activeMedia.value.mediaTags.map((entry) => entry.tag.name).join(','))

  if (nextTags.join('|') === currentTags.join('|')) {
    lightboxTagsEditing.value = false
    return
  }

  saving.value = true
  try {
    await api.updateMedia(authHeaders(), mediaId, { tags: nextTags })
    await loadAll()
    showToast('Tags updated')
    lightboxTagsEditing.value = false
  } catch (error) {
    message.value = (error as Error).message
  } finally {
    saving.value = false
  }
}

function beginDetailsFieldEdit(field: 'filename' | 'tags' | 'album' | 'metadataCreatedAt' | 'metadataModifiedAt' | 'location') {
  if (!activeMedia.value) return
  activeDetailsField.value = field
}

function cancelDetailsFieldEdit(field: 'filename' | 'tags' | 'album' | 'metadataCreatedAt' | 'metadataModifiedAt' | 'location') {
  if (!activeMedia.value) {
    activeDetailsField.value = null
    return
  }

  if (field === 'filename') {
    editor.filename = splitFilenameParts(activeMedia.value.filename).baseName
  }
  if (field === 'tags') {
    editor.tagsInput = activeMedia.value.mediaTags.map((entry) => entry.tag.name).join(', ')
  }
  if (field === 'album') {
    targetAlbumId.value = activeMedia.value.albumMedia[0]?.albumId || ''
  }
  if (field === 'metadataCreatedAt') {
    editor.metadataCreatedAtInput = toDateTimeLocalInput(activeMedia.value.metadataCreatedAt)
  }
  if (field === 'metadataModifiedAt') {
    editor.metadataModifiedAtInput = toDateTimeLocalInput(activeMedia.value.metadataModifiedAt)
  }
  if (field === 'location') {
    editor.locationInput = formatLocationInput(activeMedia.value.latitude, activeMedia.value.longitude)
  }

  activeDetailsField.value = null
}

async function commitDetailsFieldEdit(field: 'filename' | 'tags' | 'album' | 'metadataCreatedAt' | 'metadataModifiedAt' | 'location') {
  if (!activeMedia.value || !token.value) return
  if (activeDetailsField.value !== field) return
  if (field === 'tags' && suppressTagsCommitOnBlur.value) return
  if (saving.value) return

  const mediaId = activeMedia.value.id
  saving.value = true

  try {
    if (field === 'filename') {
      const currentParts = splitFilenameParts(activeMedia.value.filename)
      const nextBaseName = editor.filename.trim()
      const currentFilename = activeMedia.value.filename
      if (!nextBaseName || nextBaseName === currentParts.baseName) {
        activeDetailsField.value = null
        editor.filename = currentParts.baseName
        return
      }

      const nextFilename = `${nextBaseName}${currentParts.extension}`
      if (nextFilename === currentFilename) {
        activeDetailsField.value = null
        return
      }
      await api.updateMedia(authHeaders(), mediaId, { filename: nextFilename })
    }

    if (field === 'tags') {
      const nextTags = normalizeTags(editor.tagsInput)
      const currentTags = normalizeTags(activeMedia.value.mediaTags.map((entry) => entry.tag.name).join(','))
      if (nextTags.join('|') === currentTags.join('|')) {
        activeDetailsField.value = null
        return
      }
      await api.updateMedia(authHeaders(), mediaId, { tags: nextTags })
    }

    if (field === 'album') {
      const nextAlbumId = targetAlbumId.value
      const currentAlbumId = activeMedia.value.albumMedia[0]?.albumId || ''
      if (!nextAlbumId || nextAlbumId === currentAlbumId) {
        activeDetailsField.value = null
        targetAlbumId.value = currentAlbumId
        return
      }
      await api.bulkMoveAlbum(authHeaders(), [mediaId], nextAlbumId)
    }

    if (field === 'metadataCreatedAt') {
      const currentValue = activeMedia.value.metadataCreatedAt
      const nextValue = fromDateTimeLocalInput(editor.metadataCreatedAtInput)
      if (currentValue === nextValue) {
        activeDetailsField.value = null
        return
      }
      if (editor.metadataCreatedAtInput.trim() && !nextValue) {
        throw new Error('Invalid metadata created date')
      }
      await api.updateMedia(authHeaders(), mediaId, { metadataCreatedAt: nextValue })
    }

    if (field === 'metadataModifiedAt') {
      const currentValue = activeMedia.value.metadataModifiedAt
      const nextValue = fromDateTimeLocalInput(editor.metadataModifiedAtInput)
      if (currentValue === nextValue) {
        activeDetailsField.value = null
        return
      }
      if (editor.metadataModifiedAtInput.trim() && !nextValue) {
        throw new Error('Invalid metadata modified date')
      }
      await api.updateMedia(authHeaders(), mediaId, { metadataModifiedAt: nextValue })
    }

    if (field === 'location') {
      const parsed = parseLocationInput(editor.locationInput)
      if (!parsed) {
        throw new Error('Location must be in format: latitude, longitude')
      }

      const currentLatitude = activeMedia.value.latitude
      const currentLongitude = activeMedia.value.longitude
      if (currentLatitude === parsed.latitude && currentLongitude === parsed.longitude) {
        activeDetailsField.value = null
        return
      }

      await api.updateMedia(authHeaders(), mediaId, {
        latitude: parsed.latitude,
        longitude: parsed.longitude,
      })
    }

    activeDetailsField.value = null
    await loadAll()
    showToast('Changes saved')
  } catch (error) {
    message.value = (error as Error).message
  } finally {
    saving.value = false
  }
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
    const currentItems = [...lightboxItems.value]
    const currentIndex = currentItems.findIndex((item) => item.id === mediaId)

    await api.deleteMedia(authHeaders(), mediaId)

    if (lightboxOpen.value) {
      const remainingItems = currentItems.filter((item) => item.id !== mediaId)
      if (remainingItems.length > 0) {
        const nextIndex = currentIndex >= 0 && currentIndex < remainingItems.length ? currentIndex : 0
        const nextItem = remainingItems[nextIndex]
        if (nextItem) {
          activeMediaId.value = nextItem.id
          selectedMediaIds.value = [nextItem.id]
        }
      } else {
        activeMediaId.value = null
        selectedMediaIds.value = []
        lightboxOpen.value = false
      }
    } else if (activeMediaId.value === mediaId) {
      activeMediaId.value = null
      editModeOpen.value = false
    }

    closeContextMenus()
    await loadAll()

    if (lightboxOpen.value) {
      await nextTick()
      scrollActiveLightboxThumbIntoView()
    }
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function duplicateMedia(mediaId: string) {
  if (!token.value) return
  try {
    const copied = await api.copyMedia(authHeaders(), mediaId)
    showToast('Copy created')
    await loadAll()
    activeMediaId.value = copied.id
    selectedMediaIds.value = [copied.id]
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function configureMediaShare(mediaId: string) {
  if (!token.value) return
  try {
    const current = await api.getMediaShareSettings(authHeaders(), mediaId)
    shareDialog.open = true
    shareDialog.resourceType = 'media'
    shareDialog.resourceId = mediaId
    shareDialog.enabled = current.settings.enabled
    shareDialog.accessMode = current.settings.accessMode
    shareDialog.hasPassword = current.settings.hasPassword
    shareDialog.token = current.settings.token
    shareDialog.expiresPreset = deriveExpiresPreset(current.settings.expiresAt)
    shareDialog.password = ''
    mediaShareEnabled.value = {
      ...mediaShareEnabled.value,
      [mediaId]: current.settings.enabled,
    }
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function copyMediaShareLink(mediaId: string) {
  if (!token.value) return
  try {
    const current = await api.getMediaShareSettings(authHeaders(), mediaId)
    if (!current.settings.enabled || !current.settings.token) {
      message.value = 'Public access is disabled. Open Public access settings first.'
      return
    }
    mediaShareEnabled.value = {
      ...mediaShareEnabled.value,
      [mediaId]: true,
    }
    await copyText(mediaShareUrl(current.settings.token))
    showToast('Media share link copied')
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function configureAlbumShare(albumId: string) {
  if (!token.value) return
  try {
    const current = await api.getAlbumShareSettings(authHeaders(), albumId)
    shareDialog.open = true
    shareDialog.resourceType = 'album'
    shareDialog.resourceId = albumId
    shareDialog.enabled = current.settings.enabled
    shareDialog.accessMode = current.settings.accessMode
    shareDialog.hasPassword = current.settings.hasPassword
    shareDialog.token = current.settings.token
    shareDialog.expiresPreset = deriveExpiresPreset(current.settings.expiresAt)
    shareDialog.password = ''
    albumShareEnabled.value = {
      ...albumShareEnabled.value,
      [albumId]: current.settings.enabled,
    }
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function copyAlbumShareLink(albumId: string) {
  if (!token.value) return
  try {
    const current = await api.getAlbumShareSettings(authHeaders(), albumId)
    if (!current.settings.enabled || !current.settings.token) {
      message.value = 'Public access is disabled. Open Public access settings first.'
      return
    }
    albumShareEnabled.value = {
      ...albumShareEnabled.value,
      [albumId]: true,
    }
    await copyText(albumShareUrl(current.settings.token))
    showToast('Album share link copied')
  } catch (error) {
    message.value = (error as Error).message
  }
}

async function saveShareSettings() {
  if (!token.value || !shareDialog.resourceId) return
  if (shareDialog.saving) return
  if (shareDialog.enabled && shareDialog.accessMode === 'password' && !shareDialog.hasPassword && !shareDialog.password.trim()) {
    message.value = 'Password is required'
    return
  }

  shareDialog.saving = true
  try {
    const payload = {
      enabled: shareDialog.enabled,
      accessMode: shareDialog.accessMode,
      expiresAt: shareDialog.enabled ? computeExpiresAtFromPreset() : null,
      ...(shareDialog.password.trim() ? { password: shareDialog.password.trim() } : {}),
    }

    if (shareDialog.resourceType === 'media') {
      const updated = await api.updateMediaShareSettings(authHeaders(), shareDialog.resourceId, payload)
      mediaShareEnabled.value = {
        ...mediaShareEnabled.value,
        [shareDialog.resourceId]: updated.settings.enabled,
      }
      shareDialog.token = updated.settings.token
      shareDialog.hasPassword = updated.settings.hasPassword
    } else {
      const updated = await api.updateAlbumShareSettings(authHeaders(), shareDialog.resourceId, payload)
      albumShareEnabled.value = {
        ...albumShareEnabled.value,
        [shareDialog.resourceId]: updated.settings.enabled,
      }
      shareDialog.token = updated.settings.token
      shareDialog.hasPassword = updated.settings.hasPassword
    }

    showToast('Share settings saved')
  } catch (error) {
    message.value = (error as Error).message
  } finally {
    shareDialog.saving = false
  }
}

async function copyLinkFromShareDialog() {
  if (!shareDialog.enabled || !shareDialog.token) {
    message.value = 'Enable public access first and save settings'
    return
  }

  const link = shareDialog.resourceType === 'media'
    ? mediaShareUrl(shareDialog.token)
    : albumShareUrl(shareDialog.token)
  await copyText(link)
  showToast('Public link copied')
}

async function applyImageEditsPermanently() {
  if (!activeMedia.value || !token.value) return
  saving.value = true

  try {
    const mediaId = activeMedia.value.id
    await api.applyMediaEdits(authHeaders(), mediaId, {
      temperature: editor.temperature,
      brightness: editor.brightness,
      contrast: editor.contrast,
      saturation: editor.saturation,
      toneDepth: editor.toneDepth,
      shadowsLevel: editor.shadowsLevel,
      highlightsLevel: editor.highlightsLevel,
      sharpness: editor.sharpness,
      definition: editor.definition,
      vignette: editor.vignette,
      glamour: editor.glamour,
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

function lightboxContainStyle(src: string, item: MediaItem) {
  return {
    backgroundImage: `url("${src}")`,
    ...mediaFilterStyle(item),
  }
}

function mediaFilterStyleFromEditor() {
  const temperature = Number(editor.temperature || 0)
  const brightness = 100 + Number(editor.brightness || 0)
  const contrast = 100 + Number(editor.contrast || 0)
  const saturation = 100 + Number(editor.saturation || 0)
  const toneDepth = Number(editor.toneDepth || 0)
  const shadowsLevel = Number(editor.shadowsLevel || 0)
  const highlightsLevel = Number(editor.highlightsLevel || 0)
  const sharpness = Number(editor.sharpness || 0)
  const definition = Number(editor.definition || 0)
  const glamour = Number(editor.glamour || 0)
  const zoom = 1 + Number(editor.cropZoom || 0) / 100
  const rotate = Number(editor.rotate || 0)
  const flipX = editor.flipX ? -1 : 1
  const flipY = editor.flipY ? -1 : 1
  const grayscale = Number(editor.grayscale || 0)
  const sepia = Number(editor.sepia || 0)
  const warmTint = Math.max(0, temperature / 100)
  const coolTint = Math.max(0, -temperature / 100)
  const depthContrast = toneDepth / 2.2
  const liftedBrightness = shadowsLevel / 2.4
  const reducedHighlights = -highlightsLevel / 2.6
  const glamourBlur = Math.max(0, glamour / 35)
  const definitionContrast = definition / 3
  const detailContrast = sharpness / 2.8
  const finalContrast = contrast + depthContrast + definitionContrast + detailContrast
  const finalBrightness = brightness + liftedBrightness + reducedHighlights
  const finalSaturation = saturation + warmTint * 6 - coolTint * 4
  const finalSepia = Math.max(0, sepia + warmTint * 10)
  return {
    filter: `brightness(${finalBrightness}%) contrast(${finalContrast}%) saturate(${finalSaturation}%) grayscale(${grayscale}%) sepia(${finalSepia}%) hue-rotate(${temperature * 0.25}deg) blur(${glamourBlur}px)`,
    transform: `scale(${zoom}) rotate(${rotate}deg) scaleX(${flipX}) scaleY(${flipY})`,
    clipPath: `inset(${editor.cropY}% ${100 - editor.cropX - editor.cropWidth}% ${100 - editor.cropY - editor.cropHeight}% ${editor.cropX}%)`,
  }
}

function mediaDetailsStyle(_item?: MediaItem) {
  return {}
}

function resetEditorAdjustments() {
  editor.temperature = 0
  editor.brightness = 0
  editor.contrast = 0
  editor.saturation = 0
  editor.toneDepth = 0
  editor.shadowsLevel = 0
  editor.highlightsLevel = 0
  editor.sharpness = 0
  editor.definition = 0
  editor.vignette = 0
  editor.glamour = 0
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
  event.stopPropagation()

  const target = event.currentTarget as HTMLElement | null
  if (target && typeof target.setPointerCapture === 'function') {
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // ignore when capture is unavailable for this pointer
    }
  }

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
  if (event.key === 'Escape' && mobileUserMenuOpen.value) {
    closeMobileUserMenu()
    return
  }

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
    await applyRouteFromLocation()
  } catch (error) {
    message.value = (error as Error).message
  }
}

function logout() {
  Object.keys(thumbs.value).forEach((mediaId) => clearThumb(mediaId))
  clearLightboxFullImage()
  clearPersistedAppViewState()
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
    activeTagId.value = ''
  }
  if (activeSection.value === 'tags') {
    activeAlbumId.value = ''
  }
  void loadAll()
})

watch(
  () => [
    routeMode.value,
    token.value,
    activeSection.value,
    activeAlbumId.value,
    activeTagId.value,
    search.value,
    activeMediaId.value,
    lightboxOpen.value,
  ],
  () => {
    persistAppViewState()
  },
)

watch(activeMedia, (item) => {
  applyMediaToEditor(item)
  if (item) {
    lightboxTagsInput.value = item.mediaTags.map((entry) => entry.tag.name).join(', ')
  } else {
    lightboxTagsInput.value = ''
    lightboxTagsEditing.value = false
  }
  if (!item) {
    mobileDetailsOpen.value = false
  }
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

watch(visibleSubalbumPreviewMedia, (items) => {
  items.forEach((preview) => {
    void loadThumb(preview.id)
  })
})

watch(
  () => [lightboxOpen.value, activeMediaId.value, lightboxItems.value.length],
  async ([isOpen, mediaId]) => {
    if (!isOpen || !mediaId) return
    await nextTick()
    scrollActiveLightboxThumbIntoView()
  },
)

watch(
  () => [lightboxOpen.value, activeMediaId.value, token.value],
  ([isOpen, mediaId]) => {
    if (!isOpen || !mediaId) {
      clearLightboxFullImage()
      return
    }
    void loadActiveLightboxFullImage()
  },
)

watch([activeAlbumId, activeMediaId, token, routeMode], () => {
  if (!token.value || routeMode.value !== 'app' || syncingFromRoute.value) return
  if (activeMediaId.value) {
    pushPath(`/media/${encodeURIComponent(activeMediaId.value)}`, true)
    return
  }
  if (activeAlbumId.value) {
    pushPath(`/albums/${encodeURIComponent(activeAlbumId.value)}`, true)
    return
  }
  pushPath('/', true)
})

onMounted(async () => {
  updateLayoutFlags()

  popStateHandler = () => {
    void applyRouteFromLocation()
  }

  window.addEventListener('popstate', popStateHandler)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('pointerup', stopCropDrag)
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointerdown', onGlobalPointerDown)
  window.addEventListener('resize', updateLayoutFlags)
  if (!token.value) {
    await applyRouteFromLocation()
    return
  }

  try {
    const me = await api.me(token.value)
    userName.value = (me as { displayName?: string; email?: string }).displayName ||
      (me as { email?: string }).email ||
      'user'
    await applyRouteFromLocation()
  } catch {
    logout()
  }
})

onBeforeUnmount(() => {
  cancelTouchGesture()
  if (popStateHandler) {
    window.removeEventListener('popstate', popStateHandler)
    popStateHandler = null
  }
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('pointerup', stopCropDrag)
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointerdown', onGlobalPointerDown)
  window.removeEventListener('resize', updateLayoutFlags)
  clearLightboxFullImage()
  if (toastTimer) {
    clearTimeout(toastTimer)
  }
})
</script>

<template>
  <div class="app">
    <template v-if="isPublicRoute">
      <header class="topbar">
        <div class="topbar-left">
          <div class="brand">
            <span class="brand-mark">jr</span>
            <div>
              <div class="brand-name">Jellyree</div>
              <div class="brand-sub">Public share</div>
            </div>
          </div>
          <div class="topbar-badge" v-if="routeMode === 'public-album' && sharedAlbumMedia.length > 0">
            {{ sharedAlbumMedia.length }} photos
          </div>
        </div>
      </header>

      <div class="workspace public-workspace">
        <main class="gallery-main">
          <div class="gallery-head">
            <div>
              <div class="gallery-title">
                {{ routeMode === 'public-media' ? (sharedMedia?.filename || 'Shared file') : (sharedAlbum?.name || 'Shared album') }}
              </div>
              <div class="muted" v-if="routeMode === 'public-album'">
                {{ sharedAlbumMedia.length }} item(s)
              </div>
            </div>
          </div>

          <div v-if="sharedLoading" class="muted">Loading shared content...</div>
          <div v-else-if="message && message.toLowerCase().includes('password')" class="shared-password-box">
            <div class="muted">This shared content is password protected.</div>
            <div class="shared-password-row">
              <input
                v-model="sharedPasswordInput"
                class="input"
                type="password"
                placeholder="Enter password"
                @keydown.enter.prevent="submitSharedPassword"
              />
              <button class="btn" @click="submitSharedPassword">Open</button>
            </div>
          </div>
          <div v-else-if="message" class="muted">{{ message }}</div>

          <div v-else-if="routeMode === 'public-media' && sharedMedia" class="public-single-view">
            <img
              v-if="sharedMedia.mimeType.startsWith('image/')"
              class="public-single-image"
              :src="publicFileUrl(sharedMedia.id)"
              :alt="sharedMedia.filename"
            />
            <div v-else class="public-single-fallback">
              <div class="photo-fallback">{{ sharedMedia.mimeType }}</div>
            </div>
          </div>

          <div v-else-if="routeMode === 'public-album'" class="masonry public-album-grid">
            <article
              v-for="item in sharedAlbumMedia"
              :key="`shared-${item.id}`"
              class="photo-card"
            >
              <img
                v-if="item.mimeType.startsWith('image/')"
                class="photo-img"
                :src="publicFileUrl(item.id)"
                :alt="item.filename"
                loading="lazy"
              />
              <div v-else class="photo-fallback">{{ item.mimeType }}</div>
            </article>
          </div>
        </main>
      </div>
    </template>

    <div v-else-if="!token" class="auth-wrap">
      <div class="auth-card">
        <div class="brand-name">Jellyree</div>
        <div class="brand-sub">cloud storage + photo gallery</div>
        <div class="auth-switch">
          <button class="chip" :class="{ active: mode === 'login' }" @click="mode = 'login'">
            Login
          </button>
          <button class="chip" :class="{ active: mode === 'register' }" @click="mode = 'register'">
            Register
          </button>
        </div>
        <form class="auth-form" @submit.prevent="submitAuth">
          <input v-model="authForm.email" class="input" placeholder="Email" />
          <input v-model="authForm.password" class="input" type="password" placeholder="Password" />
          <input
            v-if="mode === 'register'"
            v-model="authForm.displayName"
            class="input"
            placeholder="Display name"
          />
          <button class="btn full" type="submit">
            {{ mode === 'register' ? 'Create account' : 'Sign in' }}
          </button>
        </form>
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
        <div v-if="!isMobileViewport" class="search shell">
          <input v-model="search" placeholder="Search in current view" />
        </div>
        <div class="topbar-right">
          <button class="chip hamburger-btn mobile-only" @click="toggleMobileUserMenu">
            <i class="ri-menu-line" aria-hidden="true"></i>
          </button>
          <button class="btn ghost desktop-only" @click="logout">Logout</button>
          <input
            ref="fileInput"
            type="file"
            multiple
            hidden
            @change="onFileInput"
          />
        </div>
      </header>

      <div v-if="mobileUserMenuOpen && isMobileViewport" class="mobile-menu-fullscreen">
        <div class="mobile-menu-screen">
          <div class="mobile-menu-header">
            <button v-if="mobileMenuScreen !== 'main'" class="chip" @click="openMobileMenuScreen('main')">
              <i class="ri-arrow-left-line" aria-hidden="true"></i>
              Back
            </button>
            <div class="mobile-menu-title">
              {{ mobileMenuScreen === 'main' ? 'Menu' : (mobileMenuScreen === 'library' ? 'Library' : 'Bulk actions') }}
            </div>
            <button class="chip" @click="closeMobileUserMenu">
              <i class="ri-close-line" aria-hidden="true"></i>
            </button>
          </div>

          <div v-if="mobileMenuScreen === 'main'" class="mobile-menu-main-list">
            <div class="search shell mobile-menu-search">
              <i class="ri-search-line" aria-hidden="true"></i>
              <input v-model="search" placeholder="Search photos and albums" />
            </div>
            <button class="mobile-screen-item" @click="toggleMobileSelectMode; closeMobileUserMenu()">
              <i class="ri-checkbox-multiple-line" aria-hidden="true"></i>
              <span>{{ mobileSelectMode ? 'Stop select mode' : 'Select files' }}</span>
            </button>
            <button v-if="selectedCount > 0" class="mobile-screen-item" @click="cancelMobileSelection; closeMobileUserMenu()">
              <i class="ri-close-circle-line" aria-hidden="true"></i>
              <span>Cancel selection</span>
            </button>
            <button class="mobile-screen-item" @click="openMobileMenuScreen('library')">
              <i class="ri-book-2-line" aria-hidden="true"></i>
              <span>Library</span>
            </button>
            <button class="mobile-screen-item" @click="openMobileMenuScreen('bulk')">
              <i class="ri-stack-line" aria-hidden="true"></i>
              <span>Bulk actions</span>
            </button>
            <button class="mobile-screen-item danger" @click="logout">
              <i class="ri-logout-box-r-line" aria-hidden="true"></i>
              <span>Logout</span>
            </button>
          </div>

          <div v-else-if="mobileMenuScreen === 'library'" class="mobile-screen-scroll">
            <div class="mobile-menu-subtitle">Main</div>
            <button class="mobile-screen-item" @click="activeSection = 'favorites'; closeMobileUserMenu()">
              <i class="ri-star-line" aria-hidden="true"></i>
              <span>Favorites</span>
            </button>
            <button class="mobile-screen-item" @click="activeSection = 'all'; goRoot(); closeMobileUserMenu()">
              <i class="ri-image-2-line" aria-hidden="true"></i>
              <span>All photos</span>
            </button>

            <div class="mobile-menu-subtitle" v-if="pinnedAlbums.length > 0">Pinned</div>
            <button
              v-for="album in pinnedAlbums"
              :key="`menu-pin-${album.id}`"
              class="mobile-screen-item"
              @click="openAlbum(album.id); closeMobileUserMenu()"
            >
              <i class="ri-folder-2-line" aria-hidden="true"></i>
              <span>{{ album.name }}</span>
            </button>

            <div class="mobile-menu-subtitle">Albums</div>
            <button
              v-for="node in albumTree"
              :key="`menu-album-${node.album.id}`"
              class="mobile-screen-item"
              @click="openAlbum(node.album.id); closeMobileUserMenu()"
            >
              <i class="ri-folder-line" aria-hidden="true"></i>
              <span>{{ '· '.repeat(node.depth) }}{{ node.album.name }}</span>
            </button>

            <div class="mobile-menu-subtitle" v-if="sortedTags.length > 0">Tags</div>
            <button
              v-for="tag in sortedTags"
              :key="`menu-tag-${tag.id}`"
              class="mobile-screen-item"
              @click="openTag(tag.id); closeMobileUserMenu()"
            >
              <i class="ri-price-tag-3-line" aria-hidden="true"></i>
              <span>{{ tag.name }}</span>
            </button>
          </div>

          <div v-else class="mobile-screen-scroll">
            <select v-model="bulkTargetAlbumId" class="input bulk-select">
              <option value="">Move selected to album…</option>
              <option v-for="album in albums" :key="`menu-bulk-${album.id}`" :value="album.id">
                {{ album.name }}
              </option>
            </select>
            <button class="mobile-screen-item" :disabled="selectedCount === 0 || !bulkTargetAlbumId" @click="bulkMoveSelectedToAlbum; closeMobileUserMenu()">
              <i class="ri-folder-transfer-line" aria-hidden="true"></i>
              <span>Move selected</span>
            </button>
            <button class="mobile-screen-item" :disabled="selectedCount === 0" @click="bulkSetFavorite(true); closeMobileUserMenu()">
              <i class="ri-star-line" aria-hidden="true"></i>
              <span>Favorite selected</span>
            </button>
            <button class="mobile-screen-item" :disabled="selectedCount === 0" @click="bulkSetFavorite(false); closeMobileUserMenu()">
              <i class="ri-star-off-line" aria-hidden="true"></i>
              <span>Unfavorite selected</span>
            </button>
            <button class="mobile-screen-item" :disabled="selectedCount === 0" @click="downloadSelectedAsZip; closeMobileUserMenu()">
              <i class="ri-download-2-line" aria-hidden="true"></i>
              <span>Download selected</span>
            </button>
            <button class="mobile-screen-item danger" :disabled="selectedCount === 0" @click="bulkDeleteSelected; closeMobileUserMenu()">
              <i class="ri-delete-bin-line" aria-hidden="true"></i>
              <span>Delete selected</span>
            </button>
            <button class="mobile-screen-item" :disabled="selectedCount === 0" @click="clearSelection; closeMobileUserMenu()">
              <i class="ri-close-circle-line" aria-hidden="true"></i>
              <span>Clear selection</span>
            </button>
          </div>
        </div>
      </div>

      <div class="workspace" @dragover.prevent @drop.prevent.stop="handleDrop">
        <aside v-if="!isMobileViewport" class="sidebar">
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
              :class="{ active: activeAlbumId === album.id && activeSection === 'all', 'long-press-pending': isLongPressPending('album', album.id) }"
              @click="onAlbumCardClick(album.id)"
              @contextmenu.prevent="openAlbumContextMenu($event, album.id)"
              @touchstart="startTouchGesture('album', album.id, $event)"
              @touchmove.passive="moveTouchGesture($event)"
              @touchend="finishAlbumTouch(album.id)"
              @touchcancel="cancelTouchGesture"
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
              :class="{ active: activeAlbumId === node.album.id && activeSection === 'all', 'drop-target': albumDropTargetId === node.album.id, 'media-drop-target': mediaDropTargetAlbumId === node.album.id, 'long-press-pending': isLongPressPending('album', node.album.id) }"
              :style="{ paddingLeft: `${10 + node.depth * 16}px` }"
              draggable="true"
              @dragstart="onAlbumDragStart(node.album.id)"
              @dragover.prevent="onAlbumDragOver(node.album.id, $event)"
              @drop.prevent.stop="onAlbumDrop(node.album.id, $event)"
              @dragend="onAlbumDragEnd"
              @contextmenu.prevent="openAlbumContextMenu($event, node.album.id)"
              @click="onAlbumCardClick(node.album.id)"
              @touchstart="startTouchGesture('album', node.album.id, $event)"
              @touchmove.passive="moveTouchGesture($event)"
              @touchend="finishAlbumTouch(node.album.id)"
              @touchcancel="cancelTouchGesture"
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

          <div class="side-group" v-if="sortedTags.length > 0">
            <div class="side-title">Tags</div>
            <div
              v-for="tag in sortedTags"
              :key="`tag-${tag.id}`"
              class="nav-item row album-row"
              :class="{ active: activeSection === 'tags' && activeTagId === tag.id }"
            >
              <span class="row-main" @click="openTag(tag.id)"># {{ tag.name }}</span>
              <button class="menu-dots-btn" title="Rename tag" @click.stop="renameTagFromSidebar(tag)">✎</button>
            </div>
          </div>
        </aside>

        <main class="gallery-main" @pointerdown="startMarqueeSelect">
          <div class="gallery-head">
            <div>
              <div class="gallery-title">
                {{ activeSection === 'favorites' ? 'Favorites' : (activeSection === 'tags' ? (activeTag ? `#${activeTag.name}` : 'Tag') : (activeAlbum ? activeAlbum.name : 'All photos')) }}
              </div>
              <div class="muted">{{ filteredMedia.length }} items · {{ selectedCount }} selected</div>
            </div>
          </div>

          <div v-if="!isMobileViewport" class="gallery-toolbar shell">
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
              v-for="album in visibleSubalbums"
              :key="`subalbum-${album.id}`"
              class="photo-card album-card"
              :class="{ 'long-press-pending': isLongPressPending('album', album.id) }"
              @click="onAlbumCardClick(album.id)"
              @touchstart="startTouchGesture('album', album.id, $event)"
              @touchmove.passive="moveTouchGesture($event)"
              @touchend="finishAlbumTouch(album.id)"
              @touchcancel="cancelTouchGesture"
            >
              <div v-if="album.previewMedia.length > 0" class="album-preview-grid">
                <div
                  v-for="preview in album.previewMedia.slice(0, 4)"
                  :key="`album-preview-${album.id}-${preview.id}`"
                  class="album-preview-cell"
                >
                  <img
                    v-if="thumbs[preview.id] && canPreviewFromMeta(preview.id, preview.mimeType, preview.filename)"
                    class="photo-img"
                    :src="thumbs[preview.id]"
                    :alt="preview.filename"
                    loading="lazy"
                    @error="onThumbError(preview.id)"
                  />
                  <div v-else class="photo-fallback">{{ preview.mimeType }}</div>
                </div>
              </div>
              <div v-else class="album-empty-preview">📁</div>
              <div class="album-card-meta">
                <div class="album-card-name">📁 {{ album.name }}</div>
                <div class="muted">{{ album.mediaCount }} item(s)</div>
              </div>
            </article>

            <article
              v-for="item in filteredMedia"
              :key="item.id"
              class="photo-card"
              :data-media-id="item.id"
              :class="{ active: activeMediaId === item.id, selected: selectedMediaSet.has(item.id), 'long-press-pending': isLongPressPending('media', item.id), 'select-mode': isMobileViewport && mobileSelectMode }"
              draggable="true"
              @dragstart="onMediaDragStart(item.id, $event)"
              @dragend="onMediaDragEnd"
              @click="onMediaCardClick(item.id, $event)"
              @contextmenu.prevent="openMediaContextMenu($event, item.id)"
              @dblclick="onMediaCardDoubleClick(item.id)"
              @touchstart="startTouchGesture('media', item.id, $event)"
              @touchmove.passive="moveTouchGesture($event)"
              @touchend="finishMediaTouch(item.id)"
              @touchcancel="cancelTouchGesture"
            >
              <div v-if="isMobileViewport && mobileSelectMode" class="card-select-indicator" :class="{ selected: selectedMediaSet.has(item.id) }">
                <i v-if="selectedMediaSet.has(item.id)" class="ri-check-line" aria-hidden="true"></i>
              </div>
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
              <div
                v-if="item.mediaTags.length > 0"
                class="photo-card-tags"
                :class="{ 'has-fav': item.isFavorite }"
              >
                <span
                  v-for="entry in item.mediaTags"
                  :key="`card-tag-${item.id}-${entry.tag.id}`"
                  class="chip-lite photo-card-tag"
                >
                  # {{ entry.tag.name }}
                </span>
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

        <aside class="details" :class="{ 'mobile-details-open': mobileDetailsOpen }" v-if="activeMedia">
          <div class="details-head">
            <div class="details-head-main">
              <div class="details-title">Photo details</div>
              <div v-if="mobileDetailsOpen" class="muted details-subtitle">{{ activeMedia.filename }}</div>
            </div>
            <button v-if="mobileDetailsOpen" class="chip" @click="mobileDetailsOpen = false">Close</button>
          </div>
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
            <div
              v-if="activeDetailsField !== 'filename'"
              class="inline-edit-value"
              @click="beginDetailsFieldEdit('filename')"
            >
              {{ displayEditorFilename() }}
            </div>
            <div v-else class="filename-edit-row">
              <input
                v-model="editor.filename"
                class="input"
                autofocus
                @blur="commitDetailsFieldEdit('filename')"
                @keydown.enter.prevent="commitDetailsFieldEdit('filename')"
                @keydown.esc.prevent="cancelDetailsFieldEdit('filename')"
              />
              <span v-if="activeFilenameExtension()" class="filename-ext">{{ activeFilenameExtension() }}</span>
            </div>
          </div>
          <div class="field">
            <label>Metadata created</label>
            <div
              v-if="activeDetailsField !== 'metadataCreatedAt'"
              class="inline-edit-value"
              @click="beginDetailsFieldEdit('metadataCreatedAt')"
            >
              {{ activeMediaMetadataCreatedLabel }}
            </div>
            <input
              v-else
              v-model="editor.metadataCreatedAtInput"
              class="input"
              type="datetime-local"
              autofocus
              @blur="commitDetailsFieldEdit('metadataCreatedAt')"
              @keydown.enter.prevent="commitDetailsFieldEdit('metadataCreatedAt')"
              @keydown.esc.prevent="cancelDetailsFieldEdit('metadataCreatedAt')"
            />
          </div>
          <div class="field">
            <label>Metadata modified</label>
            <div
              v-if="activeDetailsField !== 'metadataModifiedAt'"
              class="inline-edit-value"
              @click="beginDetailsFieldEdit('metadataModifiedAt')"
            >
              {{ activeMediaMetadataModifiedLabel }}
            </div>
            <input
              v-else
              v-model="editor.metadataModifiedAtInput"
              class="input"
              type="datetime-local"
              autofocus
              @blur="commitDetailsFieldEdit('metadataModifiedAt')"
              @keydown.enter.prevent="commitDetailsFieldEdit('metadataModifiedAt')"
              @keydown.esc.prevent="cancelDetailsFieldEdit('metadataModifiedAt')"
            />
          </div>
          <div class="field">
            <label>Tags</label>
            <div
              v-if="activeDetailsField !== 'tags'"
              class="inline-edit-value"
              @click="beginDetailsFieldEdit('tags')"
            >
              {{ editor.tagsInput || '—' }}
            </div>
            <div v-else class="tag-input-wrap">
              <input
                ref="tagsInputRef"
                v-model="editor.tagsInput"
                class="input"
                placeholder="tag1, tag2"
                autofocus
                @blur="commitDetailsFieldEdit('tags')"
                @keydown.enter.prevent="commitDetailsFieldEdit('tags')"
                @keydown.esc.prevent="cancelDetailsFieldEdit('tags')"
              />
              <div v-if="tagSuggestions.length > 0" class="tag-suggestions" @pointerdown.prevent>
                <button
                  v-for="tag in tagSuggestions"
                  :key="`tag-suggestion-${tag.id}`"
                  class="tag-suggestion-item"
                  @click="applyTagSuggestion(tag.name)"
                >
                  # {{ tag.name }}
                </button>
              </div>
            </div>
          </div>

          <div class="field">
            <label>Album</label>
            <div
              v-if="activeDetailsField !== 'album'"
              class="inline-edit-value"
              @click="beginDetailsFieldEdit('album')"
            >
              {{ activeMediaAlbum?.name || '—' }}
            </div>
            <select
              v-else
              v-model="targetAlbumId"
              class="input"
              @change="commitDetailsFieldEdit('album')"
              @blur="commitDetailsFieldEdit('album')"
              @keydown.esc.prevent="cancelDetailsFieldEdit('album')"
            >
              <option value="">Select album</option>
              <option v-for="album in albums" :key="album.id" :value="album.id">{{ album.name }}</option>
            </select>
          </div>

          <div class="field">
            <label>Metadata location</label>
            <div
              v-if="activeDetailsField !== 'location'"
              class="inline-edit-value"
              @click="beginDetailsFieldEdit('location')"
            >
              {{ activeMediaLocationLabel }}
            </div>
            <input
              v-else
              v-model="editor.locationInput"
              class="input"
              placeholder="latitude, longitude"
              autofocus
              @blur="commitDetailsFieldEdit('location')"
              @keydown.enter.prevent="commitDetailsFieldEdit('location')"
              @keydown.esc.prevent="cancelDetailsFieldEdit('location')"
            />
          </div>

          <div class="detail-actions">
            <button class="btn ghost detail-action-btn" title="Edit photo" @click="openEditMode(activeMedia.id)">✎</button>
            <button class="btn ghost detail-action-btn" :title="activeMedia.isFavorite ? 'Unfavorite' : 'Favorite'" @click="toggleFavorite(activeMedia.id)">
              {{ activeMedia.isFavorite ? '★' : '☆' }}
            </button>
            <button class="btn ghost detail-action-btn" title="Download" @click="downloadMediaFile(activeMedia.id)">↓</button>
            <button class="btn ghost danger detail-action-btn" title="Delete" @click="deleteMedia(activeMedia.id)">🗑</button>
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
        <button @click="contextShareAlbum">Public access settings…</button>
        <button v-if="albumContextMenu.albumId && isAlbumShareEnabled(albumContextMenu.albumId)" @click="contextCopyAlbumShareLink">Copy public link</button>
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
        <button @click="contextOpenMediaDetails">Details</button>
        <button @click="contextEditMedia">Edit photo</button>
        <button @click="contextCopyMedia">Create copy</button>
        <button @click="contextShareMedia">Public access settings…</button>
        <button v-if="mediaContextMenu.mediaId && isMediaShareEnabled(mediaContextMenu.mediaId)" @click="contextCopyMediaShareLink">Copy public link</button>
        <button @click="contextDownloadMedia">Download</button>
        <button @click="contextToggleMediaFavorite">
          {{ mediaFromContext()?.isFavorite ? 'Remove favorite' : 'Add favorite' }}
        </button>
        <button class="danger" @click="contextDeleteMedia">Delete</button>
      </div>

      <Transition name="toast-pop">
        <div v-if="toast.visible" class="toast-notice">{{ toast.text }}</div>
      </Transition>

      <div v-if="lightboxOpen && activeMedia" class="overlay" @click.self="closeLightbox">
        <button v-if="lightboxItems.length > 1" class="overlay-arrow left" @click.stop="prevLightbox">‹</button>

        <div
          class="overlay-content"
          @touchstart="onLightboxTouchStart"
          @touchmove="onLightboxTouchMove"
          @touchend="onLightboxTouchEnd"
          @touchcancel="onLightboxTouchCancel"
        >
          <div class="lightbox-shell">
            <div class="lightbox-header" @click.stop>
              <div class="overlay-meta">
                <span class="overlay-filename">{{ activeMedia.filename }}</span>
                <span v-if="lightboxIndex >= 0" class="overlay-counter">{{ lightboxIndex + 1 }} / {{ lightboxItems.length }}</span>
              </div>

              <div class="lightbox-actions">
                <button class="btn ghost" @click.stop="openEditMode(activeMedia.id)">Edit</button>
                <button class="btn ghost" @click.stop="toggleFavorite(activeMedia.id)">
                  {{ activeMedia.isFavorite ? '★ Favorited' : '☆ Favorite' }}
                </button>
                <button class="btn ghost danger" @click.stop="deleteMedia(activeMedia.id)">Delete</button>
                <button class="btn ghost" @click.stop="closeLightbox">Close</button>
              </div>
            </div>

            <div class="lightbox-media-stage">
              <div
                v-if="lightboxActiveImageSrc && canPreviewInBrowser(activeMedia)"
                class="lightbox-image-contain"
                :style="lightboxContainStyle(lightboxActiveImageSrc, activeMedia)"
                :aria-label="activeMedia.filename"
                role="img"
              ></div>
              <div v-else class="lightbox-fallback">{{ activeMedia.filename }} · {{ activeMedia.mimeType }}</div>
            </div>

            <div class="lightbox-bottom">
              <div class="lightbox-tag-editor" @click.stop>
                <label>Tags</label>
                <div v-if="!lightboxTagsEditing" class="lightbox-tags-view">
                  <div class="chips" v-if="activeMedia.mediaTags.length > 0">
                    <span
                      v-for="entry in activeMedia.mediaTags"
                      :key="`lightbox-tag-${activeMedia.id}-${entry.tag.id}`"
                      class="chip-lite"
                    >
                      # {{ entry.tag.name }}
                    </span>
                  </div>
                  <span v-else class="muted">—</span>
                  <button class="btn ghost" @click.stop="beginLightboxTagsEdit">Edit tags</button>
                </div>
                <div v-else class="lightbox-tags-edit">
                  <input
                    ref="lightboxTagsInputRef"
                    v-model="lightboxTagsInput"
                    class="input"
                    placeholder="tag1, tag2"
                    @click.stop
                    @blur="commitLightboxTagsEdit"
                    @keydown.enter.prevent="commitLightboxTagsEdit"
                    @keydown.esc.prevent="cancelLightboxTagsEdit"
                  />
                  <button class="btn ghost" :disabled="saving" @click.stop="cancelLightboxTagsEdit">Cancel</button>
                  <button class="btn" :disabled="saving" @click.stop="commitLightboxTagsEdit">Save</button>
                </div>
              </div>

              <div v-if="lightboxItems.length > 1" ref="lightboxStripRef" class="lightbox-strip">
                <button
                  v-for="item in lightboxItems"
                  :key="item.id"
                  :data-lightbox-thumb-id="item.id"
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
          </div>
        </div>

        <button v-if="lightboxItems.length > 1" class="overlay-arrow right" @click.stop="nextLightbox">›</button>
      </div>

      <div v-if="editModeOpen && activeMedia" class="editor-fullscreen">
        <div class="editor-head editor-head-full">
          <div>
            <div class="details-title">Photo editor</div>
            <div class="muted">{{ activeMedia.filename }}</div>
          </div>
          <button class="chip" @click="closeEditMode">Close</button>
        </div>

        <div class="editor-layout">
          <div class="editor-canvas">
            <div class="editor-preview">
              <div
                v-if="thumbs[activeMedia.id] && canPreviewInBrowser(activeMedia)"
                class="editor-crop-stage"
                @pointermove="onCropPointerMove"
                @pointerup="stopCropDrag"
                @pointercancel="stopCropDrag"
                @pointerleave="stopCropDrag"
              >
                <div ref="editorCropStage" class="editor-image-frame" :style="editorPreviewFrameStyle">
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
          </div>

          <aside class="editor-sidebar">
            <div class="editor-controls">
              <div class="slider-row"><span>Preview scale</span><input v-model="editorPreviewScale" type="range" min="25" max="300" /></div>
              <div class="slider-row"><span>Temperature</span><input v-model="editor.temperature" type="range" min="-100" max="100" /></div>
              <div class="slider-row"><span>Brightness</span><input v-model="editor.brightness" type="range" min="-60" max="60" /></div>
              <div class="slider-row"><span>Contrast</span><input v-model="editor.contrast" type="range" min="-60" max="60" /></div>
              <div class="slider-row"><span>Saturation</span><input v-model="editor.saturation" type="range" min="-60" max="60" /></div>
              <div class="slider-row"><span>Tone depth</span><input v-model="editor.toneDepth" type="range" min="-100" max="100" /></div>
              <div class="slider-row"><span>Shadows level</span><input v-model="editor.shadowsLevel" type="range" min="-100" max="100" /></div>
              <div class="slider-row"><span>Highlights level</span><input v-model="editor.highlightsLevel" type="range" min="-100" max="100" /></div>
              <div class="slider-row"><span>Sharpness</span><input v-model="editor.sharpness" type="range" min="0" max="100" /></div>
              <div class="slider-row"><span>Definition</span><input v-model="editor.definition" type="range" min="-100" max="100" /></div>
              <div class="slider-row"><span>Vignette</span><input v-model="editor.vignette" type="range" min="0" max="100" /></div>
              <div class="slider-row"><span>Glamour</span><input v-model="editor.glamour" type="range" min="0" max="100" /></div>
              <div class="slider-row"><span>Grayscale</span><input v-model="editor.grayscale" type="range" min="0" max="100" /></div>
              <div class="slider-row"><span>Sepia</span><input v-model="editor.sepia" type="range" min="0" max="100" /></div>
              <div class="slider-row"><span>Crop zoom</span><input v-model="editor.cropZoom" type="range" min="0" max="60" /></div>
              <div class="slider-row"><span>Rotate</span><input v-model="editor.rotate" type="range" min="-180" max="180" /></div>
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
          </aside>
        </div>

        <div class="editor-mobile-panel">
          <div class="editor-mobile-tabs">
            <button
              v-for="tab in editorMobileTabs"
              :key="`editor-tab-${tab.key}`"
              class="chip"
              :class="{ active: activeEditorMobileTab === tab.key }"
              @click="activeEditorMobileTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>

          <div class="editor-mobile-control">
            <div v-if="activeEditorMobileTab === 'previewScale'" class="slider-row"><span>Preview scale</span><input v-model="editorPreviewScale" type="range" min="25" max="300" /></div>
            <div v-else-if="activeEditorMobileTab === 'temperature'" class="slider-row"><span>Temperature</span><input v-model="editor.temperature" type="range" min="-100" max="100" /></div>
            <div v-else-if="activeEditorMobileTab === 'brightness'" class="slider-row"><span>Brightness</span><input v-model="editor.brightness" type="range" min="-60" max="60" /></div>
            <div v-else-if="activeEditorMobileTab === 'contrast'" class="slider-row"><span>Contrast</span><input v-model="editor.contrast" type="range" min="-60" max="60" /></div>
            <div v-else-if="activeEditorMobileTab === 'saturation'" class="slider-row"><span>Saturation</span><input v-model="editor.saturation" type="range" min="-60" max="60" /></div>
            <div v-else-if="activeEditorMobileTab === 'toneDepth'" class="slider-row"><span>Tone depth</span><input v-model="editor.toneDepth" type="range" min="-100" max="100" /></div>
            <div v-else-if="activeEditorMobileTab === 'shadowsLevel'" class="slider-row"><span>Shadows level</span><input v-model="editor.shadowsLevel" type="range" min="-100" max="100" /></div>
            <div v-else-if="activeEditorMobileTab === 'highlightsLevel'" class="slider-row"><span>Highlights level</span><input v-model="editor.highlightsLevel" type="range" min="-100" max="100" /></div>
            <div v-else-if="activeEditorMobileTab === 'sharpness'" class="slider-row"><span>Sharpness</span><input v-model="editor.sharpness" type="range" min="0" max="100" /></div>
            <div v-else-if="activeEditorMobileTab === 'definition'" class="slider-row"><span>Definition</span><input v-model="editor.definition" type="range" min="-100" max="100" /></div>
            <div v-else-if="activeEditorMobileTab === 'vignette'" class="slider-row"><span>Vignette</span><input v-model="editor.vignette" type="range" min="0" max="100" /></div>
            <div v-else-if="activeEditorMobileTab === 'glamour'" class="slider-row"><span>Glamour</span><input v-model="editor.glamour" type="range" min="0" max="100" /></div>
            <div v-else-if="activeEditorMobileTab === 'grayscale'" class="slider-row"><span>Grayscale</span><input v-model="editor.grayscale" type="range" min="0" max="100" /></div>
            <div v-else-if="activeEditorMobileTab === 'sepia'" class="slider-row"><span>Sepia</span><input v-model="editor.sepia" type="range" min="0" max="100" /></div>
            <div v-else-if="activeEditorMobileTab === 'cropZoom'" class="slider-row"><span>Crop zoom</span><input v-model="editor.cropZoom" type="range" min="0" max="60" /></div>
            <div v-else-if="activeEditorMobileTab === 'rotate'" class="slider-row"><span>Rotate</span><input v-model="editor.rotate" type="range" min="-180" max="180" /></div>
            <div v-else class="slider-row switches">
              <span>Mirror</span>
              <div class="switch-group">
                <label><input v-model="editor.flipX" type="checkbox" /> Horizontal</label>
                <label><input v-model="editor.flipY" type="checkbox" /> Vertical</label>
              </div>
            </div>
          </div>

          <div class="editor-actions editor-actions-mobile">
            <button class="btn ghost" aria-label="Reset adjustments" title="Reset" @click="resetEditorAdjustments">
              <i class="ri-refresh-line" aria-hidden="true"></i>
            </button>
            <button class="btn ghost" aria-label="Cancel editing" title="Cancel" @click="closeEditMode">
              <i class="ri-close-line" aria-hidden="true"></i>
            </button>
            <button class="btn ghost" aria-label="Undo last apply" title="Undo" :disabled="saving || undoCount === 0" @click="undoLastPermanentEdit">
              <i class="ri-arrow-go-back-line" aria-hidden="true"></i>
            </button>
            <button class="btn" aria-label="Apply permanently" title="Apply" :disabled="saving" @click="applyImageEditsPermanently">
              <i class="ri-check-line" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>

      <div v-if="shareDialog.open" class="overlay" @click.self="closeShareDialog">
        <div class="album-dialog share-dialog">
          <div class="details-title">Public access settings</div>
          <label class="share-toggle-row">
            <input v-model="shareDialog.enabled" type="checkbox" />
            <span>Enable public access</span>
          </label>

          <div class="field" :class="{ disabled: !shareDialog.enabled }">
            <label>Access mode</label>
            <select v-model="shareDialog.accessMode" class="input" :disabled="!shareDialog.enabled">
              <option value="link">Anyone with link</option>
              <option value="password">Password protected</option>
            </select>
          </div>

          <div class="field" :class="{ disabled: !shareDialog.enabled }">
            <label>Access duration</label>
            <select v-model="shareDialog.expiresPreset" class="input" :disabled="!shareDialog.enabled">
              <option value="never">No expiration</option>
              <option value="1m">1 minute</option>
              <option value="5m">5 minutes</option>
              <option value="1h">1 hour</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
          </div>

          <div
            v-if="shareDialog.enabled && shareDialog.accessMode === 'password'"
            class="field"
          >
            <label>{{ shareDialog.hasPassword ? 'New password (optional)' : 'Password' }}</label>
            <input
              v-model="shareDialog.password"
              class="input"
              type="password"
              :placeholder="shareDialog.hasPassword ? 'Leave empty to keep current password' : 'Enter password'"
            />
          </div>

          <div class="dialog-actions">
            <button class="btn ghost" :disabled="!shareDialog.enabled || !shareDialog.token" @click="copyLinkFromShareDialog">
              Copy public link
            </button>
            <button class="btn ghost" @click="closeShareDialog">Cancel</button>
            <button class="btn" :disabled="shareDialog.saving" @click="saveShareSettings">
              Save
            </button>
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
