// Caché de la aplicación (PWA). Sube CACHE_VERSION cuando cambien archivos de la app.
const CACHE_VERSION = 'studio-v1795596100';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'styles.css', 'theme.css', 'fonts/fonts.css', 'fonts/KFGQPC-UthmanicHafs.ttf', 'fonts/ScheherazadeNew-Regular.woff', 'fonts/ScheherazadeNew-Bold.woff', 'fonts/AmiriQuran-Regular.woff', 'fonts/Amiri-Regular.woff', 'fonts/Amiri-Bold.woff', 'fonts/Tajawal-Regular.woff', 'fonts/Tajawal-Bold.woff', 'fonts/Cairo-Variable.woff', 'fonts/Montserrat-Variable.woff', 'manifest.json', 'data/catalog.json',
  'recording/recorder.js', 'recording/microphone.js', 'recording/waveform.js', 'recording/audio-monitor.js', 'recording/pcm-worklet.js', 'recording/wav.js',
  'processing/pipeline.js', 'processing/noise-reduction.js', 'processing/rnnoise-engine.js', 'processing/equalizer.js', 'processing/compressor.js', 'processing/normalizer.js', 'processing/limiter.js', 'processing/dsp-core.js', 'processing/dsp-worker.js', 'processing/worker-client.js', 'processing/resample.js', 'processing/profiles.js', 'processing/effects.js', 'processing/enhance.js', 'processing/dsp-extra.js', 'processing/controls.js', 'processing/mp3-exporter.js', 'processing/mp3-worker.js',
  'editor/waveform-editor.js', 'editor/audio-trimmer.js', 'editor/preview.js',
  'services/i18n.js', 'services/content-loader.js', 'services/local-store.js', 'services/supabase.js', 'services/audio-upload.js', 'admin/dashboard.js', 'admin/integration.js', 'admin/approval.js', 'admin/publishing.js',
  'locales/es.json', 'locales/fr.json', 'locales/ar.json', 'icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // red primero (para ver siempre la versión nueva) y caché como respaldo sin conexión
  e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE_VERSION).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req)));
});
