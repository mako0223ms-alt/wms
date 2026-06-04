// ═══════════════════════════════════════════════════════════
//  WMS Service Worker  v1.0
//  キャッシュ戦略:
//    - index.html / static assets → Cache First（オフライン対応）
//    - GAS通信 (POST / script.google.com) → Network Only（キャッシュしない）
//    - その他外部リソース → Network First（失敗時はキャッシュ）
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = 'wms-cache-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// ─── インストール：静的アセットをキャッシュ ───
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(['./', './index.html']);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ─── アクティブ化：古いキャッシュを削除 ───
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ─── フェッチ：リクエスト種別で戦略を分岐 ───
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // ① GAS通信（POST・script.google.com）→ Network Only
  //    RsWedge経由のスキャンデータ送信も含むため絶対にキャッシュしない
  if (event.request.method === 'POST' ||
      url.indexOf('script.google.com') !== -1 ||
      url.indexOf('googleapis.com') !== -1) {
    event.respondWith(fetch(event.request).catch(function() {
      return new Response(JSON.stringify({error: 'offline'}), {
        status: 503,
        headers: {'Content-Type': 'application/json'}
      });
    }));
    return;
  }

  // ② cdnjs（xlsx.js等）→ Cache First（一度取得したら永続利用）
  if (url.indexOf('cdnjs.cloudflare.com') !== -1) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // ③ index.html / 同一オリジン → Cache First + バックグラウンド更新
  //    （Stale-While-Revalidate相当）
  if (url.indexOf(self.location.origin) !== -1 ||
      event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          var networkFetch = fetch(event.request).then(function(response) {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(function() {
            return cached;
          });
          // キャッシュがあれば即返し、バックグラウンドで更新
          return cached || networkFetch;
        });
      })
    );
    return;
  }

  // ④ その他 → Network First
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request);
    })
  );
});

// ─── メッセージ：強制キャッシュクリア ───
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(function() {
      event.ports[0].postMessage({cleared: true});
    });
  }
});
