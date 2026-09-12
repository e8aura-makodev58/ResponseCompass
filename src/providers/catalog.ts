import { ApiError } from '../http/errors.js';

export const PROVIDER_IDS = ['openai', 'openrouter'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderModel {
  id: string;
  name: string;
}

const ENDPOINTS: Record<ProviderId, string> = {
  openai: 'https://api.openai.com/v1/models',
  openrouter: 'https://openrouter.ai/api/v1/models?output_modalities=text',
};

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_MODELS = 2_000;

export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.includes(value as ProviderId);
}

export async function discoverModels(
  provider: ProviderId,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderModel[]> {
  let response: Response;
  try {
    response = await fetchImpl(ENDPOINTS[provider], {
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new ApiError('PROVIDER_UNAVAILABLE', `${displayProvider(provider)} model discovery is unavailable.`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ApiError('INVALID_CREDENTIAL', `${displayProvider(provider)} rejected the API key.`);
  }
  if (!response.ok) {
    throw new ApiError('PROVIDER_UNAVAILABLE', `${displayProvider(provider)} model discovery failed.`);
  }
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new ApiError('PROVIDER_UNAVAILABLE', `${displayProvider(provider)} returned an oversized model catalog.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('PROVIDER_UNAVAILABLE', `${displayProvider(provider)} returned an invalid model catalog.`);
  }
  const data = record(body)?.['data'];
  if (!Array.isArray(data)) {
    throw new ApiError('PROVIDER_UNAVAILABLE', `${displayProvider(provider)} returned an invalid model catalog.`);
  }

  const unique = new Map<string, ProviderModel>();
  for (const item of data.slice(0, MAX_MODELS)) {
    const model = record(item);
    const id = safeText(model?.['id'], 200);
    if (id === null) continue;
    const name = provider === 'openrouter'
      ? safeText(model?.['name'], 200) ?? id
      : id;
    unique.set(id, { id, name });
  }
  const models = [...unique.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  if (models.length === 0) {
    throw new ApiError('PROVIDER_UNAVAILABLE', `${displayProvider(provider)} returned no selectable models.`);
  }
  return models;
}

export function displayProvider(provider: ProviderId): string {
  return provider === 'openai' ? 'OpenAI' : 'OpenRouter';
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed !== '' && trimmed.length <= maxLength ? trimmed : null;
}
