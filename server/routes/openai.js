import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { matchesApiToken } from '../auth.js';
import {
  DEFAULT_CHAT_TEMPLATES,
  DEFAULT_THINKING_TEMPLATES,
  buildToolCall,
  estimateUsage,
  getDelayMs,
  getThinking,
  selectTemplate,
  selectTool,
  shouldCallTool,
} from '../generation.js';

const DEFAULT_STREAM_CHUNK_DELAY_MS = 120;

function sendError(res, status, message, type = 'invalid_request_error', code) {
  return res.status(status).json({
    error: { message, type, ...(code ? { code } : {}) },
  });
}

function bearerToken(header = '') {
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function getLastMessage(messages) {
  return Array.isArray(messages) ? messages[messages.length - 1] || {} : {};
}

function inputText(input) {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return '';
  return input.map((item) => {
    if (typeof item === 'string') return item;
    if (typeof item?.content === 'string') return item.content;
    if (Array.isArray(item?.content)) return item.content.map((part) => part?.text || '').join(' ');
    return '';
  }).join(' ');
}

function delay(ms, res) {
  if (res.destroyed || res.writableEnded) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (alive) => {
      clearTimeout(timer);
      res.off('close', onClose);
      resolve(alive);
    };
    const onClose = () => finish(false);
    const timer = setTimeout(() => finish(!res.destroyed), ms);
    res.once('close', onClose);
  });
}

function sendSse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function eventBase(id, created, model) {
  return { id, object: 'chat.completion.chunk', created, model };
}

function textChunks(text) {
  return text.match(/\S+\s*/gu) || [];
}

async function streamChat(res, { id, created, model, content, thinking, toolCall, finishReason, chunkDelayMs }) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const firstDelta = { role: 'assistant' };
  sendSse(res, { ...eventBase(id, created, model), choices: [{ index: 0, delta: firstDelta, finish_reason: null }] });
  if (thinking) {
    if (!await delay(chunkDelayMs, res)) return;
    sendSse(res, { ...eventBase(id, created, model), choices: [{ index: 0, delta: { reasoning_content: thinking }, finish_reason: null }] });
  }

  if (toolCall) {
    if (!await delay(chunkDelayMs, res)) return;
    sendSse(res, {
      ...eventBase(id, created, model),
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...toolCall }] }, finish_reason: null }],
    });
  } else {
    for (const chunk of textChunks(content)) {
      if (!await delay(chunkDelayMs, res)) return;
      sendSse(res, { ...eventBase(id, created, model), choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] });
    }
  }

  if (!await delay(chunkDelayMs, res)) return;
  sendSse(res, { ...eventBase(id, created, model), choices: [{ index: 0, delta: {}, finish_reason: finishReason }] });
  res.end('data: [DONE]\n\n');
}

function modelObject(model) {
  return { id: model.id, object: 'model', created: 0, owned_by: 'make-believe' };
}

function promptFor(body, path) {
  if (path === '/chat/completions') return body.messages || [];
  if (path === '/completions') return body.prompt || '';
  return body.input ?? '';
}

export function createOpenAIRouter({ store, config, metrics, random = Math.random }) {
  const router = Router();

  router.use(async (req, res, next) => {
    const supplied = bearerToken(req.get('authorization') || '');
    const tokens = await store.getApiTokens();
    let authenticated = false;
    if (supplied) {
      for (const token of tokens) authenticated = matchesApiToken(supplied, token.hash) || authenticated;
    }
    if (!authenticated) return sendError(res, 401, 'Invalid or missing API key', 'authentication_error', 'invalid_api_key');
    metrics?.record(`/v1${req.path}`);
    return next();
  });

  router.get('/models', async (_req, res) => {
    const models = (await store.listModels()).filter((model) => model.active).map(modelObject);
    return res.json({ object: 'list', data: models });
  });

  router.use(async (req, res, next) => {
    const settings = await store.getSettings();
    const minDelayMs = settings.minDelayMs ?? config.minDelayMs ?? 180;
    const maxDelayMs = settings.maxDelayMs ?? config.maxDelayMs ?? 900;
    if (!await delay(getDelayMs({ minDelayMs, maxDelayMs }, random), res)) return;
    req.mockSettings = {
      thinkingEnabled: settings.thinkingEnabled ?? true,
      thinkingTemplates: settings.thinkingTemplates || DEFAULT_THINKING_TEMPLATES,
      chatTemplates: settings.chatTemplates || DEFAULT_CHAT_TEMPLATES,
      streamChunkDelayMs: settings.streamChunkDelayMs ?? DEFAULT_STREAM_CHUNK_DELAY_MS,
    };
    return next();
  });

  router.use(async (req, res, next) => {
    if (req.method === 'GET') return next();
    const modelId = req.body?.model;
    if (typeof modelId !== 'string' || !modelId.trim()) {
      return sendError(res, 400, 'A model is required', 'invalid_request_error', 'model_required');
    }
    const model = await store.getModel(modelId);
    if (!model || !model.active) return sendError(res, 404, `Model not found: ${modelId}`, 'not_found_error', 'model_not_found');
    req.mockModel = model;
    return next();
  });

  router.post('/chat/completions', async (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.messages)) return sendError(res, 400, 'messages must be an array', 'invalid_request_error');
    const model = req.mockModel;
    const settings = req.mockSettings;
    const last = getLastMessage(body.messages);
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const wantsTool = shouldCallTool({ tools, toolChoice: body.tool_choice ?? 'auto', message: last.content || '' });
    const selectedTool = wantsTool ? selectTool(tools, body.tool_choice) : null;
    const toolCall = selectedTool ? buildToolCall(selectedTool, { message: last.content || '' }) : null;
    const content = selectTemplate(settings.chatTemplates, random);
    const thinking = getThinking(settings, random);
    const id = `chatcmpl-${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    const created = Math.floor(Date.now() / 1000);
    const finishReason = toolCall ? 'tool_calls' : 'stop';

    if (body.stream === true) {
      return streamChat(res, {
        id,
        created,
        model: model.id,
        content,
        thinking,
        toolCall,
        finishReason,
        chunkDelayMs: settings.streamChunkDelayMs,
      });
    }

    const message = { role: 'assistant', content: toolCall ? null : content };
    if (thinking) message.reasoning_content = thinking;
    if (toolCall) message.tool_calls = [toolCall];
    return res.json({
      id,
      object: 'chat.completion',
      created,
      model: model.id,
      choices: [{ index: 0, message, finish_reason: finishReason }],
      usage: estimateUsage(body.messages, toolCall?.function.arguments || content),
    });
  });

  router.post('/responses', (req, res) => {
    const body = req.body || {};
    const settings = req.mockSettings;
    const prompt = body.input ?? '';
    const content = selectTemplate(settings.chatTemplates, random);
    const thinking = getThinking(settings, random);
    const output = [];
    if (thinking) {
      output.push({
        type: 'reasoning',
        id: `rs_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
        summary: [{ type: 'summary_text', text: thinking }],
      });
    }
    output.push({
      type: 'message',
      id: `msg_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: content, annotations: [] }],
    });
    return res.json({
      id: `resp_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      model: req.mockModel.id,
      status: 'completed',
      output,
      usage: estimateUsage(inputText(prompt), content),
    });
  });

  router.post('/completions', (req, res) => {
    const body = req.body || {};
    const content = selectTemplate(req.mockSettings.chatTemplates, random);
    return res.json({
      id: `cmpl-${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      object: 'text_completion',
      created: Math.floor(Date.now() / 1000),
      model: req.mockModel.id,
      choices: [{ text: content, index: 0, logprobs: null, finish_reason: 'stop' }],
      usage: estimateUsage(body.prompt || '', content),
    });
  });

  router.post('/embeddings', (req, res) => {
    const body = req.body || {};
    const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ''];
    const data = inputs.map((_input, index) => ({
      object: 'embedding',
      index,
      embedding: [0.01, 0, -0.01, 0.02],
    }));
    return res.json({
      object: 'list',
      data,
      model: req.mockModel.id,
      usage: estimateUsage(inputText(body.input), ''),
    });
  });

  router.use((req, res) => sendError(res, 404, `Unknown endpoint: /v1${req.path}`, 'invalid_request_error', 'not_found'));
  return router;
}

export function openAIErrorHandler(error, _req, res, next) {
  if (res.headersSent) return next(error);
  if (error?.type === 'entity.too.large') {
    return sendError(res, 413, 'Request body exceeds the configured limit', 'invalid_request_error', 'request_too_large');
  }
  if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    return sendError(res, 400, 'Invalid JSON in request body', 'invalid_request_error', 'invalid_json');
  }
  return sendError(res, 500, 'Internal server error', 'internal_error', 'internal_error');
}
