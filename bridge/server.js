const http = require('http');
const crypto = require('crypto');

const HOST = process.env.PAGECLAW_HOST || '127.0.0.1';
const PORT = Number(process.env.PAGECLAW_PORT || 3344);
const TOKEN = process.env.PAGECLAW_TOKEN || 'pc_local_dev';
const TIMEOUT_MS = Number(process.env.PAGECLAW_JOB_TIMEOUT_MS || 120000);

let activeProvider = null;
const queue = [];
const pending = new Map();

const server = http.createServer(async (req, res) => {
  try {
    cors(res);
    if (req.method === 'OPTIONS') return empty(res, 204);
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/healthz') return json(res, 200, { status: 'ok', service: 'pageclaw-bridge' });
    if (url.pathname === '/v1') return json(res, 200, providerInfo());
    if (url.pathname === '/v1/models' || url.pathname === '/compatible-mode/v1/models') return json(res, 200, modelsPayload());
    if (url.pathname === '/pageclaw/ready') return json(res, 200, readyPayload());
    if (url.pathname === '/pageclaw/provider' && req.method === 'GET') return json(res, 200, { provider: activeProvider });
    if (url.pathname === '/pageclaw/provider' && req.method === 'POST') return authed(req, res, async () => {
      const body = await readJson(req);
      activeProvider = body.provider || body;
      return json(res, 200, { ok: true, provider: activeProvider });
    });
    if (url.pathname === '/pageclaw/jobs/next') return authed(req, res, async () => json(res, 200, queue.shift() || {}));
    if (url.pathname.startsWith('/pageclaw/jobs/') && url.pathname.endsWith('/result') && req.method === 'POST') return authed(req, res, async () => {
      const id = url.pathname.split('/')[3];
      const waiter = pending.get(id);
      const body = await readJson(req);
      if (waiter) {
        pending.delete(id);
        waiter.resolve(body);
      }
      return json(res, 200, { ok: true });
    });
    if (url.pathname === '/pageclaw/diagnostics') return authed(req, res, async () => json(res, 200, diagnostics()));
    if (url.pathname === '/pageagent/adapter.js') return adapter(res);
    if ((url.pathname === '/v1/chat/completions' || url.pathname === '/compatible-mode/v1/chat/completions') && req.method === 'POST') {
      return authed(req, res, async () => chatCompletions(req, res));
    }
    return json(res, 404, { error: { message: 'not found', type: 'not_found' } });
  } catch (err) {
    return json(res, 500, { error: { message: String(err && err.message || err), type: 'server_error' } });
  }
});

server.listen(PORT, HOST, () => console.log(`PageClaw Bridge: http://${HOST}:${PORT}`));

function providerInfo() {
  return { object: 'pageclaw.provider', base_url: `http://${HOST}:${PORT}/v1`, active_provider: activeProvider };
}
function readyPayload() {
  return { ready: Boolean(activeProvider), active_provider: activeProvider };
}
function diagnostics() {
  return { active_provider: activeProvider, queue_size: queue.length, pending_size: pending.size, uptime_sec: Math.floor(process.uptime()) };
}
function modelsPayload() {
  const models = activeProvider?.models?.length ? activeProvider.models : ['pageclaw-web-model'];
  return { object: 'list', data: models.map((id) => ({ id, object: 'model', created: 0, owned_by: activeProvider?.id || 'pageclaw' })) };
}
async function chatCompletions(req, res) {
  if (!activeProvider) return json(res, 503, { error: { message: 'No active PageClaw provider', type: 'provider_unavailable' } });
  const body = await readJson(req);
  if (!Array.isArray(body.messages)) return json(res, 400, { error: { message: 'messages is required', type: 'invalid_request_error' } });
  const result = await enqueue({ type: 'chat.completions', model: body.model || activeProvider.defaultModel, messages: body.messages, driver: body.driver || 'auto' });
  const content = result.content || '';
  if (body.stream) return stream(res, body.model, content);
  return json(res, 200, {
    id: `chatcmpl-pageclaw-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model || activeProvider.defaultModel || 'pageclaw-web-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: -1, completion_tokens: -1, total_tokens: -1 },
    pageclaw: { driver: result.driver, provider: result.provider }
  });
}
function enqueue(payload) {
  const id = crypto.randomUUID();
  queue.push({ id, ...payload, created_at: Date.now() });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('extension timeout')); }, TIMEOUT_MS);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); } });
  });
}
function stream(res, model, content) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
  const id = `chatcmpl-pageclaw-${Date.now()}`;
  for (let i = 0; i < content.length; i += 24) res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content: content.slice(i, i + 24) }, finish_reason: null }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}
function authed(req, res, fn) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token !== TOKEN) return json(res, 401, { error: { message: 'invalid token', type: 'auth_error' } });
  return fn();
}
function adapter(res) {
  res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
  res.end("window.PageClawProvider={baseURL:'http://127.0.0.1:3344/compatible-mode/v1',chatCompletions:async function(body,apiKey){const r=await fetch(this.baseURL+'/chat/completions',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+apiKey},body:JSON.stringify(body)});return r.json();}};");
}
function cors(res) { res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS'); res.setHeader('access-control-allow-headers', 'authorization,content-type'); }
function readJson(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', (d) => raw += d); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } }); }); }
function json(res, status, data) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data, null, 2)); }
function empty(res, status) { res.writeHead(status); res.end(); }
