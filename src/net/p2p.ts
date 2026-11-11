// P2P taşıma: Trystero (Nostr röleleri üzerinden sinyal, sonra doğrudan WebRTC).
// Oda sahibi GameServer'ı kendi tarayıcısında çalıştırır; diğerleri ona bağlanır.
// Gerçek bir sunucuya geçerken yalnızca bu dosyanın yerine WebSocket istemcisi yazılır.
import { joinRoom, selfId, type Room } from 'trystero';
import { DT } from '../shared/constants';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { GameServer } from '../shared/server';
import type { Connection } from './connection';

const APP_ID = 'yanki-arena-fps-v1';
const PROTO = 1;
const FIND_HOST_TIMEOUT_MS = 25000;
const SILENCE_TIMEOUT_MS = 8000;

interface Hello { host: true; proto: number }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode(): string {
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(5));
  for (const b of r) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
}
export function normalizeCode(c: string) {
  return c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function openRoom(code: string): Room {
  return joinRoom({ appId: APP_ID }, `oda-${code}`);
}

/**
 * Sekme arka plana geçince setInterval saniyede bire düşer; oda sahibinin
 * simülasyonu durmasın diye zamanlayıcı bir Worker'da çalışır.
 */
function startTicker(onTick: () => void): () => void {
  const src = `let id=setInterval(()=>postMessage(0),${Math.round((DT * 1000) / 2)});onmessage=()=>clearInterval(id);`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const worker = new Worker(url);
  let last = performance.now();
  let acc = 0;
  worker.onmessage = () => {
    const now = performance.now();
    acc += (now - last) / 1000;
    last = now;
    let n = 0;
    while (acc >= DT && n < 5) { acc -= DT; n++; onTick(); }
    if (acc > DT * 5) acc = 0; // uzun takılmadan sonra yetişmeye çalışma
  };
  return () => { worker.postMessage(0); worker.terminate(); URL.revokeObjectURL(url); };
}

/** Oda aç: bu tarayıcı sunucu olur. */
export function hostGame(code: string): Connection {
  const room = openRoom(code);
  const toClient = room.makeAction<any>('s');
  const fromClient = room.makeAction<any>('c');
  const hello = room.makeAction<any>('h');

  let closed = false;
  const conn: Connection = {
    selfId,
    send: (msg: ClientMsg) => queueMicrotask(() => !closed && server.onMessage(selfId, msg)),
    onMessage: () => {},
    onClose: () => {},
    close: () => {
      if (closed) return;
      closed = true;
      stopTicker();
      room.leave();
    },
    info: { code, isHost: true, peers: () => server.playerCount },
  };

  const server = new GameServer({
    send(id: string, msg: ServerMsg) {
      if (closed) return;
      if (id === selfId) conn.onMessage(msg);
      else toClient.send(msg, { target: id });
    },
  });

  room.onPeerJoin = (peerId) => {
    const h: Hello = { host: true, proto: PROTO };
    hello.send(h, { target: peerId });
  };
  room.onPeerLeave = (peerId) => server.removePlayer(peerId);
  fromClient.onMessage = (data, ctx) => server.onMessage(ctx.peerId, data as ClientMsg);

  const stopTicker = startTicker(() => server.tickOnce());
  return conn;
}

/** Odaya katıl: oda sahibini bulana kadar bekler. */
export function joinGame(code: string, signal?: AbortSignal): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const room = openRoom(code);
    const toServer = room.makeAction<any>('c');
    const fromServer = room.makeAction<any>('s');
    const hello = room.makeAction<any>('h');

    let hostId: string | null = null;
    let closed = false;
    let lastMsg = performance.now();
    let watchdog = 0;

    const conn: Connection = {
      selfId,
      send: (msg: ClientMsg) => { if (!closed && hostId) toServer.send(msg, { target: hostId }); },
      onMessage: () => {},
      onClose: () => {},
      close: () => {
        if (closed) return;
        closed = true;
        clearInterval(watchdog);
        room.leave();
      },
      info: { code, isHost: false, peers: () => Object.keys(room.getPeers()).length },
    };

    signal?.addEventListener('abort', () => {
      if (hostId) return;
      clearTimeout(timeout);
      conn.close();
      reject(new Error('Arama iptal edildi.'));
    });

    const fail = (reason: string) => {
      if (closed) return;
      conn.close();
      conn.onClose(reason);
    };

    const timeout = setTimeout(() => {
      if (hostId) return;
      conn.close();
      reject(new Error('Bu kodla açık bir oda bulunamadı. Kodu kontrol edin ya da oda sahibinden yeni bağlantı isteyin.'));
    }, FIND_HOST_TIMEOUT_MS);

    hello.onMessage = (data, ctx) => {
      const h = data as Hello;
      if (hostId || !h?.host) return;
      if (h.proto !== PROTO) {
        clearTimeout(timeout);
        conn.close();
        reject(new Error('Oda sahibi oyunun farklı bir sürümünü kullanıyor. Sayfayı yenileyip tekrar deneyin.'));
        return;
      }
      hostId = ctx.peerId;
      clearTimeout(timeout);
      lastMsg = performance.now();
      watchdog = window.setInterval(() => {
        if (performance.now() - lastMsg > SILENCE_TIMEOUT_MS) {
          fail('Oda sahibiyle bağlantı koptu. Oda sahibinin interneti gitmiş ya da sekmesi kapanmış olabilir.');
        }
      }, 1000);
      resolve(conn);
    };

    fromServer.onMessage = (data, ctx) => {
      if (ctx.peerId !== hostId || closed) return;
      lastMsg = performance.now();
      conn.onMessage(data as ServerMsg);
    };

    room.onPeerLeave = (peerId) => {
      if (peerId === hostId) fail('Oda sahibi oyundan ayrıldı, oda kapandı.');
    };
  });
}
