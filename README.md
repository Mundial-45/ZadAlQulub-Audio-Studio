# ZadALQulub Audio Studio

Aplicación web independiente (PWA) para grabar, editar, procesar y exportar a MP3 las recitaciones de **ZadALQulub**.
Este proyecto **no modifica ni depende en tiempo de ejecución** de los repositorios `ZadALQulub` ni `ZadAlQulub-Audio`.

## Estado

| Etapa | Estado |
|---|---|
| 1 · Motor de audio (grabación, ruido, procesado, MP3) | ✅ Hecha y probada en Chrome con micrófono simulado |
| 2 · Interfaz, ES/FR/AR, catálogo, PWA | ✅ Hecha |
| 3 · Supabase (login, roles, base de datos, almacenamiento, RLS) | ✅ Esquema probado en PostgreSQL local; falta conectarlo a un proyecto real (ver `SETUP.md`) |
| 4 · Panel de colaboradores (mis grabaciones, envío, estados) | ✅ Hecho (probado con un Supabase simulado) |
| 5 · Administración (revisar, aprobar, rechazar, publicar, versiones) | ✅ Hecho (probado con un Supabase simulado) |
| 6 · Integración con ZadALQulub | ⏸ Aplazada (el reemplazo de audios será manual) |
| 7 · Pruebas en OnePlus CPH2449, tabletas y PC | ⏳ Pendiente |

Sin configurar `config.js` funciona en **modo local** (IndexedDB). Con Supabase configurado hay inicio de sesión, envío para revisión y panel de administración. Instrucciones: **`SETUP.md`**.

## Cómo publicarlo (GitHub Pages)

1. En GitHub: **Settings → Pages**.
2. *Source*: **Deploy from a branch** · *Branch*: `main` · carpeta `/ (root)` · **Save**.
3. Tras un minuto estará en `https://mundial-45.github.io/ZadAlQulub-Audio-Studio/`.
4. En el móvil: abrir esa dirección en Chrome → menú → **Instalar aplicación**.

El micrófono solo funciona con **HTTPS** (GitHub Pages lo es) o en `localhost`.

## Cómo probarlo en local

```bash
python3 -m http.server 8080      # en esta carpeta
# abrir http://localhost:8080
```

## Catálogo de textos

`data/catalog.json` es una copia de **solo lectura** de los textos de ZadALQulub (867 items: azkar, adya, ruqyah, munajat).
Cada item tiene un id estable `<sección>_<itemNumber>` (por ejemplo `azkar_116`). Los items con el mismo texto árabe se enlazan
en `sameTextAs`: al guardar un MP3 de uno, los demás se marcan como hechos automáticamente.

Para regenerarlo cuando cambien los textos (lee una copia local de ZadALQulub, no la modifica):

```bash
node tools/build-catalog.js /ruta/a/ZadALQulub
```

## Cadena de audio

1. **Captura**: AudioWorklet → PCM float32 mono a 48 kHz, sin AGC ni cancelación de eco. El original se guarda como WAV 16 bit y **nunca se sobrescribe**.
2. **Reducción de ruido**: RNNoise (WebAssembly) con mezcla ajustable. Si el navegador no lo admite se omite y se avisa.
3. **Filtros**: pasa-altos, EQ de 3 bandas (±6 dB máx.), compresor suave (ratio máx. 4:1).
4. **Normalización**: −16 LUFS (BS.1770-4, ajustable) y limitador con anticipación a −1 dBTP (ajustable).
5. **MP3**: mono, 192 kbps, 44,1 kHz (ajustable), codificado en un Web Worker.

Perfiles iniciales (modificables): Natural, Voz limpia, Estudio.

## Estructura

```
index.html · app.js · styles.css · manifest.json · service-worker.js
recording/   microphone · recorder · pcm-worklet · waveform · audio-monitor · wav
processing/  pipeline · noise-reduction · rnnoise-engine · equalizer · compressor · normalizer · limiter · dsp-core · mp3-exporter · …
editor/      waveform-editor · audio-trimmer · preview
services/    i18n · content-loader · local-store   (supabase.js llegará en la etapa 3)
locales/     es.json · fr.json · ar.json
vendor/      RNNoise (Apache-2.0) y lamejs (LGPL-3.0)
tools/       build-catalog.js
```

## Licencias de terceros

Ver `vendor/README.md`.

## Procesado de voz (versión ampliada)

- **Limpieza**: RNNoise (1–3 pasadas), reducción espectral con perfil de ruido tomado de la selección, de-reverb, reducción de respiraciones, puerta de ruido con umbral automático, quita-zumbido 50/60 Hz, quita-clics.
- **Tono y dinámica**: filtros de graves/agudos, ecualizador de 5 bandas, compresor, nivelador de volumen, de-esser.
- **Embellecedores**: exciter, saturación cálida, chorus/doblado.
- **Efectos**: calidez, brillo, voz profunda, radio, teléfono, megáfono, sala, cámara, plate, sala grande, mezquita, cueva, eco corto/medio/largo.
- **11 perfiles** de partida (natural, voz limpia, estudio, rescate, móvil, suave, radio, mezquita, profunda, brillante, sin tratamiento).
- Los controles se definen en `processing/controls.js`; el motor está en `processing/dsp-extra.js` (STFT propia, sin dependencias nuevas).
- **Grabador**: frecuencia de muestreo, filtro de graves en vivo, eco/AGC del navegador (desactivados por defecto), cuenta atrás, inicio automático con voz (con 0,5 s de pre-grabación), parada tras silencio y medición del ruido de la sala.
- Tipografía idéntica a ZadALQulub (`fonts/`), con botones A−/A+.
