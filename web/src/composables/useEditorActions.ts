import type { Ref } from 'vue'
import type { EditorMobileTab, EditorState } from './useEditorState'
import { adjustmentsToRequestPayload, normalizeEditorAdjustments } from '../editor-adjustments'

export type EditorLiquifyStroke = {
  fromX: number
  fromY: number
  toX: number
  toY: number
  radius: number
  strength: number
}

export type EditorDeformationPayload = {
  liquifyStrokes?: EditorLiquifyStroke[]
  stretch?: {
    axis: 'vertical' | 'horizontal'
    start: number
    end: number
    amount: number
  }
}

type UseEditorActionsParams = {
  token: Ref<string>
  activeMedia: Ref<{ id: string } | null>
  saving: Ref<boolean>
  message: Ref<string>
  mobileDetailsOpen: Ref<boolean>
  editModeOpen: Ref<boolean>
  editorPreviewScale: Ref<number>
  activeEditorMobileTab: Ref<EditorMobileTab>
  editor: EditorState
  selectMedia: (mediaId: string) => void
  closeContextMenus: () => void
  loadAll: () => Promise<void>
  clearThumb: (mediaId: string) => void
  clearLightboxFullImage: (mediaId: string) => void
  loadThumb: (mediaId: string) => Promise<void>
  showToast: (text: string) => void
  applyEditsRequest: (
    token: string,
    mediaId: string,
    payload: { adjustments: Record<string, number>; deformation?: EditorDeformationPayload },
  ) => Promise<unknown>
  revertEditsRequest: (token: string, mediaId: string) => Promise<unknown>
}

export function useEditorActions(params: UseEditorActionsParams) {
  const {
    token,
    activeMedia,
    saving,
    message,
    mobileDetailsOpen,
    editModeOpen,
    editorPreviewScale,
    activeEditorMobileTab,
    editor,
    selectMedia,
    closeContextMenus,
    loadAll,
    clearThumb,
    clearLightboxFullImage,
    loadThumb,
    showToast,
    applyEditsRequest,
    revertEditsRequest,
  } = params

  function closeEditMode() {
    editModeOpen.value = false
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

  async function applyImageEditsPermanently(deformation?: EditorDeformationPayload) {
    if (!activeMedia.value || !token.value) return
    saving.value = true

    try {
      const mediaId = activeMedia.value.id
      const normalized = normalizeEditorAdjustments({
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
      await applyEditsRequest(token.value, mediaId, {
        adjustments: adjustmentsToRequestPayload(normalized),
        deformation,
      })
      await loadAll()
      clearThumb(mediaId)
      clearLightboxFullImage(mediaId)
      await loadThumb(mediaId)
      message.value = 'Edits permanently applied'
      showToast('Edits permanently applied')
    } catch (error) {
      message.value = (error as Error).message
      showToast(`Failed to apply edits: ${(error as Error).message}`)
    } finally {
      saving.value = false
    }
  }

  async function undoLastPermanentEdit() {
    if (!activeMedia.value || !token.value) return
    saving.value = true

    try {
      const mediaId = activeMedia.value.id
      await revertEditsRequest(token.value, mediaId)
      await loadAll()
      clearThumb(mediaId)
      clearLightboxFullImage(mediaId)
      await loadThumb(mediaId)
      message.value = 'Last permanent edit was undone'
      showToast('Last permanent edit was undone')
      closeEditMode()
    } catch (error) {
      message.value = (error as Error).message
      showToast(`Failed to undo edits: ${(error as Error).message}`)
    } finally {
      saving.value = false
    }
  }

  return {
    openEditMode,
    closeEditMode,
    applyImageEditsPermanently,
    undoLastPermanentEdit,
  }
}
