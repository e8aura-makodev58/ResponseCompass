import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { InferenceClient } from '../src/providers/inference.js';
import { ProviderInferenceClient } from '../src/providers/inference.js';
import { ProviderSettingsStore } from '../src/providers/settingsStore.js';
import { DataPaths } from '../src/store/paths.js';
import { getJson, makeDataRoot, postJson, removeDataRoot, startApp, type TestApp } from './helpers.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

function selection(provider: 'openai' | 'openrouter') {
  return { provider, model: 'model-test', apiKey: 'secret-key-never-public' } as const;
}

describe('provider inference adapters', () => {
  it('uses OpenAI Responses strict JSON schema and parses bounded output', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const client = new ProviderInferenceClient(async (input, init) => {
      request = { url: String(input), ...(init === undefined ? {} : { init }) };
      return Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ stationId: 's1', issueClass: 'SOFTWARE', rationale: 'bounded' }) }] }] });
    });
    const result = await client.proposeMes(selection('openai'), { roomId: 'r', revision: 1, simulatedAt: '2026-01-01T00:00:00Z', freeStationIds: ['s1'], issueClasses: ['SOFTWARE'] });
    assert.equal(result.ok, true);
    assert.equal(request?.url, 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(request?.init?.headers).get('authorization'), 'Bearer secret-key-never-public');
    const body = JSON.parse(String(request?.init?.body));
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.match(body.instructions, /supplied freeStationId and issueClass/);
    assert.equal('tools' in body, false);
  });

  it('uses OpenRouter chat completions and rejects malformed or oversized output safely', async () => {
    let body: any;
    const client = new ProviderInferenceClient(async (input, init) => {
      assert.equal(String(input), 'https://openrouter.ai/api/v1/chat/completions');
      body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: '{"winnerId":"missing-fields"}' } }] });
    });
    const result = await client.rankCompass(selection('openrouter'), { roomId: 'r', revision: 1, issueId: 'i', candidates: [{ responderId: 'a' }] });
    assert.deepEqual(result, { ok: false, reason: 'INVALID_SCHEMA' });
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.messages[0].role, 'system');
    assert.match(body.messages[0].content, /Rank every supplied eligible responder exactly once/);
    assert.equal('tools' in body, false);

    const oversized = new ProviderInferenceClient(async () => new Response('x', { headers: { 'content-length': '70000' } }));
    assert.deepEqual(await oversized.proposeMes(selection('openai'), { roomId: 'r', revision: 1, simulatedAt: 'x', freeStationIds: ['s'], issueClasses: ['SOFTWARE'] }), { ok: false, reason: 'OVERSIZED_RESPONSE' });
  });

  it('parses a valid OpenRouter Compass ranking', async () => {
    const value = { rankedCandidateIds: ['b', 'a'], winnerId: 'b', meaningfulAlternativeId: 'a', explanation: 'Public facts only.', uncertainty: 'Limited history.' };
    const client = new ProviderInferenceClient(async () => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }));
    const result = await client.rankCompass(selection('openrouter'), { roomId: 'r', revision: 1, issueId: 'i', candidates: [{ responderId: 'a' }, { responderId: 'b' }] });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, value);
  });

  it('normalizes upstream HTTP, refusal, empty, timeout, and network failures', async () => {
    const packet = { roomId: 'r', revision: 1, simulatedAt: 'x', freeStationIds: ['s'], issueClasses: ['SOFTWARE'] };
    const cases: Array<[typeof fetch, string]> = [
      [async () => Response.json({ error: 'secret upstream body' }, { status: 500 }), 'HTTP_ERROR'],
      [async () => Response.json({ output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }), 'REFUSAL'],
      [async () => Response.json({ output: [] }), 'EMPTY_RESPONSE'],
      [async () => { throw new DOMException('timed out', 'AbortError'); }, 'TIMEOUT'],
      [async () => { throw new Error('network contains secret'); }, 'NETWORK'],
    ];
    for (const [fakeFetch, reason] of cases) {
      const result = await new ProviderInferenceClient(fakeFetch).proposeMes(selection('openai'), packet);
      assert.deepEqual(result, { ok: false, reason });
      assert.doesNotMatch(JSON.stringify(result), /upstream body|contains secret/);
    }
  });
});

async function configuredApp(client: InferenceClient, enabled = true) {
  const dataRoot = await makeDataRoot();
  const paths = new DataPaths(dataRoot);
  const settings = new ProviderSettingsStore(paths, {}, async () => Response.json({ data: [{ id: 'model-test' }] }));
  await settings.saveCredential('openai', 'secret-key-never-public');
  await settings.selectCompass('openai', 'model-test');
  const logs: Array<Record<string, string | number>> = [];
  const app = await startApp(dataRoot, settings, (line) => logs.push(line), { providersEnabled: enabled, inferenceClient: client });
  cleanups.push(async () => { await app.close(); await removeDataRoot(dataRoot); });
  return { app, logs };
}

describe('MES and Compass inference orchestration', () => {
  it('applies valid provider choices while preserving application-owned issue fields', async () => {
    let mesPacket: any;
    const client: InferenceClient = {
      async proposeMes(runtime, packet) {
        mesPacket = packet;
        return { ok: true, provider: runtime.provider, model: runtime.model, value: { stationId: packet.freeStationIds.at(-1)!, issueClass: 'SOFTWARE', rationale: 'Synthetic demand signal.' } };
      },
      async rankCompass(runtime, packet) {
        const ids = packet.candidates.map((candidate) => String(candidate['responderId'])).reverse();
        return { ok: true, provider: runtime.provider, model: runtime.model, value: { rankedCandidateIds: ids, winnerId: ids[0]!, meaningfulAlternativeId: ids.length > 1 ? ids[1]! : null, explanation: 'Balanced public evidence.', uncertainty: 'Outcome history is limited.' } };
      },
    };
    const { app, logs } = await configuredApp(client);
    const before = await getJson(`${app.baseUrl}/api/rooms/plant-1`);
    const cursorBefore = (await app.registry.get('plant-1')!.store.readHiddenTruth()).randomStream.cursor;
    const triggered = await postJson(`${app.baseUrl}/api/rooms/plant-1/trigger`, { expectedRevision: before.body.room.revision });
    assert.equal(triggered.status, 200);
    assert.equal(triggered.body.eventProposal.source, 'PROVIDER');
    assert.equal(triggered.body.eventProposal.stationId, mesPacket.freeStationIds.at(-1));
    const issue = triggered.body.room.issues.find((candidate: any) => candidate.raisedAt === triggered.body.room.simulatedAt);
    assert.equal(issue.class, 'SOFTWARE');
    assert.match(issue.id, /^plant-1-iss-/);
    const canonicalIssue = (await app.registry.get('plant-1')!.store.read()).issues.find((candidate) => candidate.id === issue.id);
    assert.equal(typeof canonicalIssue?.riskImpact, 'number');
    assert.equal(typeof canonicalIssue?.complexity, 'number');
    assert.equal((await app.registry.get('plant-1')!.store.readHiddenTruth()).randomStream.cursor, cursorBefore + 4);

    const offered = await postJson(`${app.baseUrl}/api/rooms/plant-1/offers`, { expectedRevision: triggered.body.room.revision });
    assert.equal(offered.status, 201);
    assert.equal(offered.body.recommendation.source, 'PROVIDER');
    assert.equal(offered.body.offer.responderId, offered.body.recommendation.winnerId);
    assert.equal(offered.body.recommendation.provider, 'openai');
    const canonicalOffer = (await app.registry.get('plant-1')!.store.read()).offers.find((candidate) => candidate.id === offered.body.offer.id);
    assert.deepEqual(canonicalOffer?.rankedCandidateIds, offered.body.recommendation.candidates.map((candidate: any) => candidate.responderId));
    const exposed = JSON.stringify({ triggered: triggered.body, offered: offered.body, logs });
    assert.doesNotMatch(exposed, /secret-key-never-public|Bearer/);
    assert.doesNotMatch(JSON.stringify(offered.body.room.audits), /Balanced public evidence|Outcome history/);
  });

  it('falls back correctly for disabled, offline, failed, and semantically invalid inference', async () => {
    let calls = 0;
    const invalid: InferenceClient = {
      async proposeMes() { calls += 1; return { ok: false, reason: 'HTTP_ERROR' }; },
      async rankCompass(runtime, packet) {
        calls += 1;
        const ids = packet.candidates.map((candidate) => String(candidate['responderId']));
        return { ok: true, provider: runtime.provider, model: runtime.model, value: { rankedCandidateIds: [ids[0]!, ids[0]!], winnerId: ids[0]!, meaningfulAlternativeId: ids[0]!, explanation: 'invalid', uncertainty: 'invalid' } };
      },
    };
    const disabled = await configuredApp(invalid, false);
    const d0 = await getJson(`${disabled.app.baseUrl}/api/rooms/plant-1`);
    const offer = await postJson(`${disabled.app.baseUrl}/api/rooms/plant-1/offers`, { expectedRevision: d0.body.room.revision });
    assert.equal(offer.body.recommendation.source, 'DETERMINISTIC_FALLBACK');
    assert.equal(offer.body.recommendation.fallbackReason, 'PROVIDERS_DISABLED');
    assert.equal(calls, 0, 'disabled gate must run before credentials/client');

    const failed = await configuredApp(invalid, true);
    const f0 = await getJson(`${failed.app.baseUrl}/api/rooms/plant-1`);
    const trigger = await postJson(`${failed.app.baseUrl}/api/rooms/plant-1/trigger`, { expectedRevision: f0.body.room.revision });
    assert.equal(trigger.body.eventProposal.source, 'DETERMINISTIC_FALLBACK');
    assert.equal(trigger.body.eventProposal.fallbackReason, 'HTTP_ERROR');
    const f1 = await getJson(`${failed.app.baseUrl}/api/rooms/plant-1`);
    const badRank = await postJson(`${failed.app.baseUrl}/api/rooms/plant-1/offers`, { expectedRevision: f1.body.room.revision });
    assert.equal(badRank.body.recommendation.source, 'DETERMINISTIC_FALLBACK');
    assert.equal(badRank.body.recommendation.fallbackReason, 'INVALID_SCHEMA');

    const current = await failed.app.registry.get('plant-2')!.store.read();
    await failed.app.registry.get('plant-2')!.store.mutate(current.revision, (draft) => { draft.mode = 'OFFLINE'; });
    const offline = await getJson(`${failed.app.baseUrl}/api/rooms/plant-2`);
    const callsBefore = calls;
    const offlineTrigger = await postJson(`${failed.app.baseUrl}/api/rooms/plant-2/trigger`, { expectedRevision: offline.body.room.revision });
    assert.equal(offlineTrigger.body.eventProposal.fallbackReason, 'ROOM_OFFLINE');
    assert.equal(calls, callsBefore);
  });

  it('rejects a provider result made stale by a competing mutation without fallback mutation', async () => {
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const client: InferenceClient = {
      async proposeMes() { return { ok: false, reason: 'HTTP_ERROR' }; },
      async rankCompass(runtime, packet) {
        started(); await wait;
        const ids = packet.candidates.map((candidate) => String(candidate['responderId']));
        return { ok: true, provider: runtime.provider, model: runtime.model, value: { rankedCandidateIds: ids, winnerId: ids[0]!, meaningfulAlternativeId: ids[1] ?? null, explanation: 'stale', uncertainty: 'stale' } };
      },
    };
    const { app } = await configuredApp(client);
    const before = await getJson(`${app.baseUrl}/api/rooms/plant-1`);
    const pending = postJson(`${app.baseUrl}/api/rooms/plant-1/offers`, { expectedRevision: before.body.room.revision });
    await began;
    await app.registry.get('plant-1')!.store.mutate(before.body.room.revision, (draft) => { draft.displayName = 'Competing mutation'; });
    release();
    const response = await pending;
    assert.equal(response.status, 409);
    const after = await getJson(`${app.baseUrl}/api/rooms/plant-1`);
    assert.equal(after.body.room.offers.length, before.body.room.offers.length);
  });
});
