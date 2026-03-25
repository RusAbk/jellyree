export type PreviewMode = 'css' | 'server'

type NumericAdjustmentKey =
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
  | 'exposure'
  | 'tint'
  | 'vibrance'
  | 'clarity'
  | 'grain'
  | 'fade'
  | 'cropZoom'
  | 'rotate'
  | 'cropX'
  | 'cropY'
  | 'cropWidth'
  | 'cropHeight'

type BooleanAdjustmentKey = 'flipX' | 'flipY'

type NumericRule = {
  min: number
  max: number
  defaultValue: number
  previewMode: PreviewMode
}

export const NUMERIC_ADJUSTMENT_RULES: Record<NumericAdjustmentKey, NumericRule> = {
  temperature: { min: -100, max: 100, defaultValue: 0, previewMode: 'server' },
  brightness: { min: -80, max: 80, defaultValue: 0, previewMode: 'server' },
  contrast: { min: -80, max: 80, defaultValue: 0, previewMode: 'server' },
  saturation: { min: -80, max: 80, defaultValue: 0, previewMode: 'server' },
  toneDepth: { min: -100, max: 100, defaultValue: 0, previewMode: 'server' },
  shadowsLevel: { min: -100, max: 100, defaultValue: 0, previewMode: 'server' },
  highlightsLevel: { min: -100, max: 100, defaultValue: 0, previewMode: 'server' },
  sharpness: { min: 0, max: 100, defaultValue: 0, previewMode: 'server' },
  definition: { min: -100, max: 100, defaultValue: 0, previewMode: 'server' },
  vignette: { min: 0, max: 100, defaultValue: 0, previewMode: 'server' },
  glamour: { min: 0, max: 100, defaultValue: 0, previewMode: 'server' },
  grayscale: { min: 0, max: 100, defaultValue: 0, previewMode: 'server' },
  sepia: { min: 0, max: 100, defaultValue: 0, previewMode: 'server' },
  exposure: { min: -100, max: 100, defaultValue: 0, previewMode: 'server' },
  tint: { min: -100, max: 100, defaultValue: 0, previewMode: 'server' },
  vibrance: { min: -100, max: 100, defaultValue: 0, previewMode: 'server' },
  clarity: { min: -100, max: 100, defaultValue: 0, previewMode: 'server' },
  grain: { min: 0, max: 100, defaultValue: 0, previewMode: 'server' },
  fade: { min: 0, max: 100, defaultValue: 0, previewMode: 'server' },
  cropZoom: { min: 0, max: 90, defaultValue: 0, previewMode: 'css' },
  rotate: { min: -180, max: 180, defaultValue: 0, previewMode: 'css' },
  cropX: { min: 0, max: 95, defaultValue: 0, previewMode: 'css' },
  cropY: { min: 0, max: 95, defaultValue: 0, previewMode: 'css' },
  cropWidth: { min: 5, max: 100, defaultValue: 100, previewMode: 'css' },
  cropHeight: { min: 5, max: 100, defaultValue: 100, previewMode: 'css' },
}

export const BOOLEAN_ADJUSTMENT_DEFAULTS: Record<BooleanAdjustmentKey, boolean> = {
  flipX: false,
  flipY: false,
}

export type NormalizedEditorAdjustments = {
  [K in NumericAdjustmentKey]: number
} & {
  [K in BooleanAdjustmentKey]: boolean
}

const NUMERIC_KEYS = Object.keys(NUMERIC_ADJUSTMENT_RULES) as NumericAdjustmentKey[]
const BOOLEAN_KEYS = Object.keys(BOOLEAN_ADJUSTMENT_DEFAULTS) as BooleanAdjustmentKey[]

function toNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function normalizeEditorAdjustments(
  input: Partial<Record<string, unknown>> | undefined | null,
): NormalizedEditorAdjustments {
  const source = input || {}

  const normalized = {
    flipX: BOOLEAN_ADJUSTMENT_DEFAULTS.flipX,
    flipY: BOOLEAN_ADJUSTMENT_DEFAULTS.flipY,
  } as NormalizedEditorAdjustments

  for (const key of NUMERIC_KEYS) {
    const rule = NUMERIC_ADJUSTMENT_RULES[key]
    normalized[key] = clamp(toNumber(source[key], rule.defaultValue), rule.min, rule.max)
  }

  for (const key of BOOLEAN_KEYS) {
    const raw = source[key]
    normalized[key] = raw === true || raw === 1 || raw === '1'
  }

  normalized.cropWidth = clamp(normalized.cropWidth, 5, 100 - normalized.cropX)
  normalized.cropHeight = clamp(normalized.cropHeight, 5, 100 - normalized.cropY)

  return normalized
}

export function adjustmentsToRequestPayload(adjustments: NormalizedEditorAdjustments) {
  const payload: Record<string, number> = {}

  for (const key of NUMERIC_KEYS) {
    payload[key] = adjustments[key]
  }

  payload.flipX = adjustments.flipX ? 1 : 0
  payload.flipY = adjustments.flipY ? 1 : 0
  return payload
}

export function extractCssPreviewAdjustments(adjustments: NormalizedEditorAdjustments): NormalizedEditorAdjustments {
  const next = { ...adjustments }
  for (const key of NUMERIC_KEYS) {
    const rule = NUMERIC_ADJUSTMENT_RULES[key]
    if (rule.previewMode === 'server') {
      next[key] = rule.defaultValue
    }
  }
  return next
}

export function extractServerPreviewAdjustments(adjustments: NormalizedEditorAdjustments): NormalizedEditorAdjustments {
  const next = { ...adjustments }
  for (const key of NUMERIC_KEYS) {
    const rule = NUMERIC_ADJUSTMENT_RULES[key]
    if (rule.previewMode === 'css') {
      next[key] = rule.defaultValue
    }
  }
  next.flipX = BOOLEAN_ADJUSTMENT_DEFAULTS.flipX
  next.flipY = BOOLEAN_ADJUSTMENT_DEFAULTS.flipY
  return next
}

export function hasServerPreviewAdjustments(adjustments: NormalizedEditorAdjustments) {
  for (const key of NUMERIC_KEYS) {
    const rule = NUMERIC_ADJUSTMENT_RULES[key]
    if (rule.previewMode !== 'server') continue
    if (adjustments[key] !== rule.defaultValue) return true
  }
  return false
}
