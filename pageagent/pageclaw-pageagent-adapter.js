(() => {
  const DEFAULT_BASE_URL = 'http://127.0.0.1:3344/compatible-mode/v1';

  window.PageClawProvider = {
    baseURL: DEFAULT_BASE_URL,
    async models(apiKey) {
      const response = await fetch(`${this.baseURL}/models`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}
      });
      return response.json();
    },
    async chatCompletions(body, apiKey) {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(body)
      });
      return response.json();
    },
    createPageAgentConfig({ apiKey, model, language = 'zh-CN' } = {}) {
      return {
        baseURL: this.baseURL,
        apiKey,
        model: model || 'pageclaw-web-model',
        language
      };
    }
  };
})();
