// Her ears, while your music plays: the sound coming out of your PC (Windows "loopback"),
// analysed right here for the beat. Nothing is recorded, kept or sent anywhere; the screen
// picture Electron hands over with it is stopped at once. Listening only while Spotify plays.

const MIN_GAP_MS = 260; // no faster than ~230 bpm

export class Rhythm {
  constructor() {
    this.stream = null;
    this.ctx = null;
    this.onBeat = null;   // (strength 0..1)
    this.onLevel = null;  // (level 0..1), every frame
    this.avg = 0;
    this.lastBeat = 0;
    this.on = false;
  }

  async start() {
    if (this.on) return;
    this.on = true;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop());
      if (!stream.getAudioTracks().length || !this.on) {
        stream.getTracks().forEach((t) => t.stop());
        this.on = false;
        return;
      }
      this.stream = stream;
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.5;
      src.connect(this.analyser); // to the analyser only: nothing is played back
      this.bins = new Uint8Array(this.analyser.frequencyBinCount);
      this.loop();
    } catch (err) {
      console.error('[capri] rhythm:', err?.message || err);
      this.on = false;
    }
  }

  stop() {
    this.on = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.onLevel?.(0);
  }

  loop() {
    if (!this.on || !this.analyser) return;
    this.analyser.getByteFrequencyData(this.bins);
    // the low end, where the kick drum is (~40-160 Hz at 48 kHz / 1024)
    let bass = 0;
    for (let i = 1; i < 5; i++) bass += this.bins[i];
    bass /= 4 * 255;
    let all = 0;
    for (let i = 0; i < 64; i++) all += this.bins[i];
    this.onLevel?.(all / (64 * 255));
    this.avg = this.avg * 0.94 + bass * 0.06;
    const now = performance.now();
    if (bass > 0.25 && bass > this.avg * 1.25 && now - this.lastBeat > MIN_GAP_MS) {
      this.lastBeat = now;
      this.onBeat?.(Math.min(1, (bass - this.avg) * 3));
    }
    requestAnimationFrame(() => this.loop());
  }
}
