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
 * Returns all active armed tool descriptors for given settings
 */
export function getArmedToolsCatalog(settings: AppSettings): ToolDescriptor[] {
  const enabledNames = settings.enabledTools || [];
  const catalog: ToolDescriptor[] = [];
  const seenNames = new Set<string>();

  // Resolve explicitly enabled tools
  for (const name of enabledNames) {
    const desc = resolveToolDescriptor(name);
    if (desc && !seenNames.has(desc.name)) {
      seenNames.add(desc.name);
      catalog.push(desc);
    }
  }

  // If no tools or fewer than 2 tools are armed, inject core defaults
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

#### ARMED TOOLS CATALOG:
${toolEntries}
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

  return calls;
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
    .trim();
}
