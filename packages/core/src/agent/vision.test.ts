import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResponsesVisionClient, VISION_PROMPT } from './vision.js';

afterEach(() => vi.unstubAllGlobals());

describe('ResponsesVisionClient', () => {
  it('sends an input_image and returns message text', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            { type: 'reasoning' },
            { type: 'message', content: [{ type: 'output_text', text: 'Balance shows $70.00.' }] },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ResponsesVisionClient({
      apiKey: 'k',
      model: 'muse-spark-1.3-contributor',
      baseUrl: 'https://api.meta.ai/v1',
    });
    const text = await client.describeImage(new Uint8Array([1, 2, 3]), 'image/png', VISION_PROMPT);
    expect(text).toBe('Balance shows $70.00.');
    const init = fetchMock.mock.calls[0]?.[1] as unknown as { body: string };
    const body = JSON.parse(init.body);
    expect(body.model).toBe('muse-spark-1.3-contributor');
    expect(body.input[0].content[1].type).toBe('input_image');
    expect(body.input[0].content[1].image_url).toContain('data:image/png;base64,');
  });

  it('throws a ModelError on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const client = new ResponsesVisionClient({
      apiKey: 'k',
      model: 'muse-spark-1.3-contributor',
      baseUrl: 'https://api.meta.ai/v1',
    });
    await expect(
      client.describeImage(new Uint8Array([1]), 'image/png', VISION_PROMPT),
    ).rejects.toThrow('Vision request failed (500)');
  });
});
