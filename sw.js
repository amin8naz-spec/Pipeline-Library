const CACHE_NAME = "amin-pipeline-cache-v1";
const urlsToCache = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
    "https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js",
    "https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js",
    "https://cdn.jsdelivr.net/npm/dexie@3.2.5/dist/dexie.js"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener("fetch", event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (key !== CACHE_NAME) return caches.delete(key);
            })
        ))
    );
});