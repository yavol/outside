import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { afterEach, mock, test } from "node:test";
// @ts-ignore -- Node's TypeScript test runner requires explicit source extensions.
import { audioDuration, parseSpeechInput, parseTranscriptionInput, synthesizeSpeech, transcribeVoice, VoiceError } from "../src/lib/voice.ts";
// @ts-ignore -- Node's TypeScript test runner requires explicit source extensions.
import { withTrace } from "../src/lib/trace.ts";

function wav(seconds = 1) {
  const bytes = Buffer.alloc(44 + Math.round(seconds * 16000 * 2));
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVE", 8);
  bytes.write("fmt ", 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
function mp3(frames = 10) {
  const bytes = Buffer.alloc(frames * 480);
  for (let offset = 0; offset < bytes.length; offset += 480) { bytes[offset] = 0xff; bytes[offset + 1] = 0xf3; bytes[offset + 2] = 0xe4; bytes[offset + 3] = 0xc4; }
  return bytes;
}
const names = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "OUTSIDE_TRANSCRIPTION_MODEL", "OUTSIDE_SPEECH_MODEL"] as const;
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
afterEach(() => {
  mock.restoreAll();
  names.forEach(name => { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; });
});

test("voice validates recording signature and derives duration before inference", () => {
  const input = parseTranscriptionInput({ audio: wav(1.25).toString("base64"), mediaType: "audio/wav", durationInSeconds: 0 });
  assert.equal(input.durationInSeconds, 1.25, "client duration must not override audio headers");
  assert.ok(Math.abs(audioDuration(mp3(), "audio/mpeg") - 0.24) < 0.0001);
  for (const value of [null, {}, { audio: "https://example.com/audio.wav", mediaType: "audio/wav" }, { audio: "not-base64", mediaType: "audio/wav" }, { audio: Buffer.from("not audio").toString("base64"), mediaType: "audio/wav" }, { audio: wav().toString("base64"), mediaType: "audio/webm" }, { audio: wav().toString("base64"), mediaType: "audio/flac" }, { audio: wav(31).toString("base64"), mediaType: "audio/wav", durationInSeconds: 1 }, { audio: Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64"), mediaType: "audio/wav" }]) {
    assert.throws(() => parseTranscriptionInput(value), VoiceError);
  }
});

test("speech accepts only bounded readable text and ignores client model or voice injection", () => {
  assert.deepEqual(parseSpeechInput({ text: " Outside. ", model: "other", voice: "cloned-voice" }), { text: "Outside." });
  for (const value of [null, {}, { text: " " }, { text: "a".repeat(1501) }, { text: "bad\u0000text" }, { text: 12 }]) assert.throws(() => parseSpeechInput(value), VoiceError);
});

test("ASR calls the documented Gateway endpoint and preserves transcript while redacting audio traces", async () => {
  process.env.AI_GATEWAY_API_KEY = "voice-test-secret";
  delete process.env.OUTSIDE_TRANSCRIPTION_MODEL;
  const input = parseTranscriptionInput({ audio: wav().toString("base64"), mediaType: "audio/wav" });
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit) => {
    assert.equal(String(url), "https://ai-gateway.vercel.sh/v4/ai/transcription-model");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("ai-model-id"), "microsoft/mai-transcribe-2");
    assert.equal(headers.get("ai-transcription-model-specification-version"), "4");
    assert.equal(headers.get("ai-gateway-protocol-version"), "0.0.1");
    assert.deepEqual(JSON.parse(String(init.body)), { audio: input.audio, mediaType: "audio/wav" });
    assert.equal(init.redirect, "error");
    return Response.json({ text: "A coastal walk, please.", durationInSeconds: 1, language: "en", warnings: [] });
  });
  const { result, trace } = await withTrace(() => transcribeVoice(input));
  assert.equal(result.model, "microsoft/mai-transcribe-2");
  assert.equal(result.text, "A coastal walk, please.");
  assert.equal(trace[0].operation, "voice.transcribe");
  assert.match(JSON.stringify(trace[0].request), /audio\/wav audio: 32044 bytes/);
  assert.doesNotMatch(JSON.stringify(trace), /voice-test-secret|UklGR/);
});

test("TTS uses a prebuilt voice and returns playable format metadata without audio in traces", async () => {
  process.env.AI_GATEWAY_API_KEY = "voice-test-secret";
  delete process.env.OUTSIDE_SPEECH_MODEL;
  const audio = mp3().toString("base64");
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit) => {
    assert.equal(String(url), "https://ai-gateway.vercel.sh/v4/ai/speech-model");
    assert.equal(new Headers(init.headers).get("ai-model-id"), "microsoft/mai-voice-2.1-flash");
    assert.deepEqual(JSON.parse(String(init.body)), { text: "Head outside.", voice: "en-US-Harper", outputFormat: "mp3" });
    return Response.json({ audio, warnings: [] });
  });
  const { result, trace } = await withTrace(() => synthesizeSpeech(parseSpeechInput({ text: "Head outside." })));
  assert.equal(result.audio, audio);
  assert.equal(result.mediaType, "audio/mpeg");
  assert.equal(result.model, "microsoft/mai-voice-2.1-flash");
  assert.match(JSON.stringify(trace[0].response), /audio\/mpeg audio: 4800 bytes/);
  assert.doesNotMatch(JSON.stringify(trace), new RegExp(audio.slice(0, 30)));
});

test("provider errors produce an error trace and no invented transcript or speech", async () => {
  process.env.AI_GATEWAY_API_KEY = "voice-test-secret";
  mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "Provider is unavailable" } }, { status: 503 }));
  const { result, trace } = await withTrace(async () => {
    try { await synthesizeSpeech({ text: "Outside." }); return "unexpected success"; }
    catch (error) { assert.ok(error instanceof VoiceError); return "unavailable"; }
  });
  assert.equal(result, "unavailable");
  assert.equal(trace.length, 1);
  assert.equal(trace[0].status, "error");
  assert.deepEqual(trace[0].response, { error: { message: "Provider is unavailable" } });
});

test("missing Gateway credentials perform no paid audio calls", async () => {
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  mock.method(globalThis, "fetch", async () => assert.fail("No provider call expected"));
  await assert.rejects(synthesizeSpeech({ text: "Outside." }), (error: unknown) => error instanceof VoiceError && error.status === 503);
});

test("HTTP 200 ASR responses with unusable transcripts or invalid duration record only an error", async () => {
  process.env.AI_GATEWAY_API_KEY = "voice-test-secret";
  const input = parseTranscriptionInput({ audio: wav().toString("base64"), mediaType: "audio/wav" });
  for (const [body, status] of [
    [{ text: "   ", durationInSeconds: 1 }, 422],
    [{ text: "x".repeat(6001), durationInSeconds: 1 }, 422],
    [{ text: "A coastal walk.", durationInSeconds: 31 }, 400],
    [{ text: "A coastal walk.", durationInSeconds: -1 }, 502],
    [{ text: "A coastal walk.", durationInSeconds: "1" }, 502],
  ] as const) {
    mock.method(globalThis, "fetch", async () => Response.json(body));
    const { trace } = await withTrace(async () => {
      await assert.rejects(transcribeVoice(input), (error: unknown) => error instanceof VoiceError && error.status === status);
    });
    assert.equal(trace.length, 1);
    assert.equal(trace[0].operation, "voice.transcribe");
    assert.equal(trace[0].status, "error");
    assert.deepEqual(trace[0].response, body, "preserve the actual provider response for debugging");
    mock.restoreAll();
  }
});
