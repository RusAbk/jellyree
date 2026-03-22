<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
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
  canPasteEdits: boolean
  beforeAfterActive: boolean
  clippingOverlayEnabled: boolean
  histogram: number[]
  clippingStats: {
    shadows: number
    highlights: number
  }
}>()

const emit = defineEmits<{
  (e: 'update:editorPreviewScale', value: number): void
  (e: 'update:activeEditorMobileTab', value: EditorMobileTab): void
  (e: 'close'): void
  (e: 'cropMove', event: PointerEvent): void
  (e: 'stopCrop'): void
  (e: 'startCrop', event: PointerEvent, mode: CropDragMode): void
  (e: 'reset'): void
  (e: 'resetGroup', group: 'tone' | 'detail' | 'color' | 'geometry'): void
  (e: 'undo'): void
  (e: 'apply'): void
  (e: 'applyPreset', preset: 'auto' | 'portrait' | 'landscape' | 'night' | 'bw'): void
  (e: 'copyEdits'): void
  (e: 'pasteEdits'): void
  (e: 'setBeforeAfterActive', value: boolean): void
  (e: 'toggleClippingOverlay'): void
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

let beforeAfterTouchTimer: ReturnType<typeof setTimeout> | null = null

function onPreviewPointerDown(event: PointerEvent) {
  if (event.pointerType !== 'touch') return
  if (beforeAfterTouchTimer) {
    clearTimeout(beforeAfterTouchTimer)
    beforeAfterTouchTimer = null
  }
  beforeAfterTouchTimer = setTimeout(() => {
    emit('setBeforeAfterActive', true)
    beforeAfterTouchTimer = null
  }, 260)
}

function onPreviewPointerUpOrCancel() {
  if (beforeAfterTouchTimer) {
    clearTimeout(beforeAfterTouchTimer)
    beforeAfterTouchTimer = null
  }
  emit('setBeforeAfterActive', false)
}

function onBeforeAfterMouseDown() {
  emit('setBeforeAfterActive', true)
}

function onBeforeAfterMouseUp() {
  emit('setBeforeAfterActive', false)
}

onBeforeUnmount(() => {
  if (beforeAfterTouchTimer) {
    clearTimeout(beforeAfterTouchTimer)
    beforeAfterTouchTimer = null
  }
})
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
            @pointerdown="onPreviewPointerDown"
            @pointermove="emit('cropMove', $event)"
            @pointerup="emit('stopCrop')"
            @pointercancel="emit('stopCrop')"
            @pointerleave="emit('stopCrop')"
            @pointerup.capture="onPreviewPointerUpOrCancel"
            @pointercancel.capture="onPreviewPointerUpOrCancel"
            @pointerleave.capture="onPreviewPointerUpOrCancel"
          >
            <div class="editor-image-frame" :style="editorPreviewFrameStyle">
              <img
                class="overlay-image editor-image"
                :src="thumbSrc"
                :alt="activeMedia.filename"
                :style="beforeAfterActive ? {} : editorFilterStyle"
              />
              <div
                v-if="clippingOverlayEnabled"
                class="editor-clipping-overlay"
                :style="{
                  '--highlight-opacity': String(Math.min(0.7, clippingStats.highlights / 32)),
                  '--shadow-opacity': String(Math.min(0.7, clippingStats.shadows / 32)),
                }"
              ></div>
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
        <div class="editor-toolbar-groups">
          <div class="editor-presets">
            <span class="editor-toolbar-label">Presets</span>
            <div class="editor-chip-row">
              <button class="chip" type="button" @click="emit('applyPreset', 'auto')">Auto</button>
              <button class="chip" type="button" @click="emit('applyPreset', 'portrait')">Portrait</button>
              <button class="chip" type="button" @click="emit('applyPreset', 'landscape')">Landscape</button>
              <button class="chip" type="button" @click="emit('applyPreset', 'night')">Night</button>
              <button class="chip" type="button" @click="emit('applyPreset', 'bw')">BW</button>
            </div>
          </div>

          <div class="editor-presets">
            <span class="editor-toolbar-label">Editing tools</span>
            <div class="editor-chip-row">
              <button class="chip" type="button" @mousedown="onBeforeAfterMouseDown" @mouseup="onBeforeAfterMouseUp" @mouseleave="onBeforeAfterMouseUp" @touchstart.prevent="emit('setBeforeAfterActive', true)" @touchend.prevent="emit('setBeforeAfterActive', false)">
                Before/After
              </button>
              <button class="chip" type="button" @click="emit('copyEdits')">Copy edits</button>
              <button class="chip" type="button" :disabled="!canPasteEdits" @click="emit('pasteEdits')">Paste edits</button>
              <button class="chip" type="button" :class="{ active: clippingOverlayEnabled }" @click="emit('toggleClippingOverlay')">
                Clipping overlay
              </button>
            </div>
          </div>

          <div class="editor-histogram">
            <div class="editor-histogram-head">
              <span class="editor-toolbar-label">Histogram</span>
              <span class="muted">Shadows {{ clippingStats.shadows.toFixed(1) }}% · Highlights {{ clippingStats.highlights.toFixed(1) }}%</span>
            </div>
            <div class="editor-histogram-bars" role="img" aria-label="Image histogram">
              <span
                v-for="(bin, index) in histogram"
                :key="`hist-${index}`"
                class="editor-histogram-bin"
                :style="{ height: `${Math.max(4, Math.min(100, bin * 100))}%` }"
              ></span>
            </div>
          </div>

          <div class="editor-presets">
            <span class="editor-toolbar-label">Reset groups</span>
            <div class="editor-chip-row">
              <button class="chip" type="button" @click="emit('resetGroup', 'tone')">Tone</button>
              <button class="chip" type="button" @click="emit('resetGroup', 'detail')">Detail</button>
              <button class="chip" type="button" @click="emit('resetGroup', 'color')">Color</button>
              <button class="chip" type="button" @click="emit('resetGroup', 'geometry')">Geometry</button>
            </div>
          </div>
        </div>

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
        <button class="btn ghost" aria-label="Apply auto preset" title="Auto preset" @click="emit('applyPreset', 'auto')">
          <i class="ri-magic-line" aria-hidden="true"></i>
        </button>
        <button class="btn ghost" aria-label="Copy edits" title="Copy" @click="emit('copyEdits')">
          <i class="ri-file-copy-line" aria-hidden="true"></i>
        </button>
        <button class="btn ghost" aria-label="Paste edits" title="Paste" :disabled="!canPasteEdits" @click="emit('pasteEdits')">
          <i class="ri-clipboard-line" aria-hidden="true"></i>
        </button>
        <button class="btn ghost" aria-label="Before after" title="Before/After" @touchstart.prevent="emit('setBeforeAfterActive', true)" @touchend.prevent="emit('setBeforeAfterActive', false)">
          <i class="ri-contrast-line" aria-hidden="true"></i>
        </button>
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
