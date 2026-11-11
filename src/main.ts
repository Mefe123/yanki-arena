import './style.css';
import { Game } from './client/game';
import { sfx } from './client/audio';
import { hostGame, joinGame, makeRoomCode, normalizeCode } from './net/p2p';
import type { Connection } from './net/connection';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const lobby = $('lobby');
const ended = $('ended');
const nameInput = $<HTMLInputElement>('name');
const codeInput = $<HTMLInputElement>('code');
const status = $('status');
const spinner = $('spinner');
const cancelBtn = $<HTMLButtonElement>('cancelJoin');
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
// İlk odak: ad boşsa ada, değilse ana eyleme
(nameInput.value ? (hashCode ? joinBtn : hostBtn) : nameInput).focus({ preventScroll: true });

// Tarayıcılar sesi ancak bir kullanıcı etkileşiminden sonra açar
window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
window.addEventListener('keydown', () => sfx.unlock(), { capture: true });

function playerName() {
  const n = nameInput.value.trim() || `Oyuncu${Math.floor(Math.random() * 900 + 100)}`;
  localStorage.setItem('yanki-ad', n);
  return n;
}

let joinAbort: AbortController | null = null;
let joinTimer = 0;

function busy(b: boolean) {
  hostBtn.disabled = joinBtn.disabled = b;
  spinner.hidden = !b;
  cancelBtn.hidden = !b;
  lobby.setAttribute('aria-busy', String(b));
  clearInterval(joinTimer);
  if (!b) $('elapsed').textContent = '';
}

let game: Game | null = null;

function backToLobby(message = '') {
  ended.hidden = true;
  lobby.hidden = false;
  history.replaceState(null, '', location.pathname + (codeInput.value ? `#oda=${codeInput.value}` : ''));
  status.textContent = message;
  hostBtn.focus();
}

function start(conn: Connection, name: string) {
  lobby.hidden = true;
  ended.hidden = true;
  history.replaceState(null, '', `#oda=${conn.info.code}`);
  document.body.classList.add('in-game');
  game = new Game(conn, canvas, name);
  game.onEnd = (reason) => {
    game = null;
    document.body.classList.remove('in-game');
    if (document.pointerLockElement) document.exitPointerLock();
    if (reason === null) {
      codeInput.value = '';
      backToLobby('Odadan çıktın.');
      return;
    }
    $('endedMsg').textContent = reason;
    ended.hidden = false;
    $('backBtn').focus();
  };
}

hostBtn.onclick = () => {
  sfx.unlock();
  const code = makeRoomCode();
  const conn = hostGame(code);
  start(conn, playerName());
};

async function join() {
  sfx.unlock();
  const code = normalizeCode(codeInput.value);
  if (code.length < 4) {
    status.textContent = 'Oda kodunu yaz (ör. K7QXM) ya da davet bağlantısını aç.';
    codeInput.setAttribute('aria-invalid', 'true');
    codeInput.focus();
    return;
  }
  codeInput.removeAttribute('aria-invalid');
  busy(true);
  const t0 = performance.now();
  // duyurulan metin bir kez yazılır; geçen süre ekran okuyucuya okunmaz
  status.textContent = `${code} odasının sahibi aranıyor…`;
  const elapsed = $('elapsed');
  elapsed.textContent = '';
  joinTimer = window.setInterval(() => {
    elapsed.textContent = `${Math.round((performance.now() - t0) / 1000)} sn`;
  }, 1000);
  joinAbort = new AbortController();
  cancelBtn.focus();
  try {
    const conn = await joinGame(code, joinAbort.signal);
    busy(false);
    status.textContent = '';
    start(conn, playerName());
  } catch (e) {
    busy(false);
    status.textContent = (e as Error).message;
    joinBtn.focus();
  } finally {
    joinAbort = null;
  }
}
joinBtn.onclick = join;
cancelBtn.onclick = () => joinAbort?.abort();
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
codeInput.addEventListener('input', () => {
  codeInput.value = normalizeCode(codeInput.value);
  codeInput.removeAttribute('aria-invalid');
});
// Ad alanında Enter: kod yazılıysa katıl, değilse oda aç düğmesine geç
nameInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (codeInput.value) join();
  else hostBtn.focus();
});

$('backBtn').onclick = () => backToLobby();

window.addEventListener('beforeunload', () => game?.dispose());
