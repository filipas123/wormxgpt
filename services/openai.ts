import { Message, AppSettings, ToolInvocation } from '../types';
import { getEffectiveSystemInstruction } from '../utils/promptUtils';

/** Best-effort parse of a tool argument payload for display purposes. */
function safeJsonArgs(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

class OpenAIService {
  private apiKey: string | null = null;
  private baseUrl = 'https://api.openai.com/v1/chat/completions';
  private readonly DEFAULT_BASE_URL = 'https://api.openai.com/v1/chat/completions';

  setApiKey(key: string) {
    this.apiKey = key;
  }

  setBaseUrl(url?: string) {
    this.baseUrl = url ?? this.DEFAULT_BASE_URL;
  }

  async generateChat(
    settings: AppSettings,
    messages: Message[],
    signal?: AbortSignal
  ): Promise<{ text: string; images: string[]; video?: string; audio?: string; sources?: { title: string; url: string }[]; toolInvocations?: ToolInvocation[] }> {
    const key = settings.openaiApiKey || this.apiKey || (typeof window !== 'undefined' ? localStorage.getItem('openaiApiKey') : '') || '';
    if (!key) {
      throw new Error('OpenAI API key not configured');
    }

    const { getDynamicTools } = await import('./tools');
    const dynamicTools = await getDynamicTools(settings);

    const attachedCount = settings.attachedMessagesCount || 8;
    let recentMessages = messages.slice(-attachedCount);
    
    while (recentMessages.length > 0 && 
          (recentMessages[0].toolInvocations?.some(ti => ti.state === 'result') || 
           (recentMessages[0].role === 'model' && recentMessages[0].toolInvocations?.some(ti => ti.state === 'call')))) {
      recentMessages.shift();
    }
    
    const formattedMessages: any[] = [];
    for (const m of recentMessages) {
      if (m.toolInvocations) {
        const results = m.toolInvocations.filter(ti => ti.state === 'result');
        if (results.length > 0) {
          results.forEach(res => {
            let parsedResult: any;
            try {
              parsedResult = typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
              if (Array.isArray(parsedResult)) parsedResult = { results: parsedResult };
            } catch (e) {
              parsedResult = res.result;
            }

            formattedMessages.push({
              role: 'tool',
              tool_call_id: res.toolCallId,
              content: typeof parsedResult === 'string' ? parsedResult : JSON.stringify(parsedResult)
            });
          });
          continue;
        }
      }
      
      formattedMessages.push({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: m.content
      });
    }

    const mappedTools = dynamicTools.length > 0 ? dynamicTools.map((t: any) => ({
      type: 'function',
      function: {
        name: t.function.name,
        description: t.function.description || `Tool: ${t.function.name}`,
        parameters: t.function.parameters
      }
    })) : undefined;

    const requestBody: any = {
      model: settings.model || 'gpt-4o',
      messages: [
        { role: 'system', content: getEffectiveSystemInstruction(settings, messages) },
        ...formattedMessages
      ],
      temperature: settings.temperature ?? 0.7,
      top_p: settings.topP ?? 1.0,
      ...(settings.maxTokens ? { max_tokens: settings.maxTokens } : {}),
      presence_penalty: settings.presencePenalty ?? 0.0,
      frequency_penalty: settings.frequencyPenalty ?? 0.0,
      stream: false,
      ...(mappedTools ? { tools: mappedTools, tool_choice: 'auto' } : {})
    };

    let accumulatedText = '';
    let toolSources: { title: string; url: string }[] = [];
    const toolInvocations: ToolInvocation[] = [];
    const conversation: any[] = [...requestBody.messages];
    const MAX_TURNS = 5;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal?.aborted) throw new Error('Generation cancelled by user');

      const response = await fetch(this.baseUrl, {
        signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({ ...requestBody, messages: conversation })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI Error ${response.status}: ${err}`);
      }

      const data = await response.json();
      const assistantMsg = data.choices?.[0]?.message;

      // Execute any requested tool calls, feed results back, and let the model continue.
      if (assistantMsg?.tool_calls && assistantMsg.tool_calls.length > 0) {
        const { executeToolCall } = await import('./tools');
        const { getToolExecutingString, getToolResultString, validateAndFixToolArgs } = await import('../utils/toolHelpers');

        conversation.push(assistantMsg);
        if (assistantMsg.content) accumulatedText += assistantMsg.content + '\n';

        for (const tc of assistantMsg.tool_calls) {
          const toolCallId = tc.id || `call_${Math.random().toString(36).slice(2, 10)}`;
          const toolName = tc.function?.name || '';
          const toolArgsStr = tc.function?.arguments || '{}';
          const execMarker = getToolExecutingString(toolName);
          accumulatedText += `${execMarker}\n`;
          const startedAt = Date.now();
          const fixedArgs = validateAndFixToolArgs(toolArgsStr, toolName);

          const toolResultData = await executeToolCall({
            id: toolCallId,
            type: 'function',
            function: { name: toolName, arguments: fixedArgs }
          });

          let parsedResult: any;
          let isError = false;
          try {
            parsedResult = JSON.parse(toolResultData);
            if (Array.isArray(parsedResult)) parsedResult = { results: parsedResult };
            if (parsedResult.sources) toolSources = [...toolSources, ...parsedResult.sources];
            if (parsedResult.error !== undefined || parsedResult.success === false) isError = true;
          } catch {
            parsedResult = { content: toolResultData };
          }

          // Replace the in-progress marker so the transcript reports the outcome
          // instead of leaving a permanently "Executing..." line behind.
          accumulatedText = accumulatedText.replace(
            execMarker,
            getToolResultString(toolName, isError)
          );

          toolInvocations.push({
            state: 'result',
            toolCallId,
            toolName,
            args: safeJsonArgs(fixedArgs),
            result: parsedResult,
            startedAt,
            completedAt: Date.now(),
            latencyMs: Date.now() - startedAt
          });

          conversation.push({
            role: 'tool',
            tool_call_id: toolCallId,
            name: toolName,
            content: typeof parsedResult === 'string' ? parsedResult : JSON.stringify(parsedResult)
          });
        }
        continue;
      }

      accumulatedText += assistantMsg?.content || '';
      return { text: accumulatedText, images: [], sources: toolSources, toolInvocations };
    }

    return { text: accumulatedText || 'No response generated.', images: [], sources: toolSources, toolInvocations };
  }

  async *streamChat(
    settings: AppSettings,
    messages: Message[],
    signal?: AbortSignal
  ): AsyncGenerator<{ text: string; images: string[]; video?: string; audio?: string; sources?: { title: string; url: string }[]; toolInvocations?: ToolInvocation[] }> {
    // Real token streaming over SSE for plain text requests.
    // Vision inputs, media commands and tool-turn continuations use the blocking path.
    const lastMsg = messages[messages.length - 1];
    const prompt = (lastMsg?.content || '').trim().toLowerCase();
    const isMediaCommand = prompt.startsWith('/image ') || prompt.startsWith('/video ') || prompt.startsWith('/audio ');
    const hasComplexTurns = messages.some(m => (m.images && m.images.length > 0) || m.toolInvocations);
    if (!isMediaCommand && !hasComplexTurns) {
      const streamed = yield* this.streamTextSSE(settings, messages, signal);
      if (streamed) return;
    }
    const result = await this.generateChat(settings, messages, signal);
    yield result;
  }

  /**
   * True token streaming over SSE from api.openai.com.
   * Yields cumulative text; returns true if the stream produced content,
   * false if it failed (caller falls back to the blocking path).
   */
  private async *streamTextSSE(
    settings: AppSettings,
    messages: Message[],
    signal?: AbortSignal
  ): AsyncGenerator<{ text: string; images: string[]; sources?: { title: string; url: string }[] }, boolean, void> {
    const key = settings.openaiApiKey || this.apiKey || (typeof window !== 'undefined' ? localStorage.getItem('openaiApiKey') : '') || '';
    if (!key) return false;

    // Declare the armed tools here as well. Without this the streamed request
    // never advertises any function, so the model can only *describe* a tool
    // call instead of requesting one and no tool can ever execute.
    let sseTools: any[] | undefined;
    try {
      const { getDynamicTools } = await import('./tools');
      const dynamicTools = await getDynamicTools(settings);
      if (dynamicTools.length > 0) {
        sseTools = dynamicTools.map((t: any) => ({
          type: 'function',
          function: {
            name: t.function.name,
            description: t.function.description || `Tool: ${t.function.name}`,
            parameters: t.function.parameters || { type: 'object', properties: {} }
          }
        }));
      }
    } catch {
      sseTools = undefined;
    }

    const systemInstruction = getEffectiveSystemInstruction(settings, messages);
    const formattedMessages: any[] = [];
    if (systemInstruction && systemInstruction.trim()) {
      formattedMessages.push({ role: 'system', content: systemInstruction });
    }
    for (const m of messages) {
      formattedMessages.push({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: m.content
      });
    }

    let resp: Response;
    try {
      resp = await fetch(this.baseUrl, {
        signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model: settings.model || 'gpt-4o',
          messages: formattedMessages,
          temperature: settings.temperature ?? 0.7,
          top_p: settings.topP ?? 1.0,
          ...(settings.maxTokens ? { max_tokens: settings.maxTokens } : {}),
          presence_penalty: settings.presencePenalty ?? 0.0,
          frequency_penalty: settings.frequencyPenalty ?? 0.0,
          stream: true,
          ...(sseTools ? { tools: sseTools, tool_choice: 'auto' } : {})
        })
      });
    } catch {
      return false;
    }

    if (!resp.ok || !resp.body) return false;

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('event-stream')) {
      // Endpoint ignored stream:true and returned a single JSON body —
      // surface it as a successful blocking response instead of failing.
      try {
        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content || '';
        if (text) {
          yield { text, images: [], sources: [] };
          return true;
        }
      } catch { /* fall through */ }
      return false;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let cumulative = '';
    let sawToolCall = false;

    try {
      while (true) {
        if (signal?.aborted) {
          try { await reader.cancel(); } catch {}
          throw new DOMException('Generation cancelled by user.', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload);
              const choice = json.choices?.[0];
              if (choice?.delta?.tool_calls?.length) sawToolCall = true;
              const delta = choice?.delta?.content ?? '';
              if (delta) {
                cumulative += delta;
                yield { text: cumulative, images: [], sources: [] };
              }
            } catch {
              // Malformed JSON chunk — skip
            }
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }

    // A streamed tool request carries no text, and a mixed one still needs the
    // tool executed — both cases hand off to the tool-aware blocking path.
    if (sawToolCall) return false;
    return cumulative.length > 0;
  }

  async verifyApiKey(key: string): Promise<boolean> {
    if (!key) return false;
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${key}`
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const openaiService = new OpenAIService();
