/**
 * services/telemetry.ts
 * Real-Time Network Activity & Telemetry Service
 * Tracks streaming request packets, latency counters, Time to First Token (TTFT),
 * and token throughput (tokens/sec) with ring buffer event storage.
 */

export type TelemetryPacketType = 
  | 'REQUEST_START'
  | 'STREAM_CHUNK'
  | 'TOOL_INVOKE'
  | 'TOOL_RESULT'
  | 'FALLBACK'
  | 'REQUEST_END'
  | 'ERROR'
  | 'SYNTHETIC_BEAT';

export type ConnectionStatus = 'idle' | 'connecting' | 'streaming' | 'tool_exec' | 'complete' | 'error';
export type ProtocolTag = 'TCP/TLS' | 'SSE' | 'REST' | 'MCP' | 'WS';

export interface TelemetryPacket {
  id: string;
  timestamp: number;
  type: TelemetryPacketType;
  provider: string;
  model: string;
  protocol?: ProtocolTag;
  destination?: string;
  payloadPreview?: string;
  deltaBytes?: number;
  deltaText?: string;
  tokenCount?: number;
  tokensPerSec?: number;
  latencyMs?: number;
  ttftMs?: number;
  summary: string;
  details?: Record<string, any>;
  level: 'info' | 'success' | 'warning' | 'error';
}

export interface TelemetryMetrics {
  status: ConnectionStatus;
  activeProvider: string;
  activeModel: string;
  currentLatencyMs: number;
  ttftMs: number;
  totalDurationMs: number;
  currentTokPerSec: number;
  avgTokPerSec: number;
  totalPackets: number;
  totalBytes: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  dropRatePct: number;
  throughputKbps: number;
  lastError: string | null;
  requestsCompleted: number;
}

type TelemetryListener = (packet: TelemetryPacket, metrics: TelemetryMetrics) => void;

class TelemetryService {
  private packets: TelemetryPacket[] = [];
  private maxPackets = 150;
  private listeners: Set<TelemetryListener> = new Set();

  private requestStartTime = 0;
  private firstTokenTime = 0;
  private lastChunkTime = 0;
  private currentStreamTokens = 0;
  private currentStreamBytes = 0;

  private metrics: TelemetryMetrics = {
    status: 'idle',
    activeProvider: 'pollinations',
    activeModel: 'openai',
    currentLatencyMs: 0,
    ttftMs: 0,
    totalDurationMs: 0,
    currentTokPerSec: 0,
    avgTokPerSec: 0,
    totalPackets: 0,
    totalBytes: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    dropRatePct: 0.0,
    throughputKbps: 0.0,
    lastError: null,
    requestsCompleted: 0
  };

  public subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(packet: TelemetryPacket) {
    this.listeners.forEach(fn => {
      try {
        fn(packet, { ...this.metrics });
      } catch (err) {
        console.error('[Telemetry] Listener error:', err);
      }
    });
  }

  public getPackets(): TelemetryPacket[] {
    return [...this.packets];
  }

  public getMetrics(): TelemetryMetrics {
    return { ...this.metrics };
  }

  public clear(): void {
    this.packets = [];
    this.metrics.totalPackets = 0;
    this.metrics.totalBytes = 0;
    this.notify({
      id: `clear_${Date.now()}`,
      timestamp: Date.now(),
      type: 'REQUEST_END',
      provider: this.metrics.activeProvider,
      model: this.metrics.activeModel,
      protocol: 'REST',
      destination: 'local://client-buffer',
      summary: 'Telemetry log buffer cleared',
      level: 'info'
    });
  }

  /**
   * Generates a synthetic heartbeat / network probe packet for idle monitoring
   */
  public generateSyntheticPacket(): TelemetryPacket {
    const protocols: ProtocolTag[] = ['TCP/TLS', 'SSE', 'REST', 'MCP', 'WS'];
    const destinations = [
      'api.groq.com:443',
      'text.pollinations.ai:443',
      'generativelanguage.googleapis.com:443',
      'mcp-gateway:8443',
      'node-c2.mesh.internal:9001'
    ];
    const proto = protocols[Math.floor(Math.random() * protocols.length)];
    const dest = destinations[Math.floor(Math.random() * destinations.length)];
    const latency = Math.floor(18 + Math.random() * 45);
    const bytes = Math.floor(64 + Math.random() * 320);

    const pkt: TelemetryPacket = {
      id: `pkt_synth_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type: 'SYNTHETIC_BEAT',
      provider: this.metrics.activeProvider,
      model: this.metrics.activeModel,
      protocol: proto,
      destination: dest,
      latencyMs: latency,
      deltaBytes: bytes,
      payloadPreview: `SYN_ACK seq=${Math.floor(Math.random() * 99999)} win=65535 len=${bytes}`,
      summary: `PING [${proto}] ${dest} (${latency}ms, ${bytes}B)`,
      level: 'info'
    };

    this.metrics.currentLatencyMs = latency;
    this.metrics.throughputKbps = Number(((bytes * 8) / (latency || 1)).toFixed(2));
    this.addPacket(pkt);
    return pkt;
  }

  /**
   * Called when a chat completion request starts
   */
  public recordRequestStart(provider: string, model: string, estimatedInputTokens = 0): void {
    const now = Date.now();
    this.requestStartTime = now;
    this.firstTokenTime = 0;
    this.lastChunkTime = now;
    this.currentStreamTokens = 0;
    this.currentStreamBytes = 0;

    this.metrics.status = 'connecting';
    this.metrics.activeProvider = provider;
    this.metrics.activeModel = model;
    this.metrics.currentLatencyMs = 0;
    this.metrics.ttftMs = 0;
    this.metrics.totalDurationMs = 0;
    this.metrics.currentTokPerSec = 0;
    this.metrics.totalInputTokens += estimatedInputTokens;
    this.metrics.lastError = null;

    const destination = provider === 'groq' 
      ? 'api.groq.com:443' 
      : provider === 'gemini' 
      ? 'generativelanguage.googleapis.com:443'
      : provider === 'puter'
      ? 'js.puter.com/v2:443'
      : 'text.pollinations.ai:443';

    const packet: TelemetryPacket = {
      id: `pkt_${now}_start`,
      timestamp: now,
      type: 'REQUEST_START',
      provider,
      model,
      protocol: 'TCP/TLS',
      destination,
      payloadPreview: `POST /v1/chat/completions (model=${model})`,
      summary: `POST /v1/chat/completions → [${provider}/${model}]`,
      details: { inputTokensEstimate: estimatedInputTokens },
      level: 'info'
    };

    this.addPacket(packet);
  }

  /**
   * Called when an incremental stream chunk is received
   */
  public recordChunk(deltaText: string, totalAccumulatedTextLength = 0): void {
    const now = Date.now();
    const elapsedSinceStart = now - (this.requestStartTime || now);
    const timeDelta = Math.max(1, now - (this.lastChunkTime || now));
    this.lastChunkTime = now;

    // Approximate token count (~4 chars per token)
    const deltaChars = deltaText.length;
    const deltaTokens = Math.max(1, Math.round(deltaChars / 4));
    const deltaBytes = new Blob([deltaText]).size;

    this.currentStreamTokens += deltaTokens;
    this.currentStreamBytes += deltaBytes;
    this.metrics.totalBytes += deltaBytes;
    this.metrics.totalOutputTokens += deltaTokens;

    // Time to first token
    if (this.firstTokenTime === 0 && this.requestStartTime > 0) {
      this.firstTokenTime = now;
      this.metrics.ttftMs = now - this.requestStartTime;
    }

    // Instantaneous and average tokens per second
    const instantTokPerSec = Math.min(150, Math.round((deltaTokens / (timeDelta / 1000)) * 10) / 10);
    const streamDurationSec = Math.max(0.1, (now - (this.firstTokenTime || now)) / 1000);
    const avgTokPerSec = Math.round((this.currentStreamTokens / streamDurationSec) * 10) / 10;

    this.metrics.status = 'streaming';
    this.metrics.currentLatencyMs = elapsedSinceStart;
    this.metrics.currentTokPerSec = instantTokPerSec;
    this.metrics.avgTokPerSec = avgTokPerSec;
    this.metrics.throughputKbps = Number(((deltaBytes * 8) / (timeDelta || 1)).toFixed(2));

    const destination = this.metrics.activeProvider === 'groq' 
      ? 'api.groq.com:443' 
      : 'text.pollinations.ai:443';

    const packet: TelemetryPacket = {
      id: `pkt_${now}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      type: 'STREAM_CHUNK',
      provider: this.metrics.activeProvider,
      model: this.metrics.activeModel,
      protocol: 'SSE',
      destination,
      deltaBytes,
      deltaText: deltaText.slice(0, 80),
      payloadPreview: deltaText.slice(0, 60),
      tokenCount: deltaTokens,
      tokensPerSec: instantTokPerSec,
      latencyMs: elapsedSinceStart,
      ttftMs: this.metrics.ttftMs,
      summary: `SSE Chunk +${deltaTokens} tok (${deltaBytes}B) @ ${instantTokPerSec} tok/s`,
      level: 'info'
    };

    this.addPacket(packet);
  }

  /**
   * Called when a tool invocation begins
   */
  public recordToolStart(toolName: string, args: Record<string, any>): void {
    const now = Date.now();
    this.metrics.status = 'tool_exec';

    const packet: TelemetryPacket = {
      id: `pkt_${now}_tool_${toolName}`,
      timestamp: now,
      type: 'TOOL_INVOKE',
      provider: this.metrics.activeProvider,
      model: this.metrics.activeModel,
      protocol: 'MCP',
      destination: `mcp://local/tool/${toolName}`,
      payloadPreview: JSON.stringify(args).slice(0, 70),
      summary: `EXEC TOOL: ${toolName}`,
      details: { args },
      level: 'warning'
    };

    this.addPacket(packet);
  }

  /**
   * Called when a tool invocation finishes
   */
  public recordToolResult(toolName: string, durationMs: number, isError = false, resultSnippet?: string): void {
    const now = Date.now();
    this.metrics.status = 'streaming';

    const packet: TelemetryPacket = {
      id: `pkt_${now}_toolres_${toolName}`,
      timestamp: now,
      type: 'TOOL_RESULT',
      provider: this.metrics.activeProvider,
      model: this.metrics.activeModel,
      protocol: 'MCP',
      destination: `mcp://local/tool/${toolName}`,
      payloadPreview: (resultSnippet || '').slice(0, 70),
      latencyMs: durationMs,
      summary: isError 
        ? `TOOL FAILED: ${toolName} (${durationMs}ms)`
        : `TOOL COMPLETE: ${toolName} (${durationMs}ms)`,
      details: { resultSnippet },
      level: isError ? 'error' : 'success'
    };

    this.addPacket(packet);
  }

  /**
   * Called when a provider auto-fallback occurs
   */
  public recordFallback(fromProvider: string, toProvider: string, reason: string): void {
    const now = Date.now();

    const packet: TelemetryPacket = {
      id: `pkt_${now}_fallback`,
      timestamp: now,
      type: 'FALLBACK',
      provider: toProvider,
      model: this.metrics.activeModel,
      protocol: 'REST',
      destination: `${toProvider}:failover`,
      payloadPreview: `Routing switch: ${reason}`,
      summary: `AUTO-FALLBACK: ${fromProvider} → ${toProvider}`,
      details: { reason },
      level: 'warning'
    };

    this.metrics.activeProvider = toProvider;
    this.addPacket(packet);
  }

  /**
   * Called when generation finishes successfully
   */
  public recordRequestEnd(finalTokenCount?: number): void {
    const now = Date.now();
    const durationMs = now - (this.requestStartTime || now);
    this.metrics.status = 'complete';
    this.metrics.totalDurationMs = durationMs;
    this.metrics.currentLatencyMs = durationMs;
    this.metrics.requestsCompleted++;

    if (finalTokenCount) {
      this.metrics.totalOutputTokens += finalTokenCount;
    }

    const packet: TelemetryPacket = {
      id: `pkt_${now}_end`,
      timestamp: now,
      type: 'REQUEST_END',
      provider: this.metrics.activeProvider,
      model: this.metrics.activeModel,
      protocol: 'TCP/TLS',
      destination: `${this.metrics.activeProvider}:closed`,
      latencyMs: durationMs,
      ttftMs: this.metrics.ttftMs,
      tokensPerSec: this.metrics.avgTokPerSec,
      payloadPreview: `HTTP/2 200 OK (${this.currentStreamBytes} bytes transferred)`,
      summary: `200 OK — Stream completed in ${durationMs}ms (~${this.metrics.avgTokPerSec} tok/s)`,
      details: {
        totalOutputTokens: this.currentStreamTokens || finalTokenCount || 0,
        totalBytes: this.currentStreamBytes
      },
      level: 'success'
    };

    this.addPacket(packet);
  }

  /**
   * Called when an error halts generation
   */
  public recordError(provider: string, errorText: string): void {
    const now = Date.now();
    const durationMs = now - (this.requestStartTime || now);
    this.metrics.status = 'error';
    this.metrics.lastError = errorText;
    this.metrics.totalDurationMs = durationMs;

    const packet: TelemetryPacket = {
      id: `pkt_${now}_err`,
      timestamp: now,
      type: 'ERROR',
      provider,
      model: this.metrics.activeModel,
      protocol: 'TCP/TLS',
      destination: `${provider}:error`,
      latencyMs: durationMs,
      payloadPreview: errorText.slice(0, 80),
      summary: `ERROR: ${errorText.slice(0, 100)}`,
      details: { fullError: errorText },
      level: 'error'
    };

    this.addPacket(packet);
  }

  private addPacket(packet: TelemetryPacket): void {
    this.packets.push(packet);
    if (this.packets.length > this.maxPackets) {
      this.packets.shift();
    }
    this.metrics.totalPackets++;
    this.notify(packet);
  }
}

export const telemetryService = new TelemetryService();
export default telemetryService;
