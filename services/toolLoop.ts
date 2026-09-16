import { AppSettings, Message, ToolInvocation } from '../types';

/**
 * Chunk shape emitted by provider `generateContentStream` implementations that
 * stream raw text but surface function calls as structured events.
 */
export interface ProviderToolCallChunk {
  type: 'tool_call';
  name: string;
  args: any;
  callId: string;
}

export type ProviderTurnChunk = string | ProviderToolCallChunk;

export interface ToolLoopChunk {
  text: string;
  images: string[];
  video?: string;
  audio?: string;
  sources?: { title: string; url: string }[];
  toolInvocations?: ToolInvocation[];
}

/** Best-effort parse of a tool argument payload for display purposes. */
function parseArgsForDisplay(raw: any): any {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function parseResultForDisplay(raw: string): any {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { results: parsed };
    return parsed;
  } catch {
    return { content: raw };
  }
}

/**
 * Runs a full multi-turn tool loop over a provider that only knows how to
 * stream a single turn.
 *
 * Several providers (DeepSeek, Mistral, xAI, Anthropic) parse function calls out
 * of their SSE stream and then hand them to a wrapper that keeps only the string
 * chunks — so the requested tool was silently dropped and the model never
 * received its result. This helper executes the requested tools, feeds the
 * results back as a proper assistant/tool message pair (the shape every
 * provider's history formatter already understands), and re-runs the provider
 * until it answers without asking for more tools.
 */
export async function* streamWithToolLoop(
  settings: AppSettings,
  messages: Message[],
  signal: AbortSignal | undefined,
  runTurn: (messages: Message[]) => AsyncGenerator<ProviderTurnChunk>
): AsyncGenerator<ToolLoopChunk> {
  const { executeToolCall } = await import('./tools');

  const MAX_TURNS = 5;
  const executedSignatures = new Set<string>();
  const toolInvocations: ToolInvocation[] = [];
  const sources: { title: string; url: string }[] = [];
  let accumulatedText = '';
  let working: Message[] = [...messages];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal?.aborted) return;

    const pendingCalls: ProviderToolCallChunk[] = [];
    let turnText = '';

    for await (const chunk of runTurn(working)) {
      if (signal?.aborted) return;
      if (typeof chunk === 'string') {
        turnText += chunk;
        accumulatedText += chunk;
        yield { text: accumulatedText, images: [], sources };
      } else if (chunk && chunk.type === 'tool_call' && chunk.name) {
        pendingCalls.push(chunk);
      }
    }

    // Drop calls that repeat an earlier identical request to avoid loops.
    const calls = pendingCalls.filter(call => {
      const signature = `${call.name}::${JSON.stringify(call.args ?? {})}`;
      if (executedSignatures.has(signature)) return false;
      executedSignatures.add(signature);
      return true;
    });

    if (calls.length === 0) break;

    const callInvocations: ToolInvocation[] = [];
    const resultInvocations: ToolInvocation[] = [];

    for (const call of calls) {
      if (signal?.aborted) return;
      const toolCallId = call.callId || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = Date.now();

      let resultRaw: string;
      try {
        resultRaw = await executeToolCall({
          id: toolCallId,
          type: 'function',
          function: {
            name: call.name,
            arguments: typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? {})
          }
        });
      } catch (err: any) {
        resultRaw = JSON.stringify({ success: false, error: err?.message || 'Tool execution failed' });
      }

      const parsedResult = parseResultForDisplay(resultRaw);
      if (parsedResult?.sources && Array.isArray(parsedResult.sources)) {
        sources.push(...parsedResult.sources);
      }

      const doneAt = Date.now();
      const invocation: ToolInvocation = {
        state: 'result',
        toolCallId,
        toolName: call.name,
        args: parseArgsForDisplay(call.args),
        result: parsedResult,
        startedAt,
        completedAt: doneAt,
        latencyMs: doneAt - startedAt
      };
      toolInvocations.push(invocation);
      resultInvocations.push(invocation);
      callInvocations.push({
        state: 'call',
        toolCallId,
        toolName: call.name,
        args: parseArgsForDisplay(call.args)
      });
    }

    // Keep the narration and the eventual answer visually separated.
    if (accumulatedText && !accumulatedText.endsWith('\n')) {
      accumulatedText += '\n\n';
    }

    // Feed the tool round back so the next turn can answer with real data.
    working = [
      ...working,
      { role: 'assistant', content: turnText, timestamp: Date.now(), toolInvocations: callInvocations },
      { role: 'tool', content: '', timestamp: Date.now(), toolInvocations: resultInvocations }
    ];
  }

  if (toolInvocations.length > 0) {
    yield { text: accumulatedText, images: [], sources, toolInvocations };
  }
}
