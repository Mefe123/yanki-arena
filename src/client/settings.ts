// Kullanıcı ayarları: tarayıcıda saklanır, değişince dinleyenlere haber verilir.

export interface Settings {
  volume: number;        // 0..1
  muted: boolean;
  sensitivity: number;   // çarpan, 0.3..3
  invertY: boolean;
  fov: number;           // derece
  reduceFx: boolean;     // sallanma, geri tepme ve ekran efektlerini azalt
  crosshair: string;     // nişangâh rengi
}

const KEY = 'yanki-ayarlar';

const defaults = (): Settings => ({
  volume: 0.7,
  muted: false,
  sensitivity: 1,
  invertY: false,
  fov: 75,
  reduceFx: matchMedia('(prefers-reduced-motion: reduce)').matches,
  crosshair: '#ffffff',
});

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...defaults(), ...raw };
  } catch {
    return defaults();
  }
}

const listeners = new Set<(s: Settings) => void>();
export const settings: Settings = load();

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* gizli sekme */ }
  for (const l of listeners) l(settings);
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  fn(settings);
  return () => listeners.delete(fn);
}

export const CROSSHAIR_COLORS: [string, string][] = [
  ['#ffffff', 'Beyaz'],
  ['#ffe14a', 'Sarı'],
  ['#5cff7a', 'Yeşil'],
  ['#4ae8ff', 'Camgöbeği'],
  ['#ff5cf0', 'Pembe'],
];
