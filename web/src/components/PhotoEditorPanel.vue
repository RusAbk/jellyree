<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
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

type GeometryTool = 'crop' | 'liquify' | 'stretch'
type StretchAxis = 'vertical' | 'horizontal'

type LiquifyStroke = {
  fromX: number
  fromY: number
  toX: number
  toY: number
  radius: number
  strength: number
}

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

const geometryTool = ref<GeometryTool>('crop')
const liquifyBrushSize = ref(24)
const liquifyIntensity = ref(56)
const liquifyStrokes = ref<LiquifyStroke[]>([])
const liquifyChangeTick = ref(0)
const liquifyCursor = reactive({
  visible: false,
  x: 50,
  y: 50,
})

const stretchAxis = ref<StretchAxis>('vertical')
const stretchBandStart = ref(34)
const stretchBandEnd = ref(66)
const stretchAmount = ref(0)

const stageDrag = reactive({
  active: false,
  mode: 'none' as 'none' | 'liquify' | 'stretch-start' | 'stretch-end' | 'stretch-band',
  startX: 0,
  startY: 0,
  startNormX: 0,
  startNormY: 0,
  originBandStart: 34,
  originBandEnd: 66,
  lastNormX: 0,
  lastNormY: 0,
})

const stretchOverlayStyle = computed(() => {
  if (stretchAxis.value === 'vertical') {
    return {
      left: `${stretchBandStart.value}%`,
      width: `${Math.max(0, stretchBandEnd.value - stretchBandStart.value)}%`,
      top: '0%',
      height: '100%',
    }
  }

  return {
    top: `${stretchBandStart.value}%`,
    height: `${Math.max(0, stretchBandEnd.value - stretchBandStart.value)}%`,
    left: '0%',
    width: '100%',
  }
})

const stretchStartHandleStyle = computed(() => {
  if (stretchAxis.value === 'vertical') {
    return {
      left: `${stretchBandStart.value}%`,
      top: '50%',
      transform: 'translate(-50%, -50%)',
    }
  }

  return {
    top: `${stretchBandStart.value}%`,
    left: '50%',
    transform: 'translate(-50%, -50%)',
  }
})

const stretchEndHandleStyle = computed(() => {
  if (stretchAxis.value === 'vertical') {
    return {
      left: `${stretchBandEnd.value}%`,
      top: '50%',
      transform: 'translate(-50%, -50%)',
    }
  }

  return {
    top: `${stretchBandEnd.value}%`,
    left: '50%',
    transform: 'translate(-50%, -50%)',
  }
})

const liquifyCursorStyle = computed(() => {
  const size = `${liquifyBrushSize.value}%`
  return {
    width: size,
    height: size,
    left: `${liquifyCursor.x}%`,
    top: `${liquifyCursor.y}%`,
  }
})

function onStartCrop(event: PointerEvent, mode: CropDragMode) {
  if (geometryTool.value !== 'crop') return
  emit('startCrop', event, mode)
}

function clampPercent(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value))
}

function normalizePointInElement(event: PointerEvent, target: HTMLElement) {
  const rect = target.getBoundingClientRect()
  const normalizedX = rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * 100 : 0
  const normalizedY = rect.height > 0 ? ((event.clientY - rect.top) / rect.height) * 100 : 0
  return {
    x: clampPercent(normalizedX),
    y: clampPercent(normalizedY),
    width: rect.width,
    height: rect.height,
  }
}

function clampStretchBand() {
  const minBand = 8
  stretchBandStart.value = clampPercent(stretchBandStart.value)
  stretchBandEnd.value = clampPercent(stretchBandEnd.value)
  if (stretchBandEnd.value < stretchBandStart.value) {
    const tmp = stretchBandStart.value
    stretchBandStart.value = stretchBandEnd.value
    stretchBandEnd.value = tmp
  }
  if (stretchBandEnd.value - stretchBandStart.value < minBand) {
    const center = (stretchBandStart.value + stretchBandEnd.value) / 2
    stretchBandStart.value = clampPercent(center - minBand / 2)
    stretchBandEnd.value = clampPercent(stretchBandStart.value + minBand)
    if (stretchBandEnd.value - stretchBandStart.value < minBand) {
      stretchBandStart.value = clampPercent(stretchBandEnd.value - minBand)
    }
  }
}

function clearLiquify() {
  liquifyStrokes.value = []
  liquifyChangeTick.value += 1
}

function resetStretch() {
  stretchBandStart.value = 34
  stretchBandEnd.value = 66
  stretchAmount.value = 0
}

function resetLocalGeometryDeform() {
  clearLiquify()
  resetStretch()
  geometryTool.value = 'crop'
}

function onResetAll() {
  resetLocalGeometryDeform()
  emit('reset')
}

function onResetGroup(group: 'tone' | 'detail' | 'color' | 'geometry') {
  if (group === 'geometry') {
    resetLocalGeometryDeform()
  }
  emit('resetGroup', group)
}

function onStagePointerDown(event: PointerEvent) {
  onPreviewPointerDown(event)

  if (geometryTool.value === 'crop') return
  const target = event.currentTarget as HTMLElement | null
  if (!target) return

  const point = normalizePointInElement(event, target)

  if (geometryTool.value === 'liquify') {
    stageDrag.active = true
    stageDrag.mode = 'liquify'
    stageDrag.lastNormX = point.x
    stageDrag.lastNormY = point.y
    liquifyCursor.visible = true
    liquifyCursor.x = point.x
    liquifyCursor.y = point.y
  } else {
    const axisValue = stretchAxis.value === 'vertical' ? point.x : point.y
    const threshold = 2.8
    const inBand = axisValue > stretchBandStart.value && axisValue < stretchBandEnd.value

    if (Math.abs(axisValue - stretchBandStart.value) <= threshold) {
      stageDrag.mode = 'stretch-start'
    } else if (Math.abs(axisValue - stretchBandEnd.value) <= threshold) {
      stageDrag.mode = 'stretch-end'
    } else if (inBand) {
      stageDrag.mode = 'stretch-band'
    } else {
      stageDrag.mode = 'none'
      return
    }

    stageDrag.active = true
    stageDrag.startNormX = point.x
    stageDrag.startNormY = point.y
    stageDrag.originBandStart = stretchBandStart.value
    stageDrag.originBandEnd = stretchBandEnd.value
  }

  stageDrag.startX = event.clientX
  stageDrag.startY = event.clientY

  if (typeof target.setPointerCapture === 'function') {
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // Ignore when capture is unavailable for this pointer.
    }
  }

  event.preventDefault()
}

function appendLiquifyStroke(fromX: number, fromY: number, toX: number, toY: number) {
  const distance = Math.hypot(toX - fromX, toY - fromY)
  if (distance < 0.16) return

  const stroke: LiquifyStroke = {
    fromX: fromX / 100,
    fromY: fromY / 100,
    toX: toX / 100,
    toY: toY / 100,
    radius: liquifyBrushSize.value / 100,
    strength: Math.max(0.04, liquifyIntensity.value / 100),
  }

  liquifyStrokes.value.push(stroke)
  if (liquifyStrokes.value.length > 120) {
    liquifyStrokes.value.shift()
  }
  liquifyChangeTick.value += 1
}

function onStagePointerMove(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement | null
  if (!target) return

  if (geometryTool.value === 'crop') {
    emit('cropMove', event)
    return
  }

  const point = normalizePointInElement(event, target)

  if (geometryTool.value === 'liquify') {
    liquifyCursor.visible = true
    liquifyCursor.x = point.x
    liquifyCursor.y = point.y

    if (stageDrag.active && stageDrag.mode === 'liquify') {
      appendLiquifyStroke(stageDrag.lastNormX, stageDrag.lastNormY, point.x, point.y)
      stageDrag.lastNormX = point.x
      stageDrag.lastNormY = point.y
    }
    return
  }

  if (!stageDrag.active || stageDrag.mode === 'none') return

  const axisPoint = stretchAxis.value === 'vertical' ? point.x : point.y
  const axisStart = stretchAxis.value === 'vertical' ? stageDrag.startNormX : stageDrag.startNormY
  const delta = axisPoint - axisStart
  const minBand = 8

  if (stageDrag.mode === 'stretch-start') {
    stretchBandStart.value = clampPercent(stageDrag.originBandStart + delta, 0, stretchBandEnd.value - minBand)
    return
  }

  if (stageDrag.mode === 'stretch-end') {
    stretchBandEnd.value = clampPercent(stageDrag.originBandEnd + delta, stretchBandStart.value + minBand, 100)
    return
  }

  const width = stageDrag.originBandEnd - stageDrag.originBandStart
  let nextStart = stageDrag.originBandStart + delta
  let nextEnd = nextStart + width
  if (nextStart < 0) {
    nextEnd -= nextStart
    nextStart = 0
  }
  if (nextEnd > 100) {
    const overflow = nextEnd - 100
    nextStart -= overflow
    nextEnd = 100
  }
  stretchBandStart.value = clampPercent(nextStart)
  stretchBandEnd.value = clampPercent(nextEnd)
}

function onStagePointerUpOrCancel() {
  emit('stopCrop')
  onPreviewPointerUpOrCancel()

  stageDrag.active = false
  stageDrag.mode = 'none'
  if (geometryTool.value === 'liquify') {
    liquifyCursor.visible = false
  }
}

function onStagePointerLeave() {
  emit('stopCrop')
  onPreviewPointerUpOrCancel()
  stageDrag.active = false
  stageDrag.mode = 'none'
  liquifyCursor.visible = false
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

function hasLocalGeometryAdjustments() {
  return liquifyStrokes.value.length > 0 || Math.abs(stretchAmount.value) > 0.01
}

function clampPixel(value: number, max: number) {
  return value < 0 ? 0 : value > max ? max : value
}

function sampleBilinear(source: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const x0 = clampPixel(Math.floor(x), width - 1)
  const y0 = clampPixel(Math.floor(y), height - 1)
  const x1 = clampPixel(x0 + 1, width - 1)
  const y1 = clampPixel(y0 + 1, height - 1)

  const tx = Math.max(0, Math.min(1, x - x0))
  const ty = Math.max(0, Math.min(1, y - y0))

  const i00 = (y0 * width + x0) * 4
  const i10 = (y0 * width + x1) * 4
  const i01 = (y1 * width + x0) * 4
  const i11 = (y1 * width + x1) * 4

  const out = [0, 0, 0, 0]
  for (let channel = 0; channel < 4; channel += 1) {
    const top = (source[i00 + channel] || 0) * (1 - tx) + (source[i10 + channel] || 0) * tx
    const bottom = (source[i01 + channel] || 0) * (1 - tx) + (source[i11 + channel] || 0) * tx
    out[channel] = top * (1 - ty) + bottom * ty
  }
  return out
}

function applyLiquifyWarp(data: ImageData) {
  if (liquifyStrokes.value.length === 0) return

  const width = data.width
  const height = data.height
  const minSide = Math.max(1, Math.min(width, height))
  const target = data.data

  for (const stroke of liquifyStrokes.value) {
    const radiusPx = Math.max(1, stroke.radius * minSide)
    const fromX = stroke.fromX * width
    const fromY = stroke.fromY * height
    const dx = (stroke.toX - stroke.fromX) * width * stroke.strength
    const dy = (stroke.toY - stroke.fromY) * height * stroke.strength

    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) continue

    const padding = radiusPx + Math.max(Math.abs(dx), Math.abs(dy))
    const x0 = Math.max(0, Math.floor(fromX - padding))
    const y0 = Math.max(0, Math.floor(fromY - padding))
    const x1 = Math.min(width - 1, Math.ceil(fromX + padding))
    const y1 = Math.min(height - 1, Math.ceil(fromY + padding))

    const sourceSnapshot = new Uint8ClampedArray(target)

    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const vx = x - fromX
        const vy = y - fromY
        const dist = Math.sqrt(vx * vx + vy * vy)
        if (dist > radiusPx) continue

        const t = 1 - dist / radiusPx
        const falloff = t * t

        const srcX = clampPixel(x - dx * falloff, width - 1)
        const srcY = clampPixel(y - dy * falloff, height - 1)
        const sample = sampleBilinear(sourceSnapshot, width, height, srcX, srcY)
        const index = (y * width + x) * 4
        target[index] = clampChannel(Math.round(sample[0] || 0))
        target[index + 1] = clampChannel(Math.round(sample[1] || 0))
        target[index + 2] = clampChannel(Math.round(sample[2] || 0))
        target[index + 3] = clampChannel(Math.round(sample[3] || 255))
      }
    }
  }
}

function mapStretchCoordinate(
  outputCoord: number,
  outputStart: number,
  outputEnd: number,
  inputStart: number,
  inputEnd: number,
  length: number,
) {
  const safeLength = Math.max(1, length)
  const startOut = Math.max(0, Math.min(safeLength, outputStart))
  const endOut = Math.max(startOut + 1e-4, Math.min(safeLength, outputEnd))
  const startIn = Math.max(0, Math.min(safeLength, inputStart))
  const endIn = Math.max(startIn + 1e-4, Math.min(safeLength, inputEnd))

  if (outputCoord <= startOut) {
    const denom = Math.max(1e-4, startOut)
    return (outputCoord / denom) * startIn
  }

  if (outputCoord >= endOut) {
    const denom = Math.max(1e-4, safeLength - endOut)
    return endIn + ((outputCoord - endOut) / denom) * (safeLength - endIn)
  }

  const denom = Math.max(1e-4, endOut - startOut)
  return startIn + ((outputCoord - startOut) / denom) * (endIn - startIn)
}

function applyStretchWarp(data: ImageData) {
  if (Math.abs(stretchAmount.value) <= 0.01) return

  clampStretchBand()

  const width = data.width
  const height = data.height
  const source = new Uint8ClampedArray(data.data)
  const target = data.data
  const axisLength = stretchAxis.value === 'vertical' ? width : height

  const inputStart = (stretchBandStart.value / 100) * axisLength
  const inputEnd = (stretchBandEnd.value / 100) * axisLength
  const baseBandSize = Math.max(1, inputEnd - inputStart)
  const scale = Math.max(0.25, Math.min(2.6, 1 + stretchAmount.value / 100))
  const outputBandSize = Math.max(1, Math.min(axisLength - 2, baseBandSize * scale))
  const center = (inputStart + inputEnd) / 2

  let outputStart = center - outputBandSize / 2
  let outputEnd = center + outputBandSize / 2
  if (outputStart < 0) {
    outputEnd -= outputStart
    outputStart = 0
  }
  if (outputEnd > axisLength) {
    const overflow = outputEnd - axisLength
    outputStart -= overflow
    outputEnd = axisLength
  }
  outputStart = Math.max(0, outputStart)
  outputEnd = Math.min(axisLength, outputEnd)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const srcX = stretchAxis.value === 'vertical'
        ? mapStretchCoordinate(x, outputStart, outputEnd, inputStart, inputEnd, width)
        : x
      const srcY = stretchAxis.value === 'horizontal'
        ? mapStretchCoordinate(y, outputStart, outputEnd, inputStart, inputEnd, height)
        : y

      const sample = sampleBilinear(source, width, height, srcX, srcY)
      const idx = (y * width + x) * 4
      target[idx] = clampChannel(Math.round(sample[0] || 0))
      target[idx + 1] = clampChannel(Math.round(sample[1] || 0))
      target[idx + 2] = clampChannel(Math.round(sample[2] || 0))
      target[idx + 3] = clampChannel(Math.round(sample[3] || 255))
    }
  }
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
  const needsProcessing = hasJsAdjustments(props.editor) || hasLocalGeometryAdjustments()
  if (!props.thumbSrc || !props.canPreview || props.beforeAfterActive || !needsProcessing) {
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
    applyLiquifyWarp(data)
    applyStretchWarp(data)
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
    liquifyChangeTick.value,
    stretchAxis.value,
    stretchBandStart.value,
    stretchBandEnd.value,
    stretchAmount.value,
  ],
  () => {
    scheduleJsPreviewRender()
  },
  { immediate: true },
)

watch(
  () => props.activeMedia?.id || null,
  () => {
    resetLocalGeometryDeform()
    scheduleJsPreviewRender()
  },
)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      stageDrag.active = false
      stageDrag.mode = 'none'
      liquifyCursor.visible = false
    }
  },
)

watch(
  () => activeTabModel.value,
  (tab) => {
    if (tab === 'liquify') {
      geometryTool.value = 'liquify'
      return
    }
    if (tab === 'stretch') {
      geometryTool.value = 'stretch'
      return
    }
    if (geometryTool.value !== 'crop') {
      geometryTool.value = 'crop'
    }
  },
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
            @pointerdown="onStagePointerDown"
            @pointermove="onStagePointerMove"
            @pointerup="onStagePointerUpOrCancel"
            @pointercancel="onStagePointerUpOrCancel"
            @pointerleave="onStagePointerLeave"
          >
            <div class="editor-image-frame" :style="editorPreviewFrameStyle">
              <img
                class="overlay-image editor-image"
                :src="beforeAfterActive ? thumbSrc : (processedPreviewSrc || thumbSrc)"
                :alt="activeMedia.filename"
                :style="editorFilterStyle"
              />
              <div
                v-if="geometryTool === 'stretch'"
                class="editor-stretch-overlay"
                :class="{ vertical: stretchAxis === 'vertical', horizontal: stretchAxis === 'horizontal' }"
              >
                <div class="editor-stretch-band" :style="stretchOverlayStyle"></div>
                <span class="editor-stretch-line start" :style="stretchStartHandleStyle"></span>
                <span class="editor-stretch-line end" :style="stretchEndHandleStyle"></span>
                <button class="editor-stretch-handle start" type="button" :style="stretchStartHandleStyle">‹›</button>
                <button class="editor-stretch-handle end" type="button" :style="stretchEndHandleStyle">‹›</button>
              </div>
              <div
                v-if="geometryTool === 'liquify' && liquifyCursor.visible"
                class="editor-liquify-cursor"
                :style="liquifyCursorStyle"
              ></div>
              <div
                v-if="clippingOverlayEnabled"
                class="editor-clipping-overlay"
                :style="{
                  '--highlight-opacity': String(Math.min(0.7, clippingStats.highlights / 32)),
                  '--shadow-opacity': String(Math.min(0.7, clippingStats.shadows / 32)),
                }"
              ></div>
              <div v-if="geometryTool === 'crop'" class="crop-rect" :style="editorCropRectStyle" @pointerdown="onStartCrop($event, 'move')">
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
              <template v-if="desktopSection === 'geometry'">
                <div class="editor-tool-box">
                  <span class="editor-toolbar-label">Geometry tool</span>
                  <div class="editor-chip-row">
                    <button class="chip" type="button" :class="{ active: geometryTool === 'crop' }" @click="geometryTool = 'crop'">
                      Crop
                    </button>
                    <button class="chip" type="button" :class="{ active: geometryTool === 'liquify' }" @click="geometryTool = 'liquify'">
                      Liquify
                    </button>
                    <button class="chip" type="button" :class="{ active: geometryTool === 'stretch' }" @click="geometryTool = 'stretch'">
                      Stretch
                    </button>
                  </div>
                </div>

                <div v-if="geometryTool === 'liquify'" class="editor-tool-box">
                  <span class="editor-toolbar-label">Liquify brush</span>
                  <div class="slider-row slider-row-pro">
                    <span class="slider-row-title">Brush size</span>
                    <div class="slider-row-main">
                      <input v-model="liquifyBrushSize" type="range" min="8" max="55" />
                      <span class="slider-value-pill">{{ liquifyBrushSize }}%</span>
                    </div>
                  </div>
                  <div class="slider-row slider-row-pro">
                    <span class="slider-row-title">Intensity</span>
                    <div class="slider-row-main">
                      <input v-model="liquifyIntensity" type="range" min="5" max="100" />
                      <span class="slider-value-pill">{{ liquifyIntensity }}%</span>
                    </div>
                  </div>
                  <div class="editor-chip-row">
                    <button class="chip" type="button" @click="clearLiquify">Clear liquify</button>
                  </div>
                </div>

                <div v-if="geometryTool === 'stretch'" class="editor-tool-box">
                  <span class="editor-toolbar-label">Stretch zone</span>
                  <div class="editor-chip-row">
                    <button class="chip" type="button" :class="{ active: stretchAxis === 'vertical' }" @click="stretchAxis = 'vertical'">
                      Vertical
                    </button>
                    <button class="chip" type="button" :class="{ active: stretchAxis === 'horizontal' }" @click="stretchAxis = 'horizontal'">
                      Horizontal
                    </button>
                  </div>
                  <div class="slider-row slider-row-pro">
                    <span class="slider-row-title">Amount</span>
                    <div class="slider-row-main">
                      <input v-model="stretchAmount" type="range" min="-85" max="85" />
                      <span class="slider-value-pill">{{ stretchAmount }}%</span>
                    </div>
                  </div>
                  <div class="editor-chip-row">
                    <button class="chip" type="button" @click="resetStretch">Reset stretch</button>
                  </div>
                </div>
              </template>

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
              <button class="chip" type="button" @click="onResetGroup('tone')">Tone</button>
              <button class="chip" type="button" @click="onResetGroup('detail')">Detail</button>
              <button class="chip" type="button" @click="onResetGroup('color')">Color</button>
              <button class="chip" type="button" @click="onResetGroup('geometry')">Geometry</button>
            </div>
          </div>
        </div>

        <div class="editor-actions">
          <button class="btn ghost" @click="onResetAll">Reset</button>
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
        <template v-else-if="activeTabModel === 'liquify'">
          <div class="editor-tool-box compact">
            <div class="editor-chip-row">
              <button class="chip" type="button" :class="{ active: geometryTool === 'liquify' }" @click="geometryTool = 'liquify'">
                Enable brush
              </button>
              <button class="chip" type="button" @click="clearLiquify">Clear</button>
            </div>
            <div class="slider-row"><span>Brush size</span><input v-model="liquifyBrushSize" type="range" min="8" max="55" /></div>
            <div class="slider-row"><span>Intensity</span><input v-model="liquifyIntensity" type="range" min="5" max="100" /></div>
          </div>
        </template>
        <template v-else-if="activeTabModel === 'stretch'">
          <div class="editor-tool-box compact">
            <div class="editor-chip-row">
              <button class="chip" type="button" :class="{ active: geometryTool === 'stretch' }" @click="geometryTool = 'stretch'">
                Enable stretch
              </button>
              <button class="chip" type="button" @click="resetStretch">Reset</button>
            </div>
            <div class="editor-chip-row">
              <button class="chip" type="button" :class="{ active: stretchAxis === 'vertical' }" @click="stretchAxis = 'vertical'">Vertical</button>
              <button class="chip" type="button" :class="{ active: stretchAxis === 'horizontal' }" @click="stretchAxis = 'horizontal'">Horizontal</button>
            </div>
            <div class="slider-row"><span>Amount</span><input v-model="stretchAmount" type="range" min="-85" max="85" /></div>
          </div>
        </template>
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
        <button class="btn ghost" aria-label="Reset adjustments" title="Reset" @click="onResetAll">
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
