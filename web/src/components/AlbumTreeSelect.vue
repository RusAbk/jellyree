<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Album } from '../api'

type AlbumTreeItem = {
  id: string
  name: string
  depth: number
  parentId: string | null
  hasChildren: boolean
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    albums: Album[]
    placeholder?: string
    emptyOptionLabel?: string
    allowEmpty?: boolean
    disabled?: boolean
    searchPlaceholder?: string
  }>(),
  {
    placeholder: 'Select album',
    emptyOptionLabel: '',
    allowEmpty: true,
    disabled: false,
    searchPlaceholder: 'Search albums',
  },
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'blur'): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const open = ref(false)
const search = ref('')
const expandedAlbumIds = ref<string[]>([])
const knownParentIds = ref<string[]>([])
const expandedInitialized = ref(false)

const albumById = computed(() => new Map(props.albums.map((album) => [album.id, album])))

const childrenByParent = computed(() => {
  const map = new Map<string | null, Album[]>()

  for (const album of props.albums) {
    const key = album.parentId || null
    const bucket = map.get(key) || []
    bucket.push(album)
    map.set(key, bucket)
  }

  for (const [key, bucket] of map.entries()) {
    map.set(key, [...bucket].sort((a, b) => a.name.localeCompare(b.name)))
  }

  return map
})

const parentAlbumIds = computed(() => {
  const ids = new Set<string>()
  for (const album of props.albums) {
    if (album.parentId) {
      ids.add(album.parentId)
    }
  }
  return ids
})

const treeItems = computed<AlbumTreeItem[]>(() => {
  const result: AlbumTreeItem[] = []

  const walk = (parentId: string | null, depth: number) => {
    const children = childrenByParent.value.get(parentId) || []
    for (const album of children) {
      result.push({
        id: album.id,
        name: album.name,
        depth,
        parentId,
        hasChildren: (childrenByParent.value.get(album.id) || []).length > 0,
      })
      walk(album.id, depth + 1)
    }
  }

  walk(null, 0)
  return result
})

const filteredTreeItems = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return treeItems.value

  const includeIds = new Set<string>()

  for (const item of treeItems.value) {
    if (!item.name.toLowerCase().includes(query)) continue
    includeIds.add(item.id)

    let cursor = item.parentId
    while (cursor) {
      includeIds.add(cursor)
      cursor = albumById.value.get(cursor)?.parentId || null
    }
  }

  return treeItems.value.filter((item) => includeIds.has(item.id))
})

const visibleTreeItems = computed(() => {
  if (search.value.trim()) {
    return filteredTreeItems.value
  }

  const expandedSet = new Set(expandedAlbumIds.value)
  const visibleIds = new Set<string>()
  const result: AlbumTreeItem[] = []

  for (const item of treeItems.value) {
    const isVisible =
      item.parentId === null ||
      (visibleIds.has(item.parentId) && expandedSet.has(item.parentId))

    if (!isVisible) continue
    result.push(item)
    visibleIds.add(item.id)
  }

  return result
})

const selectedLabel = computed(() => {
  if (!props.modelValue) return ''
  return albumById.value.get(props.modelValue)?.name || ''
})

function closePanel(emitBlur: boolean) {
  if (!open.value) return
  open.value = false
  if (emitBlur) {
    emit('blur')
  }
}

function togglePanel() {
  if (props.disabled) return

  if (open.value) {
    closePanel(true)
    return
  }

  open.value = true
}

function selectAlbum(albumId: string) {
  emit('update:modelValue', albumId)
  closePanel(false)
}

function toggleExpanded(albumId: string) {
  if (search.value.trim()) return

  if (expandedAlbumIds.value.includes(albumId)) {
    expandedAlbumIds.value = expandedAlbumIds.value.filter((id) => id !== albumId)
    return
  }

  expandedAlbumIds.value = [...expandedAlbumIds.value, albumId]
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (!target || !rootRef.value) return
  if (rootRef.value.contains(target)) return
  closePanel(true)
}

function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open.value) return
  event.preventDefault()
  closePanel(true)
}

watch(open, async (nextOpen) => {
  if (!nextOpen) return
  await nextTick()
  searchInputRef.value?.focus()
})

watch(
  () => props.modelValue,
  () => {
    search.value = ''
  },
)

watch(
  parentAlbumIds,
  (nextSet) => {
    const nextIds = Array.from(nextSet)
    const knownSet = new Set(knownParentIds.value)

    if (!expandedInitialized.value) {
      expandedAlbumIds.value = [...nextIds]
      knownParentIds.value = [...nextIds]
      expandedInitialized.value = true
      return
    }

    const expandedSet = new Set(expandedAlbumIds.value)
    for (const id of nextIds) {
      if (!knownSet.has(id)) {
        expandedSet.add(id)
      }
    }

    expandedAlbumIds.value = Array.from(expandedSet)
    knownParentIds.value = [...nextIds]
  },
  { immediate: true },
)

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onEscape)
})
</script>

<template>
  <div ref="rootRef" class="album-tree-select" :class="{ disabled: disabled }">
    <button
      type="button"
      class="input album-tree-select-trigger"
      :disabled="disabled"
      @click="togglePanel"
    >
      <span class="album-tree-select-label">{{ selectedLabel || placeholder }}</span>
      <span class="album-tree-select-caret">▾</span>
    </button>

    <div v-if="open" class="album-tree-select-panel">
      <input
        ref="searchInputRef"
        v-model="search"
        class="input album-tree-select-search"
        type="text"
        :placeholder="searchPlaceholder"
      />

      <div class="album-tree-select-list">
        <button
          v-if="allowEmpty"
          type="button"
          class="album-tree-option album-tree-option-empty"
          :class="{ selected: !modelValue }"
          @click="selectAlbum('')"
        >
          {{ emptyOptionLabel || placeholder }}
        </button>

        <div
          v-for="item in visibleTreeItems"
          :key="`album-tree-item-${item.id}`"
          class="album-tree-row"
          :style="{ paddingLeft: `${6 + item.depth * 16}px` }"
        >
          <button
            v-if="item.hasChildren"
            type="button"
            class="album-tree-expander"
            :class="{ expanded: expandedAlbumIds.includes(item.id) || search.trim() }"
            :title="expandedAlbumIds.includes(item.id) ? 'Collapse' : 'Expand'"
            @click.stop="toggleExpanded(item.id)"
          >
            {{ expandedAlbumIds.includes(item.id) || search.trim() ? '▾' : '▸' }}
          </button>
          <span v-else class="album-tree-expander-spacer" aria-hidden="true"></span>

          <button
            type="button"
            class="album-tree-option"
            :class="{ selected: modelValue === item.id }"
            @click="selectAlbum(item.id)"
          >
            <span class="album-tree-option-name">{{ item.name }}</span>
          </button>
        </div>

        <div v-if="visibleTreeItems.length === 0" class="album-tree-empty">
          Nothing found
        </div>
      </div>
    </div>
  </div>
</template>
