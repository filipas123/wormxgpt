/**
 * errorClassifier.ts
 * ════════════════════════════════════════════════════════════════════════════════
 * Distinguishes real model answers from provider failure prose.
 *
 * Several gateways (Pollinations in particular) do not fail the HTTP request when
 * an account is out of budget or rate-limited: they return 200 with the failure
 * explanation as the *assistant message*. Downstream that prose looks like a
 * perfectly good answer, so the router records a success, the fallback chain
 * never engages, and the user sees an unstyled paragraph like the "raise the key
 * budget" notice. classifyErrorText() catches these, and isFatalForFallback()
 * tells the router which ones justify trying the next provider.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type { Message } from '../types';

/** Error categories surfaced by the UI ErrorPanel. */
export type ClassifiedErrorType =
  | 'api_key'
  | 'budget_exhausted'
  | 'rate_limit'
  | 'context_overflow'
  | 'model_unavailable'
  | 'network'
  | 'unknown';

interface ErrorRule {
  type: ClassifiedErrorType;
  patterns: RegExp[];
}

/**
 * Ordered rules: the first match wins, so the most specific categories come
 * first. "budget"/"quota" style failures are checked before generic rate limits
 * because their remediation (top up / raise key budget) differs from "wait".
 */
const ERROR_RULES: ErrorRule[] = [
  {
    type: 'budget_exhausted',
    patterns: [
      /reached its (?:budget|limit)/i,
      /raise the (?:key )?budget/i,
      /out of (?:budget|credits?|funds)/i,
      /(?:budget|quota|credits?)\s+(?:has been\s+)?(?:exhausted|exceeded|depleted)/i,
      /insufficient (?:quota|credits?|funds|balance)/i,
      /topping up the wallet/i,
      /exceeded your current quota/i,
      /billing (?:limit|hard limit)/i,
      /payment required/i,
    ],
  },
  {
    type: 'rate_limit',
    patterns: [
      // Bare status codes only count with an HTTP/status prefix or an explicit
      // reason attached — a sentence that merely mentions "429" is content.
      /\b(?:http|status(?:\s+code)?|error)\s*[:\-]?\s*429\b/i,
      /\b429\b\s*(?:too many requests|rate limit)/i,
      /rate[- ]?limit(?:ed| exceeded)?/i,
      /too many requests/i,
      /temporarily rate limited/i,
      /quota.{0,40}retry (?:in|after)/i,
      /please (?:slow down|try again (?:in|later))/i,
    ],
  },
  {
    type: 'api_key',
    patterns: [
      /\b(?:http|status(?:\s+code)?|error)\s*[:\-]?\s*40[13]\b/i,
      /api key.{0,60}(?:invalid|missing|not configured|expired|denied)/i,
      /invalid api key/i,
      /unauthorized/i,
      /authentication (?:failed|error|required)/i,
      /incorrect api key/i,
      /key not configured/i,
      /permission denied/i,
      /forbidden/i,
    ],
  },
  {
    type: 'context_overflow',
    patterns: [
      /context length(?:\s+exceeded)?/i,
      /maximum context/i,
      /too many tokens/i,
      /token limit/i,
      /reduce the (?:length|size) of (?:the )?(?:your )?(?:messages|prompt|context)/i,
      /input (?:is )?too long/i,
    ],
  },
  {
    type: 'model_unavailable',
    patterns: [
      /model [`"']?[\w./-]+[`"']? (?:does not exist|is not (?:found|available|supported)|not found)/i,
      /no (?:such|known) model/i,
      /model (?:is )?overloaded/i,
      /currently (?:unavailable|overloaded|at capacity)/i,
      /no available (?:channels|endpoints|providers)/i,
      /compute (?:is )?(?:unavailable|at capacity)/i,
    ],
  },
  {
    type: 'network',
    patterns: [
      /failed to fetch/i,
      /network (?:error|timeout|request failed)/i,
      /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/,
      /connection (?:refused|timed out|reset|error)/i,
      /socket hang up/i,
      /(?:\b(?:http|status(?:\s+code)?)\s*[:\-]?\s*50[234]\b)|\b50[234]\s+(?:bad gateway|service unavailable|gateway timeout)\b/i,
      /dns (?:resolution )?failed/i,
    ],
  },
];

const ROUTER_TEXT_MARKER = '[SYSTEM ERROR]';

/**
 * Cheap prefilter: a message that shows none of these failure cues cannot be a
 * provider error, so it is returned to the user untouched. This exists to keep
 * legitimate prose from being misclassified — a normal answer that merely
 * *mentions* an error (“the API returned 429 yesterday”) never contains a
 * failure-notice cue and is never parsed by the rules below.
 */
const ERROR_NOTICE_CUES: RegExp[] = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\bquota\b/i,
  /\bbudget\b/i,
  /\bexceeded\b/i,
  /\bexhausted\b/i,
  /\bdepleted\b/i,
  /\brefused\b/i,
  /\brate[- ]?limit/i,
  /\btoo many requests\b/i,
  /\b429\b/, /\b40[13]\b/, /\b5\d\d\b/,
  /\bfetch\b/i,
  /\btimeout\b/i,
  /\bunavailable\b/i,
  /\boverloaded\b/i,
  /\broute failed\b/i,
  /\bconnection\b/i,
  /\bsocket\b/i,
  /\bdns\b/i,
  /\bpayment\b/i,
  /\bbilling\b/i,
  /\bapi key\b/i,
  /\btry again\b/i,
  /\btemporarily\b/i,
  /\bdenied\b/i,
  /\bnot (?:available|found|supported)\b/i,
  /\bdoes not exist\b/i,
  /\bat capacity\b/i,
  /\bno available\b/i,
  /\binvalid\b/i,
  /\bmissing\b/i,
  /\bexpired\b/i,
  /\bcontext\b/i,
  /\bmaximum\b/i,
  /\btokens?\b/i,
];

function hasErrorNoticeCue(text: string): boolean {
  return ERROR_NOTICE_CUES.some(c => c.test(text));
}

/**
 * Classifies provider error prose. Returns null when the text does not look like
 * a failure — including null/undefined/short texts, so ordinary answers and
 * short prose are never misclassified.
 */
export function classifyErrorText(text: string | null | undefined): ClassifiedErrorType | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  // Failure prose is a *notice*, not an essay: every real gateway error is
  // short. Long, well-developed answers are never classified, no matter how
  // many trigger words they contain. The floor is low because thrown error
  // strings can be as short as "HTTP 429".
  if (trimmed.length < 6 || trimmed.length > 1200) return null;

  // The router's own terminal banner is already a classified failure.
  if (text.includes(ROUTER_TEXT_MARKER)) return 'network';

  // Skip the marker head when scanning so the router banner cannot mask the
  // underlying provider error text that follows it.
  const scan = text.replace(`[${'SYSTEM ERROR'}]`, '');

  // Cheap rejection first: no failure-notice cue → ordinary content.
  if (!hasErrorNoticeCue(scan)) return null;

  for (const rule of ERROR_RULES) {
    if (rule.patterns.some(p => p.test(scan))) return rule.type;
  }
  return null;
}

/**
 * True when this failure can be fixed by retrying elsewhere and therefore must
 * keep walking the fallback chain. Only a context overflow is genuinely fatal:
 * every provider will hit the same oversized prompt, so further attempts just
 * burn latency. Budget, auth, rate-limit, model and network failures are NOT
 * fatal — another provider (or Pollinations' free gateway) can still answer,
 * which is exactly the case in the "budget reached" screenshot where the next
 * provider must get a chance.
 */
export function isFatalForFallback(type: ClassifiedErrorType): boolean {
  return type === 'context_overflow';
}

/**
 * Wraps a provider error string as a machine-readable chunk so providerRouter /
 * ChatService can branch on `toolInvocations[0].toolName === '__error__'`
 * without re-parsing prose.
 */
export function buildErrorChunk(type: ClassifiedErrorType, message: string) {
  return {
    text: '',
    images: [],
    toolInvocations: [
      {
        state: 'result' as const,
        toolCallId: 'error_' + Date.now().toString(36),
        toolName: '__error__',
        args: {},
        result: { type, message },
      },
    ],
  };
}

/**
 * Detects a chunk produced by buildErrorChunk.
 */
export function isErrorChunk(chunk: any): boolean {
  return Array.isArray(chunk?.toolInvocations) &&
    chunk.toolInvocations.some((inv: any) => inv?.toolName === '__error__');
}

/**
 * Classification stored on the failing Message so the UI can render a themed
 * ErrorPanel (with remediation hints) instead of bare prose.
 */
export function withErrorMetadata<T extends Message>(message: T, type: ClassifiedErrorType, raw: string): T {
  const hints: Record<ClassifiedErrorType, string> = {
    budget_exhausted: 'Top up or raise the budget on that provider key, or switch provider.',
    api_key: 'Check the API key for this provider in Settings → Provider Keys.',
    rate_limit: 'Wait a moment, slow down, or switch provider.',
    context_overflow: 'Clear the conversation buffer or lower the attached-history count.',
    model_unavailable: 'Pick another model or enable auto-fallback.',
    network: 'Check your connection and the provider status page.',
    unknown: 'Enable auto-fallback or try a different model.',
  };
  return {
    ...message,
    isError: true,
    errorType: type,
    errorRaw: raw,
    content: `[${type.toUpperCase()}] ${hints[type]}\n\n${raw}`,
  } as T;
}
