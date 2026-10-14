import assert from "node:assert/strict";
import { test } from "node:test";
import { audioBlobFromBase64, audioBlobToBase64, encodePCM16Wav, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, prepareTranscriptionAudio } from "../src/lib/browser-audio.ts";

test("PCM16 WAV contains the format and duration expected by speech recognition", () => {
  const wav = encodePCM16Wav(new Float32Array(16_000));
  const view = new DataView(wav);
  const label = (start: number, size: number) => new TextDecoder().decode(wav.slice(start, start + size));
  assert.equal(label(0, 4), "RIFF");
  assert.equal(label(8, 4), "WAVE");
  assert.equal(label(12, 4), "fmt ");
  assert.equal(label(36, 4), "data");
  assert.equal(view.getUint32(4, true), wav.byteLength - 8);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint32(28, true), 32_000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true) / view.getUint32(28, true), 1);
  assert.equal(wav.byteLength, 32_044);
});

test("PCM16 clips loud samples instead of wrapping them and replaces invalid values with silence", () => {
  const view = new DataView(encodePCM16Wav(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2, Number.NaN, Infinity])));
  assert.deepEqual(Array.from({ length: 9 }, (_, index) => view.getInt16(44 + index * 2, true)), [-32_768, -32_768, -16_384, 0, 16_384, 32_767, 32_767, 0, 0]);
});

test("PCM16 rejects empty or overlong clips and accepts the exact 30 second boundary", () => {
  assert.throws(() => encodePCM16Wav(new Float32Array()), /empty/);
  assert.throws(() => encodePCM16Wav(new Float32Array(16_000 * MAX_AUDIO_SECONDS + 1)), /30 seconds/);
  assert.throws(() => encodePCM16Wav(new Float32Array(1), 0), /sample rate/);
  assert.equal(encodePCM16Wav(new Float32Array(16_000 * MAX_AUDIO_SECONDS)).byteLength, 960_044);
});

test("audio base64 is raw bytes and survives a WAV round trip", async () => {
  const original = new Blob([encodePCM16Wav(new Float32Array([-1, 0, 1]))], { type: "audio/wav" });
  const encoded = await audioBlobToBase64(original);
  assert.ok(!encoded.startsWith("data:"));
  const decoded = audioBlobFromBase64(encoded, "audio/wav");
  assert.equal(decoded.type, "audio/wav");
  assert.deepEqual(new Uint8Array(await decoded.arrayBuffer()), new Uint8Array(await original.arrayBuffer()));
  assert.throws(() => audioBlobFromBase64("data:audio/wav;base64,AA==", "audio/wav"), /could not be read/);
  assert.throws(() => audioBlobFromBase64("AA==", "text/html"), /unsupported/);
});

test("oversized files and cancelled audio are rejected before browser decoding or upload", async () => {
  await assert.rejects(prepareTranscriptionAudio(new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: "audio/mpeg" })), /3 MB/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareTranscriptionAudio(new Blob([new Uint8Array([1])], { type: "audio/wav" }), { signal: controller.signal }), { name: "AbortError" });
});
