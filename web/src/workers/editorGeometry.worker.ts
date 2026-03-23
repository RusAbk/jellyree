/// <reference lib="webworker" />

type StretchAxis = 'vertical' | 'horizontal'

type LiquifyStroke = {
  fromX: number
  fromY: number
  toX: number
  toY: number
  radius: number
  strength: number
}

type StretchPayload = {
  axis: StretchAxis
  start: number
  end: number
  amount: number
}

type GeometryWorkerRequest = {
  id: number
  imageData: ImageData
  liquifyStrokes: LiquifyStroke[]
  stretch: StretchPayload | null
}

type GeometryWorkerResponse = {
  id: number
  imageData: ImageData
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function clampChannel(value: number) {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

function clampPixel(value: number, max: number) {
  return value < 0 ? 0 : value > max ? max : value
}

function sampleBilinear(source: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const x0 = clampPixel(Math.floor(x), width - 1)
  const y0 = clampPixel(Math.floor(y), height - 1)
  const x1 = clampPixel(x0 + 1, width - 1)
  const y1 = clampPixel(y0 + 1, height - 1)

  const tx = clamp(x - x0, 0, 1)
  const ty = clamp(y - y0, 0, 1)

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

function applyLiquifyWarp(data: ImageData, strokes: LiquifyStroke[]) {
  if (strokes.length === 0) return data

  const width = data.width
  const height = data.height
  const minSide = Math.max(1, Math.min(width, height))
  const source = new Uint8ClampedArray(data.data)
  const target = data.data
  const displacementX = new Float32Array(width * height)
  const displacementY = new Float32Array(width * height)

  for (const stroke of strokes) {
    const radiusPx = Math.max(1, stroke.radius * minSide)
    const fromX = stroke.fromX * width
    const fromY = stroke.fromY * height
    const dx = (stroke.toX - stroke.fromX) * width * stroke.strength * 0.92
    const dy = (stroke.toY - stroke.fromY) * height * stroke.strength * 0.92

    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) continue

    const x0 = Math.max(0, Math.floor(fromX - radiusPx))
    const y0 = Math.max(0, Math.floor(fromY - radiusPx))
    const x1 = Math.min(width - 1, Math.ceil(fromX + radiusPx))
    const y1 = Math.min(height - 1, Math.ceil(fromY + radiusPx))

    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const vx = x - fromX
        const vy = y - fromY
        const dist = Math.sqrt(vx * vx + vy * vy)
        if (dist > radiusPx) continue

        const t = 1 - dist / radiusPx
        const falloff = t * t * (2 - t)
        const index = y * width + x
        displacementX[index] = (displacementX[index] || 0) + dx * falloff
        displacementY[index] = (displacementY[index] || 0) + dy * falloff
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const srcX = clampPixel(x - (displacementX[index] || 0), width - 1)
      const srcY = clampPixel(y - (displacementY[index] || 0), height - 1)
      const sample = sampleBilinear(source, width, height, srcX, srcY)
      const pixel = index * 4
      target[pixel] = clampChannel(Math.round(sample[0] || 0))
      target[pixel + 1] = clampChannel(Math.round(sample[1] || 0))
      target[pixel + 2] = clampChannel(Math.round(sample[2] || 0))
      target[pixel + 3] = clampChannel(Math.round(sample[3] || 255))
    }
  }

  return data
}

function applyStretchWarp(data: ImageData, stretch: StretchPayload | null) {
  if (!stretch || Math.abs(stretch.amount) <= 0.01) return data

  const width = data.width
  const height = data.height
  const source = new Uint8ClampedArray(data.data)
  const axisLength = stretch.axis === 'vertical' ? width : height

  const inputStart = Math.floor((stretch.start / 100) * axisLength)
  const inputEnd = Math.ceil((stretch.end / 100) * axisLength)
  const baseBandSize = Math.max(1, inputEnd - inputStart)
  const scale = Math.max(0.15, Math.min(2.8, 1 + stretch.amount / 100))
  const outputBandSize = Math.max(1, Math.round(baseBandSize * scale))
  const delta = outputBandSize - baseBandSize

  const targetWidth = stretch.axis === 'vertical' ? Math.max(2, width + delta) : width
  const targetHeight = stretch.axis === 'horizontal' ? Math.max(2, height + delta) : height
  const target = new Uint8ClampedArray(targetWidth * targetHeight * 4)

  if (stretch.axis === 'vertical') {
    const destStart = inputStart
    const destEnd = destStart + outputBandSize

    for (let y = 0; y < targetHeight; y += 1) {
      for (let x = 0; x < targetWidth; x += 1) {
        let srcX = x
        if (x >= destStart && x < destEnd) {
          const t = (x - destStart) / Math.max(1, outputBandSize)
          srcX = inputStart + t * baseBandSize
        } else if (x >= destEnd) {
          srcX = x - delta
        }
        const sample = sampleBilinear(source, width, height, clampPixel(srcX, width - 1), y)
        const idx = (y * targetWidth + x) * 4
        target[idx] = clampChannel(Math.round(sample[0] || 0))
        target[idx + 1] = clampChannel(Math.round(sample[1] || 0))
        target[idx + 2] = clampChannel(Math.round(sample[2] || 0))
        target[idx + 3] = clampChannel(Math.round(sample[3] || 255))
      }
    }
  } else {
    const destStart = inputStart
    const destEnd = destStart + outputBandSize

    for (let y = 0; y < targetHeight; y += 1) {
      for (let x = 0; x < targetWidth; x += 1) {
        let srcY = y
        if (y >= destStart && y < destEnd) {
          const t = (y - destStart) / Math.max(1, outputBandSize)
          srcY = inputStart + t * baseBandSize
        } else if (y >= destEnd) {
          srcY = y - delta
        }
        const sample = sampleBilinear(source, width, height, x, clampPixel(srcY, height - 1))
        const idx = (y * targetWidth + x) * 4
        target[idx] = clampChannel(Math.round(sample[0] || 0))
        target[idx + 1] = clampChannel(Math.round(sample[1] || 0))
        target[idx + 2] = clampChannel(Math.round(sample[2] || 0))
        target[idx + 3] = clampChannel(Math.round(sample[3] || 255))
      }
    }
  }

  return new ImageData(target, targetWidth, targetHeight)
}

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<GeometryWorkerRequest>) => {
  const payload = event.data
  let output = payload.imageData

  if (payload.liquifyStrokes.length > 0) {
    output = applyLiquifyWarp(output, payload.liquifyStrokes)
  }

  output = applyStretchWarp(output, payload.stretch)

  const response: GeometryWorkerResponse = {
    id: payload.id,
    imageData: output,
  }
  workerScope.postMessage(response, [response.imageData.data.buffer])
}

export {}
