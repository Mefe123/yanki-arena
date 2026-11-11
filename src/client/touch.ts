// Dokunmatik kontroller: solda sanal çubuk (hareket), sağda sürükle (bakış),
// ateş düğmesi basılıyken sürüklenirse nişan da alınır. Zıpla, şarjör, skor düğmeleri.
import type { Input } from './input';

export const isTouchDevice = () =>
  matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;

const STICK_R = 56;
const LOOK_SENS = 2.4; // dokunmatik bakış, fareye göre çarpan

export class TouchControls {
  private root: HTMLElement;
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private looks = new Map<number, { x: number; y: number }>();
  private fireId: number | null = null;
  private fireBtn!: HTMLElement;
  private cleanup: (() => void)[] = [];

  constructor(private input: Input, onBoard: (show: boolean) => void) {
    this.root = document.getElementById('touch')!;
    this.root.hidden = false;
    this.stickBase = this.root.querySelector('.stick')!;
    this.stickKnob = this.root.querySelector('.stick i')!;

    const zone = this.root.querySelector<HTMLElement>('.move-zone')!;
    const lookZone = this.root.querySelector<HTMLElement>('.look-zone')!;
    this.on(zone, 'touchstart', this.stickStart);
    this.on(lookZone, 'touchstart', this.lookStart);
    this.on(window, 'touchmove', this.move, { passive: false });
    this.on(window, 'touchend', this.end);
    this.on(window, 'touchcancel', this.end);

    const fire = this.fireBtn = this.root.querySelector<HTMLElement>('[data-btn="fire"]')!;
    this.on(fire, 'touchstart', (e: TouchEvent) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.fireId = t.identifier;
      this.input.fire = true;
      fire.classList.add('down');
      this.looks.set(t.identifier, { x: t.clientX, y: t.clientY });
    });
    this.hold('jump', 'Space');
    this.hold('reload', 'KeyR');
    const board = this.root.querySelector<HTMLElement>('[data-btn="board"]')!;
    this.on(board, 'touchstart', (e: TouchEvent) => { e.preventDefault(); onBoard(true); });
    this.on(board, 'touchend', () => onBoard(false));

    // ilk dokunuşta tam ekran + yatay kilit (desteklenen tarayıcılarda)
    const goFull = () => {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
          (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {});
        }).catch(() => {});
      }
    };
    this.on(this.root, 'touchend', goFull, { once: true });
  }

  private on(el: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) {
    el.addEventListener(type, fn, opts);
    this.cleanup.push(() => el.removeEventListener(type, fn, opts));
  }

  private hold(name: string, code: string) {
    const b = this.root.querySelector<HTMLElement>(`[data-btn="${name}"]`)!;
    this.on(b, 'touchstart', (e: TouchEvent) => { e.preventDefault(); this.input.keys.add(code); b.classList.add('down'); });
    this.on(b, 'touchend', () => { this.input.keys.delete(code); b.classList.remove('down'); });
    this.on(b, 'touchcancel', () => { this.input.keys.delete(code); b.classList.remove('down'); });
  }

  private stickStart = (e: TouchEvent) => {
    e.preventDefault();
    if (this.stickId !== null) return;
    const t = e.changedTouches[0];
    this.stickId = t.identifier;
    this.stickOrigin = { x: t.clientX, y: t.clientY };
    this.stickBase.style.transform = `translate(${t.clientX - STICK_R}px, ${t.clientY - STICK_R}px)`;
    this.stickBase.classList.add('on');
    this.stickKnob.style.transform = 'translate(0px, 0px)';
  };

  private lookStart = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) this.looks.set(t.identifier, { x: t.clientX, y: t.clientY });
  };

  private move = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        let dx = t.clientX - this.stickOrigin.x;
        let dy = t.clientY - this.stickOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > STICK_R) { dx = (dx / len) * STICK_R; dy = (dy / len) * STICK_R; }
        this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        // küçük ölü bölge, sonra doğrusal
        const k = (v: number) => (Math.abs(v) < 8 ? 0 : v / STICK_R);
        this.input.stick = { f: -k(dy), s: k(dx) };
        continue;
      }
      const prev = this.looks.get(t.identifier);
      if (prev) {
        this.input.addLook((t.clientX - prev.x) * LOOK_SENS, (t.clientY - prev.y) * LOOK_SENS);
        prev.x = t.clientX;
        prev.y = t.clientY;
      }
    }
  };

  private end = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.input.stick = null;
        this.stickBase.classList.remove('on');
      }
      this.looks.delete(t.identifier);
      if (t.identifier === this.fireId) {
        this.fireId = null;
        this.input.fire = false;
        this.fireBtn.classList.remove('down');
      }
    }
  };

  dispose() {
    for (const c of this.cleanup) c();
    this.root.hidden = true;
    this.input.stick = null;
  }
}
