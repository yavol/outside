import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
// @ts-ignore -- Node requires the explicit TypeScript extension for direct source tests.
import { recordTrace, sanitizeTraceValue, withTrace } from '../src/lib/trace.ts';
// @ts-ignore -- Node requires the explicit TypeScript extension for direct source tests.
import { inspectImage, parseAgentInput, parseVisionInput, planTrip } from '../src/lib/agent.ts';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
const PRIVATE_ENV = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'OUTSIDE_PLANNER_MODEL', 'OUTSIDE_PLANNER_FALLBACK_MODEL', 'OUTSIDE_VISION_MODEL', 'OUTSIDE_VISION_FALLBACK_MODEL', 'OUTSIDE_GEMINI_MODEL'] as const;

test('audio traces redact request, response, inline data, and data URI audio with MIME and byte counts', () => {
  const audio = Buffer.from('private audio bytes').toString('base64');
  const safe = sanitizeTraceValue({
    request: { audio, mediaType: 'audio/wav' },
    response: { audio, mediaType: 'audio/mpeg', warnings: [] },
    inlineData: { mimeType: 'audio/ogg', data: audio },
    embedded: `data:audio/flac;base64,${audio}`,
  });
  assert.deepEqual(safe, {
    request: { audio: '[audio/wav audio: 19 bytes]', mediaType: 'audio/wav' },
    response: { audio: '[audio/mpeg audio: 19 bytes]', mediaType: 'audio/mpeg', warnings: [] },
    inlineData: { mimeType: 'audio/ogg', data: '[audio/ogg audio: 19 bytes]' },
    embedded: '[audio/flac audio: 19 bytes]',
  });
  assert.doesNotMatch(JSON.stringify(safe), new RegExp(audio));
});

test('trace scopes keep concurrent callers separate and discard events outside a request', async () => {
  recordTrace({ provider: 'local', model: 'outside-scope', operation: 'test', status: 'local', request: {}, response: {}, durationMs: 0 });
  const results = await Promise.all(['first', 'second'].map(async name => withTrace(async () => {
    recordTrace({ provider: 'test', model: name, operation: 'begin', status: 'success', request: { name }, response: { name }, durationMs: 1 });
    await delay(name === 'first' ? 4 : 1);
    recordTrace({ provider: 'test', model: name, operation: 'end', status: 'success', request: { name }, response: { name }, durationMs: 2 });
    return name;
  })));
  for (const result of results) {
    assert.equal(result.trace.length, 2);
    assert.ok(result.trace.every(entry => entry.model === result.result));
    assert.ok(result.trace.every(entry => entry.id && entry.time));
  }
});

test('trace sanitization removes credentials and image bytes but preserves shared usage objects', () => {
  const previous = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = 'trace-test-secret-value';
  try {
    const usage = { inputTokens: 10, outputTokens: 2 };
    const safe = sanitizeTraceValue({
      headers: { authorization: 'Bearer trace-test-secret-value', 'x-goog-api-key': 'other-value' },
      text: 'Provider echoed trace-test-secret-value and Bearer another-secret-value',
      image: `data:image/png;base64,${PNG_BASE64}`,
      inlineData: { mimeType: 'image/png', data: PNG_BASE64 },
      response: { usage }, usage,
      parts: [{ thought: true, text: 'private provider reasoning' }, { text: 'Visible answer' }],
    }) as Record<string, unknown>;
    const serialized = JSON.stringify(safe);
    assert.doesNotMatch(serialized, /trace-test-secret-value|another-secret-value|other-value|private provider reasoning|iVBORw0KGgo/);
    assert.match(serialized, /image\/png image: 68 bytes/);
    assert.deepEqual(safe.usage, usage);
    assert.deepEqual((safe.response as { usage: unknown }).usage, usage);
  } finally {
    if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previous;
  }
});

test('trace buffer is bounded and provider endpoints contain no query credentials', async () => {
  const { trace } = await withTrace(async () => {
    for (let i = 0; i < 100; i++) recordTrace({ provider: 'test', model: 'bounded', operation: 'test', status: 'success', endpoint: 'https://api.example/v1/run?key=must-not-leak#fragment', request: { long: 'x'.repeat(100_000) }, response: { long: 'y'.repeat(100_000) }, durationMs: 1 });
  });
  assert.ok(trace.length <= 32);
  assert.ok(Buffer.byteLength(JSON.stringify(trace)) < 513_000);
  assert.ok(trace.every(entry => entry.endpoint === 'https://api.example/v1/run'));
  assert.doesNotMatch(JSON.stringify(trace), /must-not-leak/);
});

test('provider execution traces include real attempts, forced skips, image redaction, and cache hits', async (t) => {
  const previousEnv = Object.fromEntries(PRIVATE_ENV.map(name => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  PRIVATE_ENV.forEach(name => { delete process.env[name]; });
  const answer = { reply: 'Cowells is selected.', selectedDestinationId: 'cowells', budget: 120, owned: [], action: 'compare' };
  try {
    process.env.AI_GATEWAY_API_KEY = 'trace-private-gateway-key';
    await t.test('HTTP failure followed by alternate success records both actual requests', async () => {
      let count = 0;
      globalThis.fetch = async (_url, init) => {
        count++;
        const request = JSON.parse(String(init?.body));
        assert.equal(request.reasoning_effort, 'low');
        assert.equal(request.max_tokens, count === 1 ? 4096 : 16384);
        if (count === 1) return Response.json({ error: { message: 'Upstream failed trace-private-gateway-key' } }, { status: 503 });
        return Response.json({ model: request.model, choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      };
      const { result, trace } = await withTrace(() => planTrip(parseAgentInput({ message: 'Compare beaches', destinationId: 'cowells', budget: 120 })));
      assert.equal(result.engine, 'gateway');
      assert.equal(count, 2);
      assert.deepEqual(trace.map(entry => entry.status), ['error', 'success']);
      assert.deepEqual(trace.map(entry => entry.model), ['openai/gpt-6-luna', 'google/gemini-4-argon']);
      assert.equal(trace[0].fallback, false);
      assert.equal(trace[1].fallback, true);
      assert.match(JSON.stringify(trace[0].request), /You are OUTSIDE/);
      assert.match(JSON.stringify(trace[0].response), /Upstream failed/);
      assert.doesNotMatch(JSON.stringify(trace), /trace-private-gateway-key|authorization/i);
      assert.deepEqual(trace[1].usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    });
    await t.test('forced fallback records a truthful skip and only calls the alternate', async () => {
      const called: string[] = [];
      globalThis.fetch = async (_url, init) => {
        const request = JSON.parse(String(init?.body)); called.push(request.model);
        return Response.json({ model: request.model, choices: [{ message: { content: JSON.stringify(answer) } }] });
      };
      const { trace } = await withTrace(() => planTrip(parseAgentInput({ message: 'Compare beaches', destinationId: 'cowells', budget: 120, forceFallback: true })));
      assert.deepEqual(called, ['google/gemini-4-argon']);
      assert.equal(trace[0].status, 'local');
      assert.equal(trace[0].operation, 'routing.skip-primary');
      assert.match(JSON.stringify(trace[0].response), /No API call was made/);
      assert.equal(trace[1].status, 'success');
    });
    await t.test('direct Gemini gear tracing redacts inline image bytes and preserves its response', async () => {
      delete process.env.AI_GATEWAY_API_KEY;
      process.env.GEMINI_API_KEY = 'trace-private-google-key';
      globalThis.fetch = async () => Response.json({ modelVersion: 'gemini-4-argon', candidates: [{ content: { parts: [{ text: JSON.stringify({ description: 'No supported gear is visible.', category: null, confidence: 0 }) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } });
      const { trace } = await withTrace(() => inspectImage(parseVisionInput({ image: `data:image/png;base64,${PNG_BASE64}`, kind: 'gear' })));
      assert.equal(trace.length, 1);
      assert.equal(trace[0].operation, 'vision.gear');
      assert.equal(trace[0].provider, 'gemini');
      assert.match(JSON.stringify(trace[0].request), /image\/png image: 68 bytes/);
      assert.doesNotMatch(JSON.stringify(trace), /iVBORw0KGgo|trace-private-google-key/);
      assert.match(JSON.stringify(trace[0].response), /No supported gear/);
    });
    await t.test('a failed direct Gemini call is attempted once and becomes an honest local result', async () => {
      let count = 0;
      globalThis.fetch = async () => { count++; return Response.json({ error: { message: 'Service unavailable' } }, { status: 503 }); };
      const { result, trace } = await withTrace(() => inspectImage(parseVisionInput({ image: `data:image/png;base64,${PNG_BASE64}`, kind: 'gear' })));
      assert.equal(count, 1);
      assert.equal(result.engine, 'local');
      assert.deepEqual(trace.map(entry => entry.status), ['error', 'local']);
      assert.equal(trace[0].model, 'gemini-4-argon');
    });
    await t.test('vision forced fallback uses Luna instead of repeating Argon', async () => {
      delete process.env.GEMINI_API_KEY;
      process.env.AI_GATEWAY_API_KEY = 'trace-private-gateway-key';
      const called: string[] = [];
      globalThis.fetch = async (_url, init) => {
        const request = JSON.parse(String(init?.body)); called.push(request.model);
        return Response.json({ model: request.model, choices: [{ message: { content: JSON.stringify({ description: 'No supported gear is visible.', category: null, confidence: 0 }) } }] });
      };
      const { trace } = await withTrace(() => inspectImage(parseVisionInput({ image: `data:image/png;base64,${PNG_BASE64}`, kind: 'gear', forceFallback: true })));
      assert.deepEqual(called, ['openai/gpt-6-luna']);
      assert.equal(trace[0].model, 'google/gemini-4-argon');
      assert.equal(trace[0].status, 'local');
      assert.equal(trace[1].model, 'openai/gpt-6-luna');
      assert.equal(trace[1].status, 'success');
    });
    await t.test('repeated public-frame analysis records a cache hit without a second model call', async () => {
      delete process.env.GEMINI_API_KEY;
      process.env.AI_GATEWAY_API_KEY = 'trace-private-gateway-key';
      let modelCalls = 0;
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('cmgp-coastcam')) return new Response(Buffer.from(PNG_BASE64, 'base64'), { headers: { 'content-type': 'image/png' } });
        modelCalls++;
        const request = JSON.parse(String(init?.body));
        return Response.json({ model: request.model, choices: [{ message: { content: JSON.stringify({ description: 'A test frame has no readable outdoor detail.', category: null, confidence: 0 }) } }] });
      };
      const input = parseVisionInput({ image: 'https://cmgp-coastcam.s3-us-west-2.amazonaws.com/cameras/dreaminn/latest/c2_snap.jpg', kind: 'conditions' });
      const { trace } = await withTrace(async () => { await inspectImage(input); await inspectImage(input); });
      assert.equal(modelCalls, 1);
      assert.equal(trace[0].model, 'google/gemini-4-argon');
      assert.deepEqual(trace.map(entry => entry.status), ['success', 'cached']);
      assert.ok(trace.every(entry => entry.operation === 'vision.conditions'));
    });
  } finally {
    globalThis.fetch = previousFetch;
    PRIVATE_ENV.forEach(name => { if (previousEnv[name] === undefined) delete process.env[name]; else process.env[name] = previousEnv[name]; });
  }
});
