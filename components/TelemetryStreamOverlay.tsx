import React, { useEffect, useState, useRef } from 'react';
import { 
  Activity, 
  Zap, 
  X, 
  Minus, 
  Maximize2, 
  Minimize2, 
  Trash2, 
  Copy, 
  Check, 
  Terminal, 
  Radio, 
  Clock, 
  Search, 
  Pause, 
  Play, 
  ShieldAlert, 
  ArrowUpRight, 
  Wifi, 
  Layers,
  Flame
} from 'lucide-react';
import { telemetryService, TelemetryPacket, TelemetryMetrics, ProtocolTag } from '../services/telemetry';

interface TelemetryStreamOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TelemetryStreamOverlay: React.FC<TelemetryStreamOverlayProps> = ({ isOpen, onClose }) => {
  const [metrics, setMetrics] = useState<TelemetryMetrics>(telemetryService.getMetrics());
  const [packets, setPackets] = useState<TelemetryPacket[]>(telemetryService.getPackets());
  const [isMinimized, setIsMinimized] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedProtocol, setSelectedProtocol] = useState<'ALL' | ProtocolTag>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [syntheticIntervalActive, setSyntheticIntervalActive] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to real-time telemetry service
  useEffect(() => {
    const unsubscribe = telemetryService.subscribe((_, updatedMetrics) => {
      if (!isPaused) {
        setMetrics(updatedMetrics);
        setPackets(telemetryService.getPackets());
      }
    });
    return () => unsubscribe();
  }, [isPaused]);

  // Synthetic packet heartbeat when idle or when monitor is open
  useEffect(() => {
    if (!isOpen || isPaused || !syntheticIntervalActive) return;

    const timer = setInterval(() => {
      // Only inject synthetic beat if no active streaming in progress
      if (metrics.status === 'idle' || metrics.status === 'complete') {
        telemetryService.generateSyntheticPacket();
        setMetrics(telemetryService.getMetrics());
        setPackets(telemetryService.getPackets());
      }
    }, 2800);

    return () => clearInterval(timer);
  }, [isOpen, isPaused, syntheticIntervalActive, metrics.status]);

  // Auto-scroll logic
  useEffect(() => {
    if (autoScroll && scrollRef.current && !isMinimized) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [packets, autoScroll, isMinimized]);

  if (!isOpen) return null;

  const handleCopyLogs = () => {
    const text = packets.map(p => {
      const time = new Date(p.timestamp).toISOString().split('T')[1].slice(0, 8);
      return `[${time}] [${p.protocol || 'TCP/TLS'}] [${p.destination || p.provider}] ${p.summary} ${p.payloadPreview ? `| payload: ${p.payloadPreview}` : ''}`;
    }).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClearLogs = () => {
    telemetryService.clear();
    setPackets([]);
    setMetrics(telemetryService.getMetrics());
  };

  // Protocol filter & Search filter
  const filteredPackets = packets.filter(p => {
    const matchesProto = selectedProtocol === 'ALL' || (p.protocol || 'TCP/TLS') === selectedProtocol;
    if (!matchesProto) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const dest = (p.destination || '').toLowerCase();
    const sum = (p.summary || '').toLowerCase();
    const prov = (p.provider || '').toLowerCase();
    const payload = (p.payloadPreview || '').toLowerCase();
    const proto = (p.protocol || '').toLowerCase();

    return dest.includes(q) || sum.includes(q) || prov.includes(q) || payload.includes(q) || proto.includes(q);
  });

  const getProtocolBadge = (protocol?: ProtocolTag) => {
    const p = protocol || 'TCP/TLS';
    switch (p) {
      case 'SSE':
        return 'bg-red-950 text-red-400 border-red-600/70 shadow-[0_0_8px_rgba(239,68,68,0.4)]';
      case 'MCP':
        return 'bg-amber-950 text-amber-300 border-amber-500/70 shadow-[0_0_8px_rgba(245,158,11,0.3)]';
      case 'WS':
        return 'bg-rose-950 text-rose-300 border-rose-500/70 shadow-[0_0_8px_rgba(244,63,94,0.3)]';
      case 'REST':
        return 'bg-red-900/60 text-red-200 border-red-500/60';
      case 'TCP/TLS':
      default:
        return 'bg-black text-red-400 border-red-700/60';
    }
  };

  // Minimized floating dock pill
  if (isMinimized) {
    return (
      <div 
        id="network-telemetry-pill"
        className="fixed bottom-4 right-4 z-[999] flex items-center gap-3 bg-[#0a0204]/95 border-2 border-red-600/80 rounded-full px-4 py-2 text-xs font-mono shadow-[0_0_25px_rgba(239,68,68,0.45)] backdrop-blur-md cursor-pointer transition-all hover:scale-105 group"
        onClick={() => setIsMinimized(false)}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-80"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600 shadow-[0_0_10px_#ef4444]"></span>
          </span>
          <span className="text-red-100 font-bold tracking-widest text-[11px] group-hover:text-red-400">
            [NET_STREAM]
          </span>
        </div>
        <div className="h-3.5 w-px bg-red-900/80"></div>
        <div className="flex items-center gap-1.5 text-red-400 font-bold">
          <Zap className="w-3.5 h-3.5 text-red-500 animate-pulse" />
          <span>{metrics.currentTokPerSec || metrics.avgTokPerSec || 0} tok/s</span>
        </div>
        <div className="h-3.5 w-px bg-red-900/80"></div>
        <div className="flex items-center gap-1.5 text-red-300/80">
          <Clock className="w-3.5 h-3.5 text-red-400" />
          <span>{metrics.currentLatencyMs || 24}ms</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-1 text-red-500 hover:text-red-200 p-0.5"
          title="Close Stream Overlay"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div 
      id="realtime-network-stream-overlay"
      className="fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-[999] w-[95vw] sm:w-[580px] max-h-[82vh] flex flex-col bg-[#080204]/95 border-2 border-red-600/80 rounded-xl shadow-[0_0_40px_rgba(239,68,68,0.35)] backdrop-blur-xl font-mono text-xs overflow-hidden animate-in fade-in zoom-in-95 duration-200"
    >
      {/* Top Red Hacker Glow Bar */}
      <div className="h-1 bg-gradient-to-r from-red-700 via-red-500 to-red-700 shadow-[0_0_15px_#ef4444]"></div>

      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-black/80 border-b border-red-900/60 select-none">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-red-500">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isPaused ? 'bg-amber-500' : 'bg-red-500'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isPaused ? 'bg-amber-500' : 'bg-red-600 shadow-[0_0_8px_#ef4444]'}`}></span>
            </span>
            <Activity className="w-4 h-4 text-red-500 animate-pulse" />
          </div>
          <span className="font-bold text-red-100 tracking-wider text-[12px] flex items-center gap-1.5">
            NETWORK TELEMETRY STREAM
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-red-950 border border-red-700 text-red-400 font-bold">
              {isPaused ? 'PAUSED' : 'LIVE'}
            </span>
          </span>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`p-1.5 rounded text-xs transition-colors flex items-center gap-1 border ${
              isPaused 
                ? 'bg-amber-950/60 text-amber-300 border-amber-700' 
                : 'bg-red-950/60 text-red-400 hover:text-red-200 border-red-900/80 hover:bg-red-900/50'
            }`}
            title={isPaused ? "Resume Live Stream" : "Pause Live Stream"}
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={handleCopyLogs}
            className="p-1.5 rounded text-red-400 hover:text-red-200 hover:bg-red-950 border border-red-950 hover:border-red-800 transition-colors"
            title="Copy Network Stream Log"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={handleClearLogs}
            className="p-1.5 rounded text-red-400 hover:text-red-200 hover:bg-red-950 border border-red-950 hover:border-red-800 transition-colors"
            title="Clear Stream Buffer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 rounded text-red-400 hover:text-red-200 hover:bg-red-950 border border-red-950 hover:border-red-800 transition-colors"
            title="Minimize Stream Dock"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onClose}
            className="p-1.5 rounded text-red-400 hover:text-red-200 hover:bg-red-950 border border-red-950 hover:border-red-800 transition-colors"
            title="Close Stream Overlay"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Cyber Metrics HUD / Quick Dashboard */}
      <div className="grid grid-cols-4 gap-2 p-2.5 bg-black/60 border-b border-red-900/50 text-[11px]">
        {/* Speed Tok/s */}
        <div className="bg-red-950/40 border border-red-900/60 rounded-lg p-2 flex flex-col">
          <span className="text-[10px] text-red-400/80 uppercase">Throughput</span>
          <span className="text-red-200 font-bold text-xs flex items-center gap-1 mt-0.5">
            <Zap className="w-3.5 h-3.5 text-red-500" />
            {metrics.currentTokPerSec || metrics.avgTokPerSec || 0} <span className="text-[10px] text-red-400 font-normal">tok/s</span>
          </span>
        </div>

        {/* Latency / TTFT */}
        <div className="bg-red-950/40 border border-red-900/60 rounded-lg p-2 flex flex-col">
          <span className="text-[10px] text-red-400/80 uppercase">Latency / TTFT</span>
          <span className="text-red-200 font-bold text-xs flex items-center gap-1 mt-0.5">
            <Clock className="w-3.5 h-3.5 text-red-400" />
            {metrics.currentLatencyMs || 18}ms
          </span>
        </div>

        {/* Drop Rate */}
        <div className="bg-red-950/40 border border-red-900/60 rounded-lg p-2 flex flex-col">
          <span className="text-[10px] text-red-400/80 uppercase">Packet Drops</span>
          <span className="text-emerald-400 font-bold text-xs flex items-center gap-1 mt-0.5">
            <Wifi className="w-3.5 h-3.5 text-emerald-500" />
            0.00%
          </span>
        </div>

        {/* Packets Count */}
        <div className="bg-red-950/40 border border-red-900/60 rounded-lg p-2 flex flex-col">
          <span className="text-[10px] text-red-400/80 uppercase">Frames / Total</span>
          <span className="text-red-200 font-bold text-xs flex items-center gap-1 mt-0.5">
            <Layers className="w-3.5 h-3.5 text-red-400" />
            {filteredPackets.length} pkts
          </span>
        </div>
      </div>

      {/* Protocol Selector & Search Bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-black/40 border-b border-red-900/40 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {(['ALL', 'TCP/TLS', 'SSE', 'REST', 'MCP', 'WS'] as const).map(tag => (
            <button
              key={tag}
              onClick={() => setSelectedProtocol(tag)}
              className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                selectedProtocol === tag
                  ? 'bg-red-600 text-white border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                  : 'bg-black/60 text-red-400 hover:text-red-200 border-red-900/60 hover:bg-red-950/60'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Search destination or content */}
        <div className="flex-1 min-w-[140px] flex items-center gap-1.5 px-2 py-1 rounded bg-black/80 border border-red-900/60 text-red-200">
          <Search className="w-3 h-3 text-red-500 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter protocol, host, payload..."
            className="w-full bg-transparent border-none outline-none text-[11px] text-red-200 placeholder-red-700/80 font-mono"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-red-500 hover:text-red-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Real-time Streaming Packet Stream Window */}
      <div 
        ref={scrollRef}
        className="flex-1 p-2.5 overflow-y-auto max-h-[360px] space-y-1.5 custom-scrollbar bg-[#050102]"
      >
        {filteredPackets.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center text-red-600 text-center gap-2">
            <Radio className="w-6 h-6 animate-pulse text-red-500" />
            <span>NO PACKETS CAPTURED IN BUFFER</span>
            <span className="text-[10px] text-red-700">Listening for socket traffic, SSE streams, and MCP calls...</span>
          </div>
        ) : (
          filteredPackets.map((pkt) => {
            const timeStr = new Date(pkt.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const proto = pkt.protocol || 'TCP/TLS';
            const dest = pkt.destination || `${pkt.provider}:${pkt.model}`;

            return (
              <div 
                key={pkt.id}
                className="group flex flex-col gap-1 p-2 rounded-lg bg-black/70 border border-red-950 hover:border-red-700/80 transition-all hover:bg-red-950/20"
              >
                <div className="flex items-center justify-between text-[10px] text-red-400 font-mono">
                  <div className="flex items-center gap-1.5">
                    <span className="text-red-600">{timeStr}</span>
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${getProtocolBadge(pkt.protocol)}`}>
                      [{proto}]
                    </span>
                    <span className="text-red-300 font-semibold truncate max-w-[200px]" title={dest}>
                      {dest}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {pkt.latencyMs !== undefined && (
                      <span className="text-red-400/90">{pkt.latencyMs}ms</span>
                    )}
                    {pkt.deltaBytes !== undefined && (
                      <span className="text-red-500">+{pkt.deltaBytes}B</span>
                    )}
                  </div>
                </div>

                {/* Packet Summary */}
                <div className="text-[11px] text-red-100 font-mono flex items-start gap-1.5 break-all">
                  <ArrowUpRight className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                  <span>{pkt.summary}</span>
                </div>

                {/* Payload Preview */}
                {pkt.payloadPreview && (
                  <div className="bg-red-950/30 border border-red-900/40 rounded px-2 py-1 text-[10px] text-red-300 font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                    <span className="text-red-500 font-bold mr-1">PAYLOAD:</span>
                    {pkt.payloadPreview}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Status Bar */}
      <div className="px-3 py-1.5 bg-black/90 border-t border-red-900/60 flex items-center justify-between text-[10px] text-red-400 select-none">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-red-200">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded bg-black border-red-700 text-red-600 focus:ring-0"
            />
            <span>Auto-scroll</span>
          </label>
          <span className="text-red-800">•</span>
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-red-200">
            <input
              type="checkbox"
              checked={syntheticIntervalActive}
              onChange={(e) => setSyntheticIntervalActive(e.target.checked)}
              className="rounded bg-black border-red-700 text-red-600 focus:ring-0"
            />
            <span>Heartbeat Probes</span>
          </label>
        </div>

        <div className="flex items-center gap-1.5 text-red-400 font-bold">
          <Flame className="w-3.5 h-3.5 text-red-500 animate-pulse" />
          <span>WORM_OS C2 ACTIVE</span>
        </div>
      </div>
    </div>
  );
};

export default TelemetryStreamOverlay;
