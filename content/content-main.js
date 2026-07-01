(() => {
  if (window.__PAGECLAW_CONTENT__) return;
  window.__PAGECLAW_CONTENT__ = true;

  const PROVIDERS = [
    { id: 'deepseek', name: 'DeepSeek', hosts: ['chat.deepseek.com'], models: ['deepseek-chat', 'deepseek-reasoner'], input: 'textarea, [contenteditable="true"]', send: 'button[type="submit"], button:has(svg)' },
    { id: 'qwen', name: 'Qwen / Tongyi', hosts: ['chat.qwen.ai', 'tongyi.aliyun.com'], models: ['qwen', 'qwen-plus', 'qwen-max'], input: 'textarea, [contenteditable="true"]', send: 'button[type="submit"], button:has(svg)' },
    { id: 'glm', name: 'GLM / Zhipu', hosts: ['chatglm.cn', 'z.ai'], models: ['glm-4', 'glm-4-plus'], input: 'textarea, [contenteditable="true"]', send: 'button[type="submit"], button:has(svg)' },
    { id: 'doubao', name: 'Doubao', hosts: ['doubao.com', 'www.doubao.com'], models: ['doubao', 'doubao-pro'], input: 'textarea, [contenteditable="true"]', send: 'button[type="submit"], button:has(svg)' },
    { id: 'kimi', name: 'Kimi', hosts: ['kimi.moonshot.cn'], models: ['kimi'], input: 'textarea, [contenteditable="true"]', send: 'button[type="submit"], button:has(svg)' },
    { id: 'yuanbao', name: 'Tencent Yuanbao', hosts: ['yuanbao.tencent.com'], models: ['hunyuan', 'yuanbao'], input: 'textarea, [contenteditable="true"]', send: 'button[type="submit"], button:has(svg)' },
    { id: 'chatgpt', name: 'ChatGPT', hosts: ['chat.openai.com', 'chatgpt.com'], models: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'], input: '#prompt-textarea, textarea, [contenteditable="true"]', send: 'button[data-testid="send-button"], button[type="submit"]' },
    { id: 'claude', name: 'Claude', hosts: ['claude.ai'], models: ['claude-3.5-sonnet', 'claude-3-opus'], input: 'div[contenteditable="true"], textarea', send: 'button[aria-label*="Send"], button[type="submit"]' }
  ];

  const capturedApis = [];
  installFetchCapture();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      if (msg?.type === 'PC_PING') return sendResponse({ ok: true });
      if (msg?.type === 'PC_CONTENT_DETECT_PROVIDER') return sendResponse({ ok: true, provider: detectProvider() });
      if (msg?.type === 'PC_CONTENT_CHAT_COMPLETION') return sendResponse(await completeChat(msg.payload, msg.provider));
      sendResponse({ ok: false, error: 'Unknown content message' });
    })().catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  });

  function detectProvider() {
    const host = location.hostname;
    const provider = PROVIDERS.find((p) => p.hosts.some((h) => host === h || host.endsWith('.' + h)));
    if (!provider) return null;
    return {
      id: provider.id,
      name: provider.name,
      models: provider.models,
      defaultModel: provider.models[0],
      url: location.href,
      capturedApiCount: capturedApis.length,
      driver: capturedApis.length ? 'web-api' : 'dom'
    };
  }

  function installFetchCapture() {
    if (window.__PAGECLAW_FETCH_CAPTURE__) return;
    window.__PAGECLAW_FETCH_CAPTURE__ = true;
    const originalFetch = window.fetch;
    window.fetch = async function(input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url;
      const method = (init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
      const body = init?.body;
      if (method === 'POST' && isLikelyChatUrl(url) && body) {
        capturedApis.unshift({ url, method, init: cloneInit(init), time: Date.now() });
        capturedApis.splice(8);
      }
      return originalFetch.apply(this, arguments);
    };
  }

  function isLikelyChatUrl(url = '') {
    return /chat|conversation|completion|message|aigc|assistant|stream|dialog/i.test(String(url)) && !/log|track|trace|feedback|upload|stat/i.test(String(url));
  }

  function cloneInit(init) {
    const out = { method: init.method || 'POST', headers: {} };
    try {
      if (init.headers instanceof Headers) init.headers.forEach((v, k) => out.headers[k] = v);
      else if (Array.isArray(init.headers)) init.headers.forEach(([k, v]) => out.headers[k] = v);
      else out.headers = { ...(init.headers || {}) };
      if (typeof init.body === 'string') out.body = init.body;
    } catch (_) {}
    return out;
  }

  async function completeChat(task, provider) {
    const prompt = normalizeMessages(task?.messages || []);
    const strategy = task?.driver || 'auto';
    if ((strategy === 'auto' || strategy === 'web-api') && capturedApis.length) {
      try {
        const content = await replayCapturedApi(prompt);
        if (content) return openAIMessage(content, provider, 'web-api');
      } catch (err) {
        if (strategy === 'web-api') throw err;
      }
    }
    const content = await runDomDriver(prompt, provider);
    return openAIMessage(content, provider, 'dom');
  }

  function normalizeMessages(messages) {
    return messages.map((m) => `${m.role || 'user'}: ${m.content || ''}`).join('\n').trim();
  }

  async function replayCapturedApi(prompt) {
    const api = capturedApis[0];
    const init = { ...api.init, headers: { ...api.init.headers } };
    init.body = rewriteBody(init.body, prompt);
    const res = await fetch(api.url, init);
    const text = await res.text();
    return extractTextFromUnknownResponse(text);
  }

  function rewriteBody(body, prompt) {
    if (!body) return body;
    try {
      const json = JSON.parse(body);
      replacePromptLikeFields(json, prompt);
      return JSON.stringify(json);
    } catch (_) {
      return String(body).replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, (s) => s.length > 8 ? JSON.stringify(prompt) : s);
    }
  }

  function replacePromptLikeFields(node, prompt) {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && /prompt|query|question|content|text|message|input/i.test(k)) node[k] = prompt;
      else if (Array.isArray(v) || typeof v === 'object') replacePromptLikeFields(v, prompt);
    }
  }

  function extractTextFromUnknownResponse(text) {
    if (!text) return '';
    const lines = text.split('\n').map((l) => l.replace(/^data:\s*/, '').trim()).filter(Boolean).filter((l) => l !== '[DONE]');
    let best = '';
    for (const line of lines.length ? lines : [text]) {
      try {
        const json = JSON.parse(line);
        const found = deepFindText(json);
        if (found && found.length >= best.length) best = found;
      } catch (_) {
        if (line.length >= best.length) best = line;
      }
    }
    return best;
  }

  function deepFindText(node) {
    if (typeof node === 'string') return node;
    if (!node || typeof node !== 'object') return '';
    const priority = ['content', 'text', 'answer', 'message', 'output', 'delta'];
    for (const key of priority) {
      const value = node[key];
      const hit = deepFindText(value);
      if (hit) return hit;
    }
    for (const value of Object.values(node)) {
      const hit = deepFindText(value);
      if (hit) return hit;
    }
    return '';
  }

  async function runDomDriver(prompt, provider) {
    const p = provider || detectProvider();
    const profile = PROVIDERS.find((x) => x.id === p?.id) || {};
    const input = findInput(profile.input);
    if (!input) throw new Error('No chat input found on current model page.');
    const before = collectAssistantText();
    setInputValue(input, prompt);
    await sleep(80);
    const button = findSendButton(profile.send);
    if (button) button.click();
    else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return await waitForNewAssistantText(before, 90000);
  }

  function findInput(selector) {
    return document.querySelector(selector || 'textarea, [contenteditable="true"]');
  }

  function setInputValue(el, value) {
    el.focus();
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } else {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function findSendButton(selector) {
    const candidates = Array.from(document.querySelectorAll(selector || 'button[type="submit"], button'));
    return candidates.find((b) => !b.disabled && /send|发送|提交|arrow|paper/i.test((b.ariaLabel || b.textContent || b.className || '').toString())) || candidates.find((b) => !b.disabled);
  }

  function collectAssistantText() {
    const nodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"], .markdown, [class*="assistant"], [class*="answer"], [class*="message"]'));
    return nodes.map((n) => n.innerText || n.textContent || '').filter(Boolean).join('\n---\n');
  }

  async function waitForNewAssistantText(before, timeoutMs) {
    const start = Date.now();
    let last = '';
    let stable = 0;
    while (Date.now() - start < timeoutMs) {
      const now = collectAssistantText();
      if (now && now !== before) {
        const delta = now.replace(before, '').trim() || now.trim();
        if (delta === last) stable += 1;
        else stable = 0;
        last = delta;
        if (stable >= 4 && delta.length > 0) return delta;
      }
      await sleep(500);
    }
    throw new Error('Timed out waiting for model response.');
  }

  function openAIMessage(content, provider, driver) {
    return {
      content,
      driver,
      provider: provider?.id || detectProvider()?.id || 'unknown',
      created: Math.floor(Date.now() / 1000)
    };
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
})();
