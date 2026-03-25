import { reactive, ref } from 'vue'

export type CropDragMode = 'move' | 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se'

export type EditorMobileTab =
  | 'previewScale'
  | 'liquify'
  | 'stretch'
  | 'exposure'
  | 'temperature'
  | 'tint'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'vibrance'
  | 'toneDepth'
  | 'shadowsLevel'
  | 'highlightsLevel'
  | 'sharpness'
  | 'clarity'
  | 'definition'
  | 'vignette'
  | 'glamour'
  | 'grayscale'
  | 'sepia'
  | 'grain'
  | 'fade'
  | 'cropZoom'
  | 'rotate'
  | 'mirror'

export type EditorState = {
  filename: string
  tagsInput: string
  metadataCreatedAtInput: string
  metadataModifiedAtInput: string
  locationInput: string
  temperature: number
  brightness: number
  contrast: number
  saturation: number
  toneDepth: number
  shadowsLevel: number
  highlightsLevel: number
  sharpness: number
  definition: number
  vignette: number
  glamour: number
  grayscale: number
  sepia: number
  exposure: number
  tint: number
  vibrance: number
  clarity: number
  grain: number
  fade: number
  cropZoom: number
  rotate: number
  flipX: boolean
  flipY: boolean
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
}

export type CropDragState = {
  active: boolean
  mode: CropDragMode
  startX: number
  startY: number
  originX: number
  originY: number
  originWidth: number
  originHeight: number
}

export type EditorPreset = 'auto' | 'portrait' | 'landscape' | 'night' | 'bw'

type EditorAdjustmentSnapshot = {
  temperature: number
  brightness: number
  contrast: number
  saturation: number
  toneDepth: number
  shadowsLevel: number
  highlightsLevel: number
  sharpness: number
  definition: number
  vignette: number
  glamour: number
  grayscale: number
  sepia: number
  exposure: number
  tint: number
  vibrance: number
  clarity: number
  grain: number
  fade: number
  cropZoom: number
  rotate: number
  flipX: boolean
  flipY: boolean
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
}

const PRESET_VALUES: Record<EditorPreset, Partial<EditorAdjustmentSnapshot>> = {
  auto: {
    brightness: 8,
    contrast: 10,
    saturation: 6,
    toneDepth: 8,
    sharpness: 10,
    definition: 10,
  },
  portrait: {
    temperature: 10,
    brightness: 6,
    saturation: 4,
    highlightsLevel: 12,
    glamour: 10,
    sharpness: 6,
  },
  landscape: {
    contrast: 12,
    saturation: 14,
    toneDepth: 12,
    sharpness: 12,
    definition: 16,
    vignette: 4,
  },
  night: {
    brightness: 14,
    shadowsLevel: 22,
    highlightsLevel: -8,
    toneDepth: -8,
    definition: 8,
    sharpness: 8,
    saturation: 6,
  },
  bw: {
    grayscale: 100,
    contrast: 14,
    toneDepth: 10,
    sharpness: 12,
    definition: 10,
    saturation: -50,
  },
}

export function createDefaultEditorState(): EditorState {
  return {
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
    exposure: 0,
    tint: 0,
    vibrance: 0,
    clarity: 0,
    grain: 0,
    fade: 0,
    cropZoom: 0,
    rotate: 0,
    flipX: false,
    flipY: false,
    cropX: 0,
    cropY: 0,
    cropWidth: 100,
    cropHeight: 100,
  }
}

export function useEditorState() {
  const editModeOpen = ref(false)

  const editor = reactive<EditorState>(createDefaultEditorState())

  const activeEditorMobileTab = ref<EditorMobileTab>('temperature')
  const editorMobileTabs: Array<{ key: EditorMobileTab; label: string }> = [
    { key: 'previewScale', label: 'Scale' },
    { key: 'liquify', label: 'Liquify' },
    { key: 'stretch', label: 'Stretch' },
    { key: 'exposure', label: 'Exposure' },
    { key: 'brightness', label: 'Bright' },
    { key: 'contrast', label: 'Contrast' },
    { key: 'toneDepth', label: 'Depth' },
    { key: 'shadowsLevel', label: 'Shadows' },
    { key: 'highlightsLevel', label: 'Highlights' },
    { key: 'temperature', label: 'Temp' },
    { key: 'tint', label: 'Tint' },
    { key: 'vibrance', label: 'Vibrance' },
    { key: 'saturation', label: 'Sat' },
    { key: 'grayscale', label: 'Gray' },
    { key: 'sepia', label: 'Sepia' },
    { key: 'fade', label: 'Fade' },
    { key: 'sharpness', label: 'Sharp' },
    { key: 'clarity', label: 'Clarity' },
    { key: 'definition', label: 'Def' },
    { key: 'glamour', label: 'Glamour' },
    { key: 'grain', label: 'Grain' },
    { key: 'vignette', label: 'Vignette' },
    { key: 'cropZoom', label: 'Zoom' },
    { key: 'rotate', label: 'Rotate' },
    { key: 'mirror', label: 'Mirror' },
  ]

  const editorPreviewScale = ref(100)

  const cropDrag = reactive<CropDragState>({
    active: false,
    mode: 'move',
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    originWidth: 100,
    originHeight: 100,
  })

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
    editor.exposure = 0
    editor.tint = 0
    editor.vibrance = 0
    editor.clarity = 0
    editor.grain = 0
    editor.fade = 0
    editor.cropZoom = 0
    editor.rotate = 0
    editor.flipX = false
    editor.flipY = false
    editor.cropX = 0
    editor.cropY = 0
    editor.cropWidth = 100
    editor.cropHeight = 100
  }

  function resetToneAdjustments() {
    editor.exposure = 0
    editor.brightness = 0
    editor.contrast = 0
    editor.toneDepth = 0
    editor.shadowsLevel = 0
    editor.highlightsLevel = 0
  }

  function resetDetailAdjustments() {
    editor.sharpness = 0
    editor.clarity = 0
    editor.definition = 0
    editor.glamour = 0
    editor.grain = 0
    editor.vignette = 0
  }

  function resetColorAdjustments() {
    editor.temperature = 0
    editor.tint = 0
    editor.vibrance = 0
    editor.saturation = 0
    editor.grayscale = 0
    editor.sepia = 0
    editor.fade = 0
  }

  function resetGeometryAdjustments() {
    editor.cropZoom = 0
    editor.rotate = 0
    editor.flipX = false
    editor.flipY = false
    editor.cropX = 0
    editor.cropY = 0
    editor.cropWidth = 100
    editor.cropHeight = 100
  }

  function applyPreset(preset: EditorPreset) {
    const values = PRESET_VALUES[preset]
    for (const [key, value] of Object.entries(values)) {
      ;(editor as unknown as Record<string, unknown>)[key] = value
    }
  }

  return {
    editModeOpen,
    editor,
    activeEditorMobileTab,
    editorMobileTabs,
    editorPreviewScale,
    cropDrag,
    resetEditorAdjustments,
    resetToneAdjustments,
    resetDetailAdjustments,
    resetColorAdjustments,
    resetGeometryAdjustments,
    applyPreset,
  }
}
