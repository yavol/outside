/** Browser-only audio helpers. Raw recordings stay in memory for one request. */
export const MAX_AUDIO_BYTES = 3_000_000;
export const MAX_AUDIO_SECONDS = 30;
export const RECORDING_LIMIT_MS = 20_000;
export const TRANSCRIPTION_SAMPLE_RATE = 16_000;

export type TranscriptionMediaType = "audio/wav" | "audio/mpeg" | "audio/flac" | "audio/ogg";

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Audio request cancelled.", "AbortError");
}

/** Encode mono, signed little-endian PCM16 with a standard 44-byte WAV header. */
export function encodePCM16Wav(samples: Float32Array, sampleRate = TRANSCRIPTION_SAMPLE_RATE): ArrayBuffer {
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 96_000) throw new Error("Unsupported audio sample rate.");
  if (!samples.length) throw new Error("The recording is empty. Try recording again.");
  if (samples.length > sampleRate * MAX_AUDIO_SECONDS) throw new Error("Choose an audio clip of 30 seconds or less.");
  const dataBytes = samples.length * 2;
  if (dataBytes + 44 > MAX_AUDIO_BYTES) throw new Error("Choose an audio clip smaller than 3 MB.");
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i])) : 0;
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32_768 : 32_767)), true);
  }
  return buffer;
}

export async function audioBlobToBase64(blob: Blob, signal?: AbortSignal): Promise<string> {
  if (!blob.size) throw new Error("The recording is empty. Try recording again.");
  if (blob.size > MAX_AUDIO_BYTES) throw new Error("Choose an audio clip smaller than 3 MB.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  abortIfNeeded(signal);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}

export function audioBlobFromBase64(base64: string, mediaType: string): Blob {
  if (!/^audio\/(?:mpeg|mp3|wav|ogg|flac|mp4|webm)$/.test(mediaType)) throw new Error("The voice response has an unsupported audio format.");
  if (!base64 || base64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("The voice response could not be read.");
  let binary: string;
  try { binary = atob(base64); } catch { throw new Error("The voice response could not be read."); }
  if (binary.length > MAX_AUDIO_BYTES) throw new Error("The voice response is too large to play.");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType });
}

function normalizedMediaType(blob: Blob, fileName?: string): TranscriptionMediaType | "convert" {
  const type = blob.type.toLowerCase().split(";")[0].trim();
  if (["audio/wav", "audio/wave", "audio/x-wav"].includes(type)) return "audio/wav";
  if (["audio/mpeg", "audio/mp3", "audio/x-mp3"].includes(type)) return "audio/mpeg";
  if (["audio/flac", "audio/x-flac"].includes(type)) return "audio/flac";
  if (["audio/ogg", "application/ogg"].includes(type)) return "audio/ogg";
  if (["audio/webm", "video/webm", "audio/mp4", "video/mp4", "audio/x-m4a"].includes(type)) return "convert";
  if (!type || type === "application/octet-stream") {
    const extension = fileName?.split(".").pop()?.toLowerCase();
    const media: Record<string, TranscriptionMediaType | "convert"> = { wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg", webm: "convert", mp4: "convert", m4a: "convert" };
    if (extension && media[extension]) return media[extension];
  }
  throw new Error("Choose a WAV, MP3, FLAC, OGG, WebM, or M4A audio clip.");
}

/** Validate duration locally; resample browser recorder containers for the ASR API. */
export async function prepareTranscriptionAudio(blob: Blob, options: { fileName?: string; signal?: AbortSignal } = {}): Promise<{ audio: string; mediaType: TranscriptionMediaType }> {
  const { signal, fileName } = options;
  abortIfNeeded(signal);
  if (!blob.size) throw new Error("The recording is empty. Try recording again.");
  if (blob.size > MAX_AUDIO_BYTES) throw new Error("Choose an audio clip smaller than 3 MB.");
  const mediaType = normalizedMediaType(blob, fileName);
  if (typeof window === "undefined") throw new Error("Audio recording is available in your browser.");
  const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass || !window.OfflineAudioContext) throw new Error("This browser cannot prepare audio. Try a current version of Chrome or Safari.");
  const context = new AudioContextClass();
  const closeContext = () => { if (context.state !== "closed") void context.close().catch(() => undefined); };
  signal?.addEventListener("abort", closeContext, { once: true });
  try {
    const data = await blob.arrayBuffer();
    abortIfNeeded(signal);
    let decoded: AudioBuffer;
    try { decoded = await context.decodeAudioData(data); } catch (error) {
      abortIfNeeded(signal);
      throw new Error("This browser could not read that audio clip. Try a WAV or MP3 file.", { cause: error });
    }
    abortIfNeeded(signal);
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error("The recording is empty. Try recording again.");
    if (decoded.duration > MAX_AUDIO_SECONDS) throw new Error("Choose an audio clip of 30 seconds or less.");
    if (mediaType !== "convert") return { audio: await audioBlobToBase64(blob, signal), mediaType };

    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const samples = decoded.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] += samples[i] / decoded.numberOfChannels;
    }
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TRANSCRIPTION_SAMPLE_RATE), TRANSCRIPTION_SAMPLE_RATE);
    const source = offline.createBufferSource();
    const monoBuffer = offline.createBuffer(1, decoded.length, decoded.sampleRate);
    monoBuffer.copyToChannel(mono, 0);
    source.buffer = monoBuffer;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    source.disconnect();
    abortIfNeeded(signal);
    const wav = new Blob([encodePCM16Wav(rendered.getChannelData(0))], { type: "audio/wav" });
    return { audio: await audioBlobToBase64(wav, signal), mediaType: "audio/wav" };
  } finally {
    signal?.removeEventListener("abort", closeContext);
    closeContext();
  }
}
