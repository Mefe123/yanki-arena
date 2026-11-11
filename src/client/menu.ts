// Oyun içi menü: devam et, davet paylaş, odadan çık ve ayarlar.
// Erişilebilirlik: diyalog rolü, açılınca odak içeri taşınır, Tab menü içinde döner,
// kapanınca odak geri verilir.
import { CROSSHAIR_COLORS, onSettings, updateSettings } from './settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Menu {
  private root = $('menu');
  private btn = $('menuBtn');
  private resumeBtn = $<HTMLButtonElement>('resume');
  private cleanup: (() => void)[] = [];
  private started = false;
  open = false;
  onResume: () => void = () => {};
  onLeave: () => void = () => {};
  onOpenChange: (open: boolean) => void = () => {};
  announce: (text: string) => void = () => {};

  constructor(private code: string, private touch: boolean) {
    this.btn.hidden = false;
    this.on(this.btn, 'click', () => this.show());
    this.on(this.resumeBtn, 'click', () => this.resume());
    this.on($('leave'), 'click', () => this.onLeave());
    this.on($('share'), 'click', () => this.share());
    this.on(this.root, 'keydown', (e: KeyboardEvent) => this.trap(e));
    // menü arka planına tıklamak menüyü kapatır
    this.on(this.root, 'click', (e: MouseEvent) => { if (e.target === this.root) this.resume(); });
    $('sensLabel').textContent = touch ? 'Dokunmatik hassasiyet' : 'Fare hassasiyeti';
    if (touch) { $('muteLabel').textContent = 'Sesi kapat'; this.started = true; }
    $('menuHint').textContent = touch
      ? 'Menüyü sol üstteki düğmeyle açarsın.'
      : 'Esc menüyü açar. Klavyeyle Sekme (Tab) tuşu ile gezinebilirsin.';
    this.bindSettings();
  }

  private on(el: EventTarget, type: string, fn: (e: any) => void) {
    el.addEventListener(type, fn);
    this.cleanup.push(() => el.removeEventListener(type, fn));
  }

  private bindSettings() {
    const vol = $<HTMLInputElement>('optVol');
    const mute = $<HTMLInputElement>('optMute');
    const sens = $<HTMLInputElement>('optSens');
    const inv = $<HTMLInputElement>('optInvert');
    const fov = $<HTMLInputElement>('optFov');
    const fx = $<HTMLInputElement>('optFx');
    const xh = $<HTMLSelectElement>('optXh');
    xh.innerHTML = CROSSHAIR_COLORS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');

    this.on(vol, 'input', () => updateSettings({ volume: +vol.value / 100, muted: false }));
    this.on(mute, 'change', () => updateSettings({ muted: mute.checked }));
    this.on(sens, 'input', () => updateSettings({ sensitivity: +sens.value }));
    this.on(inv, 'change', () => updateSettings({ invertY: inv.checked }));
    this.on(fov, 'input', () => updateSettings({ fov: +fov.value }));
    this.on(fx, 'change', () => updateSettings({ reduceFx: fx.checked }));
    this.on(xh, 'change', () => updateSettings({ crosshair: xh.value }));

    this.cleanup.push(onSettings((s) => {
      vol.value = String(Math.round(s.volume * 100));
      $('volOut').textContent = s.muted ? 'kapalı' : `%${Math.round(s.volume * 100)}`;
      mute.checked = s.muted;
      sens.value = String(s.sensitivity);
      $('sensOut').textContent = s.sensitivity.toFixed(1);
      inv.checked = s.invertY;
      fov.value = String(s.fov);
      $('fovOut').textContent = `${s.fov}°`;
      fx.checked = s.reduceFx;
      xh.value = s.crosshair;
      document.documentElement.style.setProperty('--xh', s.crosshair);
      document.body.classList.toggle('reduce-fx', s.reduceFx);
    }));
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.root.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
    this.resumeBtn.textContent = this.started ? 'Oyuna dön' : 'Oyna';
    this.onOpenChange(true);
    requestAnimationFrame(() => this.resumeBtn.focus());
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
    this.onOpenChange(false);
    // menü kapanınca klavye oyuna geçer: odağı bırak (Boşluk bir düğmeye basmasın)
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private resume() {
    this.started = true;
    this.hide();
    this.onResume();
  }

  private async share() {
    const url = `${location.origin}${location.pathname}#oda=${this.code}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    try {
      if (this.touch && nav.share) {
        await nav.share({ title: 'Yankı Arena', text: `Oda ${this.code}: hadi gel`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      this.flash('Bağlantı kopyalandı');
    } catch {
      this.flash(url);
    }
  }

  private flash(text: string) {
    const b = $('share');
    const old = 'Davet bağlantısını paylaş';
    b.textContent = text;
    this.announce(text);
    setTimeout(() => (b.textContent = old), 2200);
  }

  /** Tab ile odak menü içinde döner; Esc ile kapanır */
  private trap(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.resume(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from(this.root.querySelectorAll<HTMLElement>('button, input, select')).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  dispose() {
    for (const c of this.cleanup) c();
    this.root.hidden = true;
    this.btn.hidden = true;
    this.open = false;
  }
}
