# PageClaw

PageClaw is a browser-native, local-first AI web agent platform.

It turns an already-signed-in web model page such as DeepSeek, Qwen, GLM, Doubao, Kimi, Yuanbao, ChatGPT or Claude into a local OpenAI-compatible provider, then lets PageAgent, Cherry Studio, Cursor, Dify or other local clients use it through `http://127.0.0.1:3344/v1`.

> Goal: open a model page, keep it logged in, click PageClaw, and use the page as a local model provider without entering any model API key.

## Current scope

This repository contains the first productized source scaffold for PageClaw:

- Chrome Extension MV3 side panel
- automatic model-page detection
- local provider registration
- content-script DOM driver
- web-chat API capture hook foundation
- local Bridge with OpenAI-compatible endpoints
- PageAgent adapter endpoint
- driver hints for Chinese web model pages

## Architecture

```text
Local client / PageAgent
  -> PageClaw Local Bridge, 127.0.0.1:3344
  -> Chrome Extension task polling
  -> active signed-in model page
  -> Web API Driver first, DOM Driver fallback
  -> OpenAI-compatible response
```

## Quick start

### 1. Load the extension

Open Chrome:

```text
chrome://extensions
```

Enable Developer Mode, then load this repository as an unpacked extension.

### 2. Start the local bridge

```bash
node bridge/server.js
```

The Bridge listens only on `127.0.0.1:3344`.

### 3. Open a signed-in model page

Open one of the supported model web apps and keep it logged in:

- DeepSeek
- Qwen / Tongyi
- GLM / Zhipu
- Doubao
- Kimi
- Yuanbao
- ChatGPT
- Claude

### 4. Open PageClaw SidePanel

PageClaw detects the current model page and registers it as the active local provider.

### 5. Use the local provider

```text
Base URL: http://127.0.0.1:3344/v1
API Key:  pc_local_dev
Model:    the model shown in SidePanel
```

Available endpoints:

```text
GET  /healthz
GET  /v1
GET  /v1/models
POST /v1/chat/completions
GET  /pageclaw/provider
GET  /pageclaw/ready
GET  /pageagent/adapter.js
```

## Product direction

PageClaw is not a generic scraper and not a remote Agent SaaS. It is a local browser agent layer that uses the user's existing browser session and exposes controlled local APIs.

The near-term roadmap is:

1. Native Helper installer
2. dedicated drivers for DeepSeek, Qwen, GLM and Doubao
3. real SSE streaming
4. PageAgent floating Copilot UI
5. Chrome Web Store packaging and privacy review

## License

Apache-2.0.
