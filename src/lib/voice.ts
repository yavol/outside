import { Buffer } from "node:buffer";
// @ts-ignore -- Node's native TypeScript test runner requires explicit source extensions.
import { recordTrace } from "./trace.ts";
// @ts-ignore -- Node's native TypeScript test runner requires explicit source extensions.
import { voiceModels } from "./models.ts";
const ORIGIN = "https://ai-gateway.vercel.sh";
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const MAX_SECONDS = 30;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export type AudioMediaType = "audio/wav" | "audio/mpeg" | "audio/flac" | "audio/ogg";
export type TranscriptionInput = { audio: string; mediaType: AudioMediaType; durationInSeconds: number };
export type SpeechInput = { text: string };

export class VoiceError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.name = "VoiceError"; this.status = status; }
}

function ascii(bytes: Buffer, start: number, end: number) { return bytes.toString("ascii", start, end); }

function wavDuration(bytes: Buffer): number {
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WAVE" || bytes.readUInt32LE(4) + 8 > bytes.length) throw new VoiceError("Use a valid WAV recording.");
  let byteRate = 0;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = ascii(bytes, offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) throw new VoiceError("The WAV recording is incomplete.");
    if (name === "fmt ") {
      if (size < 16) throw new VoiceError("Invalid WAV audio format.");
      const format = bytes.readUInt16LE(start);
      const channels = bytes.readUInt16LE(start + 2);
      const sampleRate = bytes.readUInt32LE(start + 4);
      const bits = bytes.readUInt16LE(start + 14);
      byteRate = bytes.readUInt32LE(start + 8);
      if (format !== 1 || channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 96000 || bits !== 16 || byteRate !== sampleRate * channels * 2) throw new VoiceError("Use a 16-bit PCM WAV recording.");
    }
    if (name === "data") dataBytes += size;
    offset = start + size + (size % 2);
  }
  if (!byteRate || !dataBytes) throw new VoiceError("The WAV recording contains no audio.");
  return dataBytes / byteRate;
}

function mp3Frame(bytes: Buffer, offset: number): { size: number; seconds: number } | null {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null;
  const version = (bytes[offset + 1] >> 3) & 3;
  const layer = (bytes[offset + 1] >> 1) & 3;
  const bitrateIndex = bytes[offset + 2] >> 4;
  const sampleIndex = (bytes[offset + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) return null;
  const bitrate = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex] * 1000;
  const sampleRate = [44100, 48000, 32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  const padding = (bytes[offset + 2] >> 1) & 1;
  return { size: Math.floor((version === 3 ? 144 : 72) * bitrate / sampleRate) + padding, seconds: (version === 3 ? 1152 : 576) / sampleRate };
}

function mp3Duration(bytes: Buffer): number {
  let offset = 0;
  if (ascii(bytes, 0, 3) === "ID3") {
    if (bytes.length < 10 || [...bytes.subarray(6, 10)].some(byte => byte > 127)) throw new VoiceError("Invalid MP3 metadata.");
    offset = 10 + (bytes[6] << 21 | bytes[7] << 14 | bytes[8] << 7 | bytes[9]);
    if (bytes[5] & 0x10) offset += 10;
  }
  const searchEnd = Math.min(offset + 4096, bytes.length - 4);
  while (offset <= searchEnd && !mp3Frame(bytes, offset)) offset++;
  let seconds = 0;
  let frames = 0;
  while (offset + 4 <= bytes.length) {
    const frame = mp3Frame(bytes, offset);
    if (!frame || offset + frame.size > bytes.length) break;
    seconds += frame.seconds;
    frames++;
    offset += frame.size;
  }
  if (frames < 2 || bytes.length - offset > 4096) throw new VoiceError("Use a complete MP3 recording with readable duration.");
  return seconds;
}

function flacDuration(bytes: Buffer): number {
  if (bytes.length < 42 || ascii(bytes, 0, 4) !== "fLaC" || (bytes[4] & 0x7f) !== 0 || bytes.readUIntBE(5, 3) !== 34) throw new VoiceError("Use a FLAC recording with STREAMINFO metadata.");
  const start = 8;
  const sampleRate = bytes[start + 10] << 12 | bytes[start + 11] << 4 | bytes[start + 12] >> 4;
  const totalSamples = (bytes[start + 13] & 15) * 0x100000000 + bytes.readUInt32BE(start + 14);
  if (!sampleRate || !totalSamples) throw new VoiceError("The FLAC duration could not be verified.");
  return totalSamples / sampleRate;
}

function oggDuration(bytes: Buffer): number {
  let offset = 0;
  let sampleRate = 0;
  let preSkip = 0;
  let granule = 0n;
  while (offset + 27 <= bytes.length) {
    if (ascii(bytes, offset, offset + 4) !== "OggS" || bytes[offset + 4] !== 0) throw new VoiceError("Invalid Ogg recording.");
    const segments = bytes[offset + 26];
    if (offset + 27 + segments > bytes.length) throw new VoiceError("Incomplete Ogg recording.");
    let pageBytes = 0;
    for (let index = 0; index < segments; index++) pageBytes += bytes[offset + 27 + index];
    const body = offset + 27 + segments;
    if (body + pageBytes > bytes.length) throw new VoiceError("Incomplete Ogg recording.");
    if (offset === 0) {
      if (pageBytes >= 19 && ascii(bytes, body, body + 8) === "OpusHead") { sampleRate = 48000; preSkip = bytes.readUInt16LE(body + 10); }
      else if (pageBytes >= 16 && bytes[body] === 1 && ascii(bytes, body + 1, body + 7) === "vorbis") sampleRate = bytes.readUInt32LE(body + 12);
      else throw new VoiceError("Use an Ogg Opus or Vorbis recording.");
    }
    const pageGranule = bytes.readBigUInt64LE(offset + 6);
    if (pageGranule !== 0xffffffffffffffffn) granule = pageGranule;
    offset = body + pageBytes;
  }
  if (offset !== bytes.length || !sampleRate || granule <= BigInt(preSkip)) throw new VoiceError("The Ogg duration could not be verified.");
  return (Number(granule) - preSkip) / sampleRate;
}

export function audioDuration(bytes: Buffer, mediaType: AudioMediaType): number {
  if (mediaType === "audio/wav") return wavDuration(bytes);
  if (mediaType === "audio/flac") return flacDuration(bytes);
  if (mediaType === "audio/ogg") return oggDuration(bytes);
  return mp3Duration(bytes);
}

export function parseTranscriptionInput(raw: unknown): TranscriptionInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new VoiceError("Provide a short audio recording.");
  const value = raw as Record<string, unknown>;
  if (typeof value.audio !== "string" || !value.audio || value.audio.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4) throw new VoiceError("Use audio smaller than 3 MB.", 413);
  if (!["audio/wav", "audio/mpeg", "audio/flac", "audio/ogg"].includes(String(value.mediaType))) throw new VoiceError("Use WAV, MP3, FLAC, or Ogg audio.");
  if (value.audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.audio)) throw new VoiceError("Provide valid base64 audio.");
  const bytes = Buffer.from(value.audio, "base64");
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES || bytes.toString("base64") !== value.audio) throw new VoiceError("Provide valid audio smaller than 3 MB.");
  const mediaType = value.mediaType as AudioMediaType;
  const durationInSeconds = audioDuration(bytes, mediaType);
  if (!Number.isFinite(durationInSeconds) || durationInSeconds <= 0 || durationInSeconds > MAX_SECONDS + 0.001) throw new VoiceError("Keep voice recordings to 30 seconds or less.");
  return { audio: value.audio, mediaType, durationInSeconds };
}

export function parseSpeechInput(raw: unknown): SpeechInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof (raw as Record<string, unknown>).text !== "string") throw new VoiceError("Provide text to read aloud.");
  const text = ((raw as Record<string, unknown>).text as string).trim();
  if (!text || text.length > 1500 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new VoiceError("Use between 1 and 1500 characters of readable text.");
  return { text };
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.body || Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES) throw new VoiceError("The voice provider returned an oversized response.", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new VoiceError("The voice provider returned an oversized response.", 502);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VoiceError("The voice provider returned an invalid response.", 502);
  return value as Record<string, unknown>;
}

async function callVoice(kind: "transcription" | "speech", body: Record<string, unknown>): Promise<{ result: Record<string, unknown>; model: string }> {
  const key = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!key) throw new VoiceError("Gateway voice is unavailable. You can type your plan.", 503);
  const model = voiceModels()[kind];
  const endpoint = `${ORIGIN}/v4/ai/${kind}-model`;
  const started = Date.now();
  let result: Record<string, unknown> | undefined;
  try {
    const response = await fetch(endpoint, {
      method: "POST", headers: {
        Authorization: `Bearer ${key}`, "Content-Type": "application/json",
        "ai-gateway-protocol-version": "0.0.1", [`ai-${kind}-model-specification-version`]: "4", "ai-model-id": model,
      },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: "error", cache: "no-store",
    });
    result = await responseJson(response);
    if (!response.ok) throw new VoiceError(`The ${kind === "speech" ? "spoken reply" : "transcription"} service is unavailable. Please try again.`, response.status === 429 ? 429 : 502);
    if (kind === "speech" && typeof result.audio !== "string" || kind === "transcription" && typeof result.text !== "string") throw new VoiceError("The voice provider returned no usable result.", 502);
    if (kind === "speech") {
      const bytes = Buffer.from(result.audio as string, "base64");
      const mediaType: AudioMediaType = ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE" ? "audio/wav" : "audio/mpeg";
      audioDuration(bytes, mediaType);
      result = { ...result, mediaType };
    } else {
      const text = (result.text as string).trim();
      if (!text || text.length > 6000) throw new VoiceError("No readable speech was found in that recording.", 422);
      if (result.durationInSeconds !== undefined && result.durationInSeconds !== null) {
        const duration = result.durationInSeconds;
        if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) throw new VoiceError("The voice provider returned an invalid audio duration.", 502);
        if (duration > MAX_SECONDS + 0.1) throw new VoiceError("Keep voice recordings to 30 seconds or less.");
      }
    }
    recordTrace({ provider: "Vercel AI Gateway", model, endpoint, operation: kind === "speech" ? "voice.speech" : "voice.transcribe", status: "success", request: body, response: result, durationMs: Date.now() - started, usage: result.usage });
    return { result, model };
  } catch (error) {
    recordTrace({ provider: "Vercel AI Gateway", model, endpoint, operation: kind === "speech" ? "voice.speech" : "voice.transcribe", status: "error", request: body, response: result ?? null, durationMs: Date.now() - started, error: error instanceof Error ? error.message : "Voice unavailable" });
    if (error instanceof VoiceError) throw error;
    throw new VoiceError("The voice service could not be reached. Please try again or type your plan.", 502);
  }
}

export async function transcribeVoice(input: TranscriptionInput) {
  const started = Date.now();
  const { result, model } = await callVoice("transcription", { audio: input.audio, mediaType: input.mediaType });
  const text = (result.text as string).trim();
  const durationInSeconds = typeof result.durationInSeconds === "number" ? result.durationInSeconds : input.durationInSeconds;
  return { text, model, latencyMs: Date.now() - started, durationInSeconds };
}

export async function synthesizeSpeech(input: SpeechInput) {
  const started = Date.now();
  const { result, model } = await callVoice("speech", { text: input.text, voice: "en-US-Harper", outputFormat: "mp3" });
  return { audio: result.audio as string, mediaType: result.mediaType as AudioMediaType, model, latencyMs: Date.now() - started };
}
