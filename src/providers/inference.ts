import type { ProviderId } from './catalog.js';
import type { RuntimeSelection } from './settingsStore.js';

const TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type InferenceFailure =
  | 'PROVIDERS_DISABLED' | 'ROOM_OFFLINE' | 'NO_RUNTIME_SELECTION'
  | 'TIMEOUT' | 'NETWORK' | 'HTTP_ERROR' | 'REFUSAL' | 'EMPTY_RESPONSE'
  | 'OVERSIZED_RESPONSE' | 'INVALID_JSON' | 'INVALID_SCHEMA';

export type InferenceResult<T> =
  | { ok: true; value: T; provider: ProviderId; model: string }
  | { ok: false; reason: InferenceFailure };

export interface MesPacket {
  roomId: string;
  revision: number;
  simulatedAt: string;
  freeStationIds: string[];
  issueClasses: string[];
}

export interface MesProposal {
  stationId: string;
  issueClass: string;
  rationale: string;
}

export interface CompassPacket {
  roomId: string;
  revision: number;
  issueId: string;
  candidates: Array<Record<string, string | number | null>>;
}

export interface CompassDecision {
  rankedCandidateIds: string[];
  winnerId: string;
  meaningfulAlternativeId: string | null;
  explanation: string;
  uncertainty: string;
}

export interface InferenceClient {
  proposeMes(selection: RuntimeSelection, packet: MesPacket): Promise<InferenceResult<MesProposal>>;
  rankCompass(selection: RuntimeSelection, packet: CompassPacket): Promise<InferenceResult<CompassDecision>>;
}

export class ProviderInferenceClient implements InferenceClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  proposeMes(selection: RuntimeSelection, packet: MesPacket): Promise<InferenceResult<MesProposal>> {
    return this.request(selection, 'mes_event_proposal', packet, mesSchema(), validateMes);
  }

  rankCompass(selection: RuntimeSelection, packet: CompassPacket): Promise<InferenceResult<CompassDecision>> {
    return this.request(selection, 'compass_candidate_ranking', packet, compassSchema(), validateCompass);
  }

  private async request<T>(
    selection: RuntimeSelection,
    schemaName: string,
    packet: unknown,
    schema: Record<string, unknown>,
    validate: (value: unknown) => T | null,
  ): Promise<InferenceResult<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const prompt = JSON.stringify(packet);
      const response = await this.fetchImpl(endpoint(selection.provider), {
        method: 'POST',
        headers: { authorization: `Bearer ${selection.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(requestBody(selection, schemaName, schema, prompt)),
        signal: controller.signal,
      });
      if (!response.ok) return { ok: false, reason: 'HTTP_ERROR' };
      const length = Number(response.headers.get('content-length') ?? '0');
      if (length > MAX_RESPONSE_BYTES) return { ok: false, reason: 'OVERSIZED_RESPONSE' };
      const raw = await response.text();
      if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) return { ok: false, reason: 'OVERSIZED_RESPONSE' };
      let envelope: unknown;
      try { envelope = JSON.parse(raw); } catch { return { ok: false, reason: 'INVALID_JSON' }; }
      const extracted = extractText(selection.provider, envelope);
      if (extracted === 'REFUSAL') return { ok: false, reason: 'REFUSAL' };
      if (extracted === null || extracted === '') return { ok: false, reason: 'EMPTY_RESPONSE' };
      let value: unknown;
      try { value = JSON.parse(extracted); } catch { return { ok: false, reason: 'INVALID_JSON' }; }
      const valid = validate(value);
      return valid === null
        ? { ok: false, reason: 'INVALID_SCHEMA' }
        : { ok: true, value: valid, provider: selection.provider, model: selection.model };
    } catch (error) {
      return { ok: false, reason: (error as Error).name === 'AbortError' ? 'TIMEOUT' : 'NETWORK' };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function endpoint(provider: ProviderId): string {
  return provider === 'openai'
    ? 'https://api.openai.com/v1/responses'
    : 'https://openrouter.ai/api/v1/chat/completions';
}

function requestBody(provider: RuntimeSelection, name: string, schema: Record<string, unknown>, prompt: string): unknown {
  const common = { type: 'json_schema', json_schema: { name, strict: true, schema } };
  const instructions = taskInstructions(name);
  return provider.provider === 'openai'
    ? { model: provider.model, max_output_tokens: 800, instructions, input: [{ role: 'user', content: prompt }], text: { format: { type: 'json_schema', name, strict: true, schema } } }
    : { model: provider.model, max_tokens: 800, messages: [{ role: 'system', content: instructions }, { role: 'user', content: prompt }], response_format: common };
}

function taskInstructions(name: string): string {
  return name === 'mes_event_proposal'
    ? 'Choose exactly one plausible next synthetic manufacturing issue using only a supplied freeStationId and issueClass. Do not invent facts, identifiers, measurements, priority, or actions. Give a short qualitative rationale.'
    : 'Rank every supplied eligible responder exactly once using only the supplied public candidate facts. The first ID is the winner. Identify a distinct meaningful alternative when one exists. Do not change eligibility, invent evidence, or provide numeric confidence; state concise qualitative reasoning and uncertainty.';
}

function extractText(provider: ProviderId, value: unknown): string | null | 'REFUSAL' {
  if (!record(value)) return null;
  if (provider === 'openrouter') {
    const choices = value['choices'];
    const message = Array.isArray(choices) && record(choices[0]) ? choices[0]['message'] : null;
    if (!record(message)) return null;
    if (typeof message['refusal'] === 'string' && message['refusal'] !== '') return 'REFUSAL';
    return typeof message['content'] === 'string' ? message['content'] : null;
  }
  const output = value['output'];
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!record(item) || !Array.isArray(item['content'])) continue;
    for (const content of item['content']) {
      if (!record(content)) continue;
      if (content['type'] === 'refusal') return 'REFUSAL';
      if (content['type'] === 'output_text' && typeof content['text'] === 'string') return content['text'];
    }
  }
  return null;
}

function validateMes(value: unknown): MesProposal | null {
  if (!exactRecord(value, ['stationId', 'issueClass', 'rationale'])) return null;
  return bounded(value['stationId'], 100) && bounded(value['issueClass'], 40) && bounded(value['rationale'], 400)
    ? { stationId: value['stationId'], issueClass: value['issueClass'], rationale: value['rationale'] }
    : null;
}

function validateCompass(value: unknown): CompassDecision | null {
  if (!exactRecord(value, ['rankedCandidateIds', 'winnerId', 'meaningfulAlternativeId', 'explanation', 'uncertainty'])) return null;
  const ids = value['rankedCandidateIds'];
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 12 || ids.some((id) => !bounded(id, 100))) return null;
  const alternative = value['meaningfulAlternativeId'];
  if (!bounded(value['winnerId'], 100) || !(alternative === null || bounded(alternative, 100)) || !bounded(value['explanation'], 400) || !bounded(value['uncertainty'], 240)) return null;
  return { rankedCandidateIds: ids, winnerId: value['winnerId'], meaningfulAlternativeId: alternative, explanation: value['explanation'], uncertainty: value['uncertainty'] };
}

function mesSchema(): Record<string, unknown> { return objectSchema({ stationId: { type: 'string', maxLength: 100 }, issueClass: { type: 'string', maxLength: 40 }, rationale: { type: 'string', maxLength: 400 } }); }
function compassSchema(): Record<string, unknown> { return objectSchema({ rankedCandidateIds: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', maxLength: 100 } }, winnerId: { type: 'string', maxLength: 100 }, meaningfulAlternativeId: { type: ['string', 'null'], maxLength: 100 }, explanation: { type: 'string', maxLength: 400 }, uncertainty: { type: 'string', maxLength: 240 } }); }
function objectSchema(properties: Record<string, unknown>): Record<string, unknown> { return { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) }; }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactRecord(value: unknown, keys: string[]): value is Record<string, any> { return record(value) && Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function bounded(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
