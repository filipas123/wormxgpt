import { AppSettings } from '../types';
import { ATTACHED_TOOLS } from '../services/tools';
import { resilientJsonParse } from './resilientJson';

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, any>;
  required?: string[];
}

export const TOOL_ALIAS_MAP: Record<string, string[]> = {
  google_search: ['GoogleAISearch', 'SearchWeb', 'BraveSearch'],
  web_scraper: ['WebCrawler', 'SGAISmartScraper', 'FetchWebpage'],
  scrape_web: ['WebCrawler', 'SGAISmartScraper'],
  parallel_search: ['ParallelSearch', 'SearchWeb'],
  search_docs: ['mintlify-index:search_docs', 'search_docs', 'SearchWeb'],
  lookup_cve: ['chainguard-academy:lookup_cve', 'lookup_cve', 'SearchWeb'],
  read_wiki_structure: ['deepwiki:read_wiki_structure', 'WikipediaSummary'],
  cve: ['chainguard-academy:lookup_cve', 'lookup_cve', 'SearchWeb'],
  pxpipe: ['pxpipe'],
  pipex: ['pipex', 'pxpipe'],
  calc: ['Calculator'],
  calculator: ['Calculator'],
  weather: ['GetWeather'],
  crypto: ['CryptoPrices'],
  cryptoprices: ['CryptoPrices'],
  time: ['GetCurrentDateTime'],
  datetime: ['GetCurrentDateTime'],
  get_windows_and_tabs: ['get_windows_and_tabs']
};

/**
 * Standard essential tools always armed as baseline capability
 */
export const CORE_DEFAULT_TOOL_NAMES = [
  'SearchWeb',
  'WebCrawler',
  'GetCurrentDateTime',
  'Calculator',
  'CryptoPrices',
  'GetWeather',
  'pxpipe',
  'pipex'
];

/**
 * Normalizes tool identifier by removing hyphens, underscores, and case
 */
export function normalizeToolKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

/**
 * Resolves a tool name or alias to an attached tool definition
 */
export function resolveToolDescriptor(name: string): ToolDescriptor | null {
  if (!name) return null;
  const cleanName = name.includes(':') ? name.split(':')[1] : name;

  // 1. Direct key match in ATTACHED_TOOLS
  if (ATTACHED_TOOLS[cleanName]) {
    const t = ATTACHED_TOOLS[cleanName];
    return {
      name: t.function.name,
      description: t.function.description || `Execute ${t.function.name}`,
      parameters: t.function.parameters?.properties || {},
      required: t.function.parameters?.required || []
    };
  }

  // 2. Direct key in ATTACHED_TOOLS with original name
  if (ATTACHED_TOOLS[name]) {
    const t = ATTACHED_TOOLS[name];
    return {
      name: t.function.name,
      description: t.function.description || `Execute ${t.function.name}`,
      parameters: t.function.parameters?.properties || {},
      required: t.function.parameters?.required || []
    };
  }

  // 3. Normalized match across ATTACHED_TOOLS keys
  const targetNorm = normalizeToolKey(cleanName);
  for (const key of Object.keys(ATTACHED_TOOLS)) {
    if (normalizeToolKey(key) === targetNorm) {
      const t = ATTACHED_TOOLS[key];
      return {
        name: t.function.name,
        description: t.function.description || `Execute ${t.function.name}`,
        parameters: t.function.parameters?.properties || {},
        required: t.function.parameters?.required || []
      };
    }
  }

  // 4. Alias lookup
  const aliases = TOOL_ALIAS_MAP[cleanName.toLowerCase()] || TOOL_ALIAS_MAP[targetNorm];
  if (aliases && aliases.length > 0) {
    for (const alias of aliases) {
      const found = resolveToolDescriptor(alias);
      if (found) return found;
    }
  }

  // 5. Chrome MCP tools
  const CHROME_TOOLS: Record<string, { desc: string; params: any; req?: string[] }> = {
    chrome_navigate: { desc: 'Navigate active browser tab to a URL', params: { url: { type: 'string', description: 'Full URL to navigate to' } }, req: ['url'] },
    chrome_screenshot: { desc: 'Take a screenshot of the current browser tab', params: { selector: { type: 'string', description: 'Optional CSS selector' } } },
    chrome_extract_text: { desc: 'Extract clean visible text from active tab', params: {} },
    chrome_extract_links: { desc: 'Extract all links from active tab', params: {} },
    chrome_click: { desc: 'Click an element via CSS selector', params: { selector: { type: 'string', description: 'CSS selector' } }, req: ['selector'] },
    chrome_fill: { desc: 'Fill input field with value', params: { selector: { type: 'string' }, value: { type: 'string' } }, req: ['selector', 'value'] },
    chrome_execute_js: { desc: 'Execute JavaScript in tab context', params: { script: { type: 'string' } }, req: ['script'] },
    get_windows_and_tabs: { desc: 'Inspect open Chrome browser tabs and windows', params: {} }
  };

  if (CHROME_TOOLS[cleanName]) {
    const meta = CHROME_TOOLS[cleanName];
    return {
      name: cleanName,
      description: meta.desc,
      parameters: meta.params,
      required: meta.req || []
    };
  }

  // 6. Generic MCP tool descriptor
  if (name.includes(':') || name.startsWith('mcp_') || name.startsWith('tool_')) {
    return {
      name: cleanName,
      description: `External MCP tool for ${cleanName.replace(/_/g, ' ')}`,
      parameters: {
        query: { type: 'string', description: 'Input argument or search query' }
      },
      required: ['query']
    };
  }

  return null;
}

/**
 * Returns the tools the operator actually enabled — nothing else. The model must
 * only ever see tools it is allowed to call, so the catalog is exactly the
 * resolved `settings.enabledTools` set. This mirrors services/tools.ts
 * `getDynamicTools`, which declares the same set natively; keeping both in step
 * means the prompt and the request payload never disagree.
 *
 * When nothing is enabled at all, a small core baseline is used so the model is
 * never handed an empty catalog while core tools are still declared.
 */
export function getArmedToolsCatalog(settings: AppSettings): ToolDescriptor[] {
  const enabledNames = settings.enabledTools || [];
  const catalog: ToolDescriptor[] = [];
  const seenNames = new Set<string>();

  for (const name of enabledNames) {
    const desc = resolveToolDescriptor(name);
    if (desc && !seenNames.has(desc.name)) {
      seenNames.add(desc.name);
      catalog.push(desc);
    }
  }

  if (catalog.length > 0) return catalog;

  // Nothing armed: fall back to the core baseline (same resolution as
  // getDynamicTools) so the two lists stay identical.
  for (const defaultName of CORE_DEFAULT_TOOL_NAMES) {
    if (!seenNames.has(defaultName)) {
      const desc = resolveToolDescriptor(defaultName);
      if (desc && !seenNames.has(desc.name)) {
        seenNames.add(desc.name);
        catalog.push(desc);
      }
    }
  }

  return catalog;
}

/**
 * True when the operator has armed at least one callable tool.
 */
export function hasArmedTools(settings: AppSettings): boolean {
  return getArmedToolsCatalog(settings).length > 0;
}

/** Extension tools injected natively by services/tools.ts when MCP is enabled. */
const EXTENSION_TOOL_NAMES = new Set([
  'chrome_navigate', 'chrome_screenshot', 'chrome_extract_text', 'chrome_extract_links',
  'chrome_click', 'chrome_fill', 'chrome_execute_js', 'get_windows_and_tabs'
]);

/**
 * Whether a tool may actually be EXECUTED for these settings. The catalog the
 * model sees already hides unarmed tools; this is the enforcement side, so a
 * hallucinated or stale tool name can never run. MCP / browser-extension tools
 * that getDynamicTools attaches natively stay callable while MCP is enabled.
 */
export function isToolArmed(settings: AppSettings, name: string): boolean {
  if (!name || typeof name !== 'string') return false;

  const cleanName = name.includes(':') ? name.split(':')[1] : name;
  const target = normalizeToolKey(cleanName);
  if (getArmedToolsCatalog(settings).some(t => normalizeToolKey(t.name) === target || normalizeToolKey(t.name) === normalizeToolKey(name))) {
    return true;
  }

  if (settings.mcpEnabled) {
    if (EXTENSION_TOOL_NAMES.has(cleanName) || EXTENSION_TOOL_NAMES.has(name)) return true;
    if (name.includes(':') || name.startsWith('mcp_')) return true;
  }

  return false;
}

/**
 * Chain-of-thought scaffold that teaches the model how to reason about tool use
 * before it acts. Emitted for Gemini, whose native thinking config lets it work
 * through this plan internally before committing to a function call.
 */
export function getToolReasoningPrompt(settings: AppSettings): string {
  if (getArmedToolsCatalog(settings).length === 0) return '';

  const provider = String(settings.aiProvider || '').toLowerCase();
  const model = String(settings.model || '').toLowerCase();
  const isGemini = provider === 'gemini' || provider.startsWith('google') || model.startsWith('gemini');
  if (!isGemini) return '';

  return `### 🧠 CHAIN-OF-THOUGHT PROTOCOL — PLAN TOOL USE BEFORE YOU ACT
Work through these steps in order, internally, before writing your final answer. Use your thinking budget for steps 1-5; only step 6 is spoken.

1. **UNDERSTAND** — Restate the user's actual goal in one line. Identify exactly what would count as a correct answer.
2. **ASSESS NEED** — Decide whether the answer depends on real-time, private, or exact data you cannot reliably recall (today's date, live prices, current docs, a specific URL, a computation). If it does, a tool is REQUIRED. If it is stable general knowledge, answer directly and call nothing.
3. **SELECT** — From the ARMED TOOLS CATALOG above, pick the smallest set of tools that fully covers the need. Prefer one precise tool over several vague ones. Never reference a tool that is not in that catalog.
4. **PLAN ARGUMENTS** — Derive every argument from the user's own request. Never invent identifiers, URLs, filenames, or dates. If a required argument is missing and cannot be inferred, ask the user instead of calling.
5. **EXECUTE** — Emit the structured tool call block(s). Batch independent calls into a single turn.
6. **VERIFY & ANSWER** — When the tool output returns, check that it genuinely answers step 1. If it is empty, malformed, or only partially relevant, refine the arguments and call again — up to 3 attempts total. If a tool keeps failing, say so plainly and answer with what you have. Never present a guess as retrieved data, and never invent a tool result.

Do not print this plan as a numbered list unless the user asks for it — use it to drive your actions.`;
}

/**
 * Generates an authoritative, highly structured system instruction block
 * informing the model of its armed tools, their schemas, and invocation format.
 */
export function getToolAwarenessSystemPrompt(settings: AppSettings): string {
  const tools = getArmedToolsCatalog(settings);
  if (tools.length === 0) return '';

  const toolEntries = tools.map(t => {
    const paramEntries = Object.entries(t.parameters || {}).map(([paramName, paramMeta]: [string, any]) => {
      const isReq = (t.required || []).includes(paramName) ? ' (required)' : ' (optional)';
      const typeStr = paramMeta?.type ? `[${paramMeta.type}]` : '';
      const descStr = paramMeta?.description ? `: ${paramMeta.description}` : '';
      return `    - \`${paramName}\`${isReq} ${typeStr}${descStr}`;
    }).join('\n');

    const paramsBlock = paramEntries ? `\n  Parameters:\n${paramEntries}` : '\n  Parameters: None (empty object `{}`)';
    return `- **\`${t.name}\`**: ${t.description}${paramsBlock}`;
  }).join('\n\n');

  return `
### ⚡ LIVE ACTIVE TOOLS (ENABLED & ARMED FOR YOUR IMMEDIATE USE)
You have operational access to live external tools. These tools are NOT simulated — they execute in real time in the user's active environment.
Whenever the user request involves real-time facts, current dates/times, searching the web, crawling URLs, checking cryptocurrency prices, token/context compression with pxpipe / pipex, mathematical evaluations, or executing code:
YOU MUST INVOKE THE APPROPRIATE TOOL RATHER THAN GUESSING OR CLAIMING YOU CANNOT ACCESS REAL-TIME DATA.

#### HOW TO CALL TOOLS:
Output your tool invocation using the standard structured XML tool call block:
<tool_call>
{"name": "ToolName", "args": {"parameter_name": "parameter_value"}}
</tool_call>

Or markdown tool call block:
\`\`\`tool_call
{"name": "ToolName", "args": {"parameter_name": "parameter_value"}}
\`\`\`

The runtime intercepts your tool call, executes the tool, and provides you with the real-time verified findings in the next turn so you can formulate your complete, fact-checked response.

CRITICAL: Never describe a tool call in prose (for example, do not write "Tool Call: GetCurrentDateTime" or "I will now call GetCurrentDateTime"). Only the structured block above actually executes a tool. Never invent, guess, or fabricate a tool result — wait for the runtime to return the real output.

#### ARMED TOOLS CATALOG:
${toolEntries}

#### TOOL VISIBILITY RULES (HARD CONSTRAINTS)
- The catalog above is the COMPLETE set of tools you may call. Any tool not listed there is unavailable — never name it, never claim you used it, and never pretend its output exists.
- The runtime may additionally attach extension tools natively in the request payload (MCP servers / browser extensions). If the API hands you those schemas, treat them as armed and call them with their declared fields; otherwise ignore them.
- Call a tool only when the user's request actually needs the data it returns. For stable general knowledge, answer directly without calling anything.
- Never invent, guess, or simulate a tool result. If a tool call fails or returns nothing usable, retry with corrected arguments (max 3 attempts), then say so plainly.
- After a tool returns data, answer the user's question from THAT data — do not repeat the call or describe the call mechanics.
`.trim();
}

/**
 * Parsed tool call model
 */
export interface ParsedToolCall {
  name: string;
  args: Record<string, any>;
  raw: string;
}

/**
 * Matches chat-tuned models narrating a tool call in prose instead of emitting
 * the documented structured block, e.g.
 *   "**Tool Call:** GetCurrentDateTime"
 *   "Tool Call: `SearchWeb`(query)"
 *   "Calling tool: WebCrawler"
 * Captures the tool name in group 1 and an optional inline argument list in
 * group 2. Shared by the parser and the stripper so both agree on the span.
 */
function narrativeToolCallRegex(): RegExp {
  return /(?:^|\n)[^\n]{0,80}?(?:\*\*)?(?:tool\s*call|tool_call|calling\s+(?:the\s+)?tool|invoking\s+(?:the\s+)?tool|invoke\s+tool)(?:\*\*)?\s*[:\uFF1A]?\s*(?:\*\*)?\s*`?([A-Za-z][A-Za-z0-9_.:-]{2,60})`?\s*(?:\(([^\n()]*)\))?/gi;
}

/**
 * Parses tool calls embedded in model output text (supports XML, Markdown, function calls, and JSON blocks)
 */
export function parseToolCallsFromText(text: string): ParsedToolCall[] {
  if (!text || typeof text !== 'string') return [];
  const calls: ParsedToolCall[] = [];
  const seenRaw = new Set<string>();

  const safeParseArgs = (rawArgs: any): Record<string, any> => {
    if (!rawArgs) return {};
    if (typeof rawArgs === 'object' && !Array.isArray(rawArgs)) return rawArgs;
    const { data } = resilientJsonParse(rawArgs, {});
    return data;
  };

  // 1. <tool_call> ... </tool_call>
  const xmlRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = xmlRegex.exec(text)) !== null) {
    const raw = match[0];
    if (seenRaw.has(raw)) continue;
    seenRaw.add(raw);
    const inner = match[1].trim();
    const { data } = resilientJsonParse<any>(inner, {});
    const name = data.name || data.tool || data.function?.name;
    if (name) {
      calls.push({
        name,
        args: safeParseArgs(data.args || data.arguments || data.parameters || data.function?.arguments),
        raw
      });
    } else {
      const nameMatch = inner.match(/"name"\s*:\s*"([^"]+)"/i) || inner.match(/"tool"\s*:\s*"([^"]+)"/i);
      if (nameMatch) {
        calls.push({
          name: nameMatch[1],
          args: safeParseArgs(inner),
          raw
        });
      }
    }
  }

  // 2. ```tool_call ... ``` or ```tool ... ```
  const mdRegex = /```(?:tool_call|tool)\s*([\s\S]*?)```/gi;
  while ((match = mdRegex.exec(text)) !== null) {
    const raw = match[0];
    if (seenRaw.has(raw)) continue;
    seenRaw.add(raw);
    const inner = match[1].trim();
    const { data } = resilientJsonParse<any>(inner, {});
    const name = data.name || data.tool;
    if (name) {
      calls.push({
        name,
        args: safeParseArgs(data.args || data.arguments || data.parameters),
        raw
      });
    }
  }

  // 3. [TOOL_CALL: name(args)]
  const funcRegex = /\[TOOL_CALL:\s*([a-zA-Z0-9_-]+)\(([\s\S]*?)\)\]/gi;
  while ((match = funcRegex.exec(text)) !== null) {
    const raw = match[0];
    if (seenRaw.has(raw)) continue;
    seenRaw.add(raw);
    const name = match[1];
    const rawArgs = match[2].trim();
    calls.push({
      name,
      args: safeParseArgs(rawArgs),
      raw
    });
  }

  // 4. call:name{...}
  const callPrefixRegex = /(?:^|\n)call:([a-zA-Z0-9_-]+)\s*(\{[\s\S]*?\})(?=\n|$)/gi;
  while ((match = callPrefixRegex.exec(text)) !== null) {
    const raw = match[0].trim();
    if (seenRaw.has(raw)) continue;
    seenRaw.add(raw);
    const name = match[1];
    const rawArgs = match[2].trim();
    calls.push({
      name,
      args: safeParseArgs(rawArgs),
      raw
    });
  }

  // 5. Narrative prose mentions such as "Tool Call: GetCurrentDateTime". These
  //    are not a real protocol, but chat-tuned models emit them constantly.
  //    Only treat a mention as a call when the name resolves to a tool we can
  //    actually execute, so ordinary prose never triggers a bogus invocation.
  const narrativeRegex = narrativeToolCallRegex();
  while ((match = narrativeRegex.exec(text)) !== null) {
    const raw = match[0].trim();
    if (seenRaw.has(raw)) continue;
    const name = match[1];
    if (!name || !resolveToolDescriptor(name)) continue;
    seenRaw.add(raw);
    calls.push({
      name,
      args: safeParseArgs(match[2]),
      raw
    });
  }

  return calls;
}

/**
 * Removes the inline tool status lines that provider tool loops append to their
 * answer text ("[✔] **Data Retrieved:** `X`"). Only call this when a real tool
 * invocation card will display the output, otherwise the status line is the
 * user's only confirmation that a tool ran.
 */
export function stripToolStatusMarkers(text: string): string {
  if (!text) return '';
  return text
    // Provider tool loops append their own status lines to the answer text (see
    // utils/toolHelpers.ts). They are internal bookkeeping rather than content,
    // so they are only removed when a real tool card will display the output.
    .replace(/^\[[⚡✔❌]\]\s*\*\*(?:Executing|Data Retrieved|Error):\*\*[^\n]*$/gmu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Strips raw tool call syntax from model output text for clean presentation
 */
export function stripToolCallsFromText(text: string): string {
  if (!text) return '';
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/```(?:tool_call|tool)\s*[\s\S]*?```/gi, '')
    .replace(/\[TOOL_CALL:\s*[a-zA-Z0-9_-]+\([\s\S]*?\)\]/gi, '')
    .replace(/(?:^|\n)call:[a-zA-Z0-9_-]+\s*\{[\s\S]*?\}(?=\n|$)/gi, '')
    // Only drop a narrative mention when it names a tool we can actually run,
    // so unrelated prose is never deleted.
    .replace(narrativeToolCallRegex(), (match, name) => (name && resolveToolDescriptor(name) ? '' : match))
    // Drop lines that held nothing but decoration (emoji) once the fabricated
    // tool-call text was removed, without touching markdown rules or lists.
    .replace(/^[ \t]*(?:[\p{Extended_Pictographic}\u200d\ufe0f\u{1F3FB}-\u{1F3FF}][ \t]*)+$/gmu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
