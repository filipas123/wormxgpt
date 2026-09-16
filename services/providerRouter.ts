import { AppSettings, Message, ProviderType, StreamChunk, ProviderHealthStats, ToolInvocation } from '../types';
import { FALLBACK_CHAIN, FREE_MODEL_DEFAULTS, FREE_PROVIDERS, FREE_TIER_PROVIDERS } from '../constants';
import { telemetryService } from './telemetry';
import { classifyErrorText, isFatalForFallback, type ClassifiedErrorType } from './errorClassifier';

// ── Provider Service Interface ───────────────────────────────────────────────
export interface ProviderService {
  generateChat?(settings: AppSettings, messages: Message[], signal?: AbortSignal): Promise<StreamChunk>;
  streamChat(settings: AppSettings, messages: Message[], signal?: AbortSignal): AsyncGenerator<StreamChunk>;
  verifyApiKey?(key: string): Promise<boolean>;
  setApiKey?(key: string): void;
}

// ── Health Tracking ──────────────────────────────────────────────────────────
interface HealthEntry {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalLatencyMs: number;
  lastLatencyMs: number;
  lastError?: string;
  lastErrorAt?: number;
  consecutiveFailures: number;
}

// ── Provider Router ──────────────────────────────────────────────────────────
export class ProviderRouter {
  private services: Map<string, ProviderService> = new Map();
  private health: Map<string, HealthEntry> = new Map();
  private _initialized = false;

  /** Register a provider service */
  register(provider: ProviderType, service: ProviderService): void {
    this.services.set(provider, service);
    if (!this.health.has(provider)) {
      this.health.set(provider, {
        totalCalls: 0, successCalls: 0, failedCalls: 0,
        totalLatencyMs: 0, lastLatencyMs: 0, consecutiveFailures: 0
      });
    }
  }

  /** Get a registered service */
  getService(provider: ProviderType): ProviderService | undefined {
    return this.services.get(provider);
  }

  /** Get all registered provider names */
  getRegisteredProviders(): ProviderType[] {
    return Array.from(this.services.keys()) as ProviderType[];
  }

  /** Check if a provider requires an API key (not free) */
  requiresApiKey(provider: ProviderType): boolean {
    return !FREE_PROVIDERS.includes(provider);
  }

  /** Get the API key field name for a provider */
  getApiKeyField(provider: ProviderType): keyof AppSettings | null {
    const map: Partial<Record<ProviderType, keyof AppSettings>> = {
      gemini: 'geminiApiKey', groq: 'groqApiKey', pollinations: 'pollinationsApiKey',
      cerebras: 'cerebrasApiKey', siliconflow: 'siliconFlowApiKey', together: 'togetherApiKey',
      openrouter: 'openRouterApiKey', openai: 'openaiApiKey', anthropic: 'anthropicApiKey',
      deepseek: 'deepseekApiKey', mistral: 'mistralApiKey', perplexity: 'perplexityApiKey',
      xai: 'xaiApiKey', moonshot: 'moonshotApiKey', ollama: 'ollamaApiKey',
      cohere: 'cohereApiKey', wisgate: 'wisGateApiKey', nvidia: 'nvidiaApiKey',
      fireworks: 'fireworksApiKey', sambanova: 'sambanovaApiKey', hyperbolic: 'hyperbolicApiKey',
      huggingface: 'huggingfaceApiKey', deepinfra: 'deepinfraApiKey', novita: 'novitaApiKey',
      featherless: 'featherlessApiKey', lambdaai: 'lambdaaiApiKey', nebius: 'nebiusApiKey',
      tinyfish: 'tinyfishApiKey',
      llm7: 'llm7ApiKey',
      nanogpt: 'nanogptApiKey',
      ovh: 'ovhApiKey',
      puter: 'puterApiKey',
    };
    return map[provider] || null;
  }

  /** Check if a provider has a valid API key configured */
  hasApiKey(provider: ProviderType, settings: AppSettings): boolean {
    if (!this.requiresApiKey(provider)) return true;
    if (provider === 'gemini') {
      const k = settings.geminiApiKey || (typeof process !== 'undefined' && (process.env.GEMINI_API_KEY || process.env.API_KEY)) || (typeof localStorage !== 'undefined' && localStorage.getItem('geminiApiKey'));
      return !!k;
    }
    const field = this.getApiKeyField(provider);
    if (!field) return false;
    return !!(settings as any)[field];
  }

  /** Get available free providers that are currently healthy */
  getAvailableFreeProviders(): ProviderType[] {
    return FALLBACK_CHAIN.filter(p => {
      const h = this.health.get(p);
      return !h || h.consecutiveFailures < 5;
    });
  }

  /** Auto-select the best free model for a provider */
  getBestFreeModel(provider: ProviderType): string {
    if (provider === 'gemini') return 'gemini-2.5-flash';
    return FREE_MODEL_DEFAULTS[provider] || '';
  }

  /** Get health stats for all providers */
  getHealthStats(): ProviderHealthStats[] {
    return Array.from(this.health.entries()).map(([provider, h]) => ({
      provider: provider as ProviderType,
      totalCalls: h.totalCalls,
      successCalls: h.successCalls,
      failedCalls: h.failedCalls,
      avgLatencyMs: h.totalCalls > 0 ? Math.round(h.totalLatencyMs / h.totalCalls) : 0,
      lastLatencyMs: h.lastLatencyMs,
      lastError: h.lastError,
      lastErrorAt: h.lastErrorAt,
      isHealthy: h.consecutiveFailures < 3,
      isFree: FREE_PROVIDERS.includes(provider as ProviderType),
    }));
  }

  /** Get health for a specific provider */
  getProviderHealth(provider: ProviderType): HealthEntry | undefined {
    return this.health.get(provider);
  }

  /** Record a successful call */
  private recordSuccess(provider: string, latencyMs: number): void {
    const h = this.health.get(provider) || {
      totalCalls: 0, successCalls: 0, failedCalls: 0,
      totalLatencyMs: 0, lastLatencyMs: 0, consecutiveFailures: 0
    };
    h.totalCalls++;
    h.successCalls++;
    h.totalLatencyMs += latencyMs;
    h.lastLatencyMs = latencyMs;
    h.consecutiveFailures = 0;
    this.health.set(provider, h);
  }

  /** Record a failed call */
  private recordFailure(provider: string, error: string): void {
    const h = this.health.get(provider) || {
      totalCalls: 0, successCalls: 0, failedCalls: 0,
      totalLatencyMs: 0, lastLatencyMs: 0, consecutiveFailures: 0
    };
    h.totalCalls++;
    h.failedCalls++;
    h.consecutiveFailures++;
    h.lastError = error;
    h.lastErrorAt = Date.now();
    this.health.set(provider, h);
  }

  /**
   * Collapse a streaming generator into a single StreamChunk for providers that
   * only implement streamChat. Services in this codebase yield CUMULATIVE text
   * (each chunk carries the full text so far), so text takes the latest value;
   * optional fields (images/sources/video/audio/toolInvocations) are preserved
   * from the most recent chunk that supplied them instead of being dropped.
   */
  private async collectStream(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk> {
    const acc: StreamChunk = { text: '', images: [] };
    for await (const chunk of gen) {
      if (chunk.text) acc.text = chunk.text;
      if (chunk.images && chunk.images.length) acc.images = chunk.images;
      if (chunk.sources && chunk.sources.length) acc.sources = chunk.sources;
      if (chunk.video) acc.video = chunk.video;
      if (chunk.audio) acc.audio = chunk.audio;
      if (chunk.toolInvocations && chunk.toolInvocations.length) acc.toolInvocations = chunk.toolInvocations;
    }
    return acc;
  }

  /**
   * Synchronous Request-Response with Fallback Handling
   * When opts.onChunk is provided, streaming providers forward incremental
   * chunks as they arrive (enables live token rendering in the UI).
   */
  async generateWithFallback(
    settings: AppSettings,
    messages: Message[],
    signal?: AbortSignal,
    opts?: { onChunk?: (chunk: StreamChunk) => void }
  ): Promise<StreamChunk> {
    const primaryProvider = settings.aiProvider || 'pollinations';
    const autoFallback = settings.autoFallback ?? true;

    // Build the fallback chain:
    // 1. Primary provider
    // 2. Only providers with configured keys OR genuinely free providers
    const chain: { provider: ProviderType; model: string }[] = [
      { provider: primaryProvider, model: settings.model }
    ];

    if (autoFallback) {
      const userChain = settings.fallbackChain || FALLBACK_CHAIN;
      for (const p of userChain) {
        if (p !== primaryProvider && (this.services.has(p) || FREE_PROVIDERS.includes(p))) {
          const isFree = FREE_PROVIDERS.includes(p);
          const hasKey = this.hasApiKey(p, settings);
          if (isFree || hasKey) {
            chain.push({ provider: p, model: this.getBestFreeModel(p) || settings.model });
          }
        }
      }
      // If Gemini has an available API key and is not already in chain, add it near front
      if (this.hasApiKey('gemini', settings) && !chain.some(c => c.provider === 'gemini')) {
        chain.splice(1, 0, { provider: 'gemini', model: 'gemini-2.5-flash' });
      }
      // Ensure pollinations is always at least present in the chain if not already
      if (!chain.some(c => c.provider === 'pollinations')) {
        chain.push({ provider: 'pollinations', model: 'openai' });
      }
    }

    let lastErrorMsg = '';
    let lastFatalType: ClassifiedErrorType | null = null;
    const onChunk = opts?.onChunk;

    for (let i = 0; i < chain.length; i++) {
      const { provider, model } = chain[i];
      let service = this.services.get(provider);

      if (!service) {
        try {
          const { providerRegistry } = await import('./providers/registry');
          const reg = providerRegistry.getProvider(provider as any);
          if (reg) service = reg as any;
        } catch {}
      }

      if (!service) continue;
      if (signal?.aborted) throw new Error('Request aborted by user');

      const start = Date.now();
      try {
        const effectiveSettings: AppSettings = i === 0 ? settings : {
          ...settings,
          aiProvider: provider,
          model: model,
        };

        let result: StreamChunk;
        if (onChunk && typeof service.streamChat === 'function') {
          // Caller asked for live rendering: prefer the provider's streaming
          // generator and forward incremental (cumulative) chunks as they
          // arrive. Falls through to the blocking path below only if the
          // stream produced nothing usable.
          let produced = false;
          let last: StreamChunk | null = null;
          // Tool cards and sources can arrive on chunks that carry no text
          // (e.g. the final chunk after a native function call), so collect
          // them separately instead of dropping everything but the last chunk.
          const streamedTools: ToolInvocation[] = [];
          let streamedSources: { title: string; url: string }[] | undefined;
          let proseDetected = false;
          // Head buffer: the first paint is withheld until ~200 chars have
          // accumulated or the stream ends, so the opening fragment of a
          // failure notice ("The API key used for this requ") — which cannot
          // be classified until complete — is never painted and then replaced.
          // Real answers lose at most one paint tick.
          const PROBE_BUFFER_CHARS = 200;
          let probeBuffer = '';
          let probeFlushed = false;
          const flushProbe = () => {
            if (probeFlushed || !probeBuffer) return;
            probeFlushed = true;
            const buffered = probeBuffer;
            probeBuffer = '';
            if (buffered) {
              onChunk({ text: buffered, images: [] } as StreamChunk);
              produced = true;
            }
          };
          try {
            for await (const chunk of service.streamChat(effectiveSettings, messages, signal)) {
              if (chunk.toolInvocations && chunk.toolInvocations.length > 0) {
                for (const inv of chunk.toolInvocations) {
                  const existing = streamedTools.findIndex(t => t.toolCallId === inv.toolCallId);
                  if (existing >= 0) streamedTools[existing] = inv;
                  else streamedTools.push(inv);
                }
              }
              if (chunk.sources && chunk.sources.length > 0) {
                streamedSources = chunk.sources;
              }
              if (chunk.text || (chunk.images && chunk.images.length > 0)) {
                last = chunk;
                // Gateways that stream their failure notice ("The API key ...
                // reached its budget") used to paint it into the chat bubble in
                // real time. Classify BEFORE any paint: while the head buffer
                // is open, text accumulates silently; once flushed, any chunk
                // that classifies as error prose stops the stream entirely.
                if (chunk.text && classifyErrorText(chunk.text)) {
                  proseDetected = true;
                  probeBuffer = '';
                  break;
                }
                if (chunk.text && !probeFlushed) {
                  probeBuffer += chunk.text;
                  if (probeBuffer.length >= PROBE_BUFFER_CHARS) flushProbe();
                } else {
                  flushProbe();
                  onChunk(chunk);
                  if (chunk.text) produced = true;
                }
              }
            }
          } catch (streamErr: any) {
            if (streamErr.name === 'AbortError' || signal?.aborted) throw streamErr;
            // Remember the stream failure; decide below whether to retry blocking.
            last = null;
          }
          // Stream ended clean: release whatever the probe was still holding.
          if (!proseDetected) flushProbe();
          // Error prose streamed mid-flight: abandon everything this provider
          // emitted and fall through to the next one, exactly like a throw.
          if (proseDetected) {
            lastErrorMsg = (last?.text || 'provider failure notice').slice(0, 300);
            lastFatalType = classifyErrorText(lastErrorMsg);
            this.recordFailure(provider, `streamed error prose: ${lastFatalType}`);
            console.warn(`[ProviderRouter] ${provider} streamed error prose (${lastFatalType}); trying next provider.`);
            continue;
          }
          result = last ? { ...last } : { text: '', images: [] };
          if (streamedTools.length > 0) {
            result.toolInvocations = streamedTools;
            produced = true;
          }
          if (streamedSources && !result.sources?.length) {
            result.sources = streamedSources;
          }
          if (!produced && !(result.images && result.images.length > 0)) {
            if (typeof service.generateChat === 'function') {
              // One blocking retry before giving up and moving to the next provider.
              result = await service.generateChat(effectiveSettings, messages, signal);
            } else {
              throw new Error('Provider stream returned no content');
            }
          }
        } else if (typeof service.generateChat === 'function') {
          result = await service.generateChat(effectiveSettings, messages, signal);
        } else {
          result = await this.collectStream(service.streamChat(effectiveSettings, messages, signal));
        }

        if (result && (result.text || (result.images && result.images.length > 0) || (result.toolInvocations && result.toolInvocations.length > 0))) {
          // Gate: some gateways return provider failure prose as a 200 answer
          // ("The API key ... has reached its budget. Please raise the key
          // budget..."). Without this check the prose is recorded as a success,
          // the fallback chain never engages, and the user gets an unstyled
          // error paragraph as their chat answer.
          const proseFailure = classifyErrorText(result.text);
          if (proseFailure) {
            lastErrorMsg = result.text.slice(0, 300);
            lastFatalType = proseFailure;
            this.recordFailure(provider, `error prose: ${proseFailure}`);
            console.warn(`[ProviderRouter] ${provider} returned error prose (${proseFailure}); trying next provider.`);
            continue;
          }

          this.recordSuccess(provider, Date.now() - start);
          return result;
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || signal?.aborted) {
          throw err;
        }
        lastErrorMsg = err?.message || 'Unknown error';
        this.recordFailure(provider, lastErrorMsg);
        console.warn(`[ProviderRouter] ${provider} failed: ${lastErrorMsg}`);
        const thrownFailure = classifyErrorText(lastErrorMsg);
        if (thrownFailure) lastFatalType = thrownFailure;
        const nextProvider = chain[i + 1]?.provider;
        if (nextProvider) {
          telemetryService.recordFallback(provider, nextProvider, lastErrorMsg);
        }
      }
    }

    // Fatal failures (invalid key / empty wallet / oversized context) cannot be
    // fixed by another provider, so skip the remaining chain and the absolute
    // fallback — they would just repeat the same failure with fresh latency.
    if (lastFatalType && isFatalForFallback(lastFatalType)) {
      return {
        text: `[${lastFatalType.toUpperCase()}] ${lastErrorMsg}`,
        images: [],
      };
    }

    // Absolute fallback: try standard Pollinations synchronous direct handler.
    // Its answer is gated too: an out-of-budget Pollinations body used to slip
    // through this last resort and reach the chat as a normal answer.
    try {
      const { pollinationsService } = await import('./pollinations');
      const fallbackResult = await pollinationsService.generateChat(
        { ...settings, aiProvider: 'pollinations', model: 'openai' },
        messages,
        signal
      );
      if (fallbackResult && fallbackResult.text && !classifyErrorText(fallbackResult.text)) {
        return fallbackResult;
      }
      if (fallbackResult?.text) {
        lastErrorMsg = fallbackResult.text.slice(0, 300);
      }
    } catch {}

    return {
      text: `[SYSTEM ERROR] Neural routing failed.\n\nAll attempted providers (${chain.map(c => c.provider).join(' → ')}) returned errors.\nLast error: ${lastErrorMsg || 'Connection timeout.'}\n\nPlease check your API key in Settings or switch provider to Pollinations AI.`,
      images: []
    };
  }

  /**
   * Synchronous Direct generation without fallback
   */
  async generateDirect(
    settings: AppSettings,
    messages: Message[],
    signal?: AbortSignal
  ): Promise<StreamChunk> {
    const provider = settings.aiProvider || 'pollinations';
    let service = this.services.get(provider);

    if (!service) {
      const { providerRegistry } = await import('./providers/registry');
      const reg = providerRegistry.getProvider(provider as any);
      if (reg) service = reg as any;
    }

    if (!service) {
      throw new Error(`Provider '${provider}' is not registered.`);
    }

    const start = Date.now();
    try {
      let result: StreamChunk;
      if (typeof service.generateChat === 'function') {
        result = await service.generateChat(settings, messages, signal);
      } else {
        let text = '';
        let images: string[] = [];
        let sources: any[] = [];
        for await (const chunk of service.streamChat(settings, messages, signal)) {
          if (chunk.text) text = chunk.text;
          if (chunk.images) images = chunk.images;
          if (chunk.sources) sources = chunk.sources;
        }
        result = { text, images, sources };
      }
      // Same prose gate as the fallback path: a direct call (used by the tool
      // loop's inner turns) that comes back as a budget/auth notice must not be
      // recorded as a success — the loop would otherwise feed the failure prose
      // back in as if it were tool evidence.
      const proseFailure = classifyErrorText(result.text);
      if (proseFailure) {
        this.recordFailure(provider, `error prose: ${proseFailure}`);
        throw new Error(result.text.slice(0, 300));
      }
      this.recordSuccess(provider, Date.now() - start);
      return result;
    } catch (err: any) {
      this.recordFailure(provider, err?.message || 'Unknown');
      throw err;
    }
  }

  /**
   * Generator wrappers for backwards compatibility
   */
  async *streamWithFallback(
    settings: AppSettings,
    messages: Message[],
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const result = await this.generateWithFallback(settings, messages, signal);
    yield result;
  }

  async *streamDirect(
    settings: AppSettings,
    messages: Message[],
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const result = await this.generateDirect(settings, messages, signal);
    yield result;
  }
}

// ── Singleton Instance ───────────────────────────────────────────────────────
export const providerRouter = new ProviderRouter();

/**
 * Initialize the router with all available services.
 */
export async function initializeProviderRouter(): Promise<void> {
  const services = await import('./index');
  
  providerRouter.register('gemini', services.geminiService);
  providerRouter.register('groq', services.groqService);
  providerRouter.register('pollinations', services.pollinationsService);
  providerRouter.register('openai', services.openaiService);
  providerRouter.register('anthropic', services.anthropicService);
  providerRouter.register('deepseek', services.deepseekService);
  providerRouter.register('mistral', services.mistralService);
  providerRouter.register('perplexity', services.perplexityService);
  providerRouter.register('xai', services.xaiService);
  providerRouter.register('together', services.togetherService);
  providerRouter.register('openrouter', services.openrouterService);
  providerRouter.register('cerebras', services.cerebrasService);
  providerRouter.register('siliconflow', services.siliconflowService);
  providerRouter.register('moonshot', services.moonshotService);
  providerRouter.register('ollama', services.ollamaService);
  providerRouter.register('tinyfish', services.tinyfishService);

  // OpenAI-Compatible Providers
  providerRouter.register('cohere', services.cohereService);
  providerRouter.register('nvidia', services.nvidiaService);
  providerRouter.register('fireworks', services.fireworksService);
  providerRouter.register('sambanova', services.sambanovaService);
  providerRouter.register('hyperbolic', services.hyperbolicService);
  providerRouter.register('huggingface', services.huggingfaceService);
  providerRouter.register('deepinfra', services.deepinfraService);
  providerRouter.register('novita', services.novitaService);
  providerRouter.register('featherless', services.featherlessService);
  providerRouter.register('lambdaai', services.lambdaaiService);
  providerRouter.register('nebius', services.nebiusService);
  providerRouter.register('wisgate', services.wisGateService);
  providerRouter.register('uncloseai', services.uncloseaiService);
  providerRouter.register('llm7', services.llm7Service);
  providerRouter.register('puter', services.puterService);
}
