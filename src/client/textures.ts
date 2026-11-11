// Kodla üretilen dokular (dış dosya yok, telif sorunu yok).
import * as THREE from 'three';

function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function toTex(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function noise(g: CanvasRenderingContext2D, size: number, r: () => number, n: number, light: number, dark: number, max = 30) {
  for (let i = 0; i < n; i++) {
    const w = 2 + r() * max;
    g.fillStyle = r() < 0.5 ? `rgba(255,250,235,${r() * light})` : `rgba(70,40,10,${r() * dark})`;
    g.fillRect(r() * size, r() * size, w, w * (0.4 + r()));
  }
}

function hsl(h: number, s: number, l: number) {
  return `hsl(${h},${s}%,${l}%)`;
}

export function sandTexture() {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(11);
  g.fillStyle = '#e2c99a';
  g.fillRect(0, 0, S, S);
  noise(g, S, r, 2200, 0.08, 0.06, 6);
  // rüzgâr dalgaları
  g.strokeStyle = 'rgba(150,110,60,0.07)';
  g.lineWidth = 3;
  for (let y = 0; y < S; y += 14 + r() * 10) {
    g.beginPath();
    for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + y) * 5);
    g.stroke();
  }
  // çakıllar
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(${120 + r() * 60},${90 + r() * 40},${60 + r() * 30},0.5)`;
    g.beginPath();
    g.arc(r() * S, r() * S, 1 + r() * 2.2, 0, Math.PI * 2);
    g.fill();
  }
  return toTex(c);
}

/** Kumtaşı tuğla: sur ve alçak duvarlar */
export function brickTexture(seed = 3, hue = 32) {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(seed);
  g.fillStyle = hsl(hue, 35, 52);
  g.fillRect(0, 0, S, S);
  const rows = 8;
  const bh = S / rows;
  for (let row = 0; row < rows; row++) {
    const cols = 4;
    const bw = S / cols;
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < cols; col++) {
      const x = col * bw + off;
      const y = row * bh;
      g.fillStyle = hsl(hue + (r() - 0.5) * 8, 38 + r() * 14, 58 + (r() - 0.5) * 14);
      g.fillRect(x + 3, y + 3, bw - 6, bh - 6);
      // tuğla yüzeyi: aşınma
      for (let k = 0; k < 18; k++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,240,210,0.12)' : 'rgba(90,50,20,0.1)';
        g.fillRect(x + 3 + r() * (bw - 10), y + 3 + r() * (bh - 10), 3 + r() * 14, 2 + r() * 6);
      }
      g.fillStyle = 'rgba(255,240,210,0.18)';
      g.fillRect(x + 3, y + 3, bw - 6, 3);
      g.fillStyle = 'rgba(60,30,10,0.18)';
      g.fillRect(x + 3, y + bh - 6, bw - 6, 3);
    }
  }
  return toTex(c);
}

/** Sıvalı bina duvarı */
export function plasterTexture(seed = 5) {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(seed);
  g.fillStyle = '#d8b989';
  g.fillRect(0, 0, S, S);
  noise(g, S, r, 900, 0.07, 0.07, 40);
  // lekeler ve aşağıya doğru koyulaşan kir
  for (let p = 0; p < 5; p++) {
    const px = r() * S, py = r() * S;
    const gr = g.createRadialGradient(px, py, 0, px, py, 60 + r() * 80);
    gr.addColorStop(0, 'rgba(150,105,60,0.22)');
    gr.addColorStop(1, 'rgba(150,105,60,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  // çatlaklar
  g.strokeStyle = 'rgba(90,60,30,0.35)';
  g.lineWidth = 1.2;
  for (let k = 0; k < 6; k++) {
    let x = r() * S, y = r() * S;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += (r() - 0.5) * 30; y += r() * 18; g.lineTo(x, y); }
    g.stroke();
  }
  return toTex(c);
}

/** Büyük kesme taş: set, kiriş, sütun */
export function stoneTexture(seed = 9) {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(seed);
  g.fillStyle = '#cdb58a';
  g.fillRect(0, 0, S, S);
  const rows = 4;
  for (let row = 0; row < rows; row++) {
    const y = (row * S) / rows;
    let x = row % 2 ? -S / 4 : 0;
    while (x < S) {
      const w = S / 2 + (r() - 0.5) * 80;
      g.fillStyle = hsl(38 + (r() - 0.5) * 6, 32 + r() * 10, 64 + (r() - 0.5) * 10);
      g.fillRect(x + 3, y + 3, w - 6, S / rows - 6);
      x += w;
    }
  }
  noise(g, S, r, 1200, 0.08, 0.08, 10);
  return toTex(c);
}

/** Tahta sandık: çerçeve ve çapraz destek */
export function crateTexture() {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(21);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = hsl(28 + (r() - 0.5) * 6, 42 + r() * 10, 38 + r() * 10);
    g.fillRect(0, (i * S) / 6, S, S / 6);
    g.fillStyle = 'rgba(40,20,5,0.4)';
    g.fillRect(0, (i * S) / 6, S, 2);
  }
  // damar
  g.strokeStyle = 'rgba(60,30,10,0.18)';
  for (let k = 0; k < 40; k++) {
    const y = r() * S;
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(S / 3, y + (r() - 0.5) * 8, (2 * S) / 3, y + (r() - 0.5) * 8, S, y); g.stroke();
  }
  const frame = hsl(26, 45, 30);
  g.fillStyle = frame;
  const f = 26;
  g.fillRect(0, 0, S, f); g.fillRect(0, S - f, S, f); g.fillRect(0, 0, f, S); g.fillRect(S - f, 0, f, S);
  g.save();
  g.translate(S / 2, S / 2);
  g.rotate(Math.PI / 4);
  g.fillRect(-S * 0.7, -f / 2, S * 1.4, f);
  g.restore();
  // çiviler
  g.fillStyle = '#3a2a1a';
  for (const [x, y] of [[13, 13], [S - 13, 13], [13, S - 13], [S - 13, S - 13]]) { g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
  return toTex(c, false);
}

export function awningTexture(a: string, b: string) {
  const [c, g] = canvas(128);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? a : b;
    g.fillRect((i * 128) / 8, 0, 128 / 8, 128);
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 110, 128, 18);
  return toTex(c);
}

export function barkTexture() {
  const [c, g] = canvas(128);
  const r = rng(31);
  g.fillStyle = '#7a5a3a';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 10) {
    g.fillStyle = `rgba(40,25,10,${0.3 + r() * 0.3})`;
    g.fillRect(0, y, 128, 3);
    g.fillStyle = 'rgba(200,170,120,0.15)';
    g.fillRect(0, y + 4, 128, 2);
  }
  return toTex(c);
}

/** Palmiye yaprağı: saydam arka planlı tüy biçimi */
export function frondTexture() {
  const W = 128, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(41);
  g.strokeStyle = '#4d6a2a';
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
  for (let y = 10; y < H - 6; y += 7) {
    const t = y / H;
    const len = (W / 2 - 4) * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (0.85 + r() * 0.15);
    const col = hsl(85 + r() * 15, 45 + r() * 15, 28 + r() * 14);
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(W / 2, y); g.lineTo(W / 2 - len, y + 16 + t * 10); g.stroke();
    g.beginPath(); g.moveTo(W / 2, y); g.lineTo(W / 2 + len, y + 16 + t * 10); g.stroke();
  }
  return toTex(c, false);
}

export function clayTexture() {
  const [c, g] = canvas(128);
  const r = rng(51);
  g.fillStyle = '#b5683e';
  g.fillRect(0, 0, 128, 128);
  noise(g, 128, r, 200, 0.1, 0.1, 6);
  g.fillStyle = 'rgba(70,30,10,0.35)';
  g.fillRect(0, 40, 128, 4);
  g.fillRect(0, 52, 128, 2);
  return toTex(c);
}
