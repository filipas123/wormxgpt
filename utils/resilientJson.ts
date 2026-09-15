/**
 * utils/resilientJson.ts
 * Resilient JSON parsing & argument extraction utilities for AI tool calling.
 * Handles malformed model outputs (single quotes, trailing commas, unquoted keys,
 * nested markdown code blocks, control characters, truncated strings).
 */

/**
 * Repairs commonly broken JSON strings outputted by LLMs
 */
export function sanitizeJsonString(raw: string): string {
  if (!raw || typeof raw !== 'string') return '{}';

  let s = raw.trim();

  // Strip markdown code fences e.g. ```json ... ``` or ```tool_call ... ```
  s = s.replace(/^```(?:json|tool_call|tool)?\s*/i, '');
  s = s.replace(/\s*```$/i, '');
  s = s.trim();

  // Extract outermost balanced JSON object or array if surrounded by chatter
  const firstBrace = s.indexOf('{');
  const firstBracket = s.indexOf('[');
  
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    const lastBrace = s.lastIndexOf('}');
    if (lastBrace > firstBrace) {
      s = s.slice(firstBrace, lastBrace + 1);
    }
  } else if (firstBracket !== -1) {
    const lastBracket = s.lastIndexOf(']');
    if (lastBracket > firstBracket) {
      s = s.slice(firstBracket, lastBracket + 1);
    }
  }

  // Remove trailing commas before closing braces/brackets
  s = s.replace(/,\s*([}\]])/g, '$1');

  // Replace single quotes on keys and simple strings, avoiding apostrophes in words
  // e.g. {'name': 'val'} -> {"name": "val"}
  if (s.includes("'")) {
    s = s.replace(/(\s*\{?\s*|\s*,\s*)'([^']+)'\s*:/g, '$1"$2":');
    s = s.replace(/:\s*'([^']*)'/g, ':"$1"');
  }

  // Quote unquoted object keys: { query: "val" } -> { "query": "val" }
  s = s.replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":');

  // Fix escaped single quotes inside strings
  s = s.replace(/\\'/g, "'");

  return s;
}

/**
 * Resilient JSON parser that never throws and returns a typed fallback upon failure
 */
export function resilientJsonParse<T = Record<string, any>>(
  input: any, 
  fallback: T = {} as T
): { data: T; success: boolean; error?: string } {
  if (input === null || input === undefined) {
    return { data: fallback, success: true };
  }

  // Already an object
  if (typeof input === 'object' && !Array.isArray(input)) {
    return { data: input as T, success: true };
  }

  if (typeof input !== 'string') {
    return { data: fallback, success: false, error: 'Input is not a string or object' };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { data: fallback, success: true };
  }

  // Attempt 1: Direct JSON.parse
  try {
    const parsed = JSON.parse(trimmed);
    return { data: parsed as T, success: true };
  } catch (err1) {
    // Continue to repair pipeline
  }

  // Attempt 2: Sanitized string parse
  try {
    const sanitized = sanitizeJsonString(trimmed);
    const parsed = JSON.parse(sanitized);
    return { data: parsed as T, success: true };
  } catch (err2) {
    // Continue to heuristic key-value extraction
  }

  // Attempt 3: Heuristic key-value pairs extractor for tool arguments
  try {
    const extracted: Record<string, any> = {};
    // Match "key": "value" or key: "value" or key: number
    const kvRegex = /(?:["']?([a-zA-Z0-9_-]+)["']?\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|(\d+(?:\.\d+)?)|(true|false|null)))/gi;
    let match: RegExpExecArray | null;
    let foundAny = false;

    while ((match = kvRegex.exec(trimmed)) !== null) {
      const key = match[1];
      const strVal = match[2] !== undefined ? match[2] : match[3];
      const numVal = match[4];
      const boolVal = match[5];

      if (strVal !== undefined) {
        extracted[key] = strVal;
        foundAny = true;
      } else if (numVal !== undefined) {
        extracted[key] = Number(numVal);
        foundAny = true;
      } else if (boolVal !== undefined) {
        extracted[key] = boolVal === 'true' ? true : boolVal === 'false' ? false : null;
        foundAny = true;
      }
    }

    if (foundAny) {
      return { data: extracted as T, success: true };
    }
  } catch (err3) {
    // Fall through to query fallback
  }

  // Attempt 4: If single plain string argument, wrap in query/input
  if (trimmed.length > 0 && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { 
      data: { query: trimmed, input: trimmed } as unknown as T, 
      success: true 
    };
  }

  return {
    data: fallback,
    success: false,
    error: 'Failed to parse JSON after multiple repair strategies'
  };
}
