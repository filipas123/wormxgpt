import { AppSettings, Message, ToolInvocation } from '../types';
import { getEffectiveSystemInstruction, truncateSystemInstruction } from '../utils/promptUtils';
import { OpenAICompatibleService, StreamYield } from './openaiCompatible';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

class CohereService extends OpenAICompatibleService {
  protected readonly providerName = 'Cohere';
  protected readonly baseUrl = 'https://api.cohere.com/v2';
  protected readonly apiKeyField = 'cohereApiKey';
  protected readonly defaultModel = 'command-r-plus';

  constructor() {
    super();
    const saved = typeof window !== 'undefined' ? localStorage.getItem(this.apiKeyField) : null;
    if (saved) this.apiKey = saved;
  }

  protected getChatCompletionsUrl(): string {
    return this.baseUrl + '/chat';
  }

  protected getModelsUrl(): string {
    return 'https://api.cohere.com/v2/models';
  }

  async verifyApiKey(key: string): Promise<boolean> {
    if (!key) return false;
    try {
      const response = await fetch('https://api.cohere.com/v2/models', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async *streamChat(
    settings: AppSettings,
    messages: Message[],
    signal?: AbortSignal
  ): AsyncGenerator<StreamYield> {
    if (signal?.aborted) return;

    const lastMessage = messages[messages.length - 1];
    const prompt = lastMessage?.content || '';

    // Media command delegation
    if (prompt.toLowerCase().startsWith('/image ')) {
      yield* this.delegateMediaCohere('image', prompt.substring(7).trim(), settings, signal);
      return;
    }
    if (prompt.toLowerCase().startsWith('/video ')) {
      yield* this.delegateMediaCohere('video', prompt.substring(7).trim(), settings, signal);
      return;
    }
    if (prompt.toLowerCase().startsWith('/audio ')) {
      yield* this.delegateMediaCohere('audio', prompt.substring(7).trim(), settings, signal);
      return;
    }

    const key = this.getApiKey();
    if (!key) throw new Error('Cohere API key not configured');

    // Token budget management
    const maxTokenBudget = 4000;
    const responseBudget = 1500;
    const tokenBudget = maxTokenBudget - responseBudget;
    let usedTokens = 0;

    let systemPrompt = getEffectiveSystemInstruction(settings, messages);
    if (estimateTokens(systemPrompt) > 1500) {
      systemPrompt = truncateSystemInstruction(systemPrompt, 6000);
    }
    usedTokens += estimateTokens(systemPrompt);

    // Build Cohere v2 messages format
    const apiMessages: any[] = [{ role: 'system', content: systemPrompt }];

    const lastMsg = messages[messages.length - 1];
    const lastMsgFormatted = {
      role: lastMsg.role === 'model' ? 'assistant' : 'user',
      content: lastMsg.content
    };
    usedTokens += estimateTokens(lastMsg.content);

    const historyMessages: any[] = [];
    for (let i = messages.length - 2; i >= 0; i--) {
      const msg = messages[i];
      const msgTokens = estimateTokens(msg.content);
      if (usedTokens + msgTokens > tokenBudget) break;
      historyMessages.unshift({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: msg.content
      });
      usedTokens += msgTokens;
    }

    apiMessages.push(...historyMessages, lastMsgFormatted);

    // Load dynamic tools
    const { getDynamicTools } = await import('./tools');
    const dynamicTools = await getDynamicTools(settings);

    const requestBody: any = {
      model: settings.model || this.defaultModel,
      messages: apiMessages,
      stream: true,
      ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      ...(settings.maxTokens ? { max_tokens: settings.maxTokens } : {}),
      ...(settings.topP !== undefined ? { p: settings.topP } : {})
    };

    if (dynamicTools.length > 0) {
      requestBody.tools = dynamicTools;
    }

    const url = this.getChatCompletionsUrl();
    let accumulatedText = '';
    let toolSources: { title: string; url: string }[] = [];
    // Reported so the UI can render a real result card per executed call.
    const toolInvocations: ToolInvocation[] = [];
    // Set once if this model rejects function declarations (then retried plain).
    let toolFallbackUsed = false;
    const MAX_TURNS = 10;
    const decoder = new TextDecoder();
    let currentApiMessages = [...apiMessages];

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (signal?.aborted) return;

        // Context pruning
        const attachedCount = settings.attachedMessagesCount || 8;
        let recentMsgs = currentApiMessages.slice(-attachedCount);
        while (recentMsgs.length > 0 &&
          (recentMsgs[0].role === 'tool' || (recentMsgs[0].role === 'assistant' && recentMsgs[0].tool_calls))) {
          recentMsgs.shift();
        }
        const systemMsg = currentApiMessages.find((m: any) => m.role === 'system');
        const prunedMessages = systemMsg ? [systemMsg, ...recentMsgs.filter((m: any) => m !== systemMsg)] : recentMsgs;

        const response = await fetch(url, {
          signal,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({ ...requestBody, messages: prunedMessages })
        });

        if (!response.ok) {
          let errorText = await response.text();
          try {
            const jsonError = JSON.parse(errorText);
            if (jsonError.message) errorText = jsonError.message;
          } catch {}
          if (requestBody?.tools && !toolFallbackUsed && /tool|function/i.test(errorText)) {
            // This model does not accept function declarations — retry without
            // them so the turn still produces an answer.
            toolFallbackUsed = true;
            delete requestBody.tools;
            delete requestBody.tool_choice;
            console.warn('[Cohere] Tool declarations rejected — retrying without tools.');
            continue;
          }
          throw new Error(`Cohere Error ${response.status}: ${errorText || response.statusText}`);
        }

        if (!response.body) throw new Error('No response body');
        const reader = response.body.getReader();

        const turnToolCalls: Record<number, { id: string; name: string; args: string }> = {};
        let isMakingToolCall = false;
        let turnText = '';
        let sseBuffer = '';

        while (true) {
          if (signal?.aborted) { reader.cancel(); return; }
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.substring(6).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);

              // Cohere v2 streaming uses the same OpenAI-style format
              if (parsed.type === 'content-delta' || parsed.type === 'text-generation') {
                const text = parsed.delta?.message?.content?.text || parsed.text || '';
                if (text) {
                  turnText += text;
                  yield { text: accumulatedText + turnText, images: [], sources: toolSources };
                }
              } else if (parsed.choices?.[0]?.delta?.content) {
                // OpenAI-compatible fallback
                turnText += parsed.choices[0].delta.content;
                yield { text: accumulatedText + turnText, images: [], sources: toolSources };
              } else if (parsed.choices?.[0]?.delta?.tool_calls) {
                isMakingToolCall = true;
                for (const tc of parsed.choices[0].delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!turnToolCalls[idx]) turnToolCalls[idx] = { id: '', name: '', args: '' };
                  if (tc.id) turnToolCalls[idx].id = tc.id;
                  if (tc.function?.name) turnToolCalls[idx].name = tc.function.name;
                  if (tc.function?.arguments) turnToolCalls[idx].args += tc.function.arguments;
                }
                const firstToolName = Object.values(turnToolCalls)[0]?.name || 'tool';
                const { getToolExecutingString } = await import('../utils/toolHelpers');
                yield { text: accumulatedText + turnText + `\n\n${getToolExecutingString(firstToolName)}`, images: [], sources: toolSources };
              } else if (parsed.type === 'tool-call-start' || parsed.type === 'tool-call-delta') {
                // Cohere native tool call events
                isMakingToolCall = true;
                const idx = parsed.index ?? 0;
                if (!turnToolCalls[idx]) turnToolCalls[idx] = { id: '', name: '', args: '' };
                if (parsed.delta?.message?.tool_calls?.id) turnToolCalls[idx].id = parsed.delta.message.tool_calls.id;
                if (parsed.delta?.message?.tool_calls?.function?.name) turnToolCalls[idx].name = parsed.delta.message.tool_calls.function.name;
                if (parsed.delta?.message?.tool_calls?.function?.arguments) turnToolCalls[idx].args += parsed.delta.message.tool_calls.function.arguments;

                const firstToolName = Object.values(turnToolCalls)[0]?.name || 'tool';
                const { getToolExecutingString } = await import('../utils/toolHelpers');
                yield { text: accumulatedText + turnText + `\n\n${getToolExecutingString(firstToolName)}`, images: [], sources: toolSources };
              }
            } catch {}
          }
        }

        if (isMakingToolCall && Object.keys(turnToolCalls).length > 0) {
          const { executeToolCall } = await import('./tools');
          const { validateAndFixToolArgs, getToolExecutingString, getToolResultString } = await import('../utils/toolHelpers');

          const toolCallsArray = Object.values(turnToolCalls);

          currentApiMessages.push({
            role: 'assistant',
            content: turnText || null,
            tool_calls: toolCallsArray.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: validateAndFixToolArgs(tc.args, tc.name) }
            }))
          });

          accumulatedText += turnText + '\n';

          for (const tc of toolCallsArray) {
            const execStr = getToolExecutingString(tc.name);
            accumulatedText += `${execStr}\n`;
            yield { text: accumulatedText, images: [], sources: toolSources, toolInvocations: [...toolInvocations] };

            const fixedArgs = validateAndFixToolArgs(tc.args, tc.name);
            const startedAt = Date.now();
            const toolResultData = await executeToolCall({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: fixedArgs }
            });

            let parsedResult: any;
            try {
              parsedResult = JSON.parse(toolResultData);
              if (Array.isArray(parsedResult)) parsedResult = { results: parsedResult };
            } catch {
              parsedResult = { content: toolResultData };
            }

            currentApiMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.name,
              content: typeof parsedResult === 'string' ? parsedResult : JSON.stringify(parsedResult)
            });

            try {
              const pr = JSON.parse(toolResultData);
              if (pr.sources) toolSources = [...toolSources, ...pr.sources];
            } catch {}

            let isError = false;
            try {
              const pr = JSON.parse(toolResultData);
              if (pr.error !== undefined) isError = true;
            } catch {}

            let parsedArgs: any = {};
            try { parsedArgs = JSON.parse(fixedArgs); } catch { parsedArgs = {}; }

            toolInvocations.push({
              state: 'result',
              toolCallId: tc.id,
              toolName: tc.name,
              args: parsedArgs,
              result: parsedResult,
              startedAt,
              completedAt: Date.now(),
              latencyMs: Date.now() - startedAt
            });

            const resultStr = getToolResultString(tc.name, isError);
            accumulatedText = accumulatedText.replace(execStr, resultStr);
            yield { text: accumulatedText, images: [], sources: toolSources, toolInvocations: [...toolInvocations] };
          }
          continue;
        } else {
          accumulatedText += turnText;
          break;
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      console.error('Cohere stream error:', error);
      throw new Error(error.message || 'Failed to communicate with Cohere API');
    }
  }

  private async *delegateMediaCohere(
    type: 'image' | 'video' | 'audio',
    prompt: string,
    settings: AppSettings,
    signal?: AbortSignal
  ): AsyncGenerator<StreamYield> {
    const { pollinationsService } = await import('./pollinations');
    if (settings.pollinationsApiKey) {
      pollinationsService.setApiKey(settings.pollinationsApiKey);
    }
    const msgs: Message[] = [{
      role: 'user',
      content: `/${type} ${prompt}`,
      timestamp: Date.now(),
      images: []
    }];
    yield* pollinationsService.streamChat(settings, msgs, signal);
  }
}

export const cohereService = new CohereService();
