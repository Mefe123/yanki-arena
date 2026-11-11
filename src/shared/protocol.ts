// Ağ mesajları. Taşıma katmanından bağımsızdır: bugün WebRTC (Trystero),
// yarın WebSocket/geckos.io ile aynı mesajlar gider.
import type { InputCmd } from './physics';

export interface NetPlayer {
  id: string;
  name: string;
  color: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  g: boolean;
  yaw: number; pitch: number;
  hp: number;
  alive: boolean;
  k: number; // öldürme
  d: number; // ölüm
  ammo: number;
  fcd: number;
  rl: number;
  /** yeniden doğmaya kalan süre (s) */
  rs: number;
}

export type GameEvent =
  | { e: 'shot'; by: string; from: [number, number, number]; to: [number, number, number]; hit: string | null; head: boolean }
  | { e: 'kill'; by: string; victim: string; head: boolean }
  | { e: 'dmg'; by: string; victim: string; amount: number }
  | { e: 'join'; id: string; name: string }
  | { e: 'leave'; id: string; name: string };

export type ClientMsg =
  | { t: 'join'; name: string }
  | { t: 'in'; cmds: InputCmd[] }
  | { t: 'ping'; c: number };

export type ServerMsg =
  | { t: 'welcome'; id: string; tick: number }
  | { t: 'full' }
  | { t: 'snap'; tick: number; ack: number; ps: NetPlayer[]; ev: GameEvent[] }
  | { t: 'pong'; c: number };
