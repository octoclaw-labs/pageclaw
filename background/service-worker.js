const BRIDGE_URL = 'http://127.0.0.1:3344';
const POLL_INTERVAL_MS = 900;
let pollTimer = null;
let activeProvider = null;

chrome.runtime.onInstalled.addListener(async () => {
  const { accessToken } = await chrome.storage.local.get('accessToken');
  if (!accessToken) {
    await chrome.storage.local.set({ accessToken: 'pc_' + crypto.randomUUID() });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'PC_GET_TOKEN':
        sendResponse({ ok: true, token: await ensureToken() });
        break;
      case 'PC_DETECT_PROVIDER':
        sendResponse({ ok: true, data: await detectActiveProvider() });
        break;
      case 'PC_REGISTER_PROVIDER':
        activeProvider = msg.provider;
        await chrome.storage.local.set({ activeProvider });
        await syncProviderToBridge(activeProvider);
        sendResponse({ ok: true, data: activeProvider });
        break;
      case 'PC_BRIDGE_START':
        await startPolling();
        sendResponse({ ok: true });
        break;
      case 'PC_BRIDGE_STATUS':
        sendResponse({ ok: true, data: await bridgeStatus() });
        break;
      case 'PC_EXECUTE_CHAT':
        sendResponse({ ok: true, data: await executeChatTask(msg.task) });
        break;
      default:
        sendResponse({ ok: false, error: 'Unknown message type: ' + msg?.type });
    }
  })().catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

async function ensureToken() {
  const store = await chrome.storage.local.get('accessToken');
  if (store.accessToken) return store.accessToken;
  const token = 'pc_' + crypto.randomUUID();
  await chrome.storage.local.set({ accessToken: token });
  return token;
}

async function detectActiveProvider() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return null;
  await injectContentScript(tab.id);
  const res = await chrome.tabs.sendMessage(tab.id, { type: 'PC_CONTENT_DETECT_PROVIDER' });
  if (res?.provider) {
    activeProvider = { ...res.provider, tabId: tab.id, url: tab.url };
    await chrome.storage.local.set({ activeProvider });
    await syncProviderToBridge(activeProvider);
  }
  return activeProvider;
}

async function injectContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PC_PING' });
    if (pong?.ok) return;
  } catch (_) {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content-main.js'] });
}

async function syncProviderToBridge(provider) {
  const token = await ensureToken();
  try {
    await fetch(`${BRIDGE_URL}/pageclaw/provider`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ provider })
    });
  } catch (_) {}
}

async function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollBridgeOnce, POLL_INTERVAL_MS);
  await pollBridgeOnce();
}

async function pollBridgeOnce() {
  const token = await ensureToken();
  try {
    const res = await fetch(`${BRIDGE_URL}/pageclaw/jobs/next`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const job = await res.json();
    if (!job?.id) return;
    const result = await executeChatTask(job);
    await fetch(`${BRIDGE_URL}/pageclaw/jobs/${job.id}/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(result)
    });
  } catch (_) {}
}

async function executeChatTask(task) {
  const provider = activeProvider || (await chrome.storage.local.get('activeProvider')).activeProvider;
  if (!provider?.tabId) throw new Error('No active model page. Open a signed-in model page first.');
  await injectContentScript(provider.tabId);
  return chrome.tabs.sendMessage(provider.tabId, {
    type: 'PC_CONTENT_CHAT_COMPLETION',
    payload: task,
    provider
  });
}

async function bridgeStatus() {
  const token = await ensureToken();
  try {
    const res = await fetch(`${BRIDGE_URL}/pageclaw/ready`, { headers: { authorization: `Bearer ${token}` } });
    return { reachable: res.ok, data: await res.json().catch(() => null) };
  } catch (err) {
    return { reachable: false, error: String(err?.message || err) };
  }
}

chrome.alarms.create('pageclaw-keepalive', { periodInMinutes: 0.45 });
chrome.alarms.onAlarm.addListener(() => {});
