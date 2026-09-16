import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { AppSettings, Message, ToolInvocation } from "../types";
import { estimateTokens } from "../utils/tokenManager";
import { getEffectiveSystemInstruction, truncateSystemInstruction } from "../utils/promptUtils";
import { promptCacheService } from "./promptCache";

export interface StreamResponse {
  text: string;
  images: string[];
  video?: string;
  audio?: string;
  sources?: { title: string; url: string }[];
  toolInvocations?: ToolInvocation[];
}

export class GeminiService {
  private getPersistedApiKey(): string {
    return localStorage.getItem('geminiApiKey') || '';
  }

  setApiKey(key: string) {
    localStorage.setItem('geminiApiKey', key);
  }

  /**
   * Builds the thinking (chain-of-thought) config for Gemini models that support
   * it. Reasoning *before* acting is what makes native function calling
   * reliable, so thinking is armed for every 2.5+/3.x model the operator
   * selected — not only Pro. Pro cannot fully disable thinking, so it falls back
   * to the smallest allowed budget when the operator turns thinking off.
   */
  private buildThinkingConfig(settings: AppSettings, model: string): { thinkingBudget: number } | undefined {
    const m = (model || '').toLowerCase();
    const supportsThinking = m.includes('gemini-2.5') || m.includes('gemini-3');
    if (!supportsThinking) return undefined;

    const isPro = m.includes('pro');
    const asked = Number(settings.thinkingBudget ?? 0);
    const wantsThinking = settings.thinkingEnabled !== false && asked > 0;

    if (!wantsThinking) {
      // 2.5 Pro / 3 Pro cannot disable thinking entirely; 0 is valid only for Flash.
      return { thinkingBudget: isPro ? 128 : 0 };
    }

    return {
      thinkingBudget: isPro
        ? Math.min(Math.max(asked, 128), 32768)
        : Math.min(Math.max(asked, 512), 24576)
    };
  }

  /**
   * Synchronous standard request-response Gemini handler
   */
  async generateChat(
    settings: AppSettings,
    messages: Message[],
    signal?: AbortSignal
  ): Promise<StreamResponse> {
    const lastMessage = messages[messages.length - 1];
    const prompt = lastMessage.content;

    // Check for media generation commands - delegate to Pollinations
    if (prompt.toLowerCase().startsWith('/image ')) {
      const imagePrompt = prompt.substring(7).trim();
      return this.generateMediaViaPollinations('image', imagePrompt, settings);
    }

    if (prompt.toLowerCase().startsWith('/video ')) {
      const videoPrompt = prompt.substring(7).trim();
      return this.generateMediaViaPollinations('video', videoPrompt, settings);
    }

    if (prompt.toLowerCase().startsWith('/audio ')) {
      const audioPrompt = prompt.substring(7).trim();
      return this.generateMediaViaPollinations('audio', audioPrompt, settings);
    }

    const key = settings.geminiApiKey || this.getPersistedApiKey() || process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    if (!key) {
      throw new Error('Gemini API key not configured');
    }

    const ai = new GoogleGenAI({ apiKey: key });

    const maxTokens = 28000;
    const responseBudget = 4000;

    let systemPrompt = getEffectiveSystemInstruction(settings, messages);
    if (estimateTokens(systemPrompt) > 30000) {
      systemPrompt = truncateSystemInstruction(systemPrompt, 90000);
    }

    const systemBudget = estimateTokens(systemPrompt);
    const historyBudget = maxTokens - systemBudget - responseBudget;
    const historyWithoutLast = messages.slice(0, -1);

    let recentHistory: Message[] = [];
    let historyTokens = 0;

    for (let i = historyWithoutLast.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(historyWithoutLast[i].content);
      if (historyTokens + msgTokens > historyBudget) break;
      recentHistory.unshift(historyWithoutLast[i]);
      historyTokens += msgTokens;
    }

    const isValidBase64Image = (img: string): boolean => {
      if (!img || typeof img !== 'string') return false;
      if (!img.startsWith('data:image/')) return false;
      if (!img.includes(';base64,')) return false;
      const mimeMatch = img.match(/^data:(image\/[a-z0-9+-]+);base64,/i);
      if (!mimeMatch || mimeMatch[1].length >= 256) return false;
      const dataStart = img.indexOf(';base64,') + 8;
      return dataStart < img.length && img.length - dataStart >= 100;
    };

    const extractMimeType = (dataUrl: string): string => {
      const match = dataUrl.match(/^data:(image\/[a-z0-9+-]+);base64,/i);
      return match ? match[1] : 'image/jpeg';
    };

    const extractBase64Data = (dataUrl: string): string => {
      const idx = dataUrl.indexOf(';base64,');
      return idx !== -1 ? dataUrl.slice(idx + 8) : '';
    };

    const chatHistory = recentHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const currentParts: Part[] = [{ text: lastMessage.content }];
    if (lastMessage.images && lastMessage.images.length > 0) {
      lastMessage.images.filter(isValidBase64Image).forEach(img => {
        currentParts.push({
          inlineData: {
            mimeType: extractMimeType(img),
            data: extractBase64Data(img)
          }
        });
      });
    }

    const { getDynamicTools } = await import('./tools');
    const dynamicTools = await getDynamicTools(settings);
    const geminiTools = dynamicTools.length > 0 ? [{
      functionDeclarations: dynamicTools.map((t: any) => ({
        name: t.function.name,
        description: t.function.description || `Tool: ${t.function.name}`,
        parameters: t.function.parameters
      }))
    }] : [];

    const contents = [...chatHistory, { role: 'user', parts: currentParts }];
    let accumulatedText = "";
    let foundImages: string[] = [];
    let toolSources: { title: string; url: string }[] = [];
    const MAX_TURNS = 6;
    const { validateAndFixToolArgs, getToolExecutingString, getToolResultString } = await import('../utils/toolHelpers');
    const { pruneToolResult } = await import('../utils/tokenManager');

    const conversationContext = chatHistory.map(m => `${m.role}:${(m.parts as any[])[0]?.text || ''}`).join('|');

    if (promptCacheService.enabled) {
      const cached = promptCacheService.lookup(
        settings.model, prompt, systemPrompt,
        settings.temperature, settings.maxTokens ?? 4000,
        conversationContext
      );
      if (cached) {
        return { text: cached.response, images: cached.images || [], sources: [] };
      }
    }

    let usedToolCalls = false;

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (signal?.aborted) throw new Error('Generation cancelled by user');

        const attachedCount = settings.attachedMessagesCount || 8;
        let recentContents = contents.slice(-attachedCount);
        
        while (recentContents.length > 0 && 
              (recentContents[0].role === 'model' || (recentContents[0].role === 'user' && recentContents[0].parts.some((p: any) => p.functionResponse)))) {
          recentContents.shift();
        }

        const prunedContents = contents.length > attachedCount ? [contents[0], ...recentContents] : contents;

        const normalizeModel = (m: string) => {
          const raw = (m || '').toLowerCase();
          if (raw.includes('gemini-3') || raw.includes('gemini-1.5')) {
            return raw.includes('pro') ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
          }
          if (raw.startsWith('gemini-')) return raw;
          return 'gemini-2.5-flash';
        };
        const modelToUse = normalizeModel(settings.model);

        let response: any;
        try {
          response = await ai.models.generateContent({
            model: modelToUse,
            contents: prunedContents,
            config: {
              systemInstruction: systemPrompt,
              temperature: settings.temperature,
              topP: settings.topP ?? 1.0,
              maxOutputTokens: settings.maxTokens ?? 4000,
              thinkingConfig: this.buildThinkingConfig(settings, modelToUse),
              tools: geminiTools as any,
            },
          });
        } catch (callErr: any) {
          if (modelToUse !== 'gemini-2.5-flash') {
            console.warn(`[Gemini] ${modelToUse} failed, falling back to gemini-2.5-flash:`, callErr?.message);
            response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: prunedContents,
              config: {
                systemInstruction: systemPrompt,
                temperature: settings.temperature,
                topP: settings.topP ?? 1.0,
                maxOutputTokens: settings.maxTokens ?? 4000,
                thinkingConfig: this.buildThinkingConfig(settings, 'gemini-2.5-flash'),
                tools: geminiTools as any,
              },
            });
          } else {
            throw callErr;
          }
        }

        if (signal?.aborted) throw new Error('Generation cancelled by user');

        const turnToolCalls: Array<{ name: string; args: any; thoughtSignature?: string }> = [];
        let isMakingToolCall = false;
        let turnText = "";
        let fullModelParts: any[] = [];

        if (response.candidates?.[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts as any[]) {
            fullModelParts.push(part);
            if (part.functionCall) {
              isMakingToolCall = true;
              turnToolCalls.push({
                name: part.functionCall.name,
                args: part.functionCall.args,
                thoughtSignature: part.thoughtSignature
              });
            } else if (part.text) {
              turnText += part.text;
            } else if (part.inlineData) {
              const imgUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
              if (!foundImages.includes(imgUrl)) {
                foundImages.push(imgUrl);
              }
            }
          }
        }

        if (isMakingToolCall && turnToolCalls.length > 0) {
          usedToolCalls = true;
          const { executeToolCall } = await import('./tools');
          accumulatedText += turnText + "\n";
          const toolResponsesParts: Part[] = [];

          for (const tc of turnToolCalls) {
            const execStr = getToolExecutingString(tc.name);
            accumulatedText += `${execStr}\n`;

            const argsString = typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args);
            const toolResultRaw = await executeToolCall({
              id: 'call_' + Math.random().toString(36).substring(7),
              type: 'function',
              function: { name: tc.name, arguments: validateAndFixToolArgs(argsString, tc.name) }
            });

            const toolResultData = pruneToolResult(toolResultRaw, 32000);

            let parsedResponse: any;
            try {
              parsedResponse = JSON.parse(toolResultData);
              if (Array.isArray(parsedResponse)) {
                parsedResponse = { results: parsedResponse };
              }
            } catch (e) {
              parsedResponse = { content: toolResultData };
            }

            if (parsedResponse.sources && Array.isArray(parsedResponse.sources)) {
              toolSources = [...toolSources, ...parsedResponse.sources];
            }

            toolResponsesParts.push({
              functionResponse: {
                name: tc.name,
                response: parsedResponse
              }
            });

            let isError = false;
            try {
              const parsedResult = JSON.parse(toolResultData);
              if (parsedResult.error !== undefined) isError = true;
            } catch (e) { isError = false; }

            const resultStr = getToolResultString(tc.name, isError);
            accumulatedText = accumulatedText.replace(execStr, resultStr);
          }

          contents.push({ role: 'model', parts: fullModelParts });
          contents.push({ role: 'user', parts: toolResponsesParts });
          continue;
        } else {
          accumulatedText += turnText;
          break;
        }
      }

      if (promptCacheService.enabled && accumulatedText && !usedToolCalls) {
        promptCacheService.store(
          settings.model, prompt, systemPrompt,
          settings.temperature, settings.maxTokens ?? 4000,
          accumulatedText, foundImages.length > 0 ? foundImages : undefined,
          conversationContext
        );
      }

      return {
        text: accumulatedText || 'No response generated.',
        images: foundImages,
        sources: toolSources
      };
    } catch (error: any) {
      if (error.name === 'AbortError') throw error;
      let errorMessage = error?.message || 'Unknown anomaly';
      if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('401')) {
        errorMessage = "API_KEY_INVALID: Authentication failed. Check your Gemini API key in settings.";
      }
      throw new Error(errorMessage);
    }
  }

  async *streamChat(
    settings: AppSettings,
    messages: Message[],
    signal?: AbortSignal
  ): AsyncGenerator<StreamResponse> {
    // Real token streaming via the SDK for plain text requests.
    // Media commands and vision inputs ride the blocking pipeline.
    const lastMsg = messages[messages.length - 1];
    const prompt = (lastMsg?.content || '').trim().toLowerCase();
    const isMediaCommand = prompt.startsWith('/image ') || prompt.startsWith('/video ') || prompt.startsWith('/audio ');
    const hasImages = messages.some(m => m.images && m.images.length > 0);
    if (isMediaCommand || hasImages) {
      yield await this.generateChat(settings, messages, signal);
      return;
    }

    const key = settings.geminiApiKey || this.getPersistedApiKey() || process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    if (!key) {
      throw new Error('Gemini API key not configured');
    }

    const ai = new GoogleGenAI({ apiKey: key });

    let systemPrompt = getEffectiveSystemInstruction(settings, messages);
    if (estimateTokens(systemPrompt) > 30000) {
      systemPrompt = truncateSystemInstruction(systemPrompt, 90000);
    }

    const normalizeModel = (m: string) => {
      const raw = (m || '').toLowerCase();
      if (raw.includes('gemini-3') || raw.includes('gemini-1.5')) {
        return raw.includes('pro') ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
      }
      if (raw.startsWith('gemini-')) return raw;
      return 'gemini-2.5-flash';
    };
    const modelToUse = normalizeModel(settings.model);

    const contents: any[] = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    // Serve cached answers instantly when available (mirrors generateChat)
    if (promptCacheService.enabled) {
      const conversationContext = messages
        .slice(0, -1)
        .map(m => `${m.role}:${m.content}`)
        .join('|');
      const cached = promptCacheService.lookup(
        settings.model, lastMsg.content, systemPrompt,
        settings.temperature, settings.maxTokens ?? 4000,
        conversationContext
      );
      if (cached) {
        yield { text: cached.response, images: cached.images || [], sources: [] };
        return;
      }
    }

    // ── Arm native function declarations ────────────────────────────────────
    // Without these the model can only *narrate* a tool call in prose, so the
    // runtime has nothing to execute and the user never sees a result.
    const { getDynamicTools, executeToolCall } = await import('./tools');
    const { validateAndFixToolArgs } = await import('../utils/toolHelpers');
    const { pruneToolResult } = await import('../utils/tokenManager');

    let geminiTools: any[] = [];
    try {
      const dynamicTools = await getDynamicTools(settings);
      geminiTools = dynamicTools.length > 0 ? [{
        functionDeclarations: dynamicTools.map((t: any) => ({
          name: t.function.name,
          description: t.function.description || `Tool: ${t.function.name}`,
          parameters: t.function.parameters || { type: 'object', properties: {} }
        }))
      }] : [];
    } catch (toolErr: any) {
      console.warn('[Gemini] Failed to build tool declarations for stream:', toolErr?.message);
      geminiTools = [];
    }

    const toolInvocations: ToolInvocation[] = [];
    let toolSources: { title: string; url: string }[] = [];
    const MAX_TOOL_TURNS = 6;

    const buildConfig = (withTools: boolean) => ({
      systemInstruction: systemPrompt,
      temperature: settings.temperature,
      topP: settings.topP ?? 1.0,
      maxOutputTokens: settings.maxTokens ?? 4000,
      thinkingConfig: this.buildThinkingConfig(settings, modelToUse),
      ...(withTools && geminiTools.length > 0 ? { tools: geminiTools } : {}),
    });

    try {
      // Cumulative assistant text across tool turns so the UI keeps every
      // streamed token while tool results are folded back into the context.
      let cumulative = '';

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        if (signal?.aborted) {
          throw new DOMException('Generation cancelled by user.', 'AbortError');
        }

        let stream: any;
        try {
          stream = await ai.models.generateContentStream({
            model: modelToUse,
            contents,
            config: buildConfig(true),
          });
        } catch (startErr: any) {
          if (startErr?.name === 'AbortError' || signal?.aborted) throw startErr;
          // Providers reject malformed/oversized declarations — retry without them
          // rather than failing the whole request.
          if (geminiTools.length > 0) {
            console.warn('[Gemini] Stream rejected tool declarations, retrying without tools:', startErr?.message);
            geminiTools = [];
            stream = await ai.models.generateContentStream({
              model: modelToUse,
              contents,
              config: buildConfig(false),
            });
          } else {
            throw startErr;
          }
        }

        const modelParts: any[] = [];
        const turnToolCalls: Array<{ name: string; args: any }> = [];

        for await (const chunk of stream) {
          if (signal?.aborted) {
            throw new DOMException('Generation cancelled by user.', 'AbortError');
          }
          // Keep every raw part: function-call parts carry thought signatures
          // that must be echoed back verbatim on the next turn.
          const parts = chunk?.candidates?.[0]?.content?.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              modelParts.push(part);
              if (part?.functionCall?.name) {
                turnToolCalls.push({ name: part.functionCall.name, args: part.functionCall.args });
              }
            }
          }
          const delta = (chunk as any)?.text;
          if (delta) {
            cumulative += delta;
            yield { text: cumulative, images: [], sources: toolSources };
          }
        }

        if (turnToolCalls.length === 0) {
          break;
        }

        // ── Execute the function calls the model requested ──────────────────
        const functionResponseParts: Part[] = [];

        for (const tc of turnToolCalls) {
          if (signal?.aborted) {
            throw new DOMException('Generation cancelled by user.', 'AbortError');
          }
          const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const argsString = typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args ?? {});

          let toolResultRaw: string;
          try {
            toolResultRaw = await executeToolCall({
              id: callId,
              type: 'function',
              function: { name: tc.name, arguments: validateAndFixToolArgs(argsString, tc.name) }
            });
          } catch (execErr: any) {
            toolResultRaw = JSON.stringify({ success: false, error: execErr?.message || 'Tool execution failed' });
          }

          const toolResultData = pruneToolResult(toolResultRaw, 32000);

          let parsedResponse: any;
          try {
            parsedResponse = JSON.parse(toolResultData);
            if (Array.isArray(parsedResponse)) {
              parsedResponse = { results: parsedResponse };
            }
          } catch {
            parsedResponse = { content: toolResultData };
          }

          if (parsedResponse?.sources && Array.isArray(parsedResponse.sources)) {
            toolSources = [...toolSources, ...parsedResponse.sources];
          }

          functionResponseParts.push({
            functionResponse: { name: tc.name, response: parsedResponse }
          });

          toolInvocations.push({
            state: 'result',
            toolCallId: callId,
            toolName: tc.name,
            args: tc.args ?? {},
            result: parsedResponse,
            completedAt: Date.now()
          });
        }

        // Keep any pre-tool narration visually separated from the answer.
        if (cumulative && !cumulative.endsWith('\n')) {
          cumulative += '\n\n';
        }

        // Feed the model turn + results back so the next streamed turn can
        // answer using the real data.
        contents.push({ role: 'model', parts: modelParts });
        contents.push({ role: 'user', parts: functionResponseParts });
      }

      if (!cumulative.trim() && toolInvocations.length === 0) {
        // Empty stream — fall back to the blocking path before failing upstream.
        yield await this.generateChat(settings, messages, signal);
        return;
      }

      // Final chunk carries the accumulated tool activity so the UI can render
      // result cards even though streaming text was already forwarded.
      yield {
        text: cumulative,
        images: [],
        sources: toolSources,
        toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined
      };
    } catch (err: any) {
      if (err.name === 'AbortError' || signal?.aborted) throw err;
      console.warn('[Gemini] stream failed, falling back to blocking path:', err?.message);
      yield await this.generateChat(settings, messages, signal);
    }
  }

  async verifyApiKey(key: string): Promise<boolean> {
    if (!key) return false;
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        config: { maxOutputTokens: 1 }
      });
      return true;
    } catch {
      return false;
    }
  }

  private async generateMediaViaPollinations(
    type: 'image' | 'video' | 'audio',
    prompt: string,
    settings: AppSettings
  ): Promise<StreamResponse> {
    const { pollinationsService } = await import('./pollinations');
    if (settings.pollinationsApiKey) {
      pollinationsService.setApiKey(settings.pollinationsApiKey);
    }
    const messages: Message[] = [{
      role: 'user',
      content: `/${type} ${prompt}`,
      timestamp: Date.now(),
      images: []
    }];
    return pollinationsService.generateChat(settings, messages);
  }
}

export const geminiService = new GeminiService();
