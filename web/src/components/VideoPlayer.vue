<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { API_BASE, api, type MediaItem } from '../api'

const props = defineProps<{
  item: MediaItem
  token: string
  hasPrev: boolean
  hasNext: boolean
}>()

const emit = defineEmits<{
  close: []
  prev: []
  next: []
  'screenshot-saved': [item: MediaItem]
}>()

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

const videoRef = ref<HTMLVideoElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)

const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(1)
const muted = ref(false)
const speed = ref(1)
const seeking = ref(false)
const screenshotSaving = ref(false)
const screenshotDone = ref(false)
const screenshotError = ref(false)
const isFullscreen = ref(false)

const streamUrl = computed(
  () => `${API_BASE}/media/${props.item.id}/stream?token=${encodeURIComponent(props.token)}`,
)

// Reset state whenever the displayed item changes
watch(
  () => props.item.id,
  () => {
    playing.value = false
    currentTime.value = 0
    duration.value = 0
    screenshotDone.value = false
    screenshotError.value = false
    // The <video> src binding updates automatically via streamUrl computed
  },
)

function togglePlay() {
  const v = videoRef.value
  if (!v) return
  v.paused ? v.play() : v.pause()
}

function onTimeUpdate() {
  if (!seeking.value) currentTime.value = videoRef.value?.currentTime ?? 0
}

function onLoaded() {
  const v = videoRef.value
  if (!v) return
  duration.value = v.duration
  v.volume = volume.value
  v.playbackRate = speed.value
}

function onSeekInput(e: Event) {
  seeking.value = true
  currentTime.value = Number((e.target as HTMLInputElement).value)
}

function onSeekChange(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  if (videoRef.value) videoRef.value.currentTime = val
  currentTime.value = val
  seeking.value = false
}

function onVolumeInput(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  volume.value = val
  muted.value = val === 0
  if (videoRef.value) {
    videoRef.value.volume = val
    videoRef.value.muted = muted.value
  }
}

function toggleMute() {
  muted.value = !muted.value
  if (videoRef.value) {
    videoRef.value.muted = muted.value
  }
}

function onSpeedChange(e: Event) {
  const val = Number((e.target as HTMLSelectElement).value)
  speed.value = val
  if (videoRef.value) videoRef.value.playbackRate = val
}

function formatTime(sec: number) {
  if (!isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

async function takeScreenshot() {
  const v = videoRef.value
  if (!v || screenshotSaving.value) return

  const canvas = document.createElement('canvas')
  canvas.width = v.videoWidth
  canvas.height = v.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(v, 0, 0)
  const dataUrl = canvas.toDataURL('image/png')

  screenshotSaving.value = true
  screenshotDone.value = false
  screenshotError.value = false
  try {
    const newItem = await api.saveVideoScreenshot(props.token, props.item.id, dataUrl)
    emit('screenshot-saved', newItem)
    screenshotDone.value = true
    setTimeout(() => {
      screenshotDone.value = false
    }, 2500)
  } catch {
    screenshotError.value = true
    setTimeout(() => {
      screenshotError.value = false
    }, 3000)
  } finally {
    screenshotSaving.value = false
  }
}

function toggleFullscreen() {
  const el = containerRef.value
  if (!el) return
  if (!document.fullscreenElement) {
    el.requestFullscreen().catch(() => {})
  } else {
    document.exitFullscreen().catch(() => {})
  }
}

function onFullscreenChange() {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

function changeVolume(delta: number) {
  const next = Math.min(1, Math.max(0, volume.value + delta))
  volume.value = next
  muted.value = next === 0
  if (videoRef.value) {
    videoRef.value.volume = next
    videoRef.value.muted = muted.value
  }
}

function changeSpeed(delta: number) {
  const idx = SPEEDS.indexOf(speed.value)
  const nextIdx = Math.min(SPEEDS.length - 1, Math.max(0, idx + delta))
  const nextSpeed = SPEEDS[nextIdx] ?? speed.value
  speed.value = nextSpeed
  if (videoRef.value) videoRef.value.playbackRate = nextSpeed
}

function seekBy(seconds: number) {
  if (!videoRef.value) return
  videoRef.value.currentTime = Math.min(
    videoRef.value.duration,
    Math.max(0, videoRef.value.currentTime + seconds),
  )
}

function onKeyDown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

  if (e.code === 'Space') {
    e.preventDefault()
    e.stopImmediatePropagation()
    togglePlay()
  } else if (e.key === 'Escape') {
    e.stopImmediatePropagation()
    // let App.vue's handler call closeLightbox
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    e.stopImmediatePropagation()
    seekBy(-5)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    e.stopImmediatePropagation()
    seekBy(5)
  } else if (e.key === 'ArrowUp' && e.ctrlKey) {
    e.preventDefault()
    e.stopImmediatePropagation()
    changeSpeed(1)
  } else if (e.key === 'ArrowDown' && e.ctrlKey) {
    e.preventDefault()
    e.stopImmediatePropagation()
    changeSpeed(-1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    e.stopImmediatePropagation()
    changeVolume(0.1)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    e.stopImmediatePropagation()
    changeVolume(-0.1)
  } else if (e.key === 'S' && e.shiftKey) {
    e.preventDefault()
    e.stopImmediatePropagation()
    void takeScreenshot()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown, { capture: true })
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown, { capture: true })
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (videoRef.value) {
    videoRef.value.pause()
    videoRef.value.src = ''
  }
})
</script>

<template>
  <div class="vp-overlay" @click.self="$emit('close')">
    <!-- Navigation arrows (same style as lightbox) -->
    <button v-if="hasPrev" class="overlay-arrow left" @click.stop="$emit('prev')">‹</button>

    <div ref="containerRef" class="vp-shell" @click.stop>
      <!-- Header -->
      <div class="vp-header" @click.stop>
        <div class="overlay-meta">
          <i class="ri-film-line vp-video-icon" aria-hidden="true"></i>
          <span class="overlay-filename">{{ item.filename }}</span>
        </div>
        <div class="vp-header-actions">
          <button class="btn ghost lightbox-action-btn" title="Close" @click="$emit('close')">
            <i class="ri-close-line" aria-hidden="true"></i>
            <span class="lightbox-action-label">Close</span>
          </button>
        </div>
      </div>

      <!-- Video stage -->
      <div class="vp-stage" @click="togglePlay">
        <video
          ref="videoRef"
          class="vp-video"
          :src="streamUrl"
          preload="metadata"
          @timeupdate="onTimeUpdate"
          @loadedmetadata="onLoaded"
          @ended="playing = false"
          @pause="playing = false"
          @play="playing = true"
          @click.stop
        />
        <!-- Big play button overlay when paused -->
        <Transition name="vp-playbtn">
          <button
            v-if="!playing"
            class="vp-big-play"
            aria-label="Play"
            tabindex="-1"
            @click.stop="togglePlay"
          >
            <i class="ri-play-fill" aria-hidden="true"></i>
          </button>
        </Transition>
      </div>

      <!-- Controls -->
      <div class="vp-controls" @click.stop>
        <!-- Seek bar row -->
        <div class="vp-timeline">
          <span class="vp-time">{{ formatTime(currentTime) }}</span>
          <input
            type="range"
            class="vp-seek"
            min="0"
            :max="duration || 100"
            step="0.1"
            :value="currentTime"
            @input="onSeekInput"
            @change="onSeekChange"
          />
          <span class="vp-time">{{ formatTime(duration) }}</span>
        </div>

        <!-- Bottom control row -->
        <div class="vp-controls-row">
          <div class="vp-controls-left">
            <button class="vp-btn" :title="playing ? 'Pause' : 'Play'" @click="togglePlay">
              <i :class="playing ? 'ri-pause-line' : 'ri-play-line'" aria-hidden="true"></i>
            </button>
            <button class="vp-btn" :title="muted ? 'Unmute' : 'Mute'" @click="toggleMute">
              <i
                :class="muted || volume === 0 ? 'ri-volume-mute-line' : volume < 0.5 ? 'ri-volume-down-line' : 'ri-volume-up-line'"
                aria-hidden="true"
              ></i>
            </button>
            <input
              type="range"
              class="vp-volume"
              min="0"
              max="1"
              step="0.05"
              :value="muted ? 0 : volume"
              aria-label="Volume"
              @input="onVolumeInput"
            />
          </div>

          <div class="vp-controls-right">
            <label class="vp-speed-label" title="Playback speed">
              <select class="vp-speed" :value="speed" @change="onSpeedChange">
                <option v-for="s in SPEEDS" :key="s" :value="s">{{ s }}×</option>
              </select>
            </label>

            <button
              class="vp-btn vp-screenshot-btn"
              :class="{ saving: screenshotSaving, done: screenshotDone, error: screenshotError }"
              :disabled="screenshotSaving"
              title="Screenshot — saves to gallery"
              @click="takeScreenshot"
            >
              <i
                :class="screenshotDone ? 'ri-checkbox-circle-line' : screenshotError ? 'ri-error-warning-line' : screenshotSaving ? 'ri-loader-4-line vp-spin' : 'ri-camera-line'"
                aria-hidden="true"
              ></i>
            </button>

            <button class="vp-btn" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="toggleFullscreen">
              <i :class="isFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <button v-if="hasNext" class="overlay-arrow right" @click.stop="$emit('next')">›</button>
  </div>
</template>

<style scoped>
.vp-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
}

.vp-shell {
  display: flex;
  flex-direction: column;
  width: min(96vw, 1100px);
  height: 96vh;
  max-height: 96vh;
  background: #18181b;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7);
}

/* fullscreen: shell fills the screen */
:fullscreen .vp-shell {
  width: 100vw;
  height: 100vh;
  max-height: 100vh;
  border-radius: 0;
}

/* Header */
.vp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #111113;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  flex-shrink: 0;
}

.vp-video-icon {
  margin-right: 6px;
  opacity: 0.5;
}

.vp-header-actions {
  display: flex;
  gap: 4px;
}

/* Stage */
.vp-stage {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
  background: #000;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vp-video {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  background: #000;
}

.vp-big-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  pointer-events: none;
}

.vp-big-play i {
  font-size: 72px;
  color: rgba(255, 255, 255, 0.85);
  filter: drop-shadow(0 2px 12px rgba(0, 0, 0, 0.6));
}

.vp-playbtn-enter-active,
.vp-playbtn-leave-active {
  transition: opacity 0.15s ease;
}
.vp-playbtn-enter-from,
.vp-playbtn-leave-to {
  opacity: 0;
}

/* Controls */
.vp-controls {
  flex-shrink: 0;
  background: #111113;
  padding: 10px 16px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.vp-timeline {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.vp-time {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  min-width: 36px;
}

.vp-seek {
  flex: 1;
  height: 4px;
  cursor: pointer;
  accent-color: #a78bfa;
}

.vp-controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.vp-controls-left,
.vp-controls-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.vp-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.75);
  font-size: 18px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.vp-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.vp-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.vp-volume {
  width: 80px;
  height: 4px;
  cursor: pointer;
  accent-color: #a78bfa;
  margin-left: 4px;
}

.vp-speed-label {
  display: flex;
  align-items: center;
}

.vp-speed {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: rgba(255, 255, 255, 0.75);
  font-size: 13px;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  outline: none;
}

.vp-speed:hover {
  background: rgba(255, 255, 255, 0.14);
}

.vp-screenshot-btn.saving i {
  color: #a78bfa;
}

.vp-screenshot-btn.done i {
  color: #4ade80;
}

.vp-screenshot-btn.error i {
  color: #f87171;
}

@keyframes vp-spin {
  to {
    transform: rotate(360deg);
  }
}

.vp-spin {
  display: inline-block;
  animation: vp-spin 0.8s linear infinite;
}

@media (max-width: 480px) {
  .vp-volume {
    width: 52px;
  }
  .vp-big-play i {
    font-size: 52px;
  }
}
</style>
