// Service Worker: アセットキャッシュ（オフライン対応 & リピート高速化）
const CACHE_NAME = 'novel-game-obf-t1ya2r';

// キャッシュ対象の拡張子
const CACHEABLE_EXT = /\.(mp4|webm|ogg|mp3|wav|m4a|aac|png|jpg|jpeg|gif|webp|svg|woff2?)$/i;

// HTML/JS/CSS はネットワーク優先（更新を即反映）
const APP_SHELL_EXT = /\.(html|js|css|json)$/i;

self.addEventListener('install', (event) => {
    // 即座にアクティブ化
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // 古いキャッシュを削除
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 同一オリジンのみ処理
    if (url.origin !== self.location.origin) return;

    // API リクエストはスルー
    if (url.pathname.startsWith('/api/')) return;

    // メディアアセット → キャッシュファースト
    // ※ Range リクエスト（動画シーク等）は 206 Partial Content を返すため
    //    Cache API の put() が拒否する。Range ヘッダー付きリクエストはキャッシュをスキップ。
    if (CACHEABLE_EXT.test(url.pathname)) {
        // Range リクエストはキャッシュ不可（206 レスポンス）
        if (event.request.headers.get('range')) return;
        event.respondWith(
            caches.open(CACHE_NAME).then(cache =>
                cache.match(event.request).then(cached => {
                    if (cached) return cached;
                    return fetch(event.request).then(response => {
                        if (response.ok && response.status === 200) {
                            cache.put(event.request, response.clone());
                        }
                        return response;
                    });
                })
            ).catch(() => fetch(event.request))
        );
        return;
    }

    // アプリシェル（HTML/JS/CSS/JSON）→ ネットワークファースト + キャッシュフォールバック
    if (APP_SHELL_EXT.test(url.pathname) || url.pathname === '/') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request).then(r => r || new Response('オフライン', { status: 503 })))
        );
        return;
    }
});

// メッセージハンドラ: キャッシュ容量問い合わせ
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GET_CACHE_SIZE') {
        caches.open(CACHE_NAME).then(async (cache) => {
            const keys = await cache.keys();
            let totalSize = 0;
            let count = 0;
            for (const req of keys) {
                try {
                    const resp = await cache.match(req);
                    if (resp) {
                        const blob = await resp.clone().blob();
                        totalSize += blob.size;
                        count++;
                    }
                } catch { /* skip */ }
            }
            event.source.postMessage({
                type: 'CACHE_SIZE',
                size: totalSize,
                count: count,
            });
        });
    }

    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.delete(CACHE_NAME).then(() => {
            event.source.postMessage({ type: 'CACHE_CLEARED' });
        });
    }
});
