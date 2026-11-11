// Oyun kuralları. Hem oda sahibi (sunucu) hem istemci aynı değerleri kullanır;
// istemci tahmini ancak böyle sunucuyla birebir aynı sonucu verir.

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

export const MAX_PLAYERS = 8;

// Hareket
export const MOVE_SPEED = 7.2;
export const AIR_CONTROL = 0.35;
export const GROUND_ACCEL = 14;
export const GRAVITY = 26;
export const JUMP_SPEED = 9;

// Oyuncu gövdesi (ayak noktası y'de)
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.6;
export const HEAD_SIZE = 0.42; // baş kutusunun kenarı

// Silah: "Yankı" darbe tüfeği
export const MAX_HP = 100;
export const DAMAGE = 22;
export const HEADSHOT_MULT = 2;
export const FIRE_INTERVAL = 0.13; // saniye
export const MAG_SIZE = 18;
export const RELOAD_TIME = 1.4;
export const WEAPON_RANGE = 120;

export const RESPAWN_TIME = 3;
// Gecikme telafisinde en fazla bu kadar geriye sarılır (tick)
export const MAX_REWIND_TICKS = 10;
// İstemci diğer oyuncuları bu kadar geriden (tick) gösterir
export const INTERP_DELAY_TICKS = 3;

export const PLAYER_COLORS = [
  '#ff7a3d', '#3dd6c4', '#e9e24a', '#c06bff',
  '#ff4f7b', '#5aa8ff', '#8be35a', '#ffb36b',
];
