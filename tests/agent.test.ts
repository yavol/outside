import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
// Node's test runner executes the TypeScript source directly.
// @ts-ignore -- Explicit .ts extensions are required by Node's source loader.
import { credentialStatus, InputError, inspectImage, parseAgentInput, parseVisionInput, planTrip, protectPost, readJson } from '../src/lib/agent.ts';

function inputError(fn: () => unknown, status = 400) {
  assert.throws(fn, (error: unknown) => error instanceof InputError && error.status === status);
}

test('planner validates destination, budget, message, and owned categories before inference', () => {
  for (const input of [null, {}, { message: '' }, { message: 'x'.repeat(2_001) }, { message: 'Go', destinationId: 'unknown' }, { message: 'Go', budget: -1 }, { message: 'Go', budget: Infinity }, { message: 'Go', budget: '120' }, { message: 'Go', owned: ['tent'] }, { message: 'Go', forceFallback: 'yes' }]) {
    inputError(() => parseAgentInput(input));
  }
  const accepted = parseAgentInput({ message: '  Go outside  ', destinationId: 'sunset', budget: 0, owned: ['daypack', 'daypack'], forceFallback: true });
  assert.equal(accepted.message, 'Go outside');
  assert.equal(accepted.budget, 0);
  assert.deepEqual(accepted.owned, ['daypack']);
});

test('POST protection accepts same origin and rejects cross-origin browser requests', () => {
  const request = (headers: Record<string, string>) => new Request('https://outside.example/api/agent', { method: 'POST', headers, body: '{}' });
  assert.doesNotThrow(() => protectPost(request({ 'content-type': 'application/json; charset=utf-8', origin: 'https://outside.example', 'sec-fetch-site': 'same-origin' })));
  inputError(() => protectPost(request({ 'content-type': 'application/json', origin: 'https://attacker.example' })), 403);
  inputError(() => protectPost(request({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })), 403);
  inputError(() => protectPost(request({ 'content-type': 'text/plain' })), 415);
});

test('bounded JSON reader rejects oversized streams and malformed JSON', async () => {
  const request = (body: string, headers?: Record<string, string>) => new Request('https://outside.example/api/agent', { method: 'POST', body, headers });
  await assert.rejects(readJson(request('x'.repeat(200)), 100), (error: unknown) => error instanceof InputError && error.status === 413);
  await assert.rejects(readJson(request('{}', { 'content-length': '1000' }), 100), (error: unknown) => error instanceof InputError && error.status === 413);
  await assert.rejects(readJson(request('{broken'), 100), (error: unknown) => error instanceof InputError && error.status === 400);
  assert.deepEqual(await readJson(request('{"message":"outside"}'), 100), { message: 'outside' });
});

test('vision accepts only the exact public cameras and real supported image signatures', () => {
  const camera = 'https://cmgp-coastcam.s3-us-west-2.amazonaws.com/cameras/dreaminn/latest/c2_snap.jpg';
  assert.equal(parseVisionInput({ image: camera, kind: 'conditions' }).image, camera);
  for (const image of ['https://example.com/camera.jpg', 'http://cmgp-coastcam.s3-us-west-2.amazonaws.com/cameras/dreaminn/latest/c2_snap.jpg', 'https://cmgp-coastcam.s3-us-west-2.amazonaws.com/private/photo.jpg', 'https://cmgp-coastcam.s3-us-west-2.amazonaws.com.evil.example/cameras/dreaminn/latest/c2_snap.jpg', 'data:image/jpeg;base64,' + Buffer.from('not really an image').toString('base64')]) {
    inputError(() => parseVisionInput({ image, kind: 'gear' }));
  }
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
  assert.equal(parseVisionInput({ image: png, kind: 'gear' }).image, png);
  inputError(() => parseVisionInput({ image: png.replace('image/png', 'image/jpeg'), kind: 'gear' }));
  inputError(() => parseVisionInput({ image: camera, kind: 'unknown' }));
});

test('local fallback preserves explicit user state and never invents a gear image result', async (t) => {
  const names = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'] as const;
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  names.forEach(name => { delete process.env[name]; });
  try {
    const context: NonNullable<Parameters<typeof planTrip>[1]> = {
      fetchedAt: '2026-10-14T20:00:00.000Z',
      destinations: [
        { id: 'cowells', name: 'Cowell Beach', description: 'Wharf-side coastal walk', tags: ['Coastal walk'], weather: { kind: 'forecast', status: 'available', temperatureF: 61, windMph: 12, shortForecast: 'Cloudy', precipitationChance: 10 } },
        { id: 'main-beach', name: 'Santa Cruz Main Beach', description: 'Boardwalk beach', tags: ['Boardwalk'], weather: { kind: 'forecast', status: 'available', temperatureF: 64, windMph: 8, shortForecast: 'Partly Sunny', precipitationChance: 10 } },
        { id: 'sunset', name: 'Sunset State Beach', description: 'Remote dunes and beach', tags: ['Dunes'], weather: { kind: 'forecast', status: 'available', temperatureF: 68, windMph: 5, shortForecast: 'Sunny', precipitationChance: 0 } },
      ],
    };
    await t.test('cheaper blue gear keeps the selected beach, owned item, and exact budget', async () => {
      const result = await planTrip(parseAgentInput({ message: 'Find a cheaper option in blue', destinationId: 'cowells', budget: 120, owned: ['daypack'], forceFallback: true }));
      assert.equal(result.engine, 'local');
      assert.equal(result.model, 'local-planner');
      assert.equal(result.fallback, true);
      assert.equal(result.selectedDestinationId, 'cowells');
      assert.equal(result.budget, 120);
      assert.equal(result.action, 'cheaper');
      assert.deepEqual(result.owned, ['daypack']);
      assert.match(result.reply, /local planner/i);
    });
    await t.test('explicit ownership is recorded but negative ownership is not', async () => {
      const positive = await planTrip(parseAgentInput({ message: 'I already have a backpack. Keep missing gear under $80.', destinationId: 'sunset' }));
      assert.equal(positive.budget, 80);
      assert.deepEqual(positive.owned, ['daypack']);
      const negative = await planTrip(parseAgentInput({ message: 'I have no backpack. My budget is $79.50.', destinationId: 'sunset', owned: ['bottle'] }));
      assert.equal(negative.budget, 79.5);
      assert.deepEqual(negative.owned, ['bottle']);
    });
    await t.test('a vague owned-item request opens scanning without declaring ownership', async () => {
      const result = await planTrip(parseAgentInput({ message: 'I already have this', budget: 0 }));
      assert.equal(result.action, 'scan');
      assert.equal(result.budget, 0);
      assert.deepEqual(result.owned, []);
    });
    await t.test('warm preference compares actual available forecast temperatures', async () => {
      const result = await planTrip(parseAgentInput({ message: 'Compare the beaches and choose somewhere warmer', destinationId: 'cowells' }), context);
      assert.equal(result.selectedDestinationId, 'sunset');
      assert.match(result.reply, /Cowell Beach: 61°F/);
      assert.match(result.reply, /Main Beach: 64°F/);
      assert.match(result.reply, /Sunset State Beach: 68°F/);
      assert.match(result.reply, /forecasts/i);
      const namedComparison = await planTrip(parseAgentInput({ message: 'Which is warmer, Cowells or Main Beach?', destinationId: 'cowells' }), context);
      assert.equal(namedComparison.selectedDestinationId, 'main-beach');
    });
    await t.test('quiet preference uses remote place metadata without inventing crowd measurements', async () => {
      const result = await planTrip(parseAgentInput({ message: 'Choose a quiet beach', destinationId: 'cowells' }), context);
      assert.equal(result.selectedDestinationId, 'sunset');
      assert.match(result.reply, /crowd levels are not measured/i);
      assert.match(result.reply, /68°F/);
    });
    await t.test('stale warmer forecasts cannot win a current-weather comparison', async () => {
      const stale = structuredClone(context);
      stale.destinations[2].weather.status = 'stale';
      stale.destinations[2].weather.temperatureF = 90;
      const result = await planTrip(parseAgentInput({ message: 'Choose somewhere warmer', destinationId: 'cowells' }), stale);
      assert.equal(result.selectedDestinationId, 'main-beach');
      assert.doesNotMatch(result.reply, /90°F/);
    });
    await t.test('trusted visual evidence describes the selected frame without inventing capture freshness', async () => {
      const withVision = structuredClone(context);
      withVision.destinations[0].visualEvidence = { description: 'A cloud bank covers the horizon.', model: 'verified-image-model', imageUrl: 'https://cmgp-coastcam.s3-us-west-2.amazonaws.com/cameras/dreaminn/latest/c2_snap.jpg', capturedAt: null };
      const result = await planTrip(parseAgentInput({ message: 'Show me the camera', destinationId: 'cowells' }), withVision);
      assert.match(result.reply, /cloud bank/);
      assert.match(result.reply, /printed capture time/);
      assert.doesNotMatch(result.reply, /live|real-time/);
    });
    await t.test('unavailable image model returns no category or invented description', async () => {
      const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
      const result = await inspectImage(parseVisionInput({ image, kind: 'gear' }));
      assert.equal(result.engine, 'local');
      assert.equal(result.model, 'unavailable');
      assert.equal(result.category, null);
      assert.equal(result.confidence, 0);
      assert.match(result.description, /couldn’t analyze/i);
    });
    await t.test('health reports booleans and never returns credential values', () => {
      process.env.AI_GATEWAY_API_KEY = 'test-credential-must-never-be-returned';
      const status = credentialStatus();
      assert.equal(status.gateway, true);
      assert.equal(status.gatewayApiKey, true);
      assert.equal(status.gemini, false);
      assert.ok(Object.values(status).every(value => typeof value === 'boolean'));
      assert.doesNotMatch(JSON.stringify(status), /test-credential/);
      delete process.env.AI_GATEWAY_API_KEY;
    });
  } finally {
    names.forEach(name => { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; });
  }
});
