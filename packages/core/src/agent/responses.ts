import {
  ModelAuthError,
  ModelError,
  type ModelClient,
  type ModelMessage,
  type ModelResponse,
  type ModelToolDefinition,
  type ModelToolResultBlock,
  type ModelToolUseBlock,
} from './model.js';

type ResponseInputItem =
  | { role: 'user' | 'assistant'; content: { type: 'input_text' | 'output_text'; text: string }[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

interface ResponseOutputItem {
  type: string;
  content?: { type: string; text?: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
}

interface ResponsesApiPayload {
  output?: ResponseOutputItem[];
  status?: string;
  incomplete_details?: { reason?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

/** Map our transcript onto Responses API input items. Exported for tests. */
export function toResponseInput(messages: ModelMessage[]): ResponseInputItem[] {
  // Collect tool results up front: each output is emitted immediately after
  // its call. The endpoint rejects adjacent same-type function items, so
  // parallel calls are interleaved as call/output pairs rather than grouped.
  const outputs = new Map<string, ModelToolResultBlock>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const block of message.content) {
      if (block.type === 'tool_result') outputs.set(block.tool_use_id, block);
    }
  }
  const emitted = new Set<string>();
  const items: ResponseInputItem[] = [];
  const pushOutput = (callId: string): void => {
    const result = outputs.get(callId);
    if (!result || emitted.has(callId)) return;
    emitted.add(callId);
    items.push({
      type: 'function_call_output',
      call_id: result.tool_use_id,
      output: result.is_error ? `Error: ${result.content}` : result.content,
    });
  };
  for (const message of messages) {
    if (message.role === 'user') {
      const texts = message.content
        .filter((block) => block.type === 'text')
        .map((block) => ({ type: 'input_text' as const, text: block.text }));
      if (texts.length > 0) items.push({ role: 'user', content: texts });
      for (const block of message.content) {
        if (block.type === 'tool_result') pushOutput(block.tool_use_id);
      }
    } else {
      const texts = message.content
        .filter((block) => block.type === 'text')
        .map((block) => ({ type: 'output_text' as const, text: block.text }));
      if (texts.length > 0) items.push({ role: 'assistant', content: texts });
      for (const block of message.content) {
        if (block.type !== 'tool_use') continue;
        const call = block as ModelToolUseBlock;
        items.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.input),
        });
        pushOutput(call.id);
      }
    }
  }
  return items;
}

/** Map a Responses API payload onto our model response. Exported for tests. */
export function fromResponseOutput(payload: ResponsesApiPayload): ModelResponse {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const texts: string[] = [];
  const toolCalls: ModelResponse['toolCalls'] = [];
  for (const item of output) {
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
      }
    } else if (item.type === 'function_call' && item.call_id && item.name) {
      let input: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(item.arguments ?? '{}');
        if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>;
      } catch {
        input = {};
      }
      toolCalls.push({ type: 'tool_use', id: item.call_id, name: item.name, input });
    }
  }
  const stopReason =
    toolCalls.length > 0
      ? 'tool_use'
      : payload.status === 'incomplete' && payload.incomplete_details?.reason === 'max_output_tokens'
        ? 'max_tokens'
        : (payload.status ?? null);
  return {
    text: texts.join('\n'),
    toolCalls,
    stopReason,
    usage: {
      inputTokens: payload.usage?.input_tokens ?? null,
      outputTokens: payload.usage?.output_tokens ?? null,
    },
  };
}

const TRANSIENT_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

function delayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}

/**
 * Client for OpenAI Responses-API-compatible endpoints (e.g. Meta's Muse
 * API). Stateless: the orchestrator owns the transcript (store: false).
 */
export class ResponsesApiClient implements ModelClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(options: {
    apiKey: string;
    model: string;
    baseUrl: string;
    maxTokens?: number;
    timeoutMs?: number;
  }) {
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/responses`;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 4096;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async complete(
    messages: ModelMessage[],
    tools: ModelToolDefinition[],
    system: string,
  ): Promise<ModelResponse> {
    const body = {
      model: this.model,
      instructions: system,
      input: toResponseInput(messages),
      tools: tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      })),
      tool_choice: 'auto',
      max_output_tokens: this.maxTokens,
      store: false,
      stream: false,
    };
    let lastError = 'unknown error';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delayMs(attempt)));
      let res: Response;
      try {
        res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new ModelAuthError(
          'Model authentication failed. Set a valid RACES_MODEL_API_KEY for the worker.',
        );
      }
      if (!res.ok && !TRANSIENT_STATUSES.has(res.status)) {
        const text = await res.text().catch(() => '').then((t) => t.slice(0, 500));
        if (process.env.RACES_MODEL_DEBUG === '1') {
          console.error(
            `[model-debug] request body for HTTP ${res.status}:\n${JSON.stringify(body).slice(0, 20000)}`,
          );
        }
        throw new ModelError(`Model request failed (${res.status}): ${text}`);
      }
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const payload = (await res.json().catch(() => null)) as ResponsesApiPayload | null;
      if (!payload || typeof payload !== 'object') {
        lastError = 'invalid JSON response';
        continue;
      }
      if (payload.error) {
        throw new ModelError(`Model request failed: ${payload.error.message ?? 'unknown error'}`);
      }
      return fromResponseOutput(payload);
    }
    throw new ModelError(`Model request failed after retries: ${lastError}`);
  }
}
