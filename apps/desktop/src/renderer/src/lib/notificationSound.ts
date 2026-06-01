export type NotificationSound = 'chime' | 'bell' | 'ping' | 'ding' | 'pulse'

export const NOTIFICATION_SOUND_VALUES: NotificationSound[] = ['chime', 'bell', 'ping', 'ding', 'pulse']

export const NOTIFICATION_SOUND_LABELS: Record<NotificationSound, string> = {
  chime: 'Chime',
  bell: 'Bell',
  ping: 'Ping',
  ding: 'Ding',
  pulse: 'Pulse',
}

function getCtx(): AudioContext | null {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    return AudioCtx ? new AudioCtx() : null
  } catch {
    return null
  }
}

export function playNotificationSound(sound: NotificationSound = 'chime'): void {
  const ctx = getCtx()
  if (!ctx) return
  try {
    switch (sound) {
      case 'chime':  playChime(ctx);  break
      case 'bell':   playBell(ctx);   break
      case 'ping':   playPing(ctx);   break
      case 'ding':   playDing(ctx);   break
      case 'pulse':  playPulse(ctx);  break
    }
  } catch {
    // audio unavailable
  }
}

// Swooping sine: 880→440 Hz — the original default
function playChime(ctx: AudioContext): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(880, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.2)
  gain.gain.setValueAtTime(0.3, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + 0.5)
}

// Inharmonic partials with a fast attack and slow decay, like a struck bell
function playBell(ctx: AudioContext): void {
  const fundamental = 523 // C5
  // Bells have stretched, inharmonic partials
  const partials: Array<[ratio: number, amplitude: number]> = [
    [1, 0.35],
    [2.756, 0.18],
    [5.404, 0.09],
    [8.933, 0.05],
  ]
  for (const [ratio, amp] of partials) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(fundamental * ratio, ctx.currentTime)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(amp, ctx.currentTime + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 1.2)
  }
}

// Short, crisp high-frequency ping
function playPing(ctx: AudioContext): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(1200, ctx.currentTime)
  gain.gain.setValueAtTime(0.35, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + 0.25)
}

// Warm, mid-range ding with a soft attack
function playDing(ctx: AudioContext): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(440, ctx.currentTime)
  gain.gain.setValueAtTime(0, ctx.currentTime)
  gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + 0.8)
}

// Two short pulses in quick succession
function playPulse(ctx: AudioContext): void {
  for (const delay of [0, 0.18]) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(700, ctx.currentTime + delay)
    gain.gain.setValueAtTime(0.3, ctx.currentTime + delay)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.14)
    osc.start(ctx.currentTime + delay)
    osc.stop(ctx.currentTime + delay + 0.14)
  }
}
