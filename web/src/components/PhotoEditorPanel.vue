<script setup lang="ts">
import { computed } from 'vue'
import type { MediaItem } from '../api'
import type { CropDragMode, EditorMobileTab, EditorState } from '../composables/useEditorState'

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
}>()

const emit = defineEmits<{
  (e: 'update:editorPreviewScale', value: number): void
  (e: 'update:activeEditorMobileTab', value: EditorMobileTab): void
  (e: 'close'): void
  (e: 'cropMove', event: PointerEvent): void
  (e: 'stopCrop'): void
  (e: 'startCrop', event: PointerEvent, mode: CropDragMode): void
  (e: 'reset'): void
  (e: 'undo'): void
  (e: 'apply'): void
}>()

const previewScaleModel = computed({
  get: () => props.editorPreviewScale,
  set: (value: number | string) => emit('update:editorPreviewScale', Number(value)),
})

const activeTabModel = computed({
  get: () => props.activeEditorMobileTab,
  set: (value: EditorMobileTab) => emit('update:activeEditorMobileTab', value),
})

function onStartCrop(event: PointerEvent, mode: CropDragMode) {
  emit('startCrop', event, mode)
}
</script>

<template>
  <div v-if="open && activeMedia" class="editor-fullscreen">
    <div class="editor-head editor-head-full">
      <div>
        <div class="details-title">Photo editor</div>
        <div class="muted">{{ activeMedia.filename }}</div>
      </div>
      <button class="chip" @click="emit('close')">Close</button>
    </div>

    <div class="editor-layout">
      <div class="editor-canvas">
        <div class="editor-preview">
          <div
            v-if="thumbSrc && canPreview"
            class="editor-crop-stage"
            @pointermove="emit('cropMove', $event)"
            @pointerup="emit('stopCrop')"
            @pointercancel="emit('stopCrop')"
            @pointerleave="emit('stopCrop')"
          >
            <div class="editor-image-frame" :style="editorPreviewFrameStyle">
              <img
                class="overlay-image editor-image"
                :src="thumbSrc"
                :alt="activeMedia.filename"
                :style="editorFilterStyle"
              />
              <div class="crop-rect" :style="editorCropRectStyle" @pointerdown="onStartCrop($event, 'move')">
                <span class="crop-grid v1"></span>
                <span class="crop-grid v2"></span>
                <span class="crop-grid h1"></span>
                <span class="crop-grid h2"></span>
                <span class="crop-handle nw" @pointerdown.stop="onStartCrop($event, 'nw')"></span>
                <span class="crop-handle ne" @pointerdown.stop="onStartCrop($event, 'ne')"></span>
                <span class="crop-handle sw" @pointerdown.stop="onStartCrop($event, 'sw')"></span>
                <span class="crop-handle se" @pointerdown.stop="onStartCrop($event, 'se')"></span>
                <span class="crop-handle n" @pointerdown.stop="onStartCrop($event, 'n')"></span>
                <span class="crop-handle s" @pointerdown.stop="onStartCrop($event, 's')"></span>
                <span class="crop-handle w" @pointerdown.stop="onStartCrop($event, 'w')"></span>
                <span class="crop-handle e" @pointerdown.stop="onStartCrop($event, 'e')"></span>
              </div>
            </div>
          </div>
          <div v-else class="overlay-fallback">Preview unavailable for this format</div>
        </div>
      </div>

      <aside class="editor-sidebar">
        <div class="editor-controls">
          <div class="slider-row"><span>Preview scale</span><input v-model="previewScaleModel" type="range" min="25" max="300" /></div>
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
          <div class="slider-row"><span>Rotate</span><input v-model="editor.rotate" type="range" min="-180" max="180" step="90" /></div>
          <div class="slider-row switches">
            <span>Mirror</span>
            <div class="switch-group">
              <label><input v-model="editor.flipX" type="checkbox" /> Horizontal</label>
              <label><input v-model="editor.flipY" type="checkbox" /> Vertical</label>
            </div>
          </div>
        </div>

        <div class="editor-actions">
          <button class="btn ghost" @click="emit('reset')">Reset</button>
          <button class="btn ghost" @click="emit('close')">Cancel</button>
          <button class="btn ghost" :disabled="saving || undoCount === 0" @click="emit('undo')">
            Undo apply ({{ undoCount }})
          </button>
          <button class="btn" :disabled="saving" @click="emit('apply')">Apply permanently</button>
        </div>
      </aside>
    </div>

    <div class="editor-mobile-panel">
      <div class="editor-mobile-tabs">
        <button
          v-for="tab in editorMobileTabs"
          :key="`editor-tab-${tab.key}`"
          class="chip"
          :class="{ active: activeTabModel === tab.key }"
          @click="activeTabModel = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="editor-mobile-control">
        <div v-if="activeTabModel === 'previewScale'" class="slider-row"><span>Preview scale</span><input v-model="previewScaleModel" type="range" min="25" max="300" /></div>
        <div v-else-if="activeTabModel === 'temperature'" class="slider-row"><span>Temperature</span><input v-model="editor.temperature" type="range" min="-100" max="100" /></div>
        <div v-else-if="activeTabModel === 'brightness'" class="slider-row"><span>Brightness</span><input v-model="editor.brightness" type="range" min="-60" max="60" /></div>
        <div v-else-if="activeTabModel === 'contrast'" class="slider-row"><span>Contrast</span><input v-model="editor.contrast" type="range" min="-60" max="60" /></div>
        <div v-else-if="activeTabModel === 'saturation'" class="slider-row"><span>Saturation</span><input v-model="editor.saturation" type="range" min="-60" max="60" /></div>
        <div v-else-if="activeTabModel === 'toneDepth'" class="slider-row"><span>Tone depth</span><input v-model="editor.toneDepth" type="range" min="-100" max="100" /></div>
        <div v-else-if="activeTabModel === 'shadowsLevel'" class="slider-row"><span>Shadows level</span><input v-model="editor.shadowsLevel" type="range" min="-100" max="100" /></div>
        <div v-else-if="activeTabModel === 'highlightsLevel'" class="slider-row"><span>Highlights level</span><input v-model="editor.highlightsLevel" type="range" min="-100" max="100" /></div>
        <div v-else-if="activeTabModel === 'sharpness'" class="slider-row"><span>Sharpness</span><input v-model="editor.sharpness" type="range" min="0" max="100" /></div>
        <div v-else-if="activeTabModel === 'definition'" class="slider-row"><span>Definition</span><input v-model="editor.definition" type="range" min="-100" max="100" /></div>
        <div v-else-if="activeTabModel === 'vignette'" class="slider-row"><span>Vignette</span><input v-model="editor.vignette" type="range" min="0" max="100" /></div>
        <div v-else-if="activeTabModel === 'glamour'" class="slider-row"><span>Glamour</span><input v-model="editor.glamour" type="range" min="0" max="100" /></div>
        <div v-else-if="activeTabModel === 'grayscale'" class="slider-row"><span>Grayscale</span><input v-model="editor.grayscale" type="range" min="0" max="100" /></div>
        <div v-else-if="activeTabModel === 'sepia'" class="slider-row"><span>Sepia</span><input v-model="editor.sepia" type="range" min="0" max="100" /></div>
        <div v-else-if="activeTabModel === 'cropZoom'" class="slider-row"><span>Crop zoom</span><input v-model="editor.cropZoom" type="range" min="0" max="60" /></div>
        <div v-else-if="activeTabModel === 'rotate'" class="slider-row"><span>Rotate</span><input v-model="editor.rotate" type="range" min="-180" max="180" step="90" /></div>
        <div v-else class="slider-row switches">
          <span>Mirror</span>
          <div class="switch-group">
            <label><input v-model="editor.flipX" type="checkbox" /> Horizontal</label>
            <label><input v-model="editor.flipY" type="checkbox" /> Vertical</label>
          </div>
        </div>
      </div>

      <div class="editor-actions editor-actions-mobile">
        <button class="btn ghost" aria-label="Reset adjustments" title="Reset" @click="emit('reset')">
          <i class="ri-refresh-line" aria-hidden="true"></i>
        </button>
        <button class="btn ghost" aria-label="Cancel editing" title="Cancel" @click="emit('close')">
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
        <button class="btn ghost" aria-label="Undo last apply" title="Undo" :disabled="saving || undoCount === 0" @click="emit('undo')">
          <i class="ri-arrow-go-back-line" aria-hidden="true"></i>
        </button>
        <button class="btn" aria-label="Apply permanently" title="Apply" :disabled="saving" @click="emit('apply')">
          <i class="ri-check-line" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  </div>
</template>
