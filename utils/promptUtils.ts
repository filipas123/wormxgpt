import { AppSettings, Message } from '../types';
import { DEFAULT_SYSTEM_INSTRUCTION } from '../constants';
import { getToolAwarenessSystemPrompt, getToolReasoningPrompt } from './toolAwareness';

/**
 * Returns the effective system instruction to inject into the LLM request.
 * The user has FULL CONTROL — whatever they set in Settings is what the AI gets.
 * No backend overrides, no forced persona, no restrictions added.
 *
 * The armed-tool catalog is always appended LAST and is never subject to the
 * character budget: if it were truncated, the model would lose the ability to
 * call tools entirely. Only the user's own instruction is capped.
 *
 * @param settings The current application settings
 * @param messages The session message history (used for 'once' injection mode)
 * @param maxInstructionChars Optional budget for the user instruction only
 * @returns The system instruction string (may be empty if user disabled it)
 */
export function getEffectiveSystemInstruction(
  settings: AppSettings,
  messages: Message[],
  maxInstructionChars?: number
): string {
  // Generate active tools instruction for model awareness
  let toolPrompt = '';
  try {
    toolPrompt = getToolAwarenessSystemPrompt(settings);
  } catch (err) {
    console.warn('[promptUtils] Failed to generate tool awareness prompt:', err);
  }

  let fullInstruction = '';

  if (settings.systemOverride) {
    // Unrestricted System Override: pass the raw user instruction through,
    // bypassing default conversational guardrails and hardcoded personas.
    fullInstruction = settings.systemInstruction || '';
  } else if (!settings.promptInjectionEnabled) {
    fullInstruction = settings.systemInstruction?.trim() || '';
  } else if (settings.liveModePrompt) {
    fullInstruction = settings.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
  } else {
    fullInstruction = settings.systemInstruction?.trim() || DEFAULT_SYSTEM_INSTRUCTION;

    // Prepend custom prefix if configured
    if (settings.customPromptPrefix?.trim()) {
      const prefix = settings.customPromptPrefix.trim();
      const mode = settings.promptInjectionMode || 'always';

      if (mode === 'once') {
        const userMessageCount = messages.filter(m => m.role === 'user').length;
        if (userMessageCount <= 1) {
          fullInstruction = `${prefix}\n\n${fullInstruction}`;
        }
      } else {
        fullInstruction = `${prefix}\n\n${fullInstruction}`;
      }
    }

    // Dynamically inject workspace context if the user asks about the project / files
    const lastUserMsg = messages[messages.length - 1]?.content || '';
    const promptLower = typeof lastUserMsg === 'string' ? lastUserMsg.toLowerCase() : '';
    const keywords = ['project', 'files', 'workspace', 'directory', 'folder', 'codebase', 'repository', 'structure', 'npm', 'git', 'refactor', 'find'];
    const mentionsWorkspace = keywords.some(k => promptLower.includes(k));

    if (mentionsWorkspace) {
      try {
        const { injectWorkspacePrompt } = require('./workspaceContext');
        fullInstruction = injectWorkspacePrompt(fullInstruction);
      } catch {}
    }
  }

  // Budget the user instruction only — never the tool catalog.
  if (maxInstructionChars && fullInstruction.length > maxInstructionChars) {
    fullInstruction =
      fullInstruction.slice(0, maxInstructionChars) + '\n[System instruction truncated for token limit]';
  }

  // Append the live-tools awareness so every model across every provider knows
  // which tools are armed and exactly how to invoke them.
  const sections: string[] = [];
  if (fullInstruction.trim()) sections.push(fullInstruction);
  if (toolPrompt) sections.push(toolPrompt);

  // Gemini gets an explicit chain-of-thought plan for tool selection.
  try {
    const reasoningPrompt = getToolReasoningPrompt(settings);
    if (reasoningPrompt) sections.push(reasoningPrompt);
  } catch (err) {
    console.warn('[promptUtils] Failed to generate tool reasoning prompt:', err);
  }

  return sections.join('\n\n').trim();
}

/**
 * Markers that begin the runtime-owned sections appended by
 * getEffectiveSystemInstruction. They must survive any character budget, because
 * a truncated tool catalog is the same as having no tools at all.
 */
const PROTECTED_SECTION_MARKERS = [
  '### ⚡ LIVE ACTIVE TOOLS',
  '### 🧠 CHAIN-OF-THOUGHT PROTOCOL'
];

/**
 * Truncates a system instruction to a character budget WITHOUT cutting off the
 * armed-tool catalog or the chain-of-thought scaffold. Providers that used to
 * call `instruction.substring(0, N)` silently deleted the catalog (it is
 * appended last), which left the model unable to call any tool.
 *
 * Only the operator's own instruction is shortened; the tool sections are kept
 * whole even when they exceed the budget on their own.
 */
export function truncateSystemInstruction(instruction: string, maxChars: number): string {
  if (!instruction) return '';
  if (maxChars <= 0 || instruction.length <= maxChars) return instruction;

  let protectedFrom = instruction.length;
  for (const marker of PROTECTED_SECTION_MARKERS) {
    const idx = instruction.indexOf(marker);
    if (idx !== -1 && idx < protectedFrom) protectedFrom = idx;
  }

  const protectedTail = instruction.slice(protectedFrom);
  const head = instruction.slice(0, protectedFrom);
  const headBudget = Math.max(maxChars - protectedTail.length, 0);
  const shortenedHead = headBudget < head.length
    ? head.slice(0, headBudget) + '\n[System instruction truncated for token limit]\n'
    : head;

  return `${shortenedHead}${protectedTail}`.trim();
}

/**
 * Substitute variables in a prompt string.
 * Supported variables: {{date}}, {{model}}, {{provider}}, {{user_var_*}}
 */
export function substitutePromptVariables(prompt: string, settings: AppSettings): string {
  let result = prompt;
  result = result.replace(/\{\{date\}\}/g, new Date().toISOString().split('T')[0]);
  result = result.replace(/\{\{model\}\}/g, settings.model || 'unknown');
  result = result.replace(/\{\{provider\}\}/g, settings.aiProvider || 'unknown');
  
  // User-defined variables
  if (settings.promptVariables) {
    for (const [key, value] of Object.entries(settings.promptVariables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
  }
  
  return result;
}

/**
 * @deprecated Use getEffectiveSystemInstruction instead.
 * Kept for backwards compatibility with any code that imports this.
 */
export function getBackendSystemPrompt(settings: AppSettings): string {
  return settings.systemInstruction?.trim() || DEFAULT_SYSTEM_INSTRUCTION;
}
