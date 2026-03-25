type WebglPreviewAdjustments = {
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
}

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_image;
uniform vec2 u_texel;
uniform float u_temperature;
uniform float u_tint;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_toneDepth;
uniform float u_shadows;
uniform float u_highlights;
uniform float u_sharpness;
uniform float u_definition;
uniform float u_clarity;
uniform float u_vignette;
uniform float u_glamour;
uniform float u_grayscale;
uniform float u_sepia;
uniform float u_exposure;
uniform float u_grain;
uniform float u_fade;
varying vec2 v_uv;

float luminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec4 centerSample = texture2D(u_image, v_uv);
  vec3 center = centerSample.rgb;

  vec3 north = texture2D(u_image, v_uv + vec2(0.0, -u_texel.y)).rgb;
  vec3 south = texture2D(u_image, v_uv + vec2(0.0, u_texel.y)).rgb;
  vec3 east = texture2D(u_image, v_uv + vec2(u_texel.x, 0.0)).rgb;
  vec3 west = texture2D(u_image, v_uv + vec2(-u_texel.x, 0.0)).rgb;

  vec3 neighborAvg = (north + south + east + west) * 0.25;
  vec3 sharpened = center + (center - neighborAvg) * (u_sharpness * 1.6 + u_definition * 1.1);
  vec3 color = mix(center, sharpened, clamp(u_sharpness + u_definition, 0.0, 1.0));

  // Exposure (multiplicative, before additive brightness)
  color *= u_exposure;

  float luma = luminance(color);
  color += vec3(u_brightness);
  color = (color - 0.5) * (1.0 + u_contrast) + 0.5;
  color = mix(vec3(luma), color, 1.0 + u_saturation);

  color.r += u_temperature * 0.20;
  color.b -= u_temperature * 0.16;

  // Tint: green-magenta axis
  color.g *= 1.0 - u_tint * 0.12;

  // Vibrance: selective saturation (protects already-saturated colours)
  luma = luminance(color);
  float maxCh = max(color.r, max(color.g, color.b));
  float minCh = min(color.r, min(color.g, color.b));
  float curSat = maxCh - minCh;
  float vibranceAmt = u_vibrance * (1.0 - clamp(curSat * 1.4, 0.0, 1.0));
  color = mix(vec3(luma), color, 1.0 + vibranceAmt);

  float shadowMask = 1.0 - smoothstep(0.2, 0.72, luma);
  float highlightMask = smoothstep(0.35, 0.95, luma);
  color += vec3(u_shadows * 0.45 * shadowMask);
  color -= vec3(u_highlights * 0.38 * highlightMask);

  color = (color - 0.5) * (1.0 + u_toneDepth * 0.7) + 0.5;

  // Clarity: midtone local contrast (uses 1-px neighbour avg as approximation)
  luma = luminance(color);
  float midtoneMask = 1.0 - abs(luma * 2.0 - 1.0);
  color += (color - neighborAvg) * u_clarity * 1.8 * midtoneMask;

  vec2 p = v_uv * 2.0 - 1.0;
  float dist = length(p);
  float vignetteMask = smoothstep(0.58, 1.22, dist);
  color *= 1.0 - vignetteMask * u_vignette;

  float smoothLuma = dot(neighborAvg, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(smoothLuma), u_glamour * 0.16);

  float gray = luminance(color);
  color = mix(color, vec3(gray), u_grayscale);

  vec3 sepiaColor = vec3(
    dot(color, vec3(0.393, 0.769, 0.189)),
    dot(color, vec3(0.349, 0.686, 0.168)),
    dot(color, vec3(0.272, 0.534, 0.131))
  );
  color = mix(color, sepiaColor, u_sepia);

  // Fade: lift blacks for a matte/faded-film look
  color = color * (1.0 - u_fade * 0.12) + vec3(u_fade * 0.12);

  // Film grain: deterministic pseudo-random noise
  float grainNoise = fract(sin(dot(v_uv * 833.0, vec2(127.1, 311.7))) * 43758.5453);
  color += (grainNoise - 0.5) * u_grain * 0.12;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), centerSample.a);
}
`

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    return null
  }

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    return null
  }

  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)

  gl.deleteShader(vertex)
  gl.deleteShader(fragment)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }

  return program
}

function toUniform(value: number, scale = 1) {
  return (value / 100) * scale
}

export function applyWebglPreviewAdjustments(
  source: HTMLImageElement,
  width: number,
  height: number,
  adjustments: WebglPreviewAdjustments,
): ImageData | null {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const gl = canvas.getContext('webgl', {
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
  })

  if (!gl) return null

  const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)
  if (!program) {
    return null
  }

  gl.viewport(0, 0, width, height)
  gl.useProgram(program)

  const positionLoc = gl.getAttribLocation(program, 'a_position')
  const buffer = gl.createBuffer()
  if (!buffer || positionLoc < 0) {
    if (buffer) gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    return null
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  )
  gl.enableVertexAttribArray(positionLoc)
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)

  const texture = gl.createTexture()
  if (!texture) {
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    return null
  }

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  } catch {
    gl.deleteTexture(texture)
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    return null
  }

  const uniforms: Array<[string, number]> = [
    ['u_temperature', toUniform(adjustments.temperature, 1)],
    ['u_tint', toUniform(adjustments.tint, 1.0)],
    ['u_brightness', toUniform(adjustments.brightness, 0.55)],
    ['u_contrast', toUniform(adjustments.contrast, 1.1)],
    ['u_saturation', toUniform(adjustments.saturation, 1.0)],
    ['u_vibrance', toUniform(adjustments.vibrance, 1.0)],
    ['u_toneDepth', toUniform(adjustments.toneDepth, 1.0)],
    ['u_shadows', toUniform(adjustments.shadowsLevel, 1.0)],
    ['u_highlights', toUniform(adjustments.highlightsLevel, 1.0)],
    ['u_sharpness', toUniform(adjustments.sharpness, 1.0)],
    ['u_definition', toUniform(adjustments.definition, 1.0)],
    ['u_clarity', toUniform(adjustments.clarity, 1.0)],
    ['u_vignette', toUniform(adjustments.vignette, 1.0)],
    ['u_glamour', toUniform(adjustments.glamour, 1.0)],
    ['u_grayscale', toUniform(adjustments.grayscale, 1.0)],
    ['u_sepia', toUniform(adjustments.sepia, 1.0)],
    ['u_exposure', Math.pow(2, (adjustments.exposure / 100) * 2)],
    ['u_grain', toUniform(adjustments.grain, 1.0)],
    ['u_fade', toUniform(adjustments.fade, 1.0)],
  ]

  const texelLoc = gl.getUniformLocation(program, 'u_texel')
  if (texelLoc) {
    gl.uniform2f(texelLoc, 1 / Math.max(1, width), 1 / Math.max(1, height))
  }

  const imageLoc = gl.getUniformLocation(program, 'u_image')
  if (imageLoc) {
    gl.uniform1i(imageLoc, 0)
  }

  for (const [name, value] of uniforms) {
    const location = gl.getUniformLocation(program, name)
    if (location) {
      gl.uniform1f(location, value)
    }
  }

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

  const pixels = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

  const output = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const srcY = height - 1 - y
    const srcOffset = srcY * width * 4
    const dstOffset = y * width * 4
    output.set(pixels.subarray(srcOffset, srcOffset + width * 4), dstOffset)
  }

  gl.deleteTexture(texture)
  gl.deleteBuffer(buffer)
  gl.deleteProgram(program)

  return new ImageData(output, width, height)
}

export type { WebglPreviewAdjustments }
