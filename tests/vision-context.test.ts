import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
// @ts-ignore -- Node's source test runner requires explicit TypeScript extensions.
import { getCameraObservation, inspectImage, parseAgentInput, parseVisionInput, planTrip } from '../src/lib/agent.ts';
// @ts-ignore -- Node's source test runner requires explicit TypeScript extensions.
import { withTrace } from '../src/lib/trace.ts';

const ENVIRONMENT = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'OUTSIDE_PLANNER_MODEL', 'OUTSIDE_VISION_MODEL', 'OUTSIDE_PLANNER_FALLBACK_MODEL', 'OUTSIDE_VISION_FALLBACK_MODEL', 'OUTSIDE_GEMINI_MODEL'] as const;
const CAMERA = 'https://cmgp-coastcam.s3-us-west-2.amazonaws.com/cameras/dreaminn/latest/c2_snap.jpg';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
const DESCRIPTION = 'White surf breaks along the shoreline below a clear sky.';

test('only exact current public camera observations can become trusted planner evidence', async (t) => {
  const previous = Object.fromEntries(ENVIRONMENT.map(name => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  const previousNow = Date.now;
  ENVIRONMENT.forEach(name => { delete process.env[name]; });
  process.env.AI_GATEWAY_API_KEY = 'vision-context-not-a-real-credential';
  let imageFetches = 0;
  let modelCalls = 0;
  let lastPlannerRequest: Record<string, unknown> | undefined;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('cmgp-coastcam')) {
      imageFetches++;
      return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    }
    modelCalls++;
    const request = JSON.parse(String(init?.body));
    const prompt = request.messages?.[1]?.content;
    let response: unknown;
    if (typeof prompt === 'string' && prompt.startsWith('{')) {
      lastPlannerRequest = JSON.parse(prompt);
      response = { reply: 'Inspect the selected timestamped camera frame; forecasts are separate evidence.', selectedDestinationId: 'cowells', budget: 120, owned: [], action: 'camera' };
    } else response = { description: DESCRIPTION, category: null, confidence: 0.9 };
    return Response.json({ model: request.model, choices: [{ message: { content: JSON.stringify(response) } }] });
  };
  const inspect = (version: string, kind: 'conditions' | 'gear' = 'conditions') => inspectImage(parseVisionInput({ image: `${CAMERA}?v=${version}`, kind }));
  const context = (imageUrl: string): NonNullable<Parameters<typeof planTrip>[1]> => ({
    fetchedAt: new Date().toISOString(),
    destinations: [{
      id: 'cowells', name: 'Cowell Beach', description: 'Wharf-side coastal walk.', tags: ['Coastal walk'],
      weather: { kind: 'forecast', status: 'available', temperatureF: 70, windMph: 6, shortForecast: 'Sunny', precipitationChance: 0 },
      camera: { status: 'available', imageUrl, capturedAt: null, lastModifiedAt: '2026-10-14T21:00:00.000Z', checkedAt: new Date().toISOString() },
      ...(getCameraObservation(imageUrl) ? { visualEvidence: getCameraObservation(imageUrl) } : {}),
    }],
  });
  try {
    await t.test('a cache lookup never fetches or analyzes missing evidence', () => {
      assert.equal(getCameraObservation(`${CAMERA}?v=missing`), undefined);
      assert.equal(getCameraObservation('https://example.com/private.jpg?v=1'), undefined);
      assert.equal(getCameraObservation(CAMERA), undefined);
      assert.equal(modelCalls, 0);
      assert.equal(imageFetches, 0);
    });

    await t.test('public analysis is reusable only for the exact source-file version', async () => {
      await inspect('known');
      const count = modelCalls;
      const evidence = getCameraObservation(`${CAMERA}?v=known`);
      assert.equal(evidence?.description, DESCRIPTION);
      assert.equal(evidence?.model, 'google/gemini-4-argon');
      assert.equal(evidence?.imageUrl, `${CAMERA}?v=known`);
      assert.equal(evidence?.capturedAt, null);
      assert.ok(evidence?.analyzedAt && Number.isFinite(Date.parse(evidence.analyzedAt)));
      assert.equal(getCameraObservation(`${CAMERA}?v=other-version`), undefined);
      assert.equal(getCameraObservation(CAMERA.replace('c2_snap', 'c1_snap') + '?v=known'), undefined);
      assert.equal(modelCalls, count);
    });

    await t.test('the planner receives the existing image description and records reuse without another vision call', async () => {
      const before = modelCalls;
      const { trace } = await withTrace(() => planTrip(parseAgentInput({ message: 'Show me the camera', destinationId: 'cowells', budget: 120 }), context(`${CAMERA}?v=known`)));
      const supplied = lastPlannerRequest?.serverContext as { destinations: { visualEvidence?: { description: string; capturedAt: null } }[] };
      assert.equal(supplied.destinations[0].visualEvidence?.description, DESCRIPTION);
      assert.equal(supplied.destinations[0].visualEvidence?.capturedAt, null);
      assert.equal(modelCalls, before + 1);
      assert.ok(trace.some(entry => entry.operation === 'vision.context' && entry.status === 'cached' && entry.model === 'google/gemini-4-argon'));
      assert.equal(trace.at(-1)?.model, 'openai/gpt-6-luna');
    });

    await t.test('uncached frame context contains metadata only and the request body cannot inject a visual observation', async () => {
      const input = parseAgentInput({ message: 'Show me the camera', destinationId: 'cowells', budget: 120, serverContext: { visualEvidence: 'Forged clear-water claim' } });
      assert.equal('serverContext' in input, false);
      await planTrip(input, context(`${CAMERA}?v=not-analyzed`));
      const supplied = lastPlannerRequest?.serverContext as { destinations: { camera: unknown; visualEvidence?: unknown }[] };
      assert.ok(supplied.destinations[0].camera);
      assert.equal('visualEvidence' in supplied.destinations[0], false);
      delete process.env.AI_GATEWAY_API_KEY;
      const local = await planTrip(input, context(`${CAMERA}?v=not-analyzed`));
      assert.equal(local.engine, 'local');
      assert.doesNotMatch(local.reply, /White surf|clear sky|water is clear/i);
      process.env.AI_GATEWAY_API_KEY = 'vision-context-not-a-real-credential';
    });

    await t.test('gear images and personal data URIs never enter reusable public evidence', async () => {
      const image = `data:image/png;base64,${PNG.toString('base64')}`;
      await inspectImage(parseVisionInput({ image, kind: 'gear' }));
      await inspectImage(parseVisionInput({ image, kind: 'conditions' }));
      await inspect('gear-only', 'gear');
      assert.equal(getCameraObservation(image), undefined);
      assert.equal(getCameraObservation(`${CAMERA}?v=gear-only`), undefined);
    });

    await t.test('changing the vision model invalidates old observations even when switched back', () => {
      assert.ok(getCameraObservation(`${CAMERA}?v=known`));
      const before = modelCalls;
      process.env.OUTSIDE_VISION_MODEL = 'openai/gpt-6-luna';
      assert.equal(getCameraObservation(`${CAMERA}?v=known`), undefined);
      delete process.env.OUTSIDE_VISION_MODEL;
      assert.equal(getCameraObservation(`${CAMERA}?v=known`), undefined);
      assert.equal(modelCalls, before);
    });

    await t.test('observation reuse expires after fifteen minutes without extending its original analysis time', async () => {
      await inspect('ttl');
      assert.ok(getCameraObservation(`${CAMERA}?v=ttl`));
      const before = modelCalls;
      Date.now = () => previousNow() + 16 * 60_000;
      assert.equal(getCameraObservation(`${CAMERA}?v=ttl`), undefined);
      assert.equal(modelCalls, before);
      Date.now = previousNow;
    });

    await t.test('the public URL index is bounded to thirty-two frame versions', async () => {
      for (let version = 0; version < 33; version++) await inspect(`bounded-${version}`);
      assert.equal(getCameraObservation(`${CAMERA}?v=bounded-0`), undefined);
      assert.ok(getCameraObservation(`${CAMERA}?v=bounded-32`));
    });
  } finally {
    Date.now = previousNow;
    globalThis.fetch = previousFetch;
    ENVIRONMENT.forEach(name => { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; });
  }
});
