import { ModelAuthError, ModelError } from './model.js';
import { fromResponseOutput, type ResponsesApiPayload } from './responses.js';

export interface VisionClient {
  describeImage(
    image: Uint8Array,
    mimeType: string,
    prompt: string,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
}

/**
 * Muse Spark vision over the Responses API. Used only for labelled model
 * explanations of screenshots; verdicts never read this output.
 */
export class ResponsesVisionClient implements VisionClient {
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
    this.maxTokens = options.maxTokens ?? 1200;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async describeImage(
    image: Uint8Array,
    mimeType: string,
    prompt: string,
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    const dataUrl = `data:${mimeType};base64,${Buffer.from(image).toString('base64')}`;
    const body = {
      model: this.model,
      instructions:
        'You explain screenshots for a developer reviewing race-condition evidence. Be brief and concrete. Never invent values you cannot see.',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: dataUrl },
          ],
        },
      ],
      max_output_tokens: this.maxTokens,
      store: false,
      stream: false,
    };
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: options?.signal
          ? AbortSignal.any([AbortSignal.timeout(this.timeoutMs), options.signal])
          : AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ModelError(
        `Vision request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ModelAuthError('Model authentication failed for vision request.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ModelError(`Vision request failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const payload = (await res.json().catch(() => null)) as ResponsesApiPayload | null;
    if (!payload || typeof payload !== 'object') {
      throw new ModelError('Vision request failed: invalid JSON response.');
    }
    if (payload.error) {
      throw new ModelError(`Vision request failed: ${payload.error.message ?? 'unknown error'}`);
    }
    const text = fromResponseOutput(payload).text.trim();
    if (text === '') throw new ModelError('Vision request returned no text.');
    return text;
  }
}

export const VISION_PROMPT =
  'In 2-3 sentences, describe what this screenshot shows. Focus on any visible balance, results, or status values and whether anything looks stale or inconsistent with the latest user action. Do not invent values you cannot see.';
