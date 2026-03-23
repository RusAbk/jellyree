<script setup lang="ts">
import { computed } from 'vue'
import type { MediaItem } from '../api'
import type { EditorMobileTab, EditorState } from '../composables/useEditorState'

const props = defineProps<{
  open: boolean
  activeMedia: MediaItem | null
  thumbSrc: string
  canPreview: boolean
  editor: EditorState
  editorPreviewScale: number
  activeEditorMobileTab: EditorMobileTab
  editorMobileTabs: Array<{ key: EditorMobileTab; label: string }>
  editorPreviewFrameStyle: Record<string, string | number>
  editorCropRectStyle: Record<string, string | number>
  editorFilterStyle: Record<string, string | number>
  saving: boolean
  undoCount: number
  canPasteEdits: boolean
  canUndoStep: boolean
  canRedoStep: boolean
  historyPosition: number
  historyTotal: number
  beforeAfterActive: boolean
  clippingOverlayEnabled: boolean
  histogram: number[]
  clippingStats: {
    shadows: number
    highlights: number
  }
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'switchEngine', value: 'legacy' | 'photopea'): void
}>()

const photopeaSrc = computed(() => {
  if (!props.thumbSrc || !props.canPreview) {
    return 'https://www.photopea.com/'
  }

  const config = {
    files: [props.thumbSrc],
  }

  return `https://www.photopea.com#${encodeURIComponent(JSON.stringify(config))}`
})
</script>

<template>
  <div v-if="open && activeMedia" class="editor-fullscreen">
    <div class="editor-head editor-head-full">
      <div>
        <div class="details-title">Photo editor (Photopea mode)</div>
        <div class="muted">{{ activeMedia.filename }}</div>
      </div>
      <div class="editor-chip-row">
        <button class="chip" type="button" @click="emit('switchEngine', 'legacy')">Switch to legacy editor</button>
        <button class="chip" type="button" @click="emit('close')">Close</button>
      </div>
    </div>

    <div class="editor-layout editor-layout-photopea">
      <div v-if="canPreview" class="editor-photopea-wrap">
        <iframe
          :key="`photopea-${activeMedia.id}`"
          class="editor-photopea-iframe"
          :src="photopeaSrc"
          title="Photopea editor"
          allow="clipboard-read; clipboard-write"
          referrerpolicy="no-referrer"
        ></iframe>
      </div>

      <div v-else class="editor-photopea-unavailable">
        Preview unavailable for this format
      </div>
    </div>
  </div>
</template>
