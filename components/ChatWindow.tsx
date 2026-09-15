import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  Terminal, Sparkles, ShieldAlert, Cpu, Eye, ArrowDown, Loader2,
  ArrowRightLeft, XCircle, Activity
} from 'lucide-react';
import { useWormGPT } from '../context/GlobalContext';
import { ChatMessage } from './ChatMessage';
import { SUGGESTED_PROMPTS } from '../constants';

// ── Live Generation Status Bar ────────────────────────────────────────────────
const GenerationStatusBar: React.FC<{
  model: string;
  provider: string;
  activeToolCalling?: string | null;
  isFree?: boolean;
}> = ({ model, provider, activeToolCalling, isFree }) => (
  <div className="mx-4 sm:mx-6 md:mx-8 mb-3 px-4 py-2.5 rounded-xl bg-red-950/80 border border-red-600/70 shadow-[0_0_20px_rgba(239,68,68,0.35)] flex items-center justify-between text-xs font-mono">
    <div className="flex items-center gap-3 min-w-0">
      {/* Pulsing red dot */}
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 shadow-[0_0_8px_#ef4444]" />
      </span>

      {activeToolCalling ? (
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-amber-400 font-bold">TOOL_EXEC:</span>
          <span className="text-amber-200 font-bold truncate">{activeToolCalling}</span>
          <span className="text-red-400/80 animate-pulse">executing in sandbox...</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-red-400/80">STREAMING_PAYLOAD &gt;&gt;</span>
          <span className="text-red-100 font-bold truncate">{model}</span>
          <span className="text-red-600">•</span>
          <span className="text-red-300">{provider}</span>
        </div>
      )}
    </div>

    <div className="flex items-center gap-2 shrink-0">
      {isFree && (
        <span className="px-2 py-0.5 rounded-full bg-red-900/60 text-red-200 border border-red-500/50 text-[10px]">
          FREE TIER
        </span>
      )}
      <span className="px-2 py-0.5 rounded-full bg-red-600/30 text-red-200 border border-red-500/60 text-[10px] animate-pulse font-bold shadow-[0_0_8px_rgba(239,68,68,0.4)]">
        LIVE_STREAM
      </span>
    </div>
  </div>
);

// ── Fallback Event Card ────────────────────────────────────────────────────────
const FallbackEventCard: React.FC<{
  failed: string;
  succeeded: string;
  reason: string;
  onDismiss: () => void;
}> = ({ failed, succeeded, reason, onDismiss }) => (
  <div className="mx-4 sm:mx-6 md:mx-8 mb-3 px-3 py-2.5 rounded-xl bg-red-950/60 border border-amber-500/40 flex items-center justify-between text-xs font-mono animate-in slide-in-from-bottom duration-300 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
    <div className="flex items-center gap-2 min-w-0">
      <ArrowRightLeft className="w-4 h-4 text-amber-400 shrink-0" />
      <div className="min-w-0">
        <span className="text-amber-300 font-semibold">AUTO_FALLBACK_REROUTE:</span>
        <span className="text-slate-400 ml-1.5">
          <span className="text-rose-400 line-through">{failed}</span>
          <span className="text-slate-500 mx-1">→</span>
          <span className="text-emerald-400 font-bold">{succeeded}</span>
        </span>
        {reason && <span className="text-red-400/80 ml-1.5 truncate">({reason.slice(0, 50)})</span>}
      </div>
    </div>
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss fallback notification"
      className="text-red-400 hover:text-red-200 transition-colors ml-2 shrink-0"
    >
      <XCircle className="w-3.5 h-3.5" />
    </button>
  </div>
);

export const ChatWindow: React.FC<{
  onOpenModelSelector?: (mode?: 'text' | 'vision') => void;
}> = ({ onOpenModelSelector }) => {
  const {
    activeSession, settings, isStreaming, activeToolCalling, setInput,
    activeGeneratingModel, activeGeneratingProvider
  } = useWormGPT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef<boolean>(false);
  const [showScrollBottom, setShowScrollBottom] = useState<boolean>(false);
  const [fallbackEvent, setFallbackEvent] = useState<{ failed: string; succeeded: string; reason: string } | null>(null);

  const messages = useMemo(() => activeSession.messages, [activeSession.messages]);
  const lastMessage = messages[messages.length - 1];
  const lastMessageContent = lastMessage?.content;
  const lastMessageIdRef = useRef<string | null>(null);

  // Progressive reveal: completed responses fade in progressively instead of
  // popping in all at once after a blocking request/response round-trip.
  // Skipped when the message was already rendered via real token streaming.
  const [revealLimit, setRevealLimit] = useState<number | null>(null);
  const streamedViaTokensRef = useRef(false);
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    const mid = lastMsg ? `${lastMsg.timestamp ?? ''}-${messages.length}` : null;
    if (mid !== lastMessageIdRef.current) {
      lastMessageIdRef.current = mid;
      streamedViaTokensRef.current = false;
      setRevealLimit(null);
      return;
    }
    if (!lastMsg || lastMsg.role !== 'model') return;
    if (isStreaming) {
      // Content is updating live — real streaming is active for this message
      if (lastMsg.content) streamedViaTokensRef.current = true;
      return;
    }
    if (revealLimit !== null || streamedViaTokensRef.current) return;
    const total = lastMsg.content?.length || 0;
    if (total < 400) return;
    let shown = Math.floor(total * 0.25);
    setRevealLimit(shown);
    const timer = setInterval(() => {
      shown += Math.max(48, Math.ceil(total / 40));
      if (shown >= total) {
        setRevealLimit(null);
      } else {
        setRevealLimit(shown);
      }
    }, 40);
    return () => clearInterval(timer);
  }, [messages, isStreaming, revealLimit]);

  const displayMessages = useMemo(() => {
    if (revealLimit === null || messages.length === 0) return messages;
    const lastIdx = messages.length - 1;
    const lastMsg = messages[lastIdx];
    if (!lastMsg || lastMsg.role !== 'model') return messages;
    const trimmed = {
      ...lastMsg,
      content: (lastMsg.content || '').slice(0, revealLimit),
    };
    return [...messages.slice(0, lastIdx), trimmed];
  }, [messages, revealLimit]);

  // Check for fallback in the last message's routing events
  useEffect(() => {
    if (lastMessage?.routingEvents) {
      const fallback = lastMessage.routingEvents.find(e => e.type === 'fallback');
      const success = lastMessage.routingEvents.find(e => e.type === 'success');
      if (fallback && success) {
        setFallbackEvent({
          failed: fallback.provider,
          succeeded: success.provider,
          reason: fallback.error || 'Provider unavailable'
        });
      }
    }
  }, [lastMessage?.routingEvents]);

  // Clear fallback event after 8 seconds
  useEffect(() => {
    if (fallbackEvent) {
      const timer = setTimeout(() => setFallbackEvent(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [fallbackEvent]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isUp = distanceFromBottom > 70;
    userScrolledUp.current = isUp;
    setShowScrollBottom(distanceFromBottom > 160);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    if (!scrollRef.current) return;
    userScrolledUp.current = false;
    setShowScrollBottom(false);
    if (smooth) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    userScrolledUp.current = false;
    scrollToBottom(true);
  }, [messages.length, activeSession.id, scrollToBottom]);

  useEffect(() => {
    if (isStreaming && !userScrolledUp.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lastMessageContent, isStreaming]);

  // Keep pinned to bottom during progressive reveal as well
  useEffect(() => {
    if (revealLimit !== null && !userScrolledUp.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [revealLimit]);

  const generatingModel = activeGeneratingModel || settings.model;
  const generatingProvider = activeGeneratingProvider || settings.aiProvider;
  const isFreeModel = lastMessage?.generatedBy?.isFree;

  return (
    <div className="flex-1 overflow-hidden flex flex-col relative bg-[#050102] font-mono">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="Conversation messages"
        className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 custom-scrollbar relative z-10 select-text"
      >
        <div className="max-w-4xl mx-auto min-h-full flex flex-col">
          {displayMessages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center animate-in fade-in duration-300">
              {/* Terminal Logo */}
              <div className="mb-6 relative">
                <div className="w-16 h-16 rounded-2xl bg-red-950/50 border-2 border-red-600/80 flex items-center justify-center text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.5)]">
                  <Terminal className="w-8 h-8" />
                </div>
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 border-2 border-[#050102] flex items-center justify-center shadow-[0_0_8px_#ef4444]">
                  <Activity className="w-2 h-2 text-black stroke-[3]" />
                </span>
              </div>

              <h2 className="text-2xl font-bold tracking-tight text-red-100 mb-2 drop-shadow-[0_0_12px_rgba(239,68,68,0.7)] font-mono">
                WORM_OS // RED TERMINAL
              </h2>
              <p className="text-xs text-red-400/80 max-w-md mb-6 leading-relaxed font-mono">
                Autonomous AI offensive security research & whitebox model harness. 108+ LLM nodes, real-time packet stream telemetry, zero-trace memory wipe.
              </p>

              {/* Whitebox Legend */}
              <div className="flex flex-wrap items-center justify-center gap-2 mb-5 text-[11px] font-mono">
                <span className="px-2.5 py-1 rounded-md bg-red-950/60 border border-red-800/80 text-red-300 shadow-[0_0_8px_rgba(239,68,68,0.2)]">
                  [model] shown per message
                </span>
                <span className="px-2.5 py-1 rounded-md bg-amber-950/50 border border-amber-500/30 text-amber-300">
                  Tool calls visible
                </span>
                <span className="px-2.5 py-1 rounded-md bg-red-900/40 border border-red-600/50 text-red-200">
                  FREE models marked ✓
                </span>
              </div>

              {/* Active Config Badges */}
              <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
                <button
                  type="button"
                  onClick={() => onOpenModelSelector?.('text')}
                  className="px-3 py-1.5 rounded-lg bg-black/80 border border-red-900/80 text-xs text-red-300 flex items-center gap-1.5 cursor-pointer hover:border-red-500 hover:bg-red-950/40 hover:shadow-[0_0_12px_rgba(239,68,68,0.3)] transition-all font-mono"
                  title="Change the primary text model"
                >
                  <Cpu className="w-3.5 h-3.5 text-red-400" />
                  <span>Text: {settings.model}</span>
                  <span className="text-red-600 text-[10px]">({settings.aiProvider})</span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenModelSelector?.('vision')}
                  className="px-3 py-1.5 rounded-lg bg-black/80 border border-red-900/80 text-xs text-red-300 flex items-center gap-1.5 cursor-pointer hover:border-red-500 hover:bg-red-950/40 hover:shadow-[0_0_12px_rgba(239,68,68,0.3)] transition-all font-mono"
                  title="Change the vision model"
                >
                  <Eye className="w-3.5 h-3.5 text-red-400" />
                  <span>Vision: {settings.visionModel || 'gemini-2.5-flash'}</span>
                </button>

                {settings.autoFallback && (
                  <div className="px-3 py-1.5 rounded-lg bg-red-950/60 border border-red-600/40 text-xs text-red-300 flex items-center gap-1.5 font-mono">
                    <ArrowRightLeft className="w-3.5 h-3.5 text-red-400" />
                    <span>Auto-Fallback ON</span>
                  </div>
                )}

                {settings.systemOverride && (
                  <div className="px-3 py-1.5 rounded-lg bg-red-950/80 border border-red-500 text-xs text-red-200 flex items-center gap-1.5 font-mono shadow-[0_0_10px_rgba(239,68,68,0.3)]">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-400 animate-pulse" />
                    <span>System Override Active</span>
                  </div>
                )}
              </div>

              {/* Quick Prompts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-2xl px-4 text-left">
                {SUGGESTED_PROMPTS.slice(0, 4).map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(p)}
                    className="p-3.5 bg-black/60 hover:bg-red-950/40 border border-red-900/60 hover:border-red-600 rounded-xl text-xs text-red-300 hover:text-red-100 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)] transition-all duration-200 font-mono"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span className="truncate">{p}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6 pb-20 select-text">
              {displayMessages.map((msg, i) => (
                <ChatMessage
                  key={`${msg.timestamp || i}-${i}`}
                  message={msg}
                  settings={settings}
                  isGenerating={
                    (isStreaming || revealLimit !== null) &&
                    i === displayMessages.length - 1 &&
                    (msg.role === 'model' || msg.role === 'assistant')
                  }
                  activeToolCalling={isStreaming && i === displayMessages.length - 1 ? activeToolCalling : null}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Fallback Event Notification */}
      {fallbackEvent && !isStreaming && (
        <FallbackEventCard
          failed={fallbackEvent.failed}
          succeeded={fallbackEvent.succeeded}
          reason={fallbackEvent.reason}
          onDismiss={() => setFallbackEvent(null)}
        />
      )}

      {/* Live Generation Status Bar */}
      {isStreaming && (
        <GenerationStatusBar
          model={generatingModel}
          provider={String(generatingProvider)}
          activeToolCalling={activeToolCalling}
          isFree={isFreeModel}
        />
      )}

      {/* Scroll to Bottom Button */}
      {showScrollBottom && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-6 right-6 p-2.5 bg-red-600 hover:bg-red-500 text-white rounded-full shadow-[0_0_18px_rgba(239,68,68,0.55)] border border-red-400 hover:scale-105 active:scale-95 transition-all z-20 flex items-center justify-center"
          title="Scroll to latest message"
          aria-label="Scroll to latest message"
        >
          <ArrowDown className="w-4 h-4 stroke-[2.5]" />
        </button>
      )}
    </div>
  );
};

export default ChatWindow;
