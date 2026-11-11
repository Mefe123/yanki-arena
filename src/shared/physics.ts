// Saf, deterministik hareket ve silah adımı. DOM ya da Three.js kullanmaz;
// oda sahibi de istemci tahmini de aynı fonksiyonu çağırır.
import {
  AIR_CONTROL, EYE_HEIGHT, FIRE_INTERVAL, GRAVITY, GROUND_ACCEL, HEAD_SIZE,
  JUMP_SPEED, MAG_SIZE, MOVE_SPEED, PLAYER_HEIGHT, PLAYER_RADIUS, RELOAD_TIME,
} from './constants';
import type { Box } from './map';

/** İstemcinin her tick'te gönderdiği komut */
export interface InputCmd {
  seq: number;
  /** ileri/geri: -1..1 */
  f: number;
  /** sağ/sol: -1..1 */
  s: number;
  jump: boolean;
  fire: boolean;
  reload: boolean;
  yaw: number;
  pitch: number;
  /** İstemcinin ateş ettiği anda ekranda gördüğü sunucu tick'i (gecikme telafisi) */
  view: number;
}

/** Tahmin edilen (istemcinin kendi oyuncusu için) durum */
export interface MoveState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  ground: boolean;
  ammo: number;
  fireCd: number;
  reload: number; // kalan şarjör değiştirme süresi, 0 = değil
}

export function newMoveState(x: number, y: number, z: number): MoveState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, ground: false, ammo: MAG_SIZE, fireCd: 0, reload: 0 };
}

export function copyMoveState(a: MoveState): MoveState {
  return { ...a };
}

function overlaps(x: number, y: number, z: number, b: Box): boolean {
  return (
    x + PLAYER_RADIUS > b.min[0] && x - PLAYER_RADIUS < b.max[0] &&
    y + PLAYER_HEIGHT > b.min[1] && y < b.max[1] &&
    z + PLAYER_RADIUS > b.min[2] && z - PLAYER_RADIUS < b.max[2]
  );
}

const EPS = 1e-4;

/**
 * Bir komutu bir tick boyunca uygular. Ateş edildiyse true döner
 * (isabeti yalnızca sunucu hesaplar; istemci bunu namlu ışığı için kullanır).
 */
export function stepPlayer(p: MoveState, cmd: InputCmd, dt: number, boxes: readonly Box[]): boolean {
  // --- Hareket ---
  const f = clamp(cmd.f, -1, 1);
  const s = clamp(cmd.s, -1, 1);
  const sinY = Math.sin(cmd.yaw);
  const cosY = Math.cos(cmd.yaw);
  // ileri = (-sin, -cos), sağ = (cos, -sin)
  let wx = -sinY * f + cosY * s;
  let wz = -cosY * f - sinY * s;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }
  const tx = wx * MOVE_SPEED;
  const tz = wz * MOVE_SPEED;
  const accel = (p.ground ? GROUND_ACCEL : GROUND_ACCEL * AIR_CONTROL) * dt;
  const k = Math.min(1, accel);
  p.vx += (tx - p.vx) * k;
  p.vz += (tz - p.vz) * k;

  if (cmd.jump && p.ground) {
    p.vy = JUMP_SPEED;
    p.ground = false;
  }
  p.vy -= GRAVITY * dt;

  // Eksen eksen ilerle ve çakışmayı çöz
  p.x += p.vx * dt;
  for (const b of boxes) {
    if (!overlaps(p.x, p.y, p.z, b)) continue;
    if (p.vx > 0) p.x = b.min[0] - PLAYER_RADIUS - EPS;
    else if (p.vx < 0) p.x = b.max[0] + PLAYER_RADIUS + EPS;
    p.vx = 0;
  }
  p.z += p.vz * dt;
  for (const b of boxes) {
    if (!overlaps(p.x, p.y, p.z, b)) continue;
    if (p.vz > 0) p.z = b.min[2] - PLAYER_RADIUS - EPS;
    else if (p.vz < 0) p.z = b.max[2] + PLAYER_RADIUS + EPS;
    p.vz = 0;
  }
  p.y += p.vy * dt;
  p.ground = false;
  for (const b of boxes) {
    if (!overlaps(p.x, p.y, p.z, b)) continue;
    if (p.vy <= 0) {
      p.y = b.max[1];
      p.ground = true;
    } else {
      p.y = b.min[1] - PLAYER_HEIGHT - EPS;
    }
    p.vy = 0;
  }
  // çok küçük hızları sıfırla (denormal sayılardan kaçın)
  if (Math.abs(p.vx) < 1e-4) p.vx = 0;
  if (Math.abs(p.vz) < 1e-4) p.vz = 0;
  // Haritanın dışına düşme güvencesi
  if (p.y < -20) { p.x = 0; p.y = 2; p.z = 0; p.vx = p.vy = p.vz = 0; }

  // --- Silah ---
  p.fireCd = Math.max(0, p.fireCd - dt);
  if (p.reload > 0) {
    p.reload = Math.max(0, p.reload - dt);
    if (p.reload === 0) p.ammo = MAG_SIZE;
    return false;
  }
  if ((cmd.reload && p.ammo < MAG_SIZE) || (cmd.fire && p.ammo === 0)) {
    p.reload = RELOAD_TIME;
    return false;
  }
  if (cmd.fire && p.fireCd === 0 && p.ammo > 0) {
    p.ammo -= 1;
    p.fireCd = FIRE_INTERVAL;
    return true;
  }
  return false;
}

function clamp(v: number, a: number, b: number) {
  return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : 0;
}

/** Bakış yönü birim vektörü */
export function viewDir(yaw: number, pitch: number): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function eyePos(p: { x: number; y: number; z: number }): [number, number, number] {
  return [p.x, p.y + EYE_HEIGHT, p.z];
}

/** Işın - kutu kesişimi (slab yöntemi). Kesişme yoksa Infinity. */
export function rayBox(
  o: readonly number[], d: readonly number[],
  min: readonly number[], max: readonly number[],
): number {
  let t0 = 0;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return Infinity;
      continue;
    }
    const inv = 1 / d[i];
    let a = (min[i] - o[i]) * inv;
    let b = (max[i] - o[i]) * inv;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Oyuncunun gövde ve baş kutuları (isabet testi için) */
export function hitboxes(x: number, y: number, z: number) {
  const r = PLAYER_RADIUS;
  const h = HEAD_SIZE / 2;
  const headY = y + EYE_HEIGHT;
  return {
    body: { min: [x - r, y, z - r], max: [x + r, y + PLAYER_HEIGHT - HEAD_SIZE, z + r] },
    head: { min: [x - h, headY - h, z - h], max: [x + h, headY + h, z + h] },
  };
}
