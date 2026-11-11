// DOM tabanlı oyun arayüzü
import { MAX_HP } from '../shared/constants';
import { ARENA_HALF, MAP_BOXES } from '../shared/map';
import type { NetPlayer } from '../shared/protocol';
import type { Connection } from '../net/connection';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export class Hud {
  private root = $('hud');
  private hpNum = $('hpNum');
  private hpBar = $('hpBar');
  private ammo = $('ammo');
  private mag = $('mag');
  private reloading = $('reloading');
  private board = $('board');
  private boardBody = $('boardBody');
  private dead = $('dead');
  private deadBy = $('deadBy');
  private respawn = $('respawn');
  private feedEl = $('feed');
  private hitmarker = $('hitmarker');
  private vignette = $('vignette');
  private live = $('announce');
  private alertEl = $('alert');
  private ping = $('ping');
  private clock = $('clock');
  private warmup = $('warmup');
  private myK = $('myK');
  private myD = $('myD');
  private map = $<HTMLCanvasElement>('minimap');
  private mapCtx = this.map.getContext('2d')!;
  private mapBase = drawMapBase(this.map.width);
  private lastClock = -1;
  private lastBoard = '';
  private hitTimer = 0;
  private hurtTimer = 0;

  constructor(info: Connection['info']) {
    this.root.hidden = false;
    $('roomCode').textContent = info.code;
    $('role').textContent = info.isHost ? 'Sunucu sensin' : 'Oda sahibine bağlı';
    const copy = $('copyLink');
    copy.onclick = async (e) => {
      e.stopPropagation();
      const url = `${location.origin}${location.pathname}#oda=${info.code}`;
      try { await navigator.clipboard.writeText(url); copy.textContent = 'Kopyalandı'; }
      catch { copy.textContent = url; }
      setTimeout(() => (copy.textContent = 'Bağlantıyı kopyala'), 1800);
    };
  }

  /** Ekran okuyucuya kibarca duyur (sıradaki konuşmayı kesmez) */
  announce(text: string) {
    this.live.textContent = '';
    setTimeout(() => (this.live.textContent = text), 30);
  }

  /** Acil duyuru (ör. elendin) */
  alert(text: string) {
    this.alertEl.textContent = '';
    setTimeout(() => (this.alertEl.textContent = text), 30);
  }

  setPing(ms: number, isHost: boolean) {
    this.ping.textContent = isHost ? 'gecikme yok' : `${Math.round(ms)} ms`;
  }

  setSelf(me: NetPlayer, _names: Map<string, NetPlayer>) {
    const hp = Math.max(0, me.hp);
    this.hpNum.textContent = String(hp);
    this.hpBar.style.transform = `scaleX(${hp / MAX_HP})`;
    this.hpBar.classList.toggle('low', hp <= 35);
    this.dead.hidden = me.alive;
    this.myK.textContent = String(me.k);
    this.myD.textContent = String(me.d);
    if (!me.alive) this.respawn.textContent = String(Math.max(1, Math.ceil(me.rs)));
  }

  setWeapon(ammo: number, mag: number, reloading: boolean) {
    this.ammo.textContent = String(ammo);
    this.mag.textContent = String(mag);
    this.ammo.classList.toggle('empty', ammo === 0);
    this.reloading.hidden = !reloading;
  }

  setBoard(ps: NetPlayer[], myId: string | null) {
    const rows = [...ps].sort((a, b) => b.k - a.k || a.d - b.d);
    const html = rows.map((p) =>
      `<tr class="${p.id === myId ? 'me' : ''}"><td><i style="background:${p.color}"></i>${esc(p.name)}</td><td>${p.k}</td><td>${p.d}</td></tr>`,
    ).join('');
    if (html !== this.lastBoard) { this.boardBody.innerHTML = html; this.lastBoard = html; }
  }

  setClock(seconds: number, warmup: boolean) {
    const sec = Math.floor(seconds);
    if (sec !== this.lastClock) {
      this.lastClock = sec;
      this.clock.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    }
    this.warmup.hidden = !warmup;
  }

  /** Kuzey yukarıda; oyuncu ok, ateş eden rakipler kısa süre nokta olarak görünür */
  drawMap(x: number, z: number, yaw: number, blips: { x: number; z: number; color: string }[], alive: boolean) {
    const g = this.mapCtx;
    const S = this.map.width;
    const k = S / (ARENA_HALF * 2 + 2);
    const px = (v: number) => (v + ARENA_HALF + 1) * k;
    g.clearRect(0, 0, S, S);
    g.drawImage(this.mapBase, 0, 0);
    for (const b of blips) {
      g.fillStyle = '#ff3b3b';
      g.beginPath(); g.arc(px(b.x), px(b.z), 9, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    }
    if (!alive) return;
    g.save();
    g.translate(px(x), px(z));
    g.rotate(-yaw);
    // görüş konisi
    const cone = g.createRadialGradient(0, 0, 0, 0, 0, 90);
    cone.addColorStop(0, 'rgba(255,255,255,0.45)');
    cone.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cone;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 90, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); g.closePath(); g.fill();
    g.fillStyle = '#ffd23a';
    g.strokeStyle = '#1b1406';
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, -14); g.lineTo(10, 10); g.lineTo(0, 5); g.lineTo(-10, 10); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  showBoard(s: boolean) { this.board.hidden = !s; }

  hit(kill: boolean) {
    this.hitmarker.classList.remove('on', 'kill');
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('on');
    if (kill) this.hitmarker.classList.add('kill');
    clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => this.hitmarker.classList.remove('on', 'kill'), 220);
  }

  hurt() {
    this.vignette.classList.add('on');
    clearTimeout(this.hurtTimer);
    this.hurtTimer = window.setTimeout(() => this.vignette.classList.remove('on'), 260);
  }

  killedBy(name: string, color: string) {
    this.deadBy.innerHTML = `<b style="color:${color}">${esc(name)}</b> seni vurdu`;
  }

  feed(by: string, byColor: string, victim: string, vColor: string, head: boolean) {
    const li = document.createElement('li');
    li.innerHTML = `<b style="color:${byColor}">${esc(by)}</b><span>${head ? '◎' : '›'}</span><b style="color:${vColor}">${esc(victim)}</b>`;
    this.push(li);
  }

  notice(text: string) {
    const li = document.createElement('li');
    li.className = 'notice';
    li.textContent = text;
    this.push(li);
  }

  private push(li: HTMLLIElement) {
    this.feedEl.prepend(li);
    while (this.feedEl.children.length > 5) this.feedEl.lastElementChild?.remove();
    setTimeout(() => li.classList.add('out'), 4500);
    setTimeout(() => li.remove(), 5000);
  }

  hide() {
    this.root.hidden = true;
    this.feedEl.innerHTML = '';
    this.board.hidden = true;
  }
}

function drawMapBase(S: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const k = S / (ARENA_HALF * 2 + 2);
  const px = (v: number) => (v + ARENA_HALF + 1) * k;
  g.fillStyle = 'rgba(22,28,38,0.82)';
  g.fillRect(0, 0, S, S);
  const fill: Record<string, string> = {
    wall: '#8a97a8', building: '#5d6b80', lowwall: '#7f8ea3', crate: '#9a8466', pillar: '#a9b6c6', block: '#4c5a6e',
  };
  const order = ['block', 'building', 'wall', 'lowwall', 'crate', 'pillar'];
  for (const kind of order) {
    for (const b of MAP_BOXES) {
      if (b.kind !== kind || b.min[1] > 3) continue;
      g.fillStyle = fill[kind];
      g.fillRect(px(b.min[0]), px(b.min[2]), (b.max[0] - b.min[0]) * k, (b.max[2] - b.min[2]) * k);
    }
  }
  return c;
}
