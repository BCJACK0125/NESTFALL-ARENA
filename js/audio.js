const SOUND_NAMES = new Set([
  "shoot",
  "impact",
  "shield",
  "parry",
  "explode",
  "crystal",
  "forge",
  "countdown",
  "start",
  "win",
  "ui",
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Small, asset-free Web Audio engine used by Nestfall Arena.
 *
 * Sounds are deliberately generated at conservative levels and routed through a
 * compressor. Calling any public method before the first user gesture is safe:
 * the engine simply waits for the browser to unlock its AudioContext.
 */
class SynthAudio {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.compressor = null;
    this.noiseBuffer = null;

    this.musicWanted = false;
    this.musicTimer = null;
    this.musicCursor = 0;
    this.musicStep = 0;

    this.unlocked = false;
    this.focusPaused = false;
    this.resumePromise = null;
    this.activeSources = new Set();
    this.musicSources = new Set();

    this._onGesture = this._onGesture.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onFocus = this._onFocus.bind(this);
    this._onVisibility = this._onVisibility.bind(this);

    this._installLifecycleHandlers();
  }

  /** Create the audio graph. Safe to call repeatedly or in non-browser tests. */
  init() {
    if (this.context && this.context.state !== "closed") {
      if (this.context.state === "running") this.unlocked = true;
      return true;
    }

    if (typeof window === "undefined") return false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;

    try {
      let context;
      try {
        context = new AudioContextClass({ latencyHint: "interactive" });
      } catch (_optionsError) {
        context = new AudioContextClass();
      }
      const master = context.createGain();
      const sfxBus = context.createGain();
      const musicBus = context.createGain();
      const compressor = context.createDynamicsCompressor();

      master.gain.value = this.enabled ? 0.72 : 0.0001;
      sfxBus.gain.value = 0.72;
      musicBus.gain.value = 0.0001;
      compressor.threshold.value = -18;
      compressor.knee.value = 16;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.2;

      sfxBus.connect(master);
      musicBus.connect(master);
      master.connect(compressor);
      compressor.connect(context.destination);

      this.context = context;
      this.master = master;
      this.sfxBus = sfxBus;
      this.musicBus = musicBus;
      this.compressor = compressor;
      this.noiseBuffer = null;
      this.unlocked = context.state === "running";

      if (this.unlocked) {
        this._removeGestureHandlers();
        if (this.musicWanted && this.enabled && !this.focusPaused) this._beginMusic();
      }
      return true;
    } catch (_error) {
      // Audio is an enhancement; a blocked context must never break gameplay.
      this.context = null;
      return false;
    }
  }

  setEnabled(value) {
    this.enabled = Boolean(value);

    if (!this.context) {
      if (this.enabled) this.init();
      return this.enabled;
    }

    const now = this.context.currentTime;
    this._rampParam(this.master && this.master.gain, this.enabled ? 0.72 : 0.0001, now, 0.035);

    if (!this.enabled) {
      this._endMusic();
      this._stopSources(this.activeSources);
    } else {
      this._resume().then((ready) => {
        if (ready && this.musicWanted && !this.focusPaused) this._beginMusic();
      });
    }

    return this.enabled;
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  /**
   * Play a named synthesized cue.
   * Options: volume (0..1.5), pitch (0.5..2), pan (-1..1), delay (seconds),
   * intensity (0.4..1.5), and player (0 or 1, used as a subtle stereo pan).
   */
  play(name, options = {}) {
    const soundName = String(name || "").toLowerCase();
    if (!this.enabled || !SOUND_NAMES.has(soundName) || !this.init()) return false;

    if (this.context.state === "running" && !this.focusPaused) {
      this._playNow(soundName, options);
      return true;
    }

    // A play request made by a click/key event can unlock audio. Requests made
    // during page load expire quickly so they do not surprise the player later.
    const requestedAt = this._wallTime();
    this._resume().then((ready) => {
      if (
        ready
        && this.enabled
        && !this.focusPaused
        && this._wallTime() - requestedAt < 400
      ) {
        this._playNow(soundName, options);
      }
    });
    return false;
  }

  startMusic() {
    this.musicWanted = true;
    if (!this.enabled || !this.init()) return false;

    if (this.context.state === "running" && !this.focusPaused) {
      this._beginMusic();
      return true;
    }

    this._resume().then((ready) => {
      if (ready && this.enabled && this.musicWanted && !this.focusPaused) this._beginMusic();
    });
    return false;
  }

  stopMusic() {
    this.musicWanted = false;
    this._endMusic();
  }

  _installLifecycleHandlers() {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    window.addEventListener("pointerdown", this._onGesture, { capture: true, passive: true });
    window.addEventListener("keydown", this._onGesture, { capture: true });
    window.addEventListener("touchstart", this._onGesture, { capture: true, passive: true });
    window.addEventListener("blur", this._onBlur);
    window.addEventListener("focus", this._onFocus);
    document.addEventListener("visibilitychange", this._onVisibility);
  }

  _removeGestureHandlers() {
    if (typeof window === "undefined") return;
    window.removeEventListener("pointerdown", this._onGesture, true);
    window.removeEventListener("keydown", this._onGesture, true);
    window.removeEventListener("touchstart", this._onGesture, true);
  }

  _onGesture() {
    if (!this.enabled) return;
    this.init();
    this._resume().then((ready) => {
      if (ready) this._removeGestureHandlers();
    });
  }

  _onBlur() {
    if (this.focusPaused) return;
    this.focusPaused = true;
    if (!this.context) return;
    this._endMusic();
    this._stopSources(this.activeSources);
    if (this.context.state === "running") {
      const result = this.context.suspend();
      if (result && typeof result.catch === "function") result.catch(() => {});
    }
  }

  _onFocus() {
    if (!this.focusPaused) return;
    if (typeof document !== "undefined" && document.hidden) return;
    this.focusPaused = false;
    if (!this.enabled) return;

    this._resume().then((ready) => {
      if (ready && this.musicWanted) this._beginMusic();
    });
  }

  _onVisibility() {
    if (typeof document === "undefined") return;
    if (document.hidden) this._onBlur();
    else this._onFocus();
  }

  _resume() {
    if (!this.context || this.focusPaused || !this.enabled) return Promise.resolve(false);
    if (this.context.state === "running") {
      this.unlocked = true;
      return Promise.resolve(true);
    }
    if (this.context.state === "closed") return Promise.resolve(false);
    if (this.resumePromise) return this.resumePromise;

    try {
      const resumed = this.context.resume();
      this.resumePromise = Promise.resolve(resumed)
        .then(() => {
          const ready = Boolean(this.context && this.context.state === "running");
          if (ready) {
            this.unlocked = true;
            this._removeGestureHandlers();
          }
          return ready;
        })
        .catch(() => false)
        .finally(() => {
          this.resumePromise = null;
        });
    } catch (_error) {
      this.resumePromise = Promise.resolve(false).finally(() => {
        this.resumePromise = null;
      });
    }
    return this.resumePromise;
  }

  _playNow(name, rawOptions) {
    if (!this.context || this.context.state !== "running") return;
    const options = this._soundOptions(rawOptions);
    const handler = this[`_sound_${name}`];
    if (typeof handler !== "function") return;

    try {
      handler.call(this, options);
    } catch (_error) {
      // A sound cue should never interrupt a match, even on partial Web Audio
      // implementations found in older embedded browsers.
    }
  }

  _soundOptions(options) {
    const source = options && typeof options === "object" ? options : {};
    let pan = Number(source.pan);
    if (!Number.isFinite(pan)) {
      pan = source.player === 0 ? -0.3 : source.player === 1 ? 0.3 : 0;
    }
    return {
      volume: clamp(Number.isFinite(Number(source.volume)) ? Number(source.volume) : 1, 0, 1.5),
      pitch: clamp(Number.isFinite(Number(source.pitch)) ? Number(source.pitch) : 1, 0.5, 2),
      intensity: clamp(Number.isFinite(Number(source.intensity)) ? Number(source.intensity) : 1, 0.4, 1.5),
      pan: clamp(pan, -1, 1),
      delay: clamp(Number.isFinite(Number(source.delay)) ? Number(source.delay) : 0, 0, 3),
      final: Boolean(source.final),
    };
  }

  _sound_shoot(o) {
    const time = this.context.currentTime + o.delay;
    this._tone({ time, type: "triangle", frequency: 225 * o.pitch, endFrequency: 690 * o.pitch,
      duration: 0.17, attack: 0.008, gain: 0.115 * o.volume, pan: o.pan });
    this._noise({ time, duration: 0.1, gain: 0.035 * o.volume, pan: o.pan,
      filterType: "bandpass", frequency: 1800 * o.pitch, q: 0.8 });
  }

  _sound_impact(o) {
    const time = this.context.currentTime + o.delay;
    this._tone({ time, type: "sine", frequency: 118 * o.pitch, endFrequency: 54 * o.pitch,
      duration: 0.2, attack: 0.003, gain: 0.12 * o.volume * o.intensity, pan: o.pan });
    this._noise({ time, duration: 0.14, gain: 0.105 * o.volume * o.intensity, pan: o.pan,
      filterType: "lowpass", frequency: 950 * o.pitch, q: 0.45 });
  }

  _sound_shield(o) {
    const time = this.context.currentTime + o.delay;
    this._tone({ time, type: "sine", frequency: 205 * o.pitch, endFrequency: 455 * o.pitch,
      duration: 0.34, attack: 0.045, gain: 0.085 * o.volume, pan: o.pan });
    this._tone({ time: time + 0.025, type: "triangle", frequency: 410 * o.pitch,
      endFrequency: 825 * o.pitch, duration: 0.3, attack: 0.06, gain: 0.052 * o.volume, pan: o.pan });
  }

  _sound_parry(o) {
    const time = this.context.currentTime + o.delay;
    this._tone({ time, type: "triangle", frequency: 920 * o.pitch, endFrequency: 1460 * o.pitch,
      duration: 0.17, attack: 0.002, gain: 0.105 * o.volume, pan: o.pan });
    this._tone({ time: time + 0.018, type: "sine", frequency: 1840 * o.pitch,
      endFrequency: 1210 * o.pitch, duration: 0.22, attack: 0.002, gain: 0.058 * o.volume, pan: o.pan });
  }

  _sound_explode(o) {
    const time = this.context.currentTime + o.delay;
    this._noise({ time, duration: 0.5, gain: 0.17 * o.volume * o.intensity, pan: o.pan,
      filterType: "lowpass", frequency: 1350 * o.pitch, endFrequency: 180, q: 0.25 });
    this._noise({ time, duration: 0.075, gain: 0.105 * o.volume, pan: o.pan,
      filterType: "highpass", frequency: 2300 * o.pitch, q: 0.5 });
    this._tone({ time, type: "sine", frequency: 92 * o.pitch, endFrequency: 38 * o.pitch,
      duration: 0.48, attack: 0.004, gain: 0.15 * o.volume * o.intensity, pan: o.pan });
  }

  _sound_crystal(o) {
    const time = this.context.currentTime + o.delay;
    [740, 1110, 1480].forEach((frequency, index) => {
      this._tone({ time: time + index * 0.055, type: "sine", frequency: frequency * o.pitch,
        endFrequency: frequency * 1.025 * o.pitch, duration: 0.3 - index * 0.035,
        attack: 0.003, gain: (0.07 - index * 0.012) * o.volume, pan: o.pan });
    });
  }

  _sound_forge(o) {
    const time = this.context.currentTime + o.delay;
    this._noise({ time, duration: 0.075, gain: 0.105 * o.volume, pan: o.pan,
      filterType: "bandpass", frequency: 1450 * o.pitch, q: 2.4 });
    this._tone({ time, type: "triangle", frequency: 185 * o.pitch, endFrequency: 138 * o.pitch,
      duration: 0.24, attack: 0.003, gain: 0.105 * o.volume, pan: o.pan });
    this._tone({ time: time + 0.07, type: "sine", frequency: 370 * o.pitch,
      endFrequency: 555 * o.pitch, duration: 0.25, attack: 0.015, gain: 0.045 * o.volume, pan: o.pan });
  }

  _sound_countdown(o) {
    const time = this.context.currentTime + o.delay;
    const frequency = (o.final ? 760 : 520) * o.pitch;
    this._tone({ time, type: "sine", frequency, endFrequency: frequency * 0.99,
      duration: o.final ? 0.23 : 0.13, attack: 0.004, gain: 0.092 * o.volume, pan: o.pan });
  }

  _sound_start(o) {
    const time = this.context.currentTime + o.delay;
    [392, 523.25, 659.25, 783.99].forEach((frequency, index) => {
      this._tone({ time: time + index * 0.075, type: "triangle", frequency: frequency * o.pitch,
        endFrequency: frequency * 1.015 * o.pitch, duration: 0.25,
        attack: 0.004, gain: 0.072 * o.volume, pan: o.pan });
    });
  }

  _sound_win(o) {
    const time = this.context.currentTime + o.delay;
    [261.63, 329.63, 392, 523.25, 659.25].forEach((frequency, index) => {
      this._tone({ time: time + index * 0.095, type: index < 3 ? "triangle" : "sine",
        frequency: frequency * o.pitch, endFrequency: frequency * 1.01 * o.pitch,
        duration: 0.48, attack: 0.008, gain: 0.068 * o.volume, pan: o.pan });
    });
    [261.63, 329.63, 392].forEach((frequency) => {
      this._tone({ time: time + 0.49, type: "sine", frequency: frequency * o.pitch,
        duration: 0.82, attack: 0.045, gain: 0.035 * o.volume, pan: o.pan });
    });
  }

  _sound_ui(o) {
    const time = this.context.currentTime + o.delay;
    this._tone({ time, type: "sine", frequency: 610 * o.pitch, endFrequency: 835 * o.pitch,
      duration: 0.065, attack: 0.002, gain: 0.05 * o.volume, pan: o.pan });
  }

  _tone({
    time,
    type = "sine",
    frequency = 440,
    endFrequency = frequency,
    duration = 0.2,
    attack = 0.005,
    gain = 0.08,
    pan = 0,
    music = false,
  }) {
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const panner = this._createPanner(pan);
    const start = Math.max(this.context.currentTime, time);
    const end = start + Math.max(0.025, duration);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), end);

    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, gain), start + Math.min(attack, duration * 0.45));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(envelope);
    envelope.connect(panner);
    panner.connect(music ? this.musicBus : this.sfxBus);
    this._track(oscillator, music);
    oscillator.start(start);
    oscillator.stop(end + 0.025);
  }

  _noise({
    time,
    duration = 0.2,
    gain = 0.08,
    pan = 0,
    filterType = "lowpass",
    frequency = 1000,
    endFrequency = frequency,
    q = 0.7,
    music = false,
  }) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    const panner = this._createPanner(pan);
    const start = Math.max(this.context.currentTime, time);
    const end = start + Math.max(0.025, duration);

    source.buffer = this._getNoiseBuffer();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(Math.max(25, frequency), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(25, endFrequency), end);
    envelope.gain.setValueAtTime(Math.max(0.0001, gain), start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);

    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(panner);
    panner.connect(music ? this.musicBus : this.sfxBus);
    this._track(source, music);
    source.start(start);
    source.stop(end + 0.025);
  }

  _createPanner(pan) {
    if (typeof this.context.createStereoPanner === "function") {
      const panner = this.context.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      return panner;
    }
    // GainNode is a mono-compatible fallback with the same connect interface.
    return this.context.createGain();
  }

  _getNoiseBuffer() {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.ceil(this.context.sampleRate * 1.2);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      // A lightly correlated signal sounds fuller and less abrasive than raw white noise.
      last = last * 0.22 + (Math.random() * 2 - 1) * 0.78;
      samples[index] = last;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  _beginMusic() {
    if (
      this.musicTimer
      || !this.context
      || this.context.state !== "running"
      || !this.musicWanted
      || !this.enabled
      || this.focusPaused
    ) return;

    const now = this.context.currentTime;
    this._rampParam(this.musicBus.gain, 0.25, now, 0.28);
    this.musicCursor = now + 0.04;
    this.musicStep = 0;
    this._scheduleMusic();
    this.musicTimer = window.setInterval(() => this._scheduleMusic(), 100);
  }

  _scheduleMusic() {
    if (!this.context || this.context.state !== "running" || !this.musicWanted || this.focusPaused) return;

    const stepDuration = 60 / 98 / 2;
    const chordRoots = [130.81, 103.83, 155.56, 116.54]; // C3, A-flat2, E-flat3, B-flat2
    const chordIntervals = [
      [1, 1.1892, 1.4983],
      [1, 1.2599, 1.4983],
      [1, 1.2599, 1.4983],
      [1, 1.2599, 1.4983],
    ];
    const pattern = [0, 2, 1, 2, 0, 1, 2, 1];

    while (this.musicCursor < this.context.currentTime + 0.42) {
      const step = this.musicStep;
      const chordIndex = Math.floor(step / 8) % chordRoots.length;
      const intervalIndex = pattern[step % pattern.length];
      const root = chordRoots[chordIndex];
      const frequency = root * 2 * chordIntervals[chordIndex][intervalIndex];

      this._tone({ time: this.musicCursor, type: "triangle", frequency,
        endFrequency: frequency * 1.003, duration: stepDuration * 0.75,
        attack: 0.018, gain: 0.048, pan: step % 2 ? 0.16 : -0.16, music: true });

      if (step % 4 === 0) {
        this._tone({ time: this.musicCursor, type: "sine", frequency: root,
          endFrequency: root * 0.995, duration: stepDuration * 1.7,
          attack: 0.035, gain: 0.05, pan: 0, music: true });
      }
      if (step % 8 === 0) {
        chordIntervals[chordIndex].forEach((interval, note) => {
          this._tone({ time: this.musicCursor, type: "sine", frequency: root * interval,
            duration: stepDuration * 5.8, attack: 0.28, gain: 0.018,
            pan: (note - 1) * 0.2, music: true });
        });
      }

      this.musicStep = (step + 1) % 32;
      this.musicCursor += stepDuration;
    }
  }

  _endMusic() {
    if (this.musicTimer && typeof window !== "undefined") window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    this._stopSources(this.musicSources);
    if (this.context && this.musicBus) {
      this._rampParam(this.musicBus.gain, 0.0001, this.context.currentTime, 0.08);
    }
  }

  _track(source, music) {
    this.activeSources.add(source);
    if (music) this.musicSources.add(source);
    source.addEventListener("ended", () => {
      this.activeSources.delete(source);
      this.musicSources.delete(source);
    }, { once: true });
  }

  _stopSources(sources) {
    for (const source of [...sources]) {
      try {
        source.stop();
      } catch (_error) {
        // Already stopped nodes throw InvalidStateError in some browsers.
      }
      this.activeSources.delete(source);
      this.musicSources.delete(source);
    }
  }

  _rampParam(param, value, time, duration) {
    if (!param) return;
    try {
      param.cancelScheduledValues(time);
      param.setValueAtTime(Math.max(0.0001, param.value), time);
      param.exponentialRampToValueAtTime(Math.max(0.0001, value), time + duration);
    } catch (_error) {
      param.value = value;
    }
  }

  _wallTime() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }
}

export const audio = new SynthAudio();
