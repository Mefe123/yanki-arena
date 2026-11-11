// Kodla üretilen sesler (Web Audio). Ses dosyası yok.
// Diğer oyuncuların sesleri konumsaldır: yön ve uzaklık duyulur.
import { settings, onSettings } from './settings';

type V3 = { x: number; y: number; z: number };

class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;

  /** Kullanıcı etkileşimi sırasında çağrılmalı (tarayıcı otomatik oynatma kuralı) */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master = this.ctx.createGain();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      onSettings((s) => { this.master.gain.value = s.muted ? 0 : s.volume; });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  private get ok() { return !!this.ctx && this.ctx.state === 'running' && !settings.muted && settings.volume > 0; }

  /** Dinleyici = kamera */
  listener(p: V3, yaw: number) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(0, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** Konumluysa panner, değilse doğrudan ana çıkış */
  private out(pos?: V3, gain = 1): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 3;
      p.rolloffFactor = 1.1;
      p.maxDistance = 120;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else {
        p.setPosition(pos.x, pos.y, pos.z);
      }
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  private noiseHit(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  private tone(dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Tüfek atışı: çatlama + gövde + düşük gümleme. Uzaktaysa tizler kısılır. */
  shot(pos?: V3, listenerPos?: V3) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    let dest = this.out(pos, pos ? 1 : 0.55);
    if (pos && listenerPos) {
      const d = Math.hypot(pos.x - listenerPos.x, pos.z - listenerPos.z);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(900, 9000 - d * 180);
      lp.connect(dest);
      dest = lp;
    }
    const v = 0.95 + Math.random() * 0.1;
    this.noiseHit(dest, t, 0.09, 'bandpass', 2400 * v, 0.6, 0.9);
    this.noiseHit(dest, t, 0.22, 'lowpass', 900 * v, 0.7, 0.7);
    this.tone(dest, t, 'sine', 140 * v, 42, 0.14, 0.9);
    this.tone(dest, t, 'square', 2600 * v, 1800, 0.015, 0.12);
  }

  empty() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone(this.out(undefined, 0.4), t, 'square', 1800, 1200, 0.02, 0.4);
  }

  reloadOut() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const o = this.out(undefined, 0.45);
    this.tone(o, t, 'square', 700, 500, 0.03, 0.5);
    this.noiseHit(o, t + 0.01, 0.05, 'bandpass', 3000, 2, 0.4);
  }

  reloadIn() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const o = this.out(undefined, 0.5);
    this.tone(o, t, 'square', 900, 650, 0.03, 0.5);
    this.noiseHit(o, t, 0.05, 'bandpass', 3500, 2, 0.4);
    this.tone(o, t + 0.12, 'square', 1300, 900, 0.025, 0.5);
    this.noiseHit(o, t + 0.12, 0.04, 'bandpass', 4200, 2, 0.4);
  }

  /** Vurduğunda: kısa, net bir tık */
  hit(head: boolean) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const o = this.out(undefined, 0.5);
    this.tone(o, t, 'triangle', head ? 2200 : 1500, head ? 2000 : 1300, 0.06, 0.7);
  }

  /** Öldürdüğünde: iki notalı çan */
  kill() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const o = this.out(undefined, 0.45);
    this.tone(o, t, 'sine', 880, 880, 0.18, 0.6);
    this.tone(o, t + 0.09, 'sine', 1320, 1320, 0.3, 0.6);
  }

  hurt() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const o = this.out(undefined, 0.7);
    this.noiseHit(o, t, 0.18, 'lowpass', 500, 0.8, 0.8);
    this.tone(o, t, 'sine', 110, 60, 0.18, 0.7);
  }

  death() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const o = this.out(undefined, 0.6);
    this.tone(o, t, 'sawtooth', 320, 50, 0.7, 0.25);
    this.noiseHit(o, t, 0.4, 'lowpass', 300, 0.7, 0.6);
  }

  respawn() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const o = this.out(undefined, 0.35);
    this.tone(o, t, 'sine', 420, 840, 0.25, 0.5);
  }

  /** Kum üstünde adım */
  step(pos?: V3, gain = 1) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const o = this.out(pos, (pos ? 0.9 : 0.22) * gain);
    this.noiseHit(o, t, 0.07, 'bandpass', 600 + Math.random() * 500, 1.2, 0.8);
    this.noiseHit(o, t + 0.02, 0.05, 'highpass', 3000, 0.7, 0.25);
  }

  jump() {
    if (!this.ok) return;
    this.noiseHit(this.out(undefined, 0.25), this.ctx!.currentTime, 0.12, 'bandpass', 900, 0.8, 0.6);
  }

  land() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const o = this.out(undefined, 0.35);
    this.noiseHit(o, t, 0.12, 'lowpass', 500, 0.8, 0.8);
    this.tone(o, t, 'sine', 90, 50, 0.1, 0.5);
  }

  /** Arayüz bildirimi: biri katıldı / ayrıldı */
  chime(up: boolean) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const o = this.out(undefined, 0.2);
    this.tone(o, t, 'sine', up ? 660 : 990, up ? 660 : 990, 0.15, 0.5);
    this.tone(o, t + 0.1, 'sine', up ? 990 : 660, up ? 990 : 660, 0.2, 0.5);
  }
}

export const sfx = new Sfx();
