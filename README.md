# Yankı Arena

Tarayıcıda oynanan, çok oyunculu, özgün bir arena nişancı oyunu (FPS). Harita "Kumkent": güneşli bir çöl kasabası; binalar arasında ara sokaklar, arkada dar geçitler, ortada sütunlu bir meydan. Bütün dokular ve modeller kodla üretilir (dış görsel dosyası yok). Sunucu yok: odayı açan oyuncunun tarayıcısı sunucu görevini görür, diğerleri ona WebRTC ile doğrudan bağlanır.

Teknoloji: Vite + TypeScript + Three.js, P2P için [Trystero](https://github.com/dmotz/trystero) (sinyal için ücretsiz, herkese açık Nostr röleleri).

**Canlı:** https://mefe123.github.io/yanki-arena/

## Telefonda

Telefon ya da tablette dokunmatik kontroller kendiliğinden açılır: sol başparmakla sanal çubuk (hareket), sağ tarafı sürükleyerek bakış, kırmızı düğme ateş (basılıyken sürükleyerek nişan alınır), ok zıplama, döngü şarjör, üç çizgi skor tablosu. İlk dokunuşta tam ekrana geçer; dikey tutulursa "yatay çevir" uyarısı çıkar. Telefonda piksel oranı ve gölge çözünürlüğü düşürülür.

## Çalıştırma

```bash
npm install
npm run dev
```

Tarayıcıda `http://localhost:5199` açılır.

1. Adını yaz, **Oda aç**'a bas. Sol üstte oda kodu çıkar; **Bağlantıyı kopyala** ile davet bağlantısını al.
2. Arkadaşın bağlantıyı açar (ya da kodu yazar) ve **Odaya katıl**'a basar.
3. Ekrana tıkla, imleç kilitlenir. WASD hareket, Boşluk zıplama, sol tık ateş, R şarjör, Tab skor tablosu, Esc imleci bırakır.

Aynı bilgisayarda denemek için iki ayrı tarayıcı penceresi kullan (aynı pencerede arka plandaki sekme çizim yapmaz; oda sahibinin simülasyonu ise arka planda da çalışır).

## Yayına alma (statik barındırma)

`npm run build` komutu `dist/` klasörünü üretir. Bu klasör herhangi bir statik barındırmada çalışır, sunucu gerekmez (`base: './'` sayesinde alt yolda da çalışır).

**Cloudflare Pages:** Projeyi GitHub'a gönder, Cloudflare panelinde Workers & Pages → Create → Pages → depoyu bağla. Build command: `npm run build`, output directory: `dist`. Ya da elle: `npx wrangler pages deploy dist`.

**GitHub Pages (şu an kullanılan):** `.github/workflows/pages.yml` her `main` gönderiminde derleyip yayınlar. Depo ayarlarında Pages → Source: GitHub Actions seçili olmalı.

WebRTC ve imleç kilidi HTTPS ister; iki barındırma da HTTPS verir. (`localhost` istisnadır.)

## Mimari

```
src/shared/   Saf oyun mantığı. DOM, Three.js ya da WebRTC yok.
  constants.ts  Tick hızı (30 Hz), hareket, silah değerleri
  map.ts        Arena: eksene hizalı kutular, doğma noktaları
  physics.ts    Deterministik hareket + silah adımı, ışın-kutu testi
  protocol.ts   Ağ mesajları
  server.ts     GameServer: otoriter simülasyon
src/net/      Taşıma katmanı
  connection.ts İstemcinin gördüğü bağlantı arayüzü
  p2p.ts        Trystero ile oda açma/katılma, oda sahibinin tick zamanlayıcısı
src/client/   Tarayıcı istemcisi
  game.ts       Tahmin, sunucu düzeltmesi, ara değer, olaylar
  world.ts      Three.js sahnesi, oyuncu modelleri, silah, izler
  hud.ts, input.ts
```

- **Otoriter sunucu:** İstemciler yalnızca girdi gönderir (`{seq, ileri, yan, zıpla, ateş, bakış}`). Oda sahibi saniyede 30 tick simülasyonu çalıştırır ve her tick'te durumu yayınlar. Can, öldürme, cephane ve isabet sunucuda belirlenir. Oda sahibinin kendi istemcisi de sunucuya aynı arayüzle (yerel bağlantı) bağlanır; ayrıcalığı yoktur.
- **İstemci tahmini:** Oyuncu kendi hareketini aynı `stepPlayer` fonksiyonuyla anında uygular. Sunucu durumu gelince onaylanmamış girdiler yeniden oynatılır.
- **Ara değer:** Diğer oyuncular 3 tick (~100 ms) geriden, iki durum arasında yumuşatılarak gösterilir.
- **Gecikme telafisi:** Atış, istemcinin ekranda gördüğü tick'e (en fazla 10 tick) geri sarılarak test edilir; hareket eden hedefi gördüğün yerde vurursun.

### Gerçek sunucuya taşıma

`src/shared/` olduğu gibi Node'da çalışır. Yapılacak iş:

1. Node tarafında `new GameServer({ send: (id, msg) => socket(id).send(JSON.stringify(msg)) })`, `setInterval(() => server.tickOnce(), 1000 / 30)`, bağlantı açılınca `onMessage(id, {t:'join'})`, kapanınca `removePlayer(id)`.
2. İstemcide `p2p.ts` yerine `Connection` arayüzünü uygulayan bir WebSocket (ya da geckos.io / Colyseus) istemcisi.

Colyseus kullanılırsa `GameServer` bir `Room` içine sarılır; geckos.io (UDP benzeri, sırasız kanal) seçilirse girdiler son birkaç komutla birlikte yedekli gönderilmeli.

## P2P'nin sınırları

- **TURN sunucusu yok.** Bağlantı yalnızca STUN ile kurulur. Oyuncuların çoğu (ev internetleri) sorunsuz bağlanır, ama simetrik NAT arkasındakiler (bazı mobil operatörler, kurumsal/okul ağları, CGNAT) bağlanamayabilir. Çözüm: bir TURN sunucusu (kendi coturn kurulumun ya da ücretli bir hizmet) ve `joinRoom` çağrısında `turnConfig` ayarı. Bu ücretsiz değildir; bu yüzden şimdilik eklenmedi.
- **Oda sahibi her şeydir.** Sekmesini kapatırsa ya da interneti koparsa oyun biter (oyunculara "Oda sahibi oyundan ayrıldı" mesajı çıkar). Oda sahibi devri yok.
- **Oda sahibi hile yapabilir.** Simülasyon onun tarayıcısında çalıştığı için durumu değiştirebilir. Diğer oyuncuların hilesine karşı sunucu doğrulaması (hız, ateş hızı, isabet) vardır.
- **Oda sahibinin bağlantısı sınırı belirler.** Her tick'te herkese ayrı durum gönderir; 8 oyuncu sınırı bu yüzden. Oda sahibi en iyi internete sahip olan olmalı.
- **Sinyal rölesi üçüncü taraftır.** Nostr röleleri ücretsiz ve herkese açıktır; bazen yavaş ya da kapalı olabilir. Bağlantı kurulduktan sonra oyun verisi rölelerden geçmez.
- **Oda sahibinin pingi 0'dır**, diğerlerininki ona olan gecikmedir; gecikme telafisi bunu kısmen dengeler.

## Doğrulama

`docs/` klasöründeki ekran görüntüleri iki ayrı tarayıcı bağlamında (Playwright) alındı: katılan oyuncu oda sahibini hareket ederken görüyor, ateş ediyor, oda sahibinin canı düşüyor ve eleniyor, skor tablosu güncelleniyor, oda sahibi ayrılınca katılan oyuncuya mesaj çıkıyor.
