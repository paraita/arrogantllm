import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHAT_TEMPLATES,
  DEFAULT_THINKING_TEMPLATES,
  buildToolCall,
  estimateUsage,
  getDelayMs,
  getThinking,
  selectTemplate,
  shouldCallTool,
} from '../server/generation.js';

test('selects configured templates deterministically and has generic English defaults', () => {
  assert.equal(selectTemplate(['first', 'second'], () => 0), 'first');
  assert.equal(selectTemplate(['first', 'second'], () => 0.99), 'second');
  assert.ok(DEFAULT_CHAT_TEMPLATES.length > 0);
  assert.ok(DEFAULT_THINKING_TEMPLATES.length > 0);
  assert.match(selectTemplate(undefined, () => 0), /real model/i);
});

test('generates fake thinking only when enabled', () => {
  assert.equal(getThinking({ thinkingEnabled: false }, () => 0), null);
  assert.equal(getThinking({ thinkingEnabled: true, thinkingTemplates: ['real hard thinking'] }, () => 0), 'real hard thinking');
  assert.match(getThinking({}, () => 0), /deep reasoning/i);
});

test('selects a simulated delay within the configured inclusive range', () => {
  assert.equal(getDelayMs({ minDelayMs: 10, maxDelayMs: 20 }, () => 0), 10);
  assert.equal(getDelayMs({ minDelayMs: 10, maxDelayMs: 20 }, () => 0.999999), 20);
  assert.equal(getDelayMs({ minDelayMs: 7, maxDelayMs: 7 }, () => 0.5), 7);
});

test('formats OpenAI usage counts from prompt and completion text', () => {
  assert.deepEqual(estimateUsage('hello there', 'mock answer here'), {
    prompt_tokens: 2,
    completion_tokens: 3,
    total_tokens: 5,
  });
  assert.deepEqual(estimateUsage('', ''), {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  });
});

test('honors tool choice and does not call tools for ordinary auto requests', () => {
  const tools = [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }];
  assert.equal(shouldCallTool({ tools, toolChoice: 'none', message: 'use a tool' }), false);
  assert.equal(shouldCallTool({ tools, toolChoice: 'required', message: '' }), true);
  assert.equal(shouldCallTool({ tools, toolChoice: 'auto', message: 'What is the weather?' }), true);
  assert.equal(shouldCallTool({ tools, toolChoice: 'auto', message: 'Tell me a joke' }), false);
  assert.equal(shouldCallTool({ tools: [], toolChoice: 'required', message: '' }), false);
});

test('creates a tool call with arguments matching schema types and required fields', () => {
  const tool = {
    type: 'function',
    function: {
      name: 'lookup',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer' },
          include_archived: { type: 'boolean' },
        },
        required: ['query', 'limit'],
      },
    },
  };
  const call = buildToolCall(tool, { id: 'call_test', message: 'search for cats' });
  assert.equal(call.id, 'call_test');
  assert.equal(call.type, 'function');
  assert.equal(call.function.name, 'lookup');
  const args = JSON.parse(call.function.arguments);
  assert.equal(typeof args.query, 'string');
  assert.equal(Number.isInteger(args.limit), true);
  assert.equal(typeof args.include_archived, 'boolean');
});

test('preserves schema arguments named __proto__ as regular JSON fields', () => {
  const tool = {
    function: {
      name: 'edge_case',
      parameters: JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"]}'),
    },
  };
  const call = buildToolCall(tool, { id: 'call_proto' });
  const args = JSON.parse(call.function.arguments);
  assert.equal(Object.hasOwn(args, '__proto__'), true);
  assert.equal(args.__proto__, 'example');
});
