<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { MediaItem } from '../api'
import type { CropDragMode, EditorMobileTab, EditorState } from '../composables/useEditorState'

type QuickRecipeKey =
  | 'peachy-clean'
  | 'social-pop'
  | 'cinematic'
  | 'film-matte'
  | 'sunset-glow'
  | 'night-rescue'
  | 'portrait-soft'
  | 'bw-pro'

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
  (e: 'undoStep'): void
  (e: 'redoStep'): void
  (e: 'applyQuickRecipe', recipe: QuickRecipeKey): void
  (e: 'applySmartAutoEnhance'): void
  (e: 'setBeforeAfterActive', value: boolean): void
  (e: 'toggleClippingOverlay'): void
  (e: 'update:editorField', payload: { key: keyof EditorState; value: number | boolean }): void
}>()

const previewScaleModel = computed({
  get: () => props.editorPreviewScale,
  set: (value: number | string) => emit('update:editorPreviewScale', Number(value)),
})

const activeTabModel = computed({
  get: () => props.activeEditorMobileTab,
  set: (value: EditorMobileTab) => emit('update:activeEditorMobileTab', value),
})

const quickRecipes: Array<{ key: QuickRecipeKey; label: string; caption: string }> = [
  { key: 'peachy-clean', label: 'Peachy Clean', caption: 'clean glow' },
  { key: 'social-pop', label: 'Social Pop', caption: 'color boost' },
  { key: 'portrait-soft', label: 'Portrait Soft', caption: 'skin smooth' },
  { key: 'sunset-glow', label: 'Sunset Glow', caption: 'warm mood' },
  { key: 'night-rescue', label: 'Night Rescue', caption: 'lift shadows' },
  { key: 'cinematic', label: 'Cinematic', caption: 'teal mood' },
  { key: 'film-matte', label: 'Film Matte', caption: 'faded film' },
  { key: 'bw-pro', label: 'BW Pro', caption: 'deep mono' },
]

type DesktopSection = 'quick' | 'tone' | 'detail' | 'color' | 'geometry'
const desktopSection = ref<DesktopSection>('quick')

const sectionButtons: Array<{ key: DesktopSection; label: string }> = [
  { key: 'quick', label: 'Quick' },
  { key: 'tone', label: 'Tone' },
  { key: 'detail', label: 'Detail' },
  { key: 'color', label: 'Color' },
  { key: 'geometry', label: 'Geometry' },
]

type SliderFieldKey = keyof EditorState | 'previewScale'

type SliderConfig = {
  key: SliderFieldKey
  label: string
  min: number
  max: number
  step?: number
}

const sectionSliders: Record<Exclude<DesktopSection, 'quick'>, SliderConfig[]> = {
  tone: [
    { key: 'brightness', label: 'Brightness', min: -60, max: 60 },
    { key: 'contrast', label: 'Contrast', min: -60, max: 60 },
    { key: 'toneDepth', label: 'Tone depth', min: -100, max: 100 },
    { key: 'shadowsLevel', label: 'Shadows', min: -100, max: 100 },
    { key: 'highlightsLevel', label: 'Highlights', min: -100, max: 100 },
  ],
  detail: [
    { key: 'sharpness', label: 'Sharpness', min: 0, max: 100 },
    { key: 'definition', label: 'Definition', min: -100, max: 100 },
    { key: 'glamour', label: 'Glamour', min: 0, max: 100 },
    { key: 'vignette', label: 'Vignette', min: 0, max: 100 },
  ],
  color: [
    { key: 'temperature', label: 'Temperature', min: -100, max: 100 },
    { key: 'saturation', label: 'Saturation', min: -60, max: 60 },
    { key: 'grayscale', label: 'Grayscale', min: 0, max: 100 },
    { key: 'sepia', label: 'Sepia', min: 0, max: 100 },
  ],
  geometry: [
    { key: 'previewScale', label: 'Preview scale', min: 25, max: 300 },
    { key: 'cropZoom', label: 'Crop zoom', min: 0, max: 60 },
    { key: 'rotate', label: 'Rotate', min: -180, max: 180, step: 90 },
  ],
}

const activeSectionSliders = computed(() => {
  if (desktopSection.value === 'quick') return []
  return sectionSliders[desktopSection.value]
})

function onStartCrop(event: PointerEvent, mode: CropDragMode) {
  emit('startCrop', event, mode)
}

const processedPreviewSrc = ref('')
let previewRenderTimer: ReturnType<typeof setTimeout> | null = null
let previewRenderRunId = 0

function clampChannel(value: number) {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

function hasJsAdjustments(editor: EditorState) {
  return (
    editor.temperature !== 0 ||
    editor.brightness !== 0 ||
    editor.contrast !== 0 ||
    editor.saturation !== 0 ||
    editor.toneDepth !== 0 ||
    editor.shadowsLevel !== 0 ||
    editor.highlightsLevel !== 0 ||
    editor.sharpness !== 0 ||
    editor.definition !== 0 ||
    editor.vignette !== 0 ||
    editor.glamour !== 0 ||
    editor.grayscale !== 0 ||
    editor.sepia !== 0
  )
}

function averageBlur(source: Uint8ClampedArray, width: number, height: number) {
  const result = new Uint8ClampedArray(source.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let count = 0
      for (let oy = -1; oy <= 1; oy += 1) {
        const sy = y + oy
        if (sy < 0 || sy >= height) continue
        for (let ox = -1; ox <= 1; ox += 1) {
          const sx = x + ox
          if (sx < 0 || sx >= width) continue
          const idx = (sy * width + sx) * 4
          r += source[idx] || 0
          g += source[idx + 1] || 0
          b += source[idx + 2] || 0
          count += 1
        }
      }
      const target = (y * width + x) * 4
      result[target] = Math.round(r / Math.max(1, count))
      result[target + 1] = Math.round(g / Math.max(1, count))
      result[target + 2] = Math.round(b / Math.max(1, count))
      result[target + 3] = source[target + 3] || 255
    }
  }
  return result
}

function applyJsAdjustments(data: ImageData, editor: EditorState) {
  const pixels = data.data
  const width = data.width
  const height = data.height

  const tempShift = editor.temperature * 0.95
  const brightnessShift = editor.brightness * 2.15
  const baseContrast = 1 + editor.contrast / 100
  const depthContrast = 1 + editor.toneDepth / 230
  const definitionContrast = 1 + editor.definition / 280
  const totalContrast = Math.max(0.05, baseContrast * depthContrast * definitionContrast)
  const saturationFactor = Math.max(0, 1 + editor.saturation / 100)
  const shadowsLift = editor.shadowsLevel / 100
  const highlightsCut = editor.highlightsLevel / 100
  const grayscaleMix = Math.max(0, Math.min(1, editor.grayscale / 100))
  const sepiaMix = Math.max(0, Math.min(1, editor.sepia / 100))
  const glamourMix = Math.max(0, Math.min(0.45, editor.glamour / 180))
  const detailBoost = Math.max(0, (editor.sharpness + Math.max(0, editor.definition)) / 250)

  let blurredForBlend: Uint8ClampedArray | null = null
  if (glamourMix > 0 || detailBoost > 0) {
    blurredForBlend = averageBlur(pixels, width, height)
  }

  const centerX = width / 2
  const centerY = height / 2
  const radius = Math.max(1, Math.min(width, height) * 0.68)
  const vignettePower = Math.max(0, Math.min(0.58, editor.vignette / 170))

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      const alpha = pixels[i + 3] || 0
      if (alpha < 8) continue

      let r = pixels[i] || 0
      let g = pixels[i + 1] || 0
      let b = pixels[i + 2] || 0

      if (blurredForBlend && glamourMix > 0) {
        r = r * (1 - glamourMix) + (blurredForBlend[i] || 0) * glamourMix
        g = g * (1 - glamourMix) + (blurredForBlend[i + 1] || 0) * glamourMix
        b = b * (1 - glamourMix) + (blurredForBlend[i + 2] || 0) * glamourMix
      }

      r += tempShift * 0.52
      g += tempShift * 0.12
      b -= tempShift * 0.5

      r += brightnessShift
      g += brightnessShift
      b += brightnessShift

      r = (r - 128) * totalContrast + 128
      g = (g - 128) * totalContrast + 128
      b = (b - 128) * totalContrast + 128

      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const satBase = lum
      r = satBase + (r - satBase) * saturationFactor
      g = satBase + (g - satBase) * saturationFactor
      b = satBase + (b - satBase) * saturationFactor

      if (shadowsLift !== 0 && lum < 128) {
        const weight = (128 - lum) / 128
        const lift = shadowsLift * 52 * weight
        r += lift
        g += lift
        b += lift
      }

      if (highlightsCut !== 0 && lum > 128) {
        const weight = (lum - 128) / 127
        const cut = highlightsCut * 60 * weight
        r -= cut
        g -= cut
        b -= cut
      }

      if (grayscaleMix > 0) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b
        r = r * (1 - grayscaleMix) + gray * grayscaleMix
        g = g * (1 - grayscaleMix) + gray * grayscaleMix
        b = b * (1 - grayscaleMix) + gray * grayscaleMix
      }

      if (sepiaMix > 0) {
        const sr = 0.393 * r + 0.769 * g + 0.189 * b
        const sg = 0.349 * r + 0.686 * g + 0.168 * b
        const sb = 0.272 * r + 0.534 * g + 0.131 * b
        r = r * (1 - sepiaMix) + sr * sepiaMix
        g = g * (1 - sepiaMix) + sg * sepiaMix
        b = b * (1 - sepiaMix) + sb * sepiaMix
      }

      if (blurredForBlend && detailBoost > 0) {
        r += (r - (blurredForBlend[i] || 0)) * detailBoost
        g += (g - (blurredForBlend[i + 1] || 0)) * detailBoost
        b += (b - (blurredForBlend[i + 2] || 0)) * detailBoost
      }

      if (vignettePower > 0) {
        const dx = x - centerX
        const dy = y - centerY
        const d = Math.sqrt(dx * dx + dy * dy)
        const t = Math.max(0, Math.min(1, (d - radius * 0.62) / (radius * 0.7)))
        const darken = 1 - vignettePower * t * t
        r *= darken
        g *= darken
        b *= darken
      }

      pixels[i] = clampChannel(Math.round(r))
      pixels[i + 1] = clampChannel(Math.round(g))
      pixels[i + 2] = clampChannel(Math.round(b))
    }
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Preview image load failed'))
    image.src = src
  })
}

async function renderJsPreview() {
  const runId = ++previewRenderRunId
  if (!props.thumbSrc || !props.canPreview || props.beforeAfterActive || !hasJsAdjustments(props.editor)) {
    processedPreviewSrc.value = ''
    return
  }

  try {
    const image = await loadImage(props.thumbSrc)
    if (runId !== previewRenderRunId) return

    const maxSide = 1600
    const scale = Math.max(1, Math.max(image.naturalWidth, image.naturalHeight) / maxSide)
    const width = Math.max(1, Math.round(image.naturalWidth / scale))
    const height = Math.max(1, Math.round(image.naturalHeight / scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      processedPreviewSrc.value = ''
      return
    }

    context.drawImage(image, 0, 0, width, height)
    const data = context.getImageData(0, 0, width, height)
    applyJsAdjustments(data, props.editor)
    context.putImageData(data, 0, 0)

    if (runId !== previewRenderRunId) return
    processedPreviewSrc.value = canvas.toDataURL('image/jpeg', 0.94)
  } catch {
    processedPreviewSrc.value = ''
  }
}

function scheduleJsPreviewRender() {
  if (previewRenderTimer) {
    clearTimeout(previewRenderTimer)
  }
  previewRenderTimer = setTimeout(() => {
    previewRenderTimer = null
    void renderJsPreview()
  }, 35)
}

watch(
  () => [
    props.thumbSrc,
    props.canPreview,
    props.beforeAfterActive,
    props.editor.temperature,
    props.editor.brightness,
    props.editor.contrast,
    props.editor.saturation,
    props.editor.toneDepth,
    props.editor.shadowsLevel,
    props.editor.highlightsLevel,
    props.editor.sharpness,
    props.editor.definition,
    props.editor.vignette,
    props.editor.glamour,
    props.editor.grayscale,
    props.editor.sepia,
  ],
  () => {
    scheduleJsPreviewRender()
  },
  { immediate: true },
)

function updateEditorNumberField(key: keyof EditorState, event: Event) {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  emit('update:editorField', { key, value: Number(target.value) })
}

function updateSliderField(key: SliderFieldKey, event: Event) {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  const value = Number(target.value)
  if (key === 'previewScale') {
    emit('update:editorPreviewScale', value)
    return
  }
  emit('update:editorField', { key, value })
}

function sliderValue(key: SliderFieldKey) {
  if (key === 'previewScale') return props.editorPreviewScale
  return props.editor[key]
}

function updateEditorBooleanField(key: keyof EditorState, event: Event) {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  emit('update:editorField', { key, value: Boolean(target.checked) })
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
  if (previewRenderTimer) {
    clearTimeout(previewRenderTimer)
    previewRenderTimer = null
  }
  previewRenderRunId += 1
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
                :src="beforeAfterActive ? thumbSrc : (processedPreviewSrc || thumbSrc)"
                :alt="activeMedia.filename"
                :style="editorFilterStyle"
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
        <div class="editor-toolbar-groups editor-toolbar-groups-pro">
          <div class="editor-pro-head">
            <div>
              <div class="editor-toolbar-label">Creator Studio</div>
              <div class="editor-pro-subtitle">Fast looks + pro controls</div>
            </div>
            <div class="editor-pro-history">History {{ historyPosition }}/{{ historyTotal }}</div>
          </div>

          <div class="editor-presets editor-presets-pro">
            <span class="editor-toolbar-label">Quick Recipes</span>
            <div class="editor-recipe-grid">
              <button
                v-for="recipe in quickRecipes"
                :key="`recipe-${recipe.key}`"
                class="editor-recipe-card"
                type="button"
                @click="emit('applyQuickRecipe', recipe.key)"
              >
                <span class="editor-recipe-title">{{ recipe.label }}</span>
                <span class="editor-recipe-caption">{{ recipe.caption }}</span>
              </button>
            </div>
            <div class="editor-chip-row">
              <button class="chip" type="button" @click="emit('applySmartAutoEnhance')">Smart Auto</button>
              <button class="chip" type="button" @click="emit('applyPreset', 'auto')">Classic Auto</button>
              <button class="chip" type="button" @mousedown="onBeforeAfterMouseDown" @mouseup="onBeforeAfterMouseUp" @mouseleave="onBeforeAfterMouseUp" @touchstart.prevent="emit('setBeforeAfterActive', true)" @touchend.prevent="emit('setBeforeAfterActive', false)">
                Hold Compare
              </button>
            </div>
          </div>

          <div class="editor-presets">
            <div class="editor-chip-row editor-section-tabs">
              <button
                v-for="section in sectionButtons"
                :key="`section-${section.key}`"
                class="chip"
                :class="{ active: desktopSection === section.key }"
                type="button"
                @click="desktopSection = section.key"
              >
                {{ section.label }}
              </button>
            </div>

            <div v-if="desktopSection === 'quick'" class="editor-chip-row">
              <button class="chip" type="button" @click="emit('copyEdits')">Copy edits</button>
              <button class="chip" type="button" :disabled="!canPasteEdits" @click="emit('pasteEdits')">Paste edits</button>
              <button class="chip" type="button" :disabled="!canUndoStep" @click="emit('undoStep')">Undo step</button>
              <button class="chip" type="button" :disabled="!canRedoStep" @click="emit('redoStep')">Redo step</button>
              <button class="chip" type="button" :class="{ active: clippingOverlayEnabled }" @click="emit('toggleClippingOverlay')">
                Clipping overlay
              </button>
            </div>

            <div v-else class="editor-controls editor-controls-pro">
              <div v-for="control in activeSectionSliders" :key="`control-${control.key}`" class="slider-row slider-row-pro">
                <span class="slider-row-title">{{ control.label }}</span>
                <div class="slider-row-main">
                  <input
                    :value="sliderValue(control.key)"
                    type="range"
                    :min="control.min"
                    :max="control.max"
                    :step="control.step || 1"
                    @input="updateSliderField(control.key, $event)"
                  />
                  <span class="slider-value-pill">{{ Number(sliderValue(control.key)).toFixed(0) }}</span>
                </div>
              </div>

              <div v-if="desktopSection === 'geometry'" class="slider-row switches">
                <span>Mirror</span>
                <div class="switch-group">
                  <label><input :checked="editor.flipX" type="checkbox" @change="updateEditorBooleanField('flipX', $event)" /> Horizontal</label>
                  <label><input :checked="editor.flipY" type="checkbox" @change="updateEditorBooleanField('flipY', $event)" /> Vertical</label>
                </div>
              </div>
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
      <div class="editor-mobile-quick-recipes">
        <button class="chip" type="button" @click="emit('applySmartAutoEnhance')">Smart Auto</button>
        <button class="chip" type="button" @click="emit('applyQuickRecipe', 'peachy-clean')">Peachy</button>
        <button class="chip" type="button" @click="emit('applyQuickRecipe', 'social-pop')">Pop</button>
        <button class="chip" type="button" @click="emit('applyQuickRecipe', 'portrait-soft')">Portrait</button>
        <button class="chip" type="button" @click="emit('applyQuickRecipe', 'cinematic')">Cine</button>
      </div>

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
        <div v-else-if="activeTabModel === 'temperature'" class="slider-row"><span>Temperature</span><input :value="editor.temperature" type="range" min="-100" max="100" @input="updateEditorNumberField('temperature', $event)" /></div>
        <div v-else-if="activeTabModel === 'brightness'" class="slider-row"><span>Brightness</span><input :value="editor.brightness" type="range" min="-60" max="60" @input="updateEditorNumberField('brightness', $event)" /></div>
        <div v-else-if="activeTabModel === 'contrast'" class="slider-row"><span>Contrast</span><input :value="editor.contrast" type="range" min="-60" max="60" @input="updateEditorNumberField('contrast', $event)" /></div>
        <div v-else-if="activeTabModel === 'saturation'" class="slider-row"><span>Saturation</span><input :value="editor.saturation" type="range" min="-60" max="60" @input="updateEditorNumberField('saturation', $event)" /></div>
        <div v-else-if="activeTabModel === 'toneDepth'" class="slider-row"><span>Tone depth</span><input :value="editor.toneDepth" type="range" min="-100" max="100" @input="updateEditorNumberField('toneDepth', $event)" /></div>
        <div v-else-if="activeTabModel === 'shadowsLevel'" class="slider-row"><span>Shadows level</span><input :value="editor.shadowsLevel" type="range" min="-100" max="100" @input="updateEditorNumberField('shadowsLevel', $event)" /></div>
        <div v-else-if="activeTabModel === 'highlightsLevel'" class="slider-row"><span>Highlights level</span><input :value="editor.highlightsLevel" type="range" min="-100" max="100" @input="updateEditorNumberField('highlightsLevel', $event)" /></div>
        <div v-else-if="activeTabModel === 'sharpness'" class="slider-row"><span>Sharpness</span><input :value="editor.sharpness" type="range" min="0" max="100" @input="updateEditorNumberField('sharpness', $event)" /></div>
        <div v-else-if="activeTabModel === 'definition'" class="slider-row"><span>Definition</span><input :value="editor.definition" type="range" min="-100" max="100" @input="updateEditorNumberField('definition', $event)" /></div>
        <div v-else-if="activeTabModel === 'vignette'" class="slider-row"><span>Vignette</span><input :value="editor.vignette" type="range" min="0" max="100" @input="updateEditorNumberField('vignette', $event)" /></div>
        <div v-else-if="activeTabModel === 'glamour'" class="slider-row"><span>Glamour</span><input :value="editor.glamour" type="range" min="0" max="100" @input="updateEditorNumberField('glamour', $event)" /></div>
        <div v-else-if="activeTabModel === 'grayscale'" class="slider-row"><span>Grayscale</span><input :value="editor.grayscale" type="range" min="0" max="100" @input="updateEditorNumberField('grayscale', $event)" /></div>
        <div v-else-if="activeTabModel === 'sepia'" class="slider-row"><span>Sepia</span><input :value="editor.sepia" type="range" min="0" max="100" @input="updateEditorNumberField('sepia', $event)" /></div>
        <div v-else-if="activeTabModel === 'cropZoom'" class="slider-row"><span>Crop zoom</span><input :value="editor.cropZoom" type="range" min="0" max="60" @input="updateEditorNumberField('cropZoom', $event)" /></div>
        <div v-else-if="activeTabModel === 'rotate'" class="slider-row"><span>Rotate</span><input :value="editor.rotate" type="range" min="-180" max="180" step="90" @input="updateEditorNumberField('rotate', $event)" /></div>
        <div v-else class="slider-row switches">
          <span>Mirror</span>
          <div class="switch-group">
            <label><input :checked="editor.flipX" type="checkbox" @change="updateEditorBooleanField('flipX', $event)" /> Horizontal</label>
            <label><input :checked="editor.flipY" type="checkbox" @change="updateEditorBooleanField('flipY', $event)" /> Vertical</label>
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
        <button class="btn ghost" aria-label="Undo step" title="Undo step" :disabled="!canUndoStep" @click="emit('undoStep')">
          <i class="ri-reply-line" aria-hidden="true"></i>
        </button>
        <button class="btn ghost" aria-label="Redo step" title="Redo step" :disabled="!canRedoStep" @click="emit('redoStep')">
          <i class="ri-share-forward-line" aria-hidden="true"></i>
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
