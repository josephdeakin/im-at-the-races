import { describe, expect, it } from 'vitest';
import type { ModelMessage } from './model.js';
import { fromResponseOutput, toResponseInput } from './responses.js';

describe('toResponseInput', () => {
  it('maps text and tool results to input items', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Go.' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Listing.' },
          { type: 'tool_use', id: 'c1', name: 'listFiles', input: { path: '.' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: '{"ok":true}' },
          { type: 'tool_result', tool_use_id: 'c2', content: 'boom', is_error: true },
          { type: 'text', text: '[budgets: 29 left]' },
        ],
      },
    ];
    // Each output immediately follows its call: the endpoint rejects
    // adjacent same-type function items.
    expect(toResponseInput(messages)).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'Go.' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'Listing.' }] },
      { type: 'function_call', call_id: 'c1', name: 'listFiles', arguments: '{"path":"."}' },
      { type: 'function_call_output', call_id: 'c1', output: '{"ok":true}' },
      { role: 'user', content: [{ type: 'input_text', text: '[budgets: 29 left]' }] },
      { type: 'function_call_output', call_id: 'c2', output: 'Error: boom' },
    ]);
  });

  it('interleaves parallel calls as call/output pairs', () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c1', name: 'readFile', input: { path: 'a' } },
          { type: 'tool_use', id: 'c2', name: 'readFile', input: { path: 'b' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: 'aaa' },
          { type: 'tool_result', tool_use_id: 'c2', content: 'bbb' },
        ],
      },
    ];
    const items = toResponseInput(messages);
    expect(items.map((item) => ('type' in item ? item.type : item.role))).toEqual([
      'function_call',
      'function_call_output',
      'function_call',
      'function_call_output',
    ]);
  });
});

describe('fromResponseOutput', () => {
  it('maps messages and function calls', () => {
    const response = fromResponseOutput({
      status: 'completed',
      output: [
        { type: 'reasoning' },
        { type: 'message', content: [{ type: 'output_text', text: 'On it.' }] },
        {
          type: 'function_call',
          call_id: 'c9',
          name: 'readFile',
          arguments: '{"path":"src/a.ts"}',
        },
      ],
      usage: { input_tokens: 12, output_tokens: 34 },
    });
    expect(response.text).toBe('On it.');
    expect(response.toolCalls).toEqual([
      { type: 'tool_use', id: 'c9', name: 'readFile', input: { path: 'src/a.ts' } },
    ]);
    expect(response.stopReason).toBe('tool_use');
    expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
  });

  it('surfaces max_output_tokens and tolerates bad arguments', () => {
    const capped = fromResponseOutput({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [],
    });
    expect(capped.stopReason).toBe('max_tokens');
    expect(capped.toolCalls).toEqual([]);

    const badArgs = fromResponseOutput({
      status: 'completed',
      output: [{ type: 'function_call', call_id: 'c1', name: 'act', arguments: 'not-json' }],
    });
    expect(badArgs.toolCalls).toEqual([
      { type: 'tool_use', id: 'c1', name: 'act', input: {} },
    ]);
  });
});
