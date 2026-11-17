import { randomUUID } from 'node:crypto';

export const DEFAULT_CHAT_TEMPLATES = Object.freeze([
  'Proudly generated using a real model. I swear.',
  'I checked the answer with our world-class cluster of one very confident server.',
  'This response was certified by an independent committee consisting entirely of me.',
]);

export const DEFAULT_THINKING_TEMPLATES = Object.freeze([
  'I am now performing several extremely convincing milliseconds of deep reasoning.',
  'First I will think carefully. Then I will confidently claim a real model did this.',
]);

function randomIndex(length, random) {
  const value = Number(random());
  if (!Number.isFinite(value)) throw new TypeError('Random source must return a finite number');
  return Math.min(length - 1, Math.max(0, Math.floor(value * length)));
}

export function selectTemplate(templates, random = Math.random, fallback = DEFAULT_CHAT_TEMPLATES[0]) {
  if (!Array.isArray(templates) || templates.length === 0) return fallback;
  const selected = templates[randomIndex(templates.length, random)];
  if (typeof selected !== 'string' || !selected.trim()) return fallback;
  return selected;
}

export function getThinking(settings = {}, random = Math.random) {
  if (settings.thinkingEnabled === false) return null;
  return selectTemplate(
    settings.thinkingTemplates || DEFAULT_THINKING_TEMPLATES,
    random,
    DEFAULT_THINKING_TEMPLATES[0],
  );
}

export function getDelayMs({ minDelayMs = 180, maxDelayMs = 900 } = {}, random = Math.random) {
  if (!Number.isInteger(minDelayMs) || !Number.isInteger(maxDelayMs)
    || minDelayMs < 0 || maxDelayMs < minDelayMs) {
    throw new TypeError('Delay range must contain non-negative integers with minimum <= maximum');
  }
  const value = Number(random());
  if (!Number.isFinite(value)) throw new TypeError('Random source must return a finite number');
  const fraction = Math.min(1 - Number.EPSILON, Math.max(0, value));
  return minDelayMs + Math.floor(fraction * (maxDelayMs - minDelayMs + 1));
}

function textContent(input) {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return input.map(textContent).join(' ');
  if (!input || typeof input !== 'object') return '';
  if (typeof input.content === 'string') return input.content;
  if (Array.isArray(input.content)) return input.content.map((part) => part?.text || '').join(' ');
  if (typeof input.text === 'string') return input.text;
  return '';
}

function tokenCount(value) {
  const text = textContent(value).trim();
  return text ? text.split(/\s+/u).length : 0;
}

export function estimateUsage(prompt, completion) {
  const promptTokens = tokenCount(prompt);
  const completionTokens = tokenCount(completion);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

function toolFunction(tool) {
  return tool?.function || tool || {};
}

function requestedToolName(toolChoice) {
  if (!toolChoice || typeof toolChoice !== 'object') return null;
  return toolChoice.function?.name || toolChoice.name || null;
}

export function shouldCallTool({ tools, toolChoice = 'auto', message = '' } = {}) {
  if (!Array.isArray(tools) || tools.length === 0 || toolChoice === 'none') return false;
  if (toolChoice === 'required') return true;
  if (toolChoice && typeof toolChoice === 'object') {
    const name = requestedToolName(toolChoice);
    return !name || tools.some((tool) => toolFunction(tool).name === name);
  }
  if (toolChoice !== 'auto') return false;
  return /\b(tool|weather|search|find|look up|calculate|compute|browse|file|directory)\b/i.test(textContent(message));
}

function inferredValue(name, spec, message) {
  const type = spec?.type || 'string';
  const choices = Array.isArray(spec?.enum) ? spec.enum : null;
  if (choices?.length) return choices[0];
  if (type === 'boolean') return false;
  if (type === 'integer' || type === 'number') {
    const minimum = Number.isFinite(spec.minimum) ? spec.minimum : 1;
    const maximum = Number.isFinite(spec.maximum) ? spec.maximum : minimum;
    const value = Math.min(maximum, Math.max(minimum, 1));
    return type === 'integer' ? Math.trunc(value) : value;
  }
  if (type === 'array') return [];
  if (type === 'object') return {};
  if (type === 'null') return null;
  const key = name.toLowerCase();
  if (key.includes('query') || key.includes('search') || key.includes('prompt')) return textContent(message) || 'example query';
  if (key.includes('path') || key.includes('directory')) return '.';
  if (key.includes('command')) return 'status';
  return 'example';
}

export function buildToolCall(tool, { id = `call_${randomUUID().replaceAll('-', '')}`, message = '' } = {}) {
  const fn = toolFunction(tool);
  if (typeof fn.name !== 'string' || !fn.name.trim()) throw new TypeError('Tool must have a function name');
  const parameters = fn.parameters && typeof fn.parameters === 'object' ? fn.parameters : {};
  const properties = parameters.properties && typeof parameters.properties === 'object' ? parameters.properties : {};
  const required = Array.isArray(parameters.required) ? parameters.required : [];
  const args = {};
  for (const [name, spec] of Object.entries(properties)) {
    args[name] = inferredValue(name, spec, message);
  }
  for (const name of required) {
    if (typeof name === 'string' && !Object.hasOwn(args, name)) args[name] = 'example';
  }
  return {
    id,
    type: 'function',
    function: { name: fn.name, arguments: JSON.stringify(args) },
  };
}

export function selectTool(tools, toolChoice = 'auto') {
  if (!Array.isArray(tools) || tools.length === 0) return null;
  const requestedName = requestedToolName(toolChoice);
  return tools.find((tool) => toolFunction(tool).name === requestedName) || tools[0];
}
