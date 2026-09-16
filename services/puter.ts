import { AppSettings, Message, StreamChunk, ToolInvocation } from '../types';
import { getEffectiveSystemInstruction } from '../utils/promptUtils';

export class PuterService {
  /**
   * Retrieves the global or imported Puter instance
   */
  private async getPuter(token?: string): Promise<any> {
    let p: any = null;

    if (typeof window !== 'undefined' && (window as any).puter) {
      p = (window as any).puter;
    } else {
      try {
        const mod = await import('@heyputer/puter.js');
        p = (mod as any).puter || (mod as any).default || mod;
      } catch (err) {
        console.warn('Could not load @heyputer/puter.js dynamic module', err);
      }
    }

    if (p && token) {
      try {
        if (typeof p.init === 'function') {
          p = p.init(token);
        } else if ('authToken' in p) {
          p.authToken = token;
        } else if (typeof p.setAuthToken === 'function') {
          p.setAuthToken(token);
        }
      } catch (e) {
        console.warn('Error setting Puter auth token:', e);
      }
    }

    return p;
  }

  /**
   * Check connection to Puter AI services
   */
  async verifyConnection(token?: string): Promise<boolean> {
    try {
      const puter = await this.getPuter(token);
      return !!puter?.ai?.chat;
    } catch {
      return false;
    }
  }

  /**
   * Generates single-turn or multi-turn chat through Puter AI
   */
  async generateChat(
    settings: AppSettings, 
    messages: Message[], 
    signal?: AbortSignal
  ): Promise<{ text: string; images: string[] }> {
    const token = settings.puterApiKey || (typeof window !== 'undefined' ? localStorage.getItem('puterApiKey') : '') || '';
    const lastMessage = messages[messages.length - 1];
    const prompt = lastMessage?.content || '';

    // Handle image generation via Puter txt2img
    if (prompt.toLowerCase().startsWith('/image ') || (settings.model && settings.model.startsWith('gpt-image'))) {
      const imgPrompt = prompt.toLowerCase().startsWith('/image ') ? prompt.substring(7).trim() : prompt;
      return this.generateImage(imgPrompt, settings, token, signal);
    }

    const puter = await this.getPuter(token);
    const model = settings.model || 'gpt-5.6-sol';

    // Format messages for Puter AI. The system instruction carries the user's
    // prompt plus the armed-tool catalog, without which the model cannot know
    // which tools exist (or how to ask for them).
    const systemInstruction = getEffectiveSystemInstruction(settings, messages);
    const puterMessages = [
      ...(systemInstruction.trim() ? [{ role: 'system', content: systemInstruction }] : []),
      ...messages.map(m => ({
        role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    ];

    if (puter?.ai?.chat) {
      try {
        if (signal?.aborted) throw new Error('Generation aborted');

        const resp = await puter.ai.chat(puterMessages as any, { 
          model, 
          stream: false,
          temperature: settings.temperature ?? 0.7
        });

        const text = typeof resp === 'string' ? resp : resp?.message?.content || resp?.text || JSON.stringify(resp);
        return { text: text || 'Response completed via Puter AI.', images: [] };
      } catch (error: any) {
        if (error?.name === 'AbortError') throw error;
        console.warn('Puter chat failed, falling back to Pollinations...', error);
      }
    }

    // Fallback to pollinations if Puter SDK fails or is offline
    const { pollinationsService } = await import('./pollinations');
    return pollinationsService.generateChat(settings, messages, signal);
  }

  /**
   * Generates an image using Puter.js txt2img
   */
  private async generateImage(
    prompt: string,
    settings: AppSettings,
    token?: string,
    signal?: AbortSignal
  ): Promise<{ text: string; images: string[] }> {
    if (signal?.aborted) throw new Error('Generation cancelled');
    const model = settings.model?.startsWith('gpt-image') ? settings.model : 'gpt-image-2';

    try {
      const puter = await this.getPuter(token);
      if (puter?.ai?.txt2img) {
        const result = await puter.ai.txt2img(prompt, { model });
        let imageUrl = '';
        if (typeof result === 'string') {
          imageUrl = result;
        } else if (result?.src) {
          imageUrl = result.src;
        } else if (result?.url) {
          imageUrl = result.url;
        }

        if (imageUrl) {
          return {
            text: `Image generated via Puter.js (${model}):\n\n**Prompt:** ${prompt}`,
            images: [imageUrl]
          };
        }
      }
    } catch (err) {
      console.warn('Puter txt2img failed, falling back to Pollinations...', err);
    }

    const { pollinationsService } = await import('./pollinations');
    return pollinationsService.generateChat(
      { ...settings, model: 'flux' }, 
      [{ role: 'user', content: `/image ${prompt}`, timestamp: Date.now() }], 
      signal
    );
  }

  /**
   * Real-time token streaming chat generator via Puter.js
   */
  async *streamChat(
    settings: AppSettings, 
    messages: Message[], 
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const token = settings.puterApiKey || (typeof window !== 'undefined' ? localStorage.getItem('puterApiKey') : '') || '';
    const lastMessage = messages[messages.length - 1];
    const prompt = lastMessage?.content || '';

    // Handle image generation
    if (prompt.toLowerCase().startsWith('/image ') || (settings.model && settings.model.startsWith('gpt-image'))) {
      const imgRes = await this.generateChat(settings, messages, signal);
      yield { text: imgRes.text, images: imgRes.images };
      return;
    }

    const puter = await this.getPuter(token);
    const model = settings.model || 'gpt-5.6-sol';

    const systemInstruction = getEffectiveSystemInstruction(settings, messages);
    const conversation: any[] = [
      ...(systemInstruction.trim() ? [{ role: 'system', content: systemInstruction }] : []),
      ...messages.map(m => ({
        role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    ];

    // ── Arm native function declarations ────────────────────────────────────
    // Puter's chat API accepts OpenAI-style `tools`; without them the model can
    // only *narrate* a tool call and nothing would ever execute.
    let armedTools: any[] = [];
    try {
      const { getDynamicTools } = await import('./tools');
      armedTools = await getDynamicTools(settings);
    } catch (toolErr: any) {
      console.warn('[Puter] Tool declarations unavailable:', toolErr?.message);
      armedTools = [];
    }

    if (puter?.ai?.chat) {
      try {
        if (signal?.aborted) throw new Error('Generation cancelled');

        const toolInvocations: ToolInvocation[] = [];
        const MAX_TURNS = 5;
        let accumulatedText = '';

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          if (signal?.aborted) throw new Error('Generation cancelled');

          let streamResponse: any;
          try {
            streamResponse = await puter.ai.chat(conversation as any, {
              model,
              stream: true,
              temperature: settings.temperature ?? 0.7,
              ...(armedTools.length > 0 ? { tools: armedTools } : {})
            });
          } catch (startErr: any) {
            if (armedTools.length > 0) {
              // Some models/endpoints reject function declarations — retry plain.
              console.warn('[Puter] Tool declarations rejected, retrying without tools:', startErr?.message);
              armedTools = [];
              streamResponse = await puter.ai.chat(conversation as any, {
                model,
                stream: true,
                temperature: settings.temperature ?? 0.7
              });
            } else {
              throw startErr;
            }
          }

          const turnToolCalls: Array<{ id: string; name: string; args: string }> = [];
          let turnText = '';

          const collect = (rawCalls: any[]) => {
            for (const tc of rawCalls) {
              const fn = tc?.function || {};
              const name = fn.name || tc?.name;
              if (!name) continue;
              const idx = typeof tc.index === 'number' ? tc.index : turnToolCalls.length;
              if (!turnToolCalls[idx]) turnToolCalls[idx] = { id: '', name: '', args: '' };
              if (tc.id) turnToolCalls[idx].id = tc.id;
              turnToolCalls[idx].name = name;
              if (typeof fn.arguments === 'string') turnToolCalls[idx].args += fn.arguments;
              else if (fn.arguments) turnToolCalls[idx].args = JSON.stringify(fn.arguments);
            }
          };

          // Puter returns an async iterable for streams
          if (streamResponse && typeof (streamResponse as any)[Symbol.asyncIterator] === 'function') {
            for await (const part of streamResponse as any) {
              if (signal?.aborted) throw new Error('Generation cancelled');
              const delta = part?.text || part?.message?.content || (typeof part === 'string' ? part : '');
              if (delta) {
                turnText += delta;
                yield { text: accumulatedText + turnText, images: [] };
              }
              const rawCalls = part?.tool_calls || part?.message?.tool_calls;
              if (Array.isArray(rawCalls)) collect(rawCalls);
            }
          } else {
            // Non-streamed shape: { message: { content, tool_calls } } or plain string
            const text = typeof streamResponse === 'string'
              ? streamResponse
              : streamResponse?.message?.content || streamResponse?.text || '';
            if (text) {
              turnText += text;
              yield { text: accumulatedText + turnText, images: [] };
            }
            const rawCalls = streamResponse?.message?.tool_calls || streamResponse?.tool_calls;
            if (Array.isArray(rawCalls)) collect(rawCalls);
          }

          const calls = turnToolCalls.filter(tc => tc.name);
          if (calls.length === 0) {
            accumulatedText += turnText;
            break;
          }

          const { executeToolCall } = await import('./tools');
          const { validateAndFixToolArgs, getToolExecutingString, getToolResultString } = await import('../utils/toolHelpers');

          accumulatedText += turnText + '\n';
          conversation.push({
            role: 'assistant',
            content: turnText || null,
            tool_calls: calls.map(c => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: validateAndFixToolArgs(c.args, c.name) }
            }))
          });

          for (const call of calls) {
            const execStr = getToolExecutingString(call.name);
            accumulatedText += `${execStr}\n`;
            yield { text: accumulatedText, images: [] };

            const callId = call.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const fixedArgs = validateAndFixToolArgs(call.args, call.name);
            const startedAt = Date.now();
            let rawResult = '';
            let isError = false;
            try {
              rawResult = await executeToolCall({
                id: callId,
                type: 'function',
                function: { name: call.name, arguments: fixedArgs }
              });
              isError = rawResult.includes('"success":false') || rawResult.includes('"error":');
            } catch (execErr: any) {
              isError = true;
              rawResult = JSON.stringify({ success: false, error: execErr?.message || 'Tool execution failed' });
            }

            let parsedResult: any;
            try {
              parsedResult = JSON.parse(rawResult);
              if (Array.isArray(parsedResult)) parsedResult = { results: parsedResult };
            } catch {
              parsedResult = { content: rawResult };
            }

            accumulatedText = accumulatedText.replace(execStr, getToolResultString(call.name, isError));

            let parsedArgs: any = {};
            try { parsedArgs = JSON.parse(fixedArgs); } catch { parsedArgs = {}; }

            toolInvocations.push({
              state: 'result',
              toolCallId: callId,
              toolName: call.name,
              args: parsedArgs,
              result: parsedResult,
              startedAt,
              completedAt: Date.now(),
              latencyMs: Date.now() - startedAt
            });

            conversation.push({
              role: 'tool',
              tool_call_id: callId,
              name: call.name,
              content: typeof parsedResult === 'string' ? parsedResult : JSON.stringify(parsedResult)
            });
          }
        }

        if (accumulatedText) {
          yield {
            text: accumulatedText,
            images: [],
            toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined
          };
          return;
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        console.warn('Puter streaming error, falling back to generateChat / Pollinations...', err);
      }
    }

    // Final fallback
    const res = await this.generateChat(settings, messages, signal);
    yield { text: res.text, images: res.images };
  }
}

export const puterService = new PuterService();
