// İstemci: kendi hareketi için tahmin + sunucu düzeltmesi (reconciliation),
// diğer oyuncular için ara değer (interpolation). İsabeti yalnızca sunucu belirler.
import * as THREE from 'three';
import {
  DT, EYE_HEIGHT, INTERP_DELAY_TICKS, MAG_SIZE, TICK_RATE, WEAPON_RANGE,
} from '../shared/constants';
import { MAP_BOXES } from '../shared/map';
import {
  type InputCmd, type MoveState, copyMoveState, eyePos, rayBox, stepPlayer, viewDir,
} from '../shared/physics';
import type { GameEvent, NetPlayer, ServerMsg } from '../shared/protocol';
import type { Connection } from '../net/connection';
import { Hud } from './hud';
import { Input } from './input';
import { TouchControls, isTouchDevice } from './touch';
import { World } from './world';

interface Snap { tick: number; ps: Map<string, NetPlayer> }

export class Game {
  private world: World;
  private input: Input;
  private hud: Hud;
  private touch: TouchControls | null = null;
  private myId: string | null = null;

  // tahmin
  private pred: MoveState | null = null;
  private prevPred: MoveState | null = null;
  private pending: InputCmd[] = [];
  private seq = 0;
  private acc = 0;
  private yaw = 0;
  private pitch = 0;
  private wasAlive = false;

  // ara değer
  private snaps: Snap[] = [];
  private renderTick = 0;
  private latestTick = 0;
  private lastSnapAt = 0;

  private names = new Map<string, NetPlayer>();
  private raf = 0;
  private last = performance.now();
  private pingTimer = 0;
  private running = true;
  onEnd: (reason: string) => void = () => {};

  constructor(private conn: Connection, canvas: HTMLCanvasElement, name: string) {
    const touch = isTouchDevice();
    this.world = new World(canvas, touch);
    this.input = new Input(canvas);
    this.hud = new Hud(conn.info);
    this.input.onLockChange = (l) => this.hud.setLocked(l);
    this.input.onScoreboard = (s) => this.hud.showBoard(s);
    this.hud.onClickToPlay = () => this.input.lock();
    if (touch) {
      // dokunmatikte imleç kilidi yok: kontroller hemen hazır
      this.touch = new TouchControls(this.input, (s) => this.hud.showBoard(s));
      this.hud.setLocked(true);
    }

    conn.onMessage = (m) => this.onMessage(m);
    conn.onClose = (reason) => this.end(reason);
    conn.send({ t: 'join', name });

    window.addEventListener('resize', this.onResize);
    this.pingTimer = window.setInterval(() => conn.send({ t: 'ping', c: performance.now() }), 1000);
    this.raf = requestAnimationFrame(this.frame);

    // Hata ayıklama/otomatik test için: konsoldan durum okunabilir
    (window as unknown as { __yanki: unknown }).__yanki = this;
  }

  private onResize = () => this.world.resize();

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        this.renderTick = m.tick - INTERP_DELAY_TICKS;
        break;
      case 'full':
        this.end('Oda dolu (en fazla 8 oyuncu).');
        break;
      case 'pong':
        this.hud.setPing(performance.now() - m.c, this.conn.info.isHost);
        break;
      case 'snap':
        this.onSnap(m.tick, m.ack, m.ps, m.ev);
        break;
    }
  }

  private onSnap(tick: number, ack: number, ps: NetPlayer[], ev: GameEvent[]) {
    const map = new Map(ps.map((p) => [p.id, p]));
    this.snaps.push({ tick, ps: map });
    while (this.snaps.length > 40) this.snaps.shift();
    if (tick > this.latestTick) { this.latestTick = tick; this.lastSnapAt = performance.now(); }
    for (const p of ps) this.names.set(p.id, p);

    // Ayrılan oyuncuların modellerini kaldır
    for (const id of this.world.avatars.keys()) if (!map.has(id)) this.world.removeAvatar(id);

    const me = this.myId ? map.get(this.myId) : undefined;
    if (me) {
      if (me.alive) {
        const server: MoveState = {
          x: me.x, y: me.y, z: me.z, vx: me.vx, vy: me.vy, vz: me.vz, ground: me.g,
          ammo: me.ammo, fireCd: me.fcd, reload: me.rl,
        };
        if (!this.wasAlive || !this.pred) {
          // ilk doğuş ya da yeniden doğma: sunucunun verdiği yön ve konum
          this.pending = [];
          this.yaw = me.yaw;
          this.pitch = 0;
          this.pred = server;
          this.prevPred = copyMoveState(server);
        } else {
          // Sunucu durumunu al, onaylanmamış komutları yeniden oynat
          this.pending = this.pending.filter((c) => c.seq > ack);
          const before = this.pred;
          const st = server;
          for (const c of this.pending) stepPlayer(st, c, DT, MAP_BOXES);
          // tahmin doğruysa fark ~0; görsel sıçramayı yumuşatmak için önceki kareyi kaydır
          if (this.prevPred) {
            this.prevPred.x += st.x - before.x;
            this.prevPred.y += st.y - before.y;
            this.prevPred.z += st.z - before.z;
          }
          this.pred = st;
        }
      } else {
        this.pending = [];
      }
      this.wasAlive = me.alive;
      this.hud.setSelf(me, this.names);
    }
    this.hud.setBoard(ps, this.myId);

    for (const e of ev) this.onEvent(e);
  }

  private onEvent(e: GameEvent) {
    const name = (id: string) => this.names.get(id)?.name ?? '?';
    const color = (id: string) => this.names.get(id)?.color ?? '#fff';
    switch (e.e) {
      case 'shot':
        if (e.by === this.myId) return; // kendi izimizi zaten tahminle çizdik
        this.lastShotAt.set(e.by, performance.now());
        this.world.tracer(new THREE.Vector3(...e.from), new THREE.Vector3(...e.to), color(e.by), false);
        break;
      case 'dmg':
        if (e.by === this.myId) this.hud.hit(false);
        if (e.victim === this.myId) this.hud.hurt();
        { const a = this.world.avatars.get(e.victim); if (a) a.hitFlash = 1; }
        break;
      case 'kill':
        if (e.by === this.myId) this.hud.hit(true);
        this.hud.feed(name(e.by), color(e.by), name(e.victim), color(e.victim), e.head);
        if (e.victim === this.myId) this.hud.killedBy(name(e.by), color(e.by));
        break;
      case 'join':
        if (e.id !== this.myId) this.hud.notice(`${e.name} odaya katıldı`);
        break;
      case 'leave':
        this.hud.notice(`${e.name} ayrıldı`);
        break;
    }
  }

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    // bakış: fare anında uygulanır (tick'i beklemez)
    const [mx, my] = this.input.takeMouse();
    this.yaw -= mx;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - my));

    // sunucu saatini izle: en son tick'ten INTERP_DELAY kadar geride göster
    if (this.latestTick) {
      const target = this.latestTick + ((now - this.lastSnapAt) / 1000) * TICK_RATE - INTERP_DELAY_TICKS;
      this.renderTick += dt * TICK_RATE;
      const diff = target - this.renderTick;
      if (Math.abs(diff) > 6) this.renderTick = target;
      else this.renderTick += diff * 0.1;
    }

    // sabit adımlı yerel simülasyon
    this.acc += dt;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.localTick();
    }

    this.drawOthers(dt);
    this.drawSelf(dt);
  };

  private localTick() {
    if (!this.pred || !this.wasAlive || !this.myId) return;
    const { f, s } = this.input.axis();
    const k = this.input.keys;
    const cmd: InputCmd = {
      seq: ++this.seq,
      f, s,
      jump: k.has('Space'),
      fire: this.input.fire,
      reload: k.has('KeyR'),
      yaw: this.yaw,
      pitch: this.pitch,
      view: Math.floor(this.renderTick),
    };
    this.prevPred = copyMoveState(this.pred);
    const fired = stepPlayer(this.pred, cmd, DT, MAP_BOXES);
    this.pending.push(cmd);
    if (this.pending.length > 90) this.pending.shift();
    this.conn.send({ t: 'in', cmds: [cmd] });

    if (fired) {
      this.world.muzzle();
      // izi yalnızca haritaya göre çiz; oyuncuya isabeti sunucu söyler
      const o = eyePos(this.pred);
      const d = viewDir(this.yaw, this.pitch);
      let t = WEAPON_RANGE;
      for (const b of MAP_BOXES) t = Math.min(t, rayBox(o, d, b.min, b.max));
      for (const a of this.snaps.length ? this.othersNow() : []) {
        const tb = rayBox(o, d, [a.x - 0.35, a.y, a.z - 0.35], [a.x + 0.35, a.y + 1.8, a.z + 0.35]);
        t = Math.min(t, tb);
      }
      this.world.tracer(
        new THREE.Vector3(...o),
        new THREE.Vector3(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t),
        this.names.get(this.myId)?.color ?? '#fff', true,
      );
    }
  }

  private othersCache: NetPlayer[] = [];
  private othersNow() { return this.othersCache; }

  private drawOthers(dt: number) {
    if (!this.snaps.length) return;
    const rt = this.renderTick;
    let a = this.snaps[0];
    let b = this.snaps[this.snaps.length - 1];
    for (let i = 0; i < this.snaps.length - 1; i++) {
      if (this.snaps[i].tick <= rt && this.snaps[i + 1].tick >= rt) { a = this.snaps[i]; b = this.snaps[i + 1]; break; }
    }
    if (rt >= b.tick) a = b;
    const t = b.tick === a.tick ? 1 : Math.max(0, Math.min(1, (rt - a.tick) / (b.tick - a.tick)));

    this.othersCache = [];
    for (const pb of b.ps.values()) {
      if (pb.id === this.myId) continue;
      const pa = a.ps.get(pb.id) ?? pb;
      // ölüp yeniden doğduysa iki konum arasında kaydırma
      const jump = pa.alive !== pb.alive || Math.hypot(pa.x - pb.x, pa.z - pb.z) > 5;
      const k = jump ? 1 : t;
      const x = pa.x + (pb.x - pa.x) * k;
      const y = pa.y + (pb.y - pa.y) * k;
      const z = pa.z + (pb.z - pa.z) * k;
      const yaw = lerpAngle(pa.yaw, pb.yaw, k);
      const pitch = pa.pitch + (pb.pitch - pa.pitch) * k;
      const alive = k < 0.5 ? pa.alive : pb.alive;
      const av = this.world.avatar(pb.id, pb.name, pb.color);
      av.set(x, y, z, yaw, pitch, alive, pb.hp, dt);
      if (alive) this.othersCache.push({ ...pb, x, y, z });
    }
  }

  private drawSelf(dt: number) {
    const cam = this.world.camera;
    const alpha = this.acc / DT;
    let moving = false;
    if (this.pred && this.prevPred && this.wasAlive) {
      const p = this.pred, q = this.prevPred;
      cam.position.set(
        q.x + (p.x - q.x) * alpha,
        q.y + (p.y - q.y) * alpha + EYE_HEIGHT,
        q.z + (p.z - q.z) * alpha,
      );
      cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      moving = p.ground && Math.hypot(p.vx, p.vz) > 1;
      this.hud.setWeapon(p.ammo, MAG_SIZE, p.reload > 0);
      this.world.setReloading(p.reload > 0);
      this.world.setGunVisible(true);
    } else if (this.pred) {
      // ölüyken: kamera yavaşça yükselip aşağı bakar
      cam.position.y += (this.pred.y + 3.6 - cam.position.y) * Math.min(1, dt * 2);
      cam.rotation.x += (-0.45 - cam.rotation.x) * Math.min(1, dt * 2);
      this.world.setGunVisible(false);
    } else {
      cam.position.set(0, 12, 20);
      cam.lookAt(0, 0, 0);
      this.world.setGunVisible(false);
    }
    this.world.render(dt, moving);

    // mini harita: kendin + son 2 saniyede ateş eden rakipler
    const now = performance.now();
    const blips: { x: number; z: number; color: string }[] = [];
    for (const o of this.othersCache) {
      const t = this.lastShotAt.get(o.id);
      if (t && now - t < 2000) blips.push({ x: o.x, z: o.z, color: o.color });
    }
    this.hud.drawMap(cam.position.x, cam.position.z, this.yaw, blips, this.wasAlive);
    const playerCount = this.snaps[this.snaps.length - 1]?.ps.size ?? 0;
    this.hud.setClock(this.latestTick / TICK_RATE, playerCount < 2);
  }

  private lastShotAt = new Map<string, number>();

  private end(reason: string) {
    if (!this.running) return;
    this.dispose();
    this.onEnd(reason);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.pingTimer);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.touch?.dispose();
    this.hud.hide();
    this.world.dispose();
    this.conn.close();
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

