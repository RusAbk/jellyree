import { reactive, ref } from 'vue'

export type CropDragMode = 'move' | 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se'

export type EditorMobileTab =
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
    editor.cropZoom = 0
    editor.rotate = 0
    editor.flipX = false
    editor.flipY = false
    editor.cropX = 0
    editor.cropY = 0
    editor.cropWidth = 100
    editor.cropHeight = 100
  }

  return {
    editModeOpen,
    editor,
    activeEditorMobileTab,
    editorMobileTabs,
    editorPreviewScale,
    cropDrag,
    resetEditorAdjustments,
  }
}
