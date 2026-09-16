import { validateAndFixToolArgs } from "../utils/toolHelpers";
import { getEffectiveSystemInstruction } from "../utils/promptUtils";
import { AppSettings, Message, ToolInvocation } from '../types';

/** Best-effort parse of a tool argument payload for display purposes. */
function safeJsonArgs(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export class MoonshotService {
  private apiKey: string = "";
  private readonly baseUrl = 'https://api.moonshot.ai/v1/chat/completions';
  private readonly MAX_TOOL_TURNS = 5;

  setApiKey(key: string) {
    this.apiKey = key;
  }

  async verifyApiKey(key: string): Promise<boolean> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model: "kimi-k2.5",
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 1,
          stream: false
        })
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async *streamChat(
    settings: AppSettings,
    history: Message[],
    signal?: AbortSignal
  ): AsyncGenerator<{ text: string; images: string[]; video?: string; audio?: string; sources?: { title: string; url: string }[]; toolInvocations?: ToolInvocation[] }> {
    if (!this.apiKey) {
      throw new Error('Moonshot API key not configured');
    }

    // Declare the armed tools so the model can request a real function call.
    // Without these Kimi can only describe a tool call in prose and nothing is
    // ever executed.
    const { getDynamicTools, executeToolCall } = await import('./tools');
    let tools: any[] | undefined;
    try {
      const dynamicTools = await getDynamicTools(settings);
      if (dynamicTools.length > 0) {
        tools = dynamicTools.map((t: any) => ({
          type: 'function',
          function: {
            name: t.function.name,
            description: t.function.description || `Tool: ${t.function.name}`,
            parameters: t.function.parameters || { type: 'object', properties: {} }
          }
        }));
      }
    } catch {
      tools = undefined;
    }

    const attachedCount = settings.attachedMessagesCount || 8;
    let recentHistory = history.slice(-attachedCount);

    // Ensure we don't start with a message that is ONLY tool results or an assistant message with tool_calls
    while (recentHistory.length > 0 &&
      (recentHistory[0].toolInvocations?.some(ti => ti.state === 'result') ||
        (recentHistory[0].role === 'model' && recentHistory[0].toolInvocations?.some(ti => ti.state === 'call')))) {
      recentHistory.shift();
    }

    const conversation: any[] = [
      { role: 'system', content: getEffectiveSystemInstruction(settings, history) },
      ...recentHistory.map(m => ({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: m.content
      }))
    ];

    const toolInvocations: ToolInvocation[] = [];
    let accumulatedText = '';

    for (let turn = 0; turn < this.MAX_TOOL_TURNS; turn++) {
      if (signal?.aborted) {
        throw new DOMException('Generation cancelled by user.', 'AbortError');
      }

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        signal,
        body: JSON.stringify({
          model: settings.model || "kimi-k2.5",
          messages: conversation,
          temperature: settings.temperature,
          stream: true,
          ...(tools ? { tools, tool_choice: 'auto' } : {})
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Moonshot Error: ${error.error?.message || response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      const turnToolCalls: Array<{ id: string; name: string; args: string }> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          try {
            const data = JSON.parse(payload);
            const delta = data.choices?.[0]?.delta;
            if (!delta) continue;

            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx = typeof tc.index === 'number' ? tc.index : turnToolCalls.length;
                if (!turnToolCalls[idx]) turnToolCalls[idx] = { id: '', name: '', args: '' };
                if (tc.id) turnToolCalls[idx].id = tc.id;
                if (tc.function?.name) turnToolCalls[idx].name = tc.function.name;
                if (tc.function?.arguments) turnToolCalls[idx].args += tc.function.arguments;
              }
            }

            if (delta.content) {
              accumulatedText += delta.content;
              yield { text: accumulatedText, images: [] };
            }
          } catch {
            // Malformed chunk — skip
          }
        }
      }

      const requested = turnToolCalls.filter(tc => tc.name);
      if (requested.length === 0) {
        break;
      }

      // Echo the model turn back (required before tool results) then execute.
      const assistantToolCalls = requested.map(tc => ({
        id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.args || '{}' }
      }));
      conversation.push({ role: 'assistant', content: null, tool_calls: assistantToolCalls });

      for (const tc of assistantToolCalls) {
        if (signal?.aborted) {
          throw new DOMException('Generation cancelled by user.', 'AbortError');
        }
        const fixedArgs = validateAndFixToolArgs(tc.function.arguments, tc.function.name);
        const startedAt = Date.now();

        let resultStr: string;
        try {
          resultStr = await executeToolCall({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: fixedArgs }
          });
        } catch (execErr: any) {
          resultStr = JSON.stringify({ success: false, error: execErr?.message || 'Tool execution failed' });
        }

        const parsedResult = safeJsonArgs(resultStr);

        toolInvocations.push({
          state: 'result',
          toolCallId: tc.id,
          toolName: tc.function.name,
          args: safeJsonArgs(fixedArgs),
          result: parsedResult,
          startedAt,
          completedAt: Date.now(),
          latencyMs: Date.now() - startedAt
        });

        conversation.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: typeof parsedResult === 'string' ? parsedResult : JSON.stringify(parsedResult)
        });
      }
    }

    // Surface the tool activity so the UI can render result cards.
    if (toolInvocations.length > 0) {
      yield { text: accumulatedText, images: [], toolInvocations };
    }
  }
}

export const moonshotService = new MoonshotService();
