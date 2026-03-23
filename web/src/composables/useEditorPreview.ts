import { computed, type Ref } from 'vue'
import type { MediaItem } from '../api'
import type { CropDragMode, CropDragState, EditorState } from './useEditorState'
import { normalizeEditorAdjustments } from '../editor-adjustments'

type UseEditorPreviewParams = {
  editor: EditorState
  editorPreviewScale: Ref<number>
  cropDrag: CropDragState
  activeMedia: Ref<MediaItem | null>
}

export function useEditorPreview(params: UseEditorPreviewParams) {
  const { editor, editorPreviewScale, cropDrag, activeMedia } = params

  const editorCropRectStyle = computed(() => ({
    left: `${editor.cropX}%`,
    top: `${editor.cropY}%`,
    width: `${editor.cropWidth}%`,
    height: `${editor.cropHeight}%`,
  }))

  const editorPreviewFrameStyle = computed(() => ({
    transform: `scale(${editorPreviewScale.value / 100})`,
    transformOrigin: 'top left',
  }))

  function mediaFilterStyleFromEditor() {
    const normalized = normalizeEditorAdjustments(editor as unknown as Record<string, unknown>)
    const cssAdjustments = normalized

    const zoom = 1 + cssAdjustments.cropZoom / 100
    const rotate = cssAdjustments.rotate
    const flipX = cssAdjustments.flipX ? -1 : 1
    const flipY = cssAdjustments.flipY ? -1 : 1

    const normalizedRotate = ((Math.round(rotate / 90) * 90) % 360 + 360) % 360
    const isQuarterTurn = normalizedRotate === 90 || normalizedRotate === 270
    let frameFitScale = 1

    if (isQuarterTurn && activeMedia.value?.width && activeMedia.value?.height) {
      const width = Math.max(1, activeMedia.value.width)
      const height = Math.max(1, activeMedia.value.height)
      frameFitScale = Math.min(width / height, height / width)
    }

    return {
      filter: 'none',
      transform: `scale(${zoom * frameFitScale}) rotate(${rotate}deg) scaleX(${flipX}) scaleY(${flipY})`,
      clipPath: `inset(${cssAdjustments.cropY}% ${100 - cssAdjustments.cropX - cssAdjustments.cropWidth}% ${100 - cssAdjustments.cropY - cssAdjustments.cropHeight}% ${cssAdjustments.cropX}%)`,
    }
  }

  function clampCropRect() {
    editor.cropWidth = Math.max(5, Math.min(100, editor.cropWidth))
    editor.cropHeight = Math.max(5, Math.min(100, editor.cropHeight))
    editor.cropX = Math.max(0, Math.min(100 - editor.cropWidth, editor.cropX))
    editor.cropY = Math.max(0, Math.min(100 - editor.cropHeight, editor.cropY))
  }

  function rotateCropRectClockwise() {
    const prevX = editor.cropX
    const prevY = editor.cropY
    const prevWidth = editor.cropWidth
    const prevHeight = editor.cropHeight

    editor.cropX = 100 - (prevY + prevHeight)
    editor.cropY = prevX
    editor.cropWidth = prevHeight
    editor.cropHeight = prevWidth
    clampCropRect()
  }

  function rotateCropRectCounterClockwise() {
    const prevX = editor.cropX
    const prevY = editor.cropY
    const prevWidth = editor.cropWidth
    const prevHeight = editor.cropHeight

    editor.cropX = prevY
    editor.cropY = 100 - (prevX + prevWidth)
    editor.cropWidth = prevHeight
    editor.cropHeight = prevWidth
    clampCropRect()
  }

  function syncCropRectWithRotation(previousAngle: number, nextAngle: number) {
    const isQuarterTurn = (value: number) => Math.abs(value % 90) < 0.0001
    if (!isQuarterTurn(previousAngle) || !isQuarterTurn(nextAngle)) return

    const prevQuarter = Math.round(previousAngle / 90)
    const nextQuarter = Math.round(nextAngle / 90)
    if (prevQuarter === nextQuarter) return

    const steps = nextQuarter - prevQuarter
    const clockwise = steps > 0
    for (let index = 0; index < Math.abs(steps); index += 1) {
      if (clockwise) {
        rotateCropRectClockwise()
      } else {
        rotateCropRectCounterClockwise()
      }
    }
  }

  function startCropDrag(event: PointerEvent, mode: CropDragMode) {
    event.preventDefault()
    event.stopPropagation()

    const target = event.currentTarget as HTMLElement | null
    if (target && typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        // Ignore when capture is unavailable for this pointer.
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

  function onCropPointerMove(event: PointerEvent) {
    if (!cropDrag.active) return
    const target = event.currentTarget as HTMLElement | null
    if (!target) return
    const frame = target.querySelector('.editor-image-frame') as HTMLElement | null
    const rect = (frame || target).getBoundingClientRect()
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

  return {
    editorCropRectStyle,
    editorPreviewFrameStyle,
    mediaFilterStyleFromEditor,
    syncCropRectWithRotation,
    startCropDrag,
    stopCropDrag,
    onCropPointerMove,
  }
}
