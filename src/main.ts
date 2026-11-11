import './style.css';
import { Game } from './client/game';
import { hostGame, joinGame, makeRoomCode, normalizeCode } from './net/p2p';
import type { Connection } from './net/connection';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const lobby = $('lobby');
const ended = $('ended');
const nameInput = $<HTMLInputElement>('name');
const codeInput = $<HTMLInputElement>('code');
const status = $('status');
const hostBtn = $<HTMLButtonElement>('host');
const joinBtn = $<HTMLButtonElement>('joinBtn');
const canvas = $<HTMLCanvasElement>('view');

nameInput.value = localStorage.getItem('yanki-ad') ?? '';
const hashCode = new URLSearchParams(location.hash.slice(1)).get('oda');
if (hashCode) {
  codeInput.value = normalizeCode(hashCode);
  status.textContent = 'Davet bağlantısıyla geldin. Adını yaz ve "Odaya katıl"a bas.';
  joinBtn.classList.add('primary');
  hostBtn.classList.remove('primary');
}

function playerName() {
  const n = nameInput.value.trim() || `Oyuncu${Math.floor(Math.random() * 900 + 100)}`;
  localStorage.setItem('yanki-ad', n);
  return n;
}

function busy(b: boolean) {
  hostBtn.disabled = joinBtn.disabled = b;
}

let game: Game | null = null;

function start(conn: Connection, name: string) {
  lobby.hidden = true;
  ended.hidden = true;
  history.replaceState(null, '', `#oda=${conn.info.code}`);
  document.body.classList.add('in-game');
  game = new Game(conn, canvas, name);
  game.onEnd = (reason) => {
    game = null;
    document.body.classList.remove('in-game');
    $('endedMsg').textContent = reason;
    ended.hidden = false;
  };
}

hostBtn.onclick = () => {
  const code = makeRoomCode();
  const conn = hostGame(code);
  start(conn, playerName());
};

async function join() {
  const code = normalizeCode(codeInput.value);
  if (code.length < 4) {
    status.textContent = 'Oda kodunu yaz (ör. K7QXM) ya da davet bağlantısını aç.';
    codeInput.focus();
    return;
  }
  busy(true);
  status.textContent = `${code} odasının sahibi aranıyor… (birkaç saniye sürebilir)`;
  try {
    const conn = await joinGame(code);
    status.textContent = '';
    start(conn, playerName());
  } catch (e) {
    status.textContent = (e as Error).message;
  } finally {
    busy(false);
  }
}
joinBtn.onclick = join;
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
codeInput.addEventListener('input', () => { codeInput.value = normalizeCode(codeInput.value); });

$('backBtn').onclick = () => {
  ended.hidden = true;
  lobby.hidden = false;
  history.replaceState(null, '', location.pathname);
  status.textContent = '';
};

window.addEventListener('beforeunload', () => game?.dispose());
