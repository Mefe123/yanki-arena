// Klavye + fare. Fare bakışı yalnızca imleç kilitliyken çalışır.
import { settings } from './settings';
export class Input {
  keys = new Set<string>();
  fire = false;
  private dx = 0;
  private dy = 0;
  private readonly baseSens = 0.0022;
  /** Menü açıkken oyun girdisi alınmaz (Tab vb. menüde gezinmek için serbest kalır) */
  suspended = false;
  onMute: () => void = () => {};
  onEscape: () => void = () => {};
  /** Dokunmatik sanal çubuk (varsa klavyenin yerine geçer) */
  stick: { f: number; s: number } | null = null;
  onLockChange: (locked: boolean) => void = () => {};
  onScoreboard: (show: boolean) => void = () => {};

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.clear);
    document.addEventListener('mousemove', this.move);
    el.addEventListener('mousedown', this.mdown);
    window.addEventListener('mouseup', this.mup);
    document.addEventListener('pointerlockchange', this.lockChange);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked() { return document.pointerLockElement === this.el; }

  lock() {
    try {
      const r = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch { /* kilit desteklenmiyorsa sessizce geç */ }
  }

  /** Son okumadan beri biriken fare hareketi */
  takeMouse(): [number, number] {
    const k = this.baseSens * settings.sensitivity;
    const r: [number, number] = [this.dx * k, this.dy * k * (settings.invertY ? -1 : 1)];
    this.dx = this.dy = 0;
    return r;
  }

  /** Dokunmatik bakış: piksel cinsinden sürükleme */
  addLook(dx: number, dy: number) {
    this.dx += dx;
    this.dy += dy;
  }

  axis(): { f: number; s: number } {
    if (this.stick) return this.stick;
    const k = this.keys;
    return {
      f: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      s: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
    };
  }

  dispose() {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('mousemove', this.move);
    this.el.removeEventListener('mousedown', this.mdown);
    window.removeEventListener('mouseup', this.mup);
    document.removeEventListener('pointerlockchange', this.lockChange);
    if (this.locked) document.exitPointerLock();
  }

  private down = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (this.suspended || tag === 'INPUT' || tag === 'SELECT') return;
    if (e.code === 'KeyM' && !e.repeat) this.onMute();
    if (e.code === 'Escape' && !this.locked) { this.onEscape(); return; }
    if (e.code === 'Tab') { e.preventDefault(); this.onScoreboard(true); }
    if (e.code === 'Space') e.preventDefault();
    this.keys.add(e.code);
  };
  private up = (e: KeyboardEvent) => {
    if (e.code === 'Tab') this.onScoreboard(false);
    this.keys.delete(e.code);
  };
  private clear = () => { this.keys.clear(); this.fire = false; this.onScoreboard(false); };
  private move = (e: MouseEvent) => {
    if (!this.locked || this.suspended) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
  };
  private mdown = (e: MouseEvent) => {
    if (this.suspended) return;
    if (!this.locked) { this.lock(); return; }
    if (e.button === 0) this.fire = true;
  };
  private mup = (e: MouseEvent) => { if (e.button === 0) this.fire = false; };
  private lockChange = () => {
    if (!this.locked) { this.fire = false; this.keys.clear(); }
    this.onLockChange(this.locked);
  };
}
