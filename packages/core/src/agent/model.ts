import Anthropic from '@anthropic-ai/sdk';

export type ModelTextBlock = { type: 'text'; text: string };
export type ModelToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ModelToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: (ModelTextBlock | ModelToolUseBlock | ModelToolResultBlock)[];
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ModelResponse {
  text: string;
  toolCalls: ModelToolUseBlock[];
  stopReason: string | null;
  usage: ModelUsage;
}

export interface ModelClient {
  complete(
    messages: ModelMessage[],
    tools: ModelToolDefinition[],
    system: string,
  ): Promise<ModelResponse>;
}

export class ModelAuthError extends Error {
  constructor(message = 'Model authentication failed.') {
    super(message);
    this.name = 'ModelAuthError';
  }
}

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

/**
 * Muse API client. Transient failures (rate limits, 5xx, overloaded) retry
 * inside the SDK; authentication failures surface as ModelAuthError so the
 * orchestrator can end the run with a truthful, actionable outcome.
 */
export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: {
    apiKey: string;
    model: string;
    baseUrl?: string;
    maxTokens?: number;
    timeoutMs?: number;
  }) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      timeout: options.timeoutMs ?? 120_000,
      maxRetries: 3,
    });
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async complete(
    messages: ModelMessage[],
    tools: ModelToolDefinition[],
    system: string,
  ): Promise<ModelResponse> {
    const apiMessages: Anthropic.MessageParam[] = messages.map((message) => ({
      role: message.role,
      content: message.content.map((block) => {
        if (block.type === 'text') return { type: 'text', text: block.text } as const;
        if (block.type === 'tool_use') {
          return { type: 'tool_use', id: block.id, name: block.name, input: block.input } as const;
        }
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: block.content,
          ...(block.is_error ? { is_error: true } : {}),
        } as const;
      }),
    }));
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema as Anthropic.Tool.InputSchema,
        })),
        messages: apiMessages,
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new ModelAuthError(
          'Model authentication failed. Set a valid RACES_MODEL_API_KEY for the worker.',
        );
      }
      throw new ModelError(
        `Model request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    const toolCalls = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    return {
      text,
      toolCalls: toolCalls.map((call) => ({
        type: 'tool_use' as const,
        id: call.id,
        name: call.name,
        input: (call.input ?? {}) as Record<string, unknown>,
      })),
      stopReason: response.stop_reason,
      usage: {
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
      },
    };
  }
}
