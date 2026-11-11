import type { ClientMsg, ServerMsg } from '../shared/protocol';

/**
 * İstemcinin sunucuya bağlantısı. Oyunun geri kalanı yalnızca bunu görür;
 * taşıma P2P, yerel (oda sahibi) ya da ileride WebSocket olabilir.
 */
export interface Connection {
  readonly selfId: string;
  send(msg: ClientMsg): void;
  onMessage: (msg: ServerMsg) => void;
  /** Bağlantı koptuğunda kullanıcıya gösterilecek açıklamayla çağrılır */
  onClose: (reason: string) => void;
  close(): void;
  /** Lobi/arayüz bilgisi */
  readonly info: { code: string; isHost: boolean; peers: () => number };
}
