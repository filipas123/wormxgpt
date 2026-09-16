import { AppSettings, Message, ToolInvocation } from '../types';
import { getEffectiveSystemInstruction } from '../utils/promptUtils';

/** Best-effort parse of a tool argument payload. */
function safeParseJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export const ollamaService = {
  apiKey: '',
  host: 'http://localhost:11434',

  setApiKey(key: string) {
    this.apiKey = key;
  },

  setHost(host: string) {
    this.host = host || 'http://localhost:11434';
  },

  async verifyApiKey(key: string): Promise<boolean> {
    try {
      const baseUrl = this.host || 'http://localhost:11434';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (key) {
        headers['Authorization'] = `Bearer ${key}`;
      }
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        headers
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  _getBaseUrl(settings: AppSettings) {
    const useLocalhost = settings.ollamaUseLocalhost === true;
    const cloudBase = '/ollama-cloud';
    const localBase = '/ollama-local';

    return settings.ollamaHost?.trim()
      ? settings.ollamaHost.trim()
      : useLocalhost ? localBase : cloudBase;
  },

  _getHeaders(settings: AppSettings, apiKey?: string) {
    const isCloud = !settings.ollamaUseLocalhost;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (isCloud && (apiKey || settings.ollamaApiKey)) {
      headers['Authorization'] = `Bearer ${apiKey || settings.ollamaApiKey}`;
    }
    return headers;
  },

  async webSearch(settings: AppSettings, query: string, max_results: number = 5): Promise<any> {
    const baseUrl = this._getBaseUrl(settings);
    const headers = this._getHeaders(settings);
    const r = await fetch(`${baseUrl}/api/web_search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, max_results })
    });
    return r.json();
  },

  async webFetch(settings: AppSettings, url: string): Promise<any> {
    const baseUrl = this._getBaseUrl(settings);
    const headers = this._getHeaders(settings);
    const r = await fetch(`${baseUrl}/api/web_fetch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url })
    });
    return r.json();
  },

  async *streamChat(
    settings: AppSettings,
    messages: Message[],
    signal?: AbortSignal
  ): AsyncGenerator<{ text: string; thinking?: string; images: string[]; toolInvocations?: ToolInvocation[] }> {
    if (signal?.aborted) return;

    const baseUrl = this._getBaseUrl(settings);
    const apiKey = settings.ollamaApiKey || this.apiKey;

    const { pruneHistory } = await import('../utils/tokenManager');
    const { getDynamicTools, executeToolCall } = await import('./tools');
    const dynamicTools = await getDynamicTools(settings);

    // Prune history to avoid context overflow (Ollama works best with ~32k context for agents)
    const effectiveSystem = getEffectiveSystemInstruction(settings, messages);
    const prunedMessages = pruneHistory(
      messages,
      effectiveSystem,
      settings.maxTokens || 32000,
      4000
    );

    // Build the conversation, including any tool rounds recorded on history
    // messages, so a follow-up turn can see the earlier call and its result.
    const conversation: any[] = [
      { role: 'system', content: effectiveSystem },
      ...prunedMessages.flatMap(m => {
        const entries: any[] = [];
        const calls = (m.toolInvocations || []).filter(ti => ti.state === 'call');
        const results = (m.toolInvocations || []).filter(ti => ti.state === 'result');
        const images = m.images?.map(img => img.split(',')[1] || img);

        if (calls.length > 0) {
          entries.push({
            role: 'assistant',
            content: m.content || '',
            tool_calls: calls.map(ti => ({
              function: { name: ti.toolName, arguments: ti.args ?? {} }
            }))
          });
        } else if (results.length === 0) {
          const entry: any = {
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.content
          };
          if (images?.length) entry.images = images;
          entries.push(entry);
        }

        for (const res of results) {
          entries.push({
            role: 'tool',
            content: typeof res.result === 'string' ? res.result : JSON.stringify(res.result ?? '')
          });
        }
        return entries;
      })
    ];

    const headers = this._getHeaders(settings, apiKey);
    const toolInvocations: ToolInvocation[] = [];
    let accumulatedText = '';
    let accumulatedThinking = '';
    const MAX_TURNS = 4;

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (signal?.aborted) return;

        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers,
          signal,
          body: JSON.stringify({
            model: settings.model.replace('-cloud', '').replace(':cloud', ''),
            messages: conversation,
            stream: true,
            think: true,
            tools: dynamicTools.length > 0 ? dynamicTools.map((t: any) => ({
              type: 'function',
              function: t.function
            })) : undefined,
            options: {
              temperature: settings.temperature,
              top_p: settings.topP,
              num_ctx: settings.thinkingBudget || 32000,
            }
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Ollama Error (${response.status}): ${errorText || response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('Response body is null');

        const decoder = new TextDecoder();
        let buffer = '';
        const turnToolCalls: Array<{ name: string; argsRaw: any }> = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);

              if (data.message?.thinking) {
                accumulatedThinking += data.message.thinking;
                yield { text: accumulatedText, thinking: accumulatedThinking, images: [] };
              }

              if (data.message?.content) {
                accumulatedText += data.message.content;
                yield { text: accumulatedText, thinking: accumulatedThinking, images: [] };
              }

              if (Array.isArray(data.message?.tool_calls)) {
                for (const tc of data.message.tool_calls) {
                  const name = tc.function?.name || tc.name || '';
                  if (name) turnToolCalls.push({ name, argsRaw: tc.function?.arguments ?? tc.arguments ?? {} });
                }
              }
            } catch (e) {
              console.error('Error parsing Ollama stream chunk:', e, line);
            }
          }
        }

        // No tools requested — this turn is the final answer.
        if (turnToolCalls.length === 0) break;

        // Echo the model's tool request, then execute and feed the results back.
        conversation.push({
          role: 'assistant',
          content: '',
          tool_calls: turnToolCalls.map(tc => ({
            function: {
              name: tc.name,
              arguments: typeof tc.argsRaw === 'string' ? safeParseJson(tc.argsRaw) : (tc.argsRaw ?? {})
            }
          }))
        });

        for (const tc of turnToolCalls) {
          if (signal?.aborted) return;
          const toolCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const argsString = typeof tc.argsRaw === 'string' ? tc.argsRaw : JSON.stringify(tc.argsRaw ?? {});
          const startedAt = Date.now();

          let resultRaw: string;
          try {
            resultRaw = await executeToolCall({
              id: toolCallId,
              type: 'function',
              function: { name: tc.name, arguments: argsString }
            });
          } catch (err: any) {
            resultRaw = JSON.stringify({ success: false, error: err?.message || 'Tool execution failed' });
          }

          let parsedResult: any;
          try {
            parsedResult = JSON.parse(resultRaw);
            if (Array.isArray(parsedResult)) parsedResult = { results: parsedResult };
          } catch {
            parsedResult = { content: resultRaw };
          }

          const doneAt = Date.now();
          toolInvocations.push({
            state: 'result',
            toolCallId,
            toolName: tc.name,
            args: typeof tc.argsRaw === 'string' ? safeParseJson(tc.argsRaw) : (tc.argsRaw ?? {}),
            result: parsedResult,
            startedAt,
            completedAt: doneAt,
            latencyMs: doneAt - startedAt
          });

          conversation.push({
            role: 'tool',
            content: typeof parsedResult === 'string' ? parsedResult : JSON.stringify(parsedResult)
          });
        }
      }

      if (toolInvocations.length > 0) {
        yield { text: accumulatedText, thinking: accumulatedThinking, images: [], toolInvocations };
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      console.error('Ollama stream error:', error);
      yield {
        text: `[SYSTEM ERROR] Ollama Connection Severed: ${error.message}`,
        images: []
      };
    }
  }
};
