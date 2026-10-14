import { AsyncLocalStorage } from 'node:async_hooks';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

export type AITrace = {
  id: string;
  time: string;
  provider: string;
  model: string;
  operation: string;
  status: 'success' | 'error' | 'cached' | 'local';
  request: unknown;
  response: unknown;
  durationMs: number;
  usage?: unknown;
  error?: string;
  endpoint?: string;
  fallback?: boolean;
};

type TraceEntry = Omit<AITrace, 'id' | 'time'>;
type TraceContext = { entries: AITrace[]; bytes: number };
const scope = new AsyncLocalStorage<TraceContext>();
const MAX_ENTRIES = 32;
const MAX_TRACE_BYTES = 512_000;
const MAX_STRING_CHARS = 96_000;
const PRIVATE_KEY = /^(?:authorization|proxy-authorization|x-goog-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|password|secret|credential|credentials|organization[-_]?id|account[-_]?id)$/i;

function secrets() {
  return Object.entries(process.env)
    .filter(([key, value]) => /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/.test(key) && value && value.length >= 8)
    .map(([, value]) => value!)
    .sort((a, b) => b.length - a.length);
}

function imagePlaceholder(mime: string, base64: string) {
  return `[${mime} image: ${Buffer.byteLength(base64.replace(/\s/g, ''), 'base64')} bytes]`;
}

function audioPlaceholder(mime: string, base64: string) {
  return `[${mime} audio: ${Buffer.byteLength(base64.replace(/\s/g, ''), 'base64')} bytes]`;
}

function cleanString(value: string, privateValues: string[]) {
  let result = value.replace(/data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)/g, (_whole, mime: string, data: string) => imagePlaceholder(mime, data));
  result = result.replace(/data:(audio\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)/g, (_whole, mime: string, data: string) => audioPlaceholder(mime, data));
  for (const secret of privateValues) {
    if (result.includes(secret)) result = result.replaceAll(secret, '[REDACTED]');
  }
  result = result.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]');
  result = result.replace(/([?&](?:key|api_key|token|access_token)=)[^&#\s"']+/gi, '$1[REDACTED]');
  if (result.length > MAX_STRING_CHARS) result = `${result.slice(0, MAX_STRING_CHARS)}\n[truncated ${result.length - MAX_STRING_CHARS} characters]`;
  return result;
}

/** Defensive sanitization also protects future integrations that accidentally pass headers. */
export function sanitizeTraceValue(value: unknown): unknown {
  const privateValues = secrets();
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (typeof item === 'string') return cleanString(item, privateValues);
    if (item === null || typeof item === 'number' || typeof item === 'boolean') return item;
    if (item === undefined) return null;
    if (depth > 14) return '[nested data truncated]';
    if (typeof item !== 'object') return String(item);
    if (seen.has(item)) return '[circular reference]';
    seen.add(item);
    try {
      if (item instanceof Error) return { name: item.name, message: cleanString(item.message, privateValues) };
      if (Array.isArray(item)) {
        const result = item.slice(0, 256).map(value => visit(value, depth + 1));
        if (item.length > 256) result.push(`[${item.length - 256} additional items truncated]`);
        return result;
      }
      const record = item as Record<string, unknown>;
      const mime = typeof record.mimeType === 'string' ? record.mimeType : typeof record.mime_type === 'string' ? record.mime_type : typeof record.mediaType === 'string' ? record.mediaType : '';
      const result: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(record).slice(0, 128)) {
        if (PRIVATE_KEY.test(key)) { result[key] = '[REDACTED]'; continue; }
        if (key === 'reasoning_content' || key === 'reasoning_details' || (record.thought === true && key === 'text')) { result[key] = '[provider reasoning omitted]'; continue; }
        if ((key === 'audio' || key === 'data' && mime.startsWith('audio/') || /^(?:audio_base64|audioBase64)$/i.test(key)) && typeof raw === 'string') {
          result[key] = audioPlaceholder(mime.startsWith('audio/') ? mime : 'audio/unknown', raw);
          continue;
        }
        if ((key === 'data' && mime.startsWith('image/') || /^(?:b64_json|image_base64|base64)$/i.test(key)) && typeof raw === 'string') {
          result[key] = imagePlaceholder(mime || 'image', raw);
          continue;
        }
        result[key] = visit(raw, depth + 1);
      }
      return result;
    } finally { seen.delete(item); }
  };
  return visit(value, 0);
}

function sanitizedEndpoint(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch { return cleanString(value.split('?')[0].split('#')[0], secrets()); }
}

/** Records only within the current request; there is no process-wide event history. */
export function recordTrace(entry: TraceEntry): void {
  const context = scope.getStore();
  if (!context || context.entries.length >= MAX_ENTRIES) return;
  const safe = sanitizeTraceValue({ ...entry, endpoint: sanitizedEndpoint(entry.endpoint) }) as TraceEntry;
  const value: AITrace = { ...safe, id: randomUUID(), time: new Date().toISOString(), durationMs: Number.isFinite(entry.durationMs) ? Math.max(0, Math.round(entry.durationMs)) : 0 };
  let bytes = Buffer.byteLength(JSON.stringify(value));
  if (context.bytes + bytes > MAX_TRACE_BYTES) {
    value.request = '[request omitted: request trace size limit reached]';
    value.response = '[response omitted: request trace size limit reached]';
    bytes = Buffer.byteLength(JSON.stringify(value));
  }
  if (context.bytes + bytes > MAX_TRACE_BYTES) return;
  context.entries.push(value);
  context.bytes += bytes;
}

/** Wrap an API boundary, then return trace only to the caller of that request. */
export async function withTrace<T>(callback: () => Promise<T>): Promise<{ result: T; trace: AITrace[] }> {
  const context: TraceContext = { entries: [], bytes: 0 };
  return scope.run(context, async () => {
    const result = await callback();
    return { result, trace: context.entries.slice() };
  });
}
