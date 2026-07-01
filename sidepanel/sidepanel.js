const BRIDGE_URL = 'http://127.0.0.1:3344';
let token = 'pc_local_dev';
let provider = null;

const $ = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', async () => {
  $('detectBtn').addEventListener('click', detectProvider);
  $('refreshBtn').addEventListener('click', refreshAll);
  $('startBridgeBtn').addEventListener('click', startBridge);
  $('copyConfigBtn').addEventListener('click', copyClientConfig);
  $('copyAdapterBtn').addEventListener('click', copyPageAgentConfig);
  await initToken();
  await refreshAll();
});

async function initToken() {
  const res = await send({ type: 'PC_GET_TOKEN' });
  token = res.token || 'pc_local_dev';
}

async function refreshAll() {
  await detectProvider();
  await refreshBridgeStatus();
  renderAdvanced();
}

async function detectProvider() {
  setText('providerName', '检测中…');
  const res = await send({ type: 'PC_DETECT_PROVIDER' });
  provider = res.data || null;
  renderProvider();
  renderAdvanced();
}

function renderProvider() {
  if (!provider) {
    setText('providerName', '未识别模型网页');
    setText('providerHint', '请先打开 DeepSeek、千问、GLM、豆包、Kimi、元宝、ChatGPT 或 Claude 的聊天页面并保持登录。');
    $('models').innerHTML = '';
    return;
  }
  $('providerName').innerHTML = `<span class="ok">已识别：</span>${escapeHtml(provider.name)}`;
  setText('providerHint', `当前页面将作为本地模型 Provider 使用，默认模型：${provider.defaultModel || provider.models?.[0] || 'pageclaw-web-model'}`);
  $('models').innerHTML = (provider.models || []).map((m) => `<span class="model-pill">${escapeHtml(m)}</span>`).join('');
}

async function startBridge() {
  await send({ type: 'PC_BRIDGE_START' });
  await refreshBridgeStatus();
}

async function refreshBridgeStatus() {
  const res = await send({ type: 'PC_BRIDGE_STATUS' });
  const data = res.data;
  if (data?.reachable) {
    $('bridgeStatus').innerHTML = '<span class="ok">本地代理可用</span>';
    setText('bridgeHint', '本机客户端现在可以使用 PageClaw Provider。');
  } else {
    $('bridgeStatus').innerHTML = '<span class="err">本地代理未连接</span>';
    setText('bridgeHint', '请运行 node bridge/server.js，或安装 Native Helper 后一键启动。');
  }
  renderAdvanced();
}

async function copyClientConfig() {
  const model = provider?.defaultModel || provider?.models?.[0] || 'pageclaw-web-model';
  const text = `Base URL: ${BRIDGE_URL}/v1\nAPI Key: ${token}\nModel: ${model}`;
  await navigator.clipboard.writeText(text);
}

async function copyPageAgentConfig() {
  const model = provider?.defaultModel || provider?.models?.[0] || 'pageclaw-web-model';
  const text = `const agent = new PageAgent({\n  baseURL: '${BRIDGE_URL}/compatible-mode/v1',\n  apiKey: '${token}',\n  model: '${model}',\n  language: 'zh-CN'\n});`;
  await navigator.clipboard.writeText(text);
}

function renderAdvanced() {
  const model = provider?.defaultModel || provider?.models?.[0] || 'pageclaw-web-model';
  $('advancedInfo').textContent = [
    `Base URL: ${BRIDGE_URL}/v1`,
    `Compatible URL: ${BRIDGE_URL}/compatible-mode/v1`,
    `API Key: ${token}`,
    `Model: ${model}`,
    `Provider: ${provider ? provider.id : 'none'}`,
    '',
    'Manual bridge start:',
    `PAGECLAW_TOKEN=${token} node bridge/server.js`
  ].join('\n');
}

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (res) => resolve(res || {})));
}

function setText(id, value) { $(id).textContent = value; }
function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
