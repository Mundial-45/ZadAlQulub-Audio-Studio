// Acceso al micrófono y comprobación de capacidades reales del navegador.
export function checkCapabilities() {
  const md = navigator.mediaDevices;
  const supported = (md && md.getSupportedConstraints && md.getSupportedConstraints()) || {};
  return {
    secureContext: window.isSecureContext,
    getUserMedia: !!(md && md.getUserMedia),
    audioWorklet: typeof AudioWorkletNode !== 'undefined',
    webAssembly: typeof WebAssembly === 'object',
    moduleWorker: (() => { try { return typeof Worker !== 'undefined'; } catch (e) { return false; } })(),
    deviceSelection: !!(md && md.enumerateDevices),
    noiseSuppression: !!supported.noiseSuppression,
    echoCancellation: !!supported.echoCancellation,
    autoGainControl: !!supported.autoGainControl,
    sampleRate: !!supported.sampleRate,
    offlineAudio: typeof OfflineAudioContext !== 'undefined'
  };
}

export async function listInputDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput');
}

// Pide el micrófono sin procesados que alteren la voz (sin AGC ni cancelación de eco).
export async function openMicrophone({ deviceId, noiseSuppression = false, echoCancellation = false, autoGainControl = false, sampleRate = 48000 } = {}) {
  const audio = {
    channelCount: { ideal: 1 },
    sampleRate: { ideal: sampleRate },
    echoCancellation: !!echoCancellation,
    autoGainControl: !!autoGainControl,
    noiseSuppression: !!noiseSuppression
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

export function describeTrack(stream) {
  const track = stream.getAudioTracks()[0];
  if (!track) return null;
  const s = track.getSettings ? track.getSettings() : {};
  return {
    label: track.label || '',
    deviceId: s.deviceId || '',
    sampleRate: s.sampleRate || null,
    channelCount: s.channelCount || null,
    noiseSuppression: s.noiseSuppression,
    echoCancellation: s.echoCancellation,
    autoGainControl: s.autoGainControl
  };
}
