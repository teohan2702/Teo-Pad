# TeoPad — Hafif kod ve metin editörü

Mobil uyumlu, çevrimdışı çalışan kod ve metin editörü. Uygulama `index.html`, `sw.js`, `manifest.json` ve `icons/` klasöründen oluşur. Derleme veya üçüncü taraf npm paketi gerekmez.

## GitHub Pages ile yayınlama

1. [Settings → Pages](https://github.com/teohan2702/Teo-Pad/settings/pages) sayfasını açın.
2. Source: **Deploy from a branch** seçin.
3. Branch: **main**, klasör: **/(root)** seçin ve **Save** düğmesine basın.
4. Yayın tamamlanınca GitHub'ın gösterdiği adresi açın. Varsayılan adres: https://teohan2702.github.io/Teo-Pad/
5. Destekleyen tarayıcıda yükleme/ana ekrana ekleme seçeneğini kullanın.

Depodaki `.nojekyll` dosyası statik dosyaların Jekyll işlenmeden yayınlanmasını sağlar. İkon yolları, manifest başlangıç adresi ve service worker kapsamı depo alt dizinine göreli tutulmuştur.

Resmî yayın kaynağı: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## İkonlar

192 ve 512 piksel standart/maskable PNG ikonlar, 180 piksel Apple ana ekranı ikonu, 16/32/48 piksel faviconlar ve çok boyutlu ICO dosyası `icons/` içindedir. T harfi ve kod parantezlerinden oluşan tasarım TeoPad için üretildi. İkonlar service worker kurulumunda önbelleğe alınır; PNG/ICO dosyalarını uygulama dosyalarıyla birlikte yayınlayın.

## Çalıştırma

Yerel deneme için bu klasörde:

```bash
python3 -m http.server 8080
```

Tarayıcıda `http://localhost:8080` adresini açın. Yayında HTTPS kullanın. `index.html` dosyasına doğrudan çift tıklamak PWA/Service Worker kurulumu sağlamaz. Aynı origin altında önceki sürümden geçişte açık eski pencerelerdeki çalışmayı önce dosyaya kaydedip bu pencereleri kapatın; eski sayfanın JavaScript'i yeni dosyalar yayımlanınca geriye dönük değişmez.

`Cache-Control` ve MIME başlıklarını sunucunuzda doğru verin: HTML `text/html`, manifest `application/manifest+json` veya JSON, Service Worker JavaScript MIME. Service Worker'ı bir SPA HTML fallback'ine yönlendirmeyin.

## Kontroller

Node.js 24 üzerinde çalıştırıldı; üçüncü taraf npm bağımlılığı gerekmez. Paket kökünde:

```bash
node tests/regression.cjs .
node tests/service-worker.cjs .
```

Kontroller sonuç JSON dosyalarını `tests` klasörüne yazar. VM içindeki test bağlantısı yalnızca test sırasında eklenir; uygulama dosyasında test arayüzü yoktur. DOM ve IndexedDB/Cache etkileşimleri benzetimdir. Response/Blob kodlaması gerçek Node Web API'siyle, regex izolasyonu gerçek worker_threads ile çalıştırılır. Bunlar gerçek tarayıcı render/kurulum testlerinin yerine geçmez.

## Davranışlar

- Dosya adı alanı **tam adı** gösterir. `.env`, `README` ve bilinmeyen uzantılar korunur. Açık dosyanın adı değiştirilirse normal Kaydet yeni ad için Farklı Kaydet yolunu kullanır.
- İndirme yolunda “başlatıldı” ile “tamamlandı” ayrıdır. Tarayıcı indirmeyi tamamladığında “İndirdim” seçilirse ilgili sürüm kaydedilmiş sayılır.
- Taslak kurtarma bir kopya açar. Sekmeler bağımsız kayıt kullanır. Eski taslaklar Taslaklar bölümünden bilinçli olarak silinir; otomatik temizleme yapılmaz.
- Tümünü değiştir varsayılan olarak bütün belgeyi kapsar. “Seçimde” kutusu etkinleştirilirse o anki seçim sabit kapsam olur. Metin düzenlenince bu kapsam sıfırlanır.
- Tab varsayılan olarak normal odak gezinmesidir. “Tab girinti” açılırsa girintiler; Esc araç çubuğuna çıkar.
- “Oto. parantez” otomatik kapatma ve Enter girintisini açıp kapatır. Geri al/yinele uygulamanın ortak geçmişini kullanır.
- Dosya açma boyut sınırı 10 MiB'dir. Editör metni ve değiştirme sonuçları ayrıca uzunluk sınırına sahiptir. Tek değiştirmede en fazla 20.000 eşleşme işlenir.
- UTF-8, UTF-8 BOM ve BOM işaretli UTF-16LE/BE desteklenir. Tek tip LF/CRLF/CR korunur. Karışık satır sonları kullanıcı onayıyla LF'ye çevrilir. Geçersiz/desteklenmeyen kodlama sessizce dönüştürülmez.
- Regex için Worker zorunludur; kullanılamıyorsa düz metin araması sürer. İş başına 1,5 saniyelik süre sınırı vardır.

## Kaynak düzenleme

Inline JavaScript CSP hash'leriyle sınırlandırıldı. HTML'deki script'i değiştirirseniz hash'leri de güncelleyin. `tools/sync-metadata.py`, `index.html` içindeki `TYPES` tanımını manifest'e yansıtır ve CSP hash'lerini yeniden hesaplar:

```bash
python3 tools/sync-metadata.py .
```

Bu işlemden sonra testleri yeniden çalıştırın. Yeni yayında `sw.js` içindeki `RELEASE` değerini değiştirin. Tema ilk boyama betiği küçük bir bootstrap olduğu için ana tema uygulamasıyla renk değerleri eşleşmelidir.

## Açık doğrulama sınırı

5 Ekim 2026 birleşik yayın sürümünde 85 regresyon kontrolü (64 uygulama + 21 service worker) geçti. İkon dosyalarının boyutları ve tüm HTML/manifest/önbellek yolları ayrıca kontrol edildi. Gerçek Chrome/Firefox/Safari, Android/iOS klavyesi, ekran okuyucu, kurulum ve piksel düzeyinde wrap/geometri doğrulaması bu ortamda yapılamadı. Tarayıcı depolamasının işletim sistemi tarafından silinmesine karşı mutlak kalıcılık garantisi yoktur; dosya kaydı önemlidir. Bu paket “her ortamda sıfır hata kanıtı” olarak sunulmaz.

## v3.1 ek düzeltmeleri

Eski başarısız yazım yeni acil yedeği ezemez. Güncelleme mesajı hata verirse yenileme izni kaldırılır. Güncelleme sırasında önceki arama/değiştirme işleri iptal edilir. Bu dört kontrolün önceki v3 sürümünde başarısız, v3.1 sürümünde başarılı olduğu karşılaştırmalı testlerle doğrulandı. Bu depodaki sonuç dosyaları yeni ikonlarla birleştirilmiş sürüme aittir.
