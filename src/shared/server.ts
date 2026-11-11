// Otoriter oyun sunucusu. Bugün oda sahibinin tarayıcısında çalışır;
// DOM, Three.js ya da WebRTC'ye bağlı değildir, bu yüzden olduğu gibi
// bir Node sürecine (Colyseus odası, geckos.io kanalı, düz ws) taşınabilir.
//
// Kullanım: new GameServer(transport) → addPlayer / removePlayer / onMessage,
// dışarıdan saniyede TICK_RATE kez tick() çağrılır.
import {
  DAMAGE, DT, HEADSHOT_MULT, MAX_HP, MAX_PLAYERS, MAX_REWIND_TICKS,
  PLAYER_COLORS, RESPAWN_TIME, WEAPON_RANGE,
} from './constants';
import { MAP_BOXES, SPAWN_POINTS } from './map';
import {
  type InputCmd, type MoveState, eyePos, hitboxes, newMoveState, rayBox, stepPlayer, viewDir,
} from './physics';
import type { ClientMsg, GameEvent, NetPlayer, ServerMsg } from './protocol';

export interface ServerTransport {
  send(clientId: string, msg: ServerMsg): void;
}

interface ServerPlayer {
  id: string;
  name: string;
  color: string;
  st: MoveState;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  respawnIn: number;
  kills: number;
  deaths: number;
  lastSeq: number;
  queue: InputCmd[];
}

interface HistoryFrame {
  tick: number;
  pos: Map<string, { x: number; y: number; z: number; alive: boolean }>;
}

const MAX_QUEUE = 8;
// Tick başına en fazla işlenecek komut: istemci kısa bir takılmadan sonra
// yetişebilsin ama hız hilesi yapamasın.
const MAX_CMDS_PER_TICK = 3;

export class GameServer {
  tick = 0;
  private players = new Map<string, ServerPlayer>();
  private history: HistoryFrame[] = [];
  private events: GameEvent[] = [];

  constructor(private transport: ServerTransport) {}

  get playerCount() { return this.players.size; }

  onMessage(id: string, msg: ClientMsg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'join':
        this.addPlayer(id, String(msg.name ?? 'Oyuncu'));
        break;
      case 'in': {
        const p = this.players.get(id);
        if (!p || !Array.isArray(msg.cmds)) return;
        for (const c of msg.cmds) {
          if (typeof c?.seq !== 'number' || c.seq <= p.lastSeq) continue;
          if (p.queue.length && c.seq <= p.queue[p.queue.length - 1].seq) continue;
          p.queue.push(c);
        }
        // Çok birikirse en eskileri at (bağlantı takıldıysa)
        if (p.queue.length > MAX_QUEUE) {
          const drop = p.queue.splice(0, p.queue.length - MAX_QUEUE);
          p.lastSeq = drop[drop.length - 1].seq;
        }
        break;
      }
      case 'ping':
        this.transport.send(id, { t: 'pong', c: msg.c });
        break;
    }
  }

  addPlayer(id: string, rawName: string) {
    if (this.players.has(id)) return;
    if (this.players.size >= MAX_PLAYERS) {
      this.transport.send(id, { t: 'full' });
      return;
    }
    const name = rawName.replace(/[<>]/g, '').trim().slice(0, 16) || 'Oyuncu';
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
    const [x, y, z] = this.pickSpawn();
    const p: ServerPlayer = {
      id, name, color,
      st: newMoveState(x, y, z),
      yaw: Math.atan2(x, z), // merkeze bak
      pitch: 0,
      hp: MAX_HP, alive: true, respawnIn: 0,
      kills: 0, deaths: 0, lastSeq: 0, queue: [],
    };
    this.players.set(id, p);
    this.events.push({ e: 'join', id, name });
    this.transport.send(id, { t: 'welcome', id, tick: this.tick });
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.events.push({ e: 'leave', id, name: p.name });
  }

  /** Bir simülasyon adımı + herkese durum yayını */
  tickOnce() {
    this.tick++;

    for (const p of this.players.values()) {
      if (!p.alive) {
        p.queue.length = 0;
        p.respawnIn -= DT;
        if (p.respawnIn <= 0) this.respawn(p);
        continue;
      }
      const n = Math.min(p.queue.length, MAX_CMDS_PER_TICK);
      for (let i = 0; i < n; i++) {
        const cmd = p.queue.shift()!;
        p.lastSeq = cmd.seq;
        p.yaw = Number.isFinite(cmd.yaw) ? cmd.yaw : p.yaw;
        p.pitch = Number.isFinite(cmd.pitch) ? Math.max(-1.55, Math.min(1.55, cmd.pitch)) : p.pitch;
        const fired = stepPlayer(p.st, { ...cmd, yaw: p.yaw, pitch: p.pitch }, DT, MAP_BOXES);
        if (fired) this.fire(p, cmd.view);
        if (!p.alive) break; // (kendini vuramaz ama ileride hasar alanları olursa)
      }
    }

    this.recordHistory();
    this.broadcast();
  }

  private recordHistory() {
    const pos = new Map<string, { x: number; y: number; z: number; alive: boolean }>();
    for (const p of this.players.values()) pos.set(p.id, { x: p.st.x, y: p.st.y, z: p.st.z, alive: p.alive });
    this.history.push({ tick: this.tick, pos });
    while (this.history.length > MAX_REWIND_TICKS + 2) this.history.shift();
  }

  /** Gecikme telafili anlık isabet: atıcının gördüğü ana geri sarılır */
  private fire(shooter: ServerPlayer, viewTick: number) {
    const target = Math.max(this.tick - MAX_REWIND_TICKS, Math.min(this.tick, Math.floor(viewTick) || this.tick));
    const frame = this.history.find((h) => h.tick === target) ?? this.history[this.history.length - 1];

    const o = eyePos(shooter.st);
    const d = viewDir(shooter.yaw, shooter.pitch);

    let best = WEAPON_RANGE;
    for (const b of MAP_BOXES) {
      const t = rayBox(o, d, b.min, b.max);
      if (t < best) best = t;
    }
    let hit: ServerPlayer | null = null;
    let head = false;
    for (const p of this.players.values()) {
      if (p === shooter || !p.alive) continue;
      const past = frame?.pos.get(p.id);
      if (past && !past.alive) continue;
      const pp = past ?? p.st;
      const hb = hitboxes(pp.x, pp.y, pp.z);
      const th = rayBox(o, d, hb.head.min, hb.head.max);
      const tb = rayBox(o, d, hb.body.min, hb.body.max);
      const t = Math.min(th, tb);
      if (t < best) { best = t; hit = p; head = th <= tb; }
    }

    const to: [number, number, number] = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
    this.events.push({ e: 'shot', by: shooter.id, from: round3(o), to: round3(to), hit: hit?.id ?? null, head });

    if (hit) {
      const amount = head ? DAMAGE * HEADSHOT_MULT : DAMAGE;
      hit.hp -= amount;
      this.events.push({ e: 'dmg', by: shooter.id, victim: hit.id, amount });
      if (hit.hp <= 0) {
        hit.hp = 0;
        hit.alive = false;
        hit.respawnIn = RESPAWN_TIME;
        hit.deaths++;
        shooter.kills++;
        this.events.push({ e: 'kill', by: shooter.id, victim: hit.id, head });
      }
    }
  }

  private respawn(p: ServerPlayer) {
    const [x, y, z] = this.pickSpawn(p.id);
    p.st = newMoveState(x, y, z);
    p.yaw = Math.atan2(x, z);
    p.pitch = 0;
    p.hp = MAX_HP;
    p.alive = true;
    p.respawnIn = 0;
  }

  /** Canlı rakiplere en uzak doğma noktası */
  private pickSpawn(exceptId?: string): [number, number, number] {
    const others = [...this.players.values()].filter((p) => p.alive && p.id !== exceptId);
    if (!others.length) return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    let best = SPAWN_POINTS[0];
    let bestD = -1;
    for (const s of SPAWN_POINTS) {
      const d = Math.min(...others.map((o) => Math.hypot(o.st.x - s[0], o.st.z - s[2])));
      const score = d + Math.random() * 4; // hep aynı noktaya düşmesin
      if (score > bestD) { bestD = score; best = s; }
    }
    return best;
  }

  private broadcast() {
    const ps: NetPlayer[] = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color,
      x: p.st.x, y: p.st.y, z: p.st.z,
      vx: p.st.vx, vy: p.st.vy, vz: p.st.vz, g: p.st.ground,
      yaw: p.yaw, pitch: p.pitch,
      hp: p.hp, alive: p.alive, k: p.kills, d: p.deaths,
      ammo: p.st.ammo, fcd: p.st.fireCd, rl: p.st.reload,
      rs: Math.max(0, p.respawnIn),
    }));
    const ev = this.events;
    this.events = [];
    for (const p of this.players.values()) {
      this.transport.send(p.id, { t: 'snap', tick: this.tick, ack: p.lastSeq, ps, ev });
    }
  }
}

function round3(v: number[]): [number, number, number] {
  return [Math.round(v[0] * 1000) / 1000, Math.round(v[1] * 1000) / 1000, Math.round(v[2] * 1000) / 1000];
}
