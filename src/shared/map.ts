// "Kumkent" haritası: güneşli bir çöl kasabası. Binalar arasında ara sokaklar,
// arkada dar geçitler, ortada sütunlu bir meydan. Çarpışma ve isabet testi
// yalnızca bu eksene hizalı kutularla yapılır; görsel taraf aynı listeden çizilir.

export type BoxKind = 'floor' | 'wall' | 'building' | 'lowwall' | 'crate' | 'pillar' | 'block';

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
  kind: BoxKind;
}

const boxes: Box[] = [];

/** cx, cz merkez; y alt yüz; sx, sy, sz boyutlar */
function add(cx: number, y: number, cz: number, sx: number, sy: number, sz: number, kind: BoxKind) {
  boxes.push({
    min: [cx - sx / 2, y, cz - sz / 2],
    max: [cx + sx / 2, y + sy, cz + sz / 2],
    kind,
  });
}

/** 90°'lik dönme simetrisi: aynı yapıyı dört yöne koyar (harita adil olsun) */
function add4(cx: number, y: number, cz: number, sx: number, sy: number, sz: number, kind: BoxKind) {
  add(cx, y, cz, sx, sy, sz, kind);
  add(-cz, y, cx, sz, sy, sx, kind);
  add(-cx, y, -cz, sx, sy, sz, kind);
  add(cz, y, -cx, sz, sy, sx, kind);
}

export const ARENA_HALF = 26;

// Zemin ve sur duvarları
add(0, -1, 0, ARENA_HALF * 2 + 2, 1, ARENA_HALF * 2 + 2, 'floor');
add(0, 0, -ARENA_HALF - 0.5, ARENA_HALF * 2 + 2, 7, 1, 'wall');
add(0, 0, ARENA_HALF + 0.5, ARENA_HALF * 2 + 2, 7, 1, 'wall');
add(-ARENA_HALF - 0.5, 0, 0, 1, 7, ARENA_HALF * 2, 'wall');
add(ARENA_HALF + 0.5, 0, 0, 1, 7, ARENA_HALF * 2, 'wall');

// Köşe binaları (büyük, iki katlı) — aralarında 8 m'lik ara sokaklar
add4(-18.5, 0, -18.5, 11, 6.5, 11, 'building');
// Kenar ortası binaları — arkalarında 4 m'lik dar geçit kalır
add4(0, 0, -18.5, 8, 5, 7, 'building');

// Meydan: ortada alçak kuyu, dört sütun, sütunların üstünde kiriş
add(0, 0, 0, 3, 1, 3, 'block');
add4(4.5, 0, -4.5, 0.9, 4.2, 0.9, 'pillar');
add4(0, 4.2, -4.5, 10, 0.7, 0.9, 'block');

// Meydanın kenarlarında alçak duvarlar (eğilmeden siper)
add4(-8.5, 0, -8.5, 5, 1.15, 0.6, 'lowwall');
add4(-8.5, 0, -6.5, 0.6, 1.15, 3.4, 'lowwall');

// Ara sokaklarda sandıklar ve setler
add4(-8, 0, -18, 1.4, 1.4, 1.4, 'crate');
add4(-6.9, 0, -19.4, 1.1, 1.1, 1.1, 'crate');
add4(-7.9, 1.4, -18.1, 1, 1, 1, 'crate');
add4(9.5, 0, -14.5, 1.3, 1.3, 1.3, 'crate');
add4(0, 0, -23.5, 1.2, 1.2, 1.2, 'crate');
// sokak içinde yükseltilmiş taş set (zıplayarak çıkılır)
add4(-10.5, 0, -23.8, 3, 1.2, 4.4, 'block');
add4(-10.5, 1.2, -25.3, 3, 1, 1.4, 'lowwall');

export const MAP_BOXES: readonly Box[] = boxes;

export const SPAWN_POINTS: [number, number, number][] = [
  [-5.5, 0, -24], [5.5, 0, 24], [-24, 0, 5.5], [24, 0, -5.5],
  [8, 0, -20], [-8, 0, 20], [20, 0, 8], [-20, 0, -8],
  [9.5, 0, 9.5], [-9.5, 0, -9.5],
];

// --- Yalnızca görsel süsler (çarpışma yok) ---

/** Palmiyeler: x, z, boy */
export const PALMS: [number, number, number][] = [
  [10.5, -10.5, 7.5], [-10.5, 10.5, 8], [10.8, 10.2, 6.8], [-10.2, -10.8, 7.2],
  [-24.2, -10.5, 8.5], [24.2, 10.5, 8.2],
];

/** Toprak küpler: x, z, ölçek */
export const POTS: [number, number, number][] = [
  [2.4, -7.3, 1], [-2.4, 7.3, 1], [7.3, 2.4, 0.8], [-7.3, -2.4, 0.9],
  [-11.4, -15.2, 1.1], [11.4, 15.2, 1.1], [15.2, -11.4, 0.9], [-15.2, 11.4, 1],
];
