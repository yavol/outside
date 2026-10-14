import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
// @ts-ignore -- Node's source test runner requires explicit TypeScript extensions.
import { roleModels } from '../src/lib/models.ts';
// @ts-ignore -- Node's source test runner requires explicit TypeScript extensions.
import { inspectImage, parseVisionInput } from '../src/lib/agent.ts';
// @ts-ignore -- Node's source test runner requires explicit TypeScript extensions.
import { withTrace } from '../src/lib/trace.ts';

const ENVIRONMENT = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'OUTSIDE_PLANNER_MODEL', 'OUTSIDE_VISION_MODEL', 'OUTSIDE_PLANNER_FALLBACK_MODEL', 'OUTSIDE_VISION_FALLBACK_MODEL', 'OUTSIDE_GEMINI_MODEL'] as const;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');

test('model roles stay independent, cache identity follows vision configuration, and duplicate retries are prevented', async (t) => {
  const previous = Object.fromEntries(ENVIRONMENT.map(name => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  ENVIRONMENT.forEach(name => { delete process.env[name]; });
  try {
    await t.test('explicit planner configuration cannot change the vision role or its current fallback', () => {
      const baseline = roleModels();
      assert.equal(baseline.planner.primary, 'openai/gpt-6-luna');
      assert.equal(baseline.vision.primary, 'google/gemini-4-argon');
      process.env.OUTSIDE_PLANNER_MODEL = 'openai/gpt-6.1-sol';
      process.env.OUTSIDE_PLANNER_FALLBACK_MODEL = 'openai/gpt-6-luna';
      const configured = roleModels();
      assert.equal(configured.planner.primary, 'openai/gpt-6.1-sol');
      assert.equal(configured.planner.fallback, 'openai/gpt-6-luna');
      assert.deepEqual(configured.vision, baseline.vision);
      assert.equal(configured.directGemini, 'gemini-4-argon');
      delete process.env.OUTSIDE_PLANNER_MODEL;
      delete process.env.OUTSIDE_PLANNER_FALLBACK_MODEL;
    });

    await t.test('the same camera pixels are analyzed again after changing the active vision model', async () => {
      process.env.AI_GATEWAY_API_KEY = 'model-tests-not-a-real-credential';
      const called: string[] = [];
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('cmgp-coastcam')) return new Response(PNG, { headers: { 'content-type': 'image/png' } });
        const request = JSON.parse(String(init?.body));
        called.push(request.model);
        return Response.json({ model: request.model, choices: [{ message: { content: JSON.stringify({ description: 'This small fixture does not show readable beach conditions.', category: null, confidence: 0 }) } }] });
      };
      const input = parseVisionInput({ image: 'https://cmgp-coastcam.s3-us-west-2.amazonaws.com/cameras/sunset/latest/c2_snap.jpg', kind: 'conditions' });
      const { result, trace } = await withTrace(async () => {
        const initial = await inspectImage(input);
        process.env.OUTSIDE_VISION_MODEL = 'openai/gpt-6-luna';
        const changed = await inspectImage(input);
        const repeated = await inspectImage(input);
        return { initial, changed, repeated };
      });
      assert.deepEqual(called, ['google/gemini-4-argon', 'openai/gpt-6-luna']);
      assert.equal(result.initial.cached, false);
      assert.equal(result.changed.cached, false);
      assert.equal(result.changed.model, 'openai/gpt-6-luna');
      assert.equal(result.repeated.cached, true);
      assert.equal(result.repeated.model, 'openai/gpt-6-luna');
      assert.deepEqual(trace.map(entry => entry.status), ['success', 'success', 'cached']);
      delete process.env.OUTSIDE_VISION_MODEL;
    });

    await t.test('an identical configured primary and fallback cause only one failed provider request', async () => {
      process.env.OUTSIDE_VISION_FALLBACK_MODEL = 'google/gemini-4-argon';
      let calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json({ error: { message: 'Fixture service unavailable' } }, { status: 503 }); };
      const input = parseVisionInput({ image: `data:image/png;base64,${PNG.toString('base64')}`, kind: 'gear' });
      const { result, trace } = await withTrace(() => inspectImage(input));
      assert.equal(calls, 1);
      assert.equal(result.engine, 'local');
      assert.equal(result.category, null);
      assert.deepEqual(trace.map(entry => entry.status), ['error', 'local']);
      assert.equal(trace[0].model, 'google/gemini-4-argon');
    });
  } finally {
    globalThis.fetch = previousFetch;
    ENVIRONMENT.forEach(name => { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; });
  }
});
