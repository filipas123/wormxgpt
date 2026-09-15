import React, { useState, Suspense, lazy, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  Copy, Check, Terminal, Brain, User, Sparkles, Wrench, ChevronDown, ChevronRight,
  CheckCircle2, AlertCircle, Clock, Loader2, Cpu, Zap, AlertTriangle, RefreshCw,
  ArrowRightLeft, Activity, Eye, Shield
} from 'lucide-react';
import { Message, AppSettings, ToolInvocation, GeneratedBy, RoutingEvent } from '../types';
import { InlineCode } from './CodeBlock';

const CodeBlock = lazy(() => import('./CodeBlock'));

interface ChatMessageProps {
  message: Message;
  settings: AppSettings;
  isGenerating?: boolean;
  activeToolCalling?: string | null;
  onRetry?: () => void;
}

// ── Streaming Cursor ─────────────────────────────────────────────────────────
const StreamingCursor: React.FC = () => (
  <span className="inline-block w-[2px] h-[14px] bg-red-500 ml-0.5 align-middle animate-[blink_0.9s_step-end_infinite] shadow-[0_0_8px_#ef4444]" />
);

// ── Generation Badge (Whitebox) ───────────────────────────────────────────────
const GenerationBadge: React.FC<{ generatedBy: GeneratedBy; isGenerating?: boolean }> = ({ generatedBy, isGenerating }) => {
  const isFree = generatedBy.isFree;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5 font-mono">
      {/* Model Name Badge */}
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-950/80 border border-red-600/60 text-[10px] text-red-200 shadow-[0_0_6px_rgba(239,68,68,0.2)]">
        <Cpu className="w-2.5 h-2.5 text-red-400" />
        {generatedBy.model}
      </span>

      {/* Provider Badge */}
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/80 border border-red-900/80 text-[10px] text-red-300">
        <Zap className="w-2.5 h-2.5 text-red-500" />
        {generatedBy.provider}
      </span>

      {/* Free Tier Badge */}
      {isFree && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-900/40 border border-red-500/40 text-[10px] text-red-200">
          <Sparkles className="w-2.5 h-2.5 text-red-400" />
          FREE
        </span>
      )}

      {/* Latency Badge */}
      {generatedBy.latencyMs !== undefined && !isGenerating && (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] border ${
          generatedBy.latencyMs < 1000
            ? 'bg-red-950/40 border-red-800/40 text-red-300'
            : generatedBy.latencyMs < 5000
            ? 'bg-amber-950/30 border-amber-600/30 text-amber-300'
            : 'bg-rose-950/40 border-rose-600/40 text-rose-300'
        }`}>
          <Clock className="w-2.5 h-2.5" />
          {generatedBy.latencyMs < 1000
            ? `${generatedBy.latencyMs}ms`
            : `${(generatedBy.latencyMs / 1000).toFixed(1)}s`}
        </span>
      )}

      {/* Token Count */}
      {generatedBy.outputTokens !== undefined && !isGenerating && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 border border-red-950 text-[10px] text-red-400/80">
          <Activity className="w-2.5 h-2.5 text-red-500" />
          {generatedBy.outputTokens.toLocaleString()} tok
        </span>
      )}

      {/* Fallback indicator */}
      {generatedBy.attemptedProviders && generatedBy.attemptedProviders.length > 1 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-950/40 border border-amber-500/40 text-[10px] text-amber-300" title={`Tried: ${generatedBy.attemptedProviders.join(' → ')}`}>
          <ArrowRightLeft className="w-2.5 h-2.5 text-amber-400" />
          fallback
        </span>
      )}

      {/* Streaming indicator */}
      {isGenerating && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-950/80 border border-red-500 text-[10px] text-red-200 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.3)]">
          <Loader2 className="w-2.5 h-2.5 animate-spin text-red-400" />
          streaming...
        </span>
      )}
    </div>
  );
};

// ── Routing Events Log (Whitebox) ─────────────────────────────────────────────
const RoutingLog: React.FC<{ events: RoutingEvent[] }> = ({ events }) => {
  const [isOpen, setIsOpen] = useState(false);
  if (!events || events.length === 0) return null;

  return (
    <div className="mt-2 text-[10px] font-mono">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-slate-500 hover:text-slate-400 transition-colors"
      >
        <ArrowRightLeft className="w-3 h-3" />
        <span>Provider routing log ({events.length} events)</span>
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {isOpen && (
        <div className="mt-1.5 space-y-1 pl-2 border-l border-slate-800">
          {events.map((evt, i) => (
            <div key={i} className={`flex items-center gap-2 ${
              evt.type === 'success' ? 'text-emerald-400' :
              evt.type === 'fallback' ? 'text-amber-400' :
              evt.type === 'failure' ? 'text-rose-400' : 'text-slate-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                evt.type === 'success' ? 'bg-emerald-400' :
                evt.type === 'fallback' ? 'bg-amber-400' :
                evt.type === 'failure' ? 'bg-rose-400' : 'bg-slate-500'
              }`} />
              <span>[{evt.type.toUpperCase()}]</span>
              <span className="text-slate-300">{evt.provider}</span>
              {evt.model && <span className="text-slate-500">→ {evt.model}</span>}
              {evt.latencyMs && <span className="text-slate-500">{evt.latencyMs}ms</span>}
              {evt.error && <span className="text-rose-400 truncate max-w-32" title={evt.error}>⚠ {evt.error.slice(0, 40)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Tool Invocation Card ───────────────────────────────────────────────────────
const ToolInvocationCard: React.FC<{ invocation: ToolInvocation; isActiveCall?: boolean }> = ({ invocation, isActiveCall }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [copiedRes, setCopiedRes] = useState(false);

  const handleCopyResult = async () => {
    try {
      const resStr = typeof invocation.result === 'string'
        ? invocation.result
        : JSON.stringify(invocation.result, null, 2);
      await navigator.clipboard.writeText(resStr);
      setCopiedRes(true);
      setTimeout(() => setCopiedRes(false), 2000);
    } catch {}
  };

  const isSuccess = invocation.state === 'result' && !invocation.result?.error;
  const isError = invocation.state === 'result' && invocation.result?.error;
  const latencyMs = invocation.latencyMs;

  return (
    <div className={`my-2.5 rounded-xl border overflow-hidden text-xs font-mono shadow-sm transition-all ${
      isActiveCall
        ? 'border-red-500 bg-red-950/40 shadow-[0_0_15px_rgba(239,68,68,0.3)]'
        : isError
        ? 'border-rose-600/60 bg-black/90'
        : 'border-red-900/70 bg-[#080204]'
    }`}>
      {/* Tool Header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-3 py-2 border-b flex items-center justify-between transition-colors text-left ${
          isActiveCall
            ? 'bg-red-950/60 border-red-500/50 hover:bg-red-900/40'
            : 'bg-black/90 border-red-950/80 hover:bg-red-950/30'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
            isActiveCall
              ? 'bg-red-600/30 border-red-500 text-red-300 shadow-[0_0_8px_rgba(239,68,68,0.4)]'
              : 'bg-red-950/60 border-red-800/60 text-red-400'
          }`}>
            <Wrench className="w-3 h-3" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-red-300">TOOL:</span>
            <strong className={`${isActiveCall ? 'text-red-200 drop-shadow-[0_0_6px_rgba(239,68,68,0.6)]' : 'text-red-300'} truncate font-mono`}>
              {invocation.toolName}
            </strong>
            <span className="text-red-600 text-[10px] font-mono">#{invocation.toolCallId?.slice(-6)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Latency */}
          {latencyMs !== undefined && (
            <span className="text-[10px] text-red-500 font-mono">{latencyMs}ms</span>
          )}

          {/* Status Badge */}
          {invocation.state === 'call' || isActiveCall ? (
            <span className="px-2 py-0.5 rounded-full bg-red-950/80 text-red-200 border border-red-500/60 text-[10px] flex items-center gap-1 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.3)]">
              <Loader2 className="w-3 h-3 animate-spin text-red-400" /> Executing...
            </span>
          ) : isError ? (
            <span className="px-2 py-0.5 rounded-full bg-rose-950/60 text-rose-300 border border-rose-600/50 text-[10px] flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Error
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-red-950/50 text-red-200 border border-red-600/50 text-[10px] flex items-center gap-1 font-semibold">
              <CheckCircle2 className="w-3 h-3 text-red-400" /> Done
            </span>
          )}
          {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-red-500" /> : <ChevronRight className="w-3.5 h-3.5 text-red-500" />}
        </div>
      </button>

      {/* Tool Body */}
      {isOpen && (
        <div className="p-3 space-y-2.5 bg-black/90">
          {/* Arguments */}
          {invocation.args && Object.keys(invocation.args).length > 0 && (
            <div>
              <div className="text-[10px] text-red-400/80 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1">
                <Eye className="w-3 h-3 text-red-500" /> Input Arguments:
              </div>
              <pre className="p-2 rounded-lg bg-[#050102] border border-red-950 text-[11px] text-red-200 overflow-x-auto custom-scrollbar font-mono">
                {JSON.stringify(invocation.args, null, 2)}
              </pre>
            </div>
          )}

          {/* Response / Output */}
          {invocation.state === 'result' && (
            <div>
              <div className="flex items-center justify-between text-[10px] text-red-400/80 font-semibold uppercase tracking-wider mb-1">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-red-500" /> Output Response:
                </span>
                <button
                  type="button"
                  onClick={handleCopyResult}
                  className="text-red-400 hover:text-red-200 lowercase text-[10px] flex items-center gap-1 font-mono"
                >
                  {copiedRes ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedRes ? 'copied' : 'copy'}</span>
                </button>
              </div>
              <pre className={`p-2.5 rounded-lg border text-[11px] overflow-x-auto max-h-72 custom-scrollbar whitespace-pre-wrap font-mono ${
                isError
                  ? 'bg-rose-950/20 border-rose-800/40 text-rose-300'
                  : 'bg-[#050102] border-red-950 text-red-200/90'
              }`}>
                {typeof invocation.result === 'string'
                  ? invocation.result
                  : JSON.stringify(invocation.result, null, 2)}
              </pre>
            </div>
          )}

          {/* Timestamps */}
          {(invocation.startedAt || invocation.completedAt) && (
            <div className="text-[10px] text-slate-600 font-mono flex gap-3">
              {invocation.startedAt && <span>Started: {new Date(invocation.startedAt).toISOString().slice(11, 23)}</span>}
              {invocation.completedAt && <span>Done: {new Date(invocation.completedAt).toISOString().slice(11, 23)}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Error Panel ────────────────────────────────────────────────────────────────
const ErrorPanel: React.FC<{ message: Message; onRetry?: () => void }> = ({ message, onRetry }) => {
  const [showRaw, setShowRaw] = useState(false);
  const errorType = message.errorType || 'unknown';

  const errorLabels: Record<string, { label: string; icon: React.ReactNode; hint: string }> = {
    api_key: { label: 'API Key Error', icon: <Shield className="w-4 h-4" />, hint: 'Check your API key in Settings → Provider Keys' },
    rate_limit: { label: 'Rate Limited', icon: <Clock className="w-4 h-4" />, hint: 'Too many requests — wait a moment or switch provider' },
    network: { label: 'Network Error', icon: <AlertTriangle className="w-4 h-4" />, hint: 'Check your internet connection and provider status' },
    context_overflow: { label: 'Context Too Long', icon: <Activity className="w-4 h-4" />, hint: 'Clear the conversation buffer or reduce context' },
    model_unavailable: { label: 'Model Unavailable', icon: <Cpu className="w-4 h-4" />, hint: 'Switch model in the model selector or enable auto-fallback' },
    unknown: { label: 'Generation Failed', icon: <AlertCircle className="w-4 h-4" />, hint: 'Enable auto-fallback or try a different model' },
  };

  const errInfo = errorLabels[errorType] || errorLabels.unknown;

  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 overflow-hidden">
      <div className="px-3 py-2 bg-rose-500/10 border-b border-rose-500/20 flex items-center justify-between">
        <div className="flex items-center gap-2 text-rose-300 text-xs font-semibold">
          {errInfo.icon}
          <span>{errInfo.label}</span>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 text-[11px] text-rose-400 hover:text-rose-200 border border-rose-500/30 hover:border-rose-400 px-2.5 py-1 rounded-lg transition-all"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        )}
      </div>
      <div className="p-3 space-y-2">
        <p className="text-xs text-rose-200/80">{errInfo.hint}</p>
        <div className="text-[10px] text-slate-500 font-mono">
          <button onClick={() => setShowRaw(!showRaw)} className="text-slate-600 hover:text-slate-400 flex items-center gap-1">
            <ChevronRight className={`w-3 h-3 transition-transform ${showRaw ? 'rotate-90' : ''}`} />
            {showRaw ? 'Hide' : 'Show'} raw error
          </button>
          {showRaw && (
            <pre className="mt-1.5 p-2 bg-slate-950 border border-slate-800 rounded-lg text-rose-400/70 text-[10px] overflow-x-auto whitespace-pre-wrap max-h-32">
              {message.errorRaw || message.content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main ChatMessage Component ────────────────────────────────────────────────
export const ChatMessage: React.FC<ChatMessageProps> = React.memo(({
  message, settings, isGenerating, activeToolCalling, onRetry
}) => {
  const isModel = message.role === 'model' || message.role === 'assistant';
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showThinking, setShowThinking] = useState(true);

  const showMetadata = settings.showGenerationMetadata !== false;
  const showRouting = settings.showRoutingEvents !== false;
  const showToolDetails = settings.showToolDetails !== false;

  const handleCopyMessage = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(message.content);
      } else {
        const ta = document.createElement('textarea');
        ta.value = message.content;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Classify error from content
  const isErrorMessage = message.isError || (
    message.content?.startsWith('CRITICAL_FAILURE:') ||
    message.content?.startsWith('[ERROR]')
  );

  const classifyError = (content: string) => {
    if (content.includes('401') || content.includes('api key') || content.includes('unauthorized')) return 'api_key';
    if (content.includes('429') || content.includes('rate limit')) return 'rate_limit';
    if (content.includes('context') && content.includes('length')) return 'context_overflow';
    if (content.includes('model') && (content.includes('not found') || content.includes('unavailable'))) return 'model_unavailable';
    if (content.includes('fetch') || content.includes('network') || content.includes('ECONNREFUSED')) return 'network';
    return 'unknown';
  };

  const errorType = message.errorType || (isErrorMessage ? classifyError(message.content?.toLowerCase() || '') : undefined);
  const cleanContent = isErrorMessage
    ? message.content?.replace(/^CRITICAL_FAILURE:\s*/, '') || ''
    : message.content;

  return (
    <div
      className={`flex flex-col ${isModel ? 'items-start' : 'items-end'} font-mono animate-in fade-in duration-200 select-text`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Sender Header */}
      <div className={`text-[11px] font-medium mb-1.5 flex items-center gap-1.5 ${isModel ? 'text-red-400' : 'text-red-300'} select-none font-mono`}>
        {isModel ? (
          <>
            <div className="w-5 h-5 rounded-md bg-red-950/80 border border-red-600/70 flex items-center justify-center text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.3)]">
              <Terminal className="w-3 h-3" />
            </div>
            <span className="font-bold text-red-200 tracking-wide">WORM_NODE</span>
            {/* Show actual model used, not current settings */}
            {message.generatedBy ? (
              <span className="text-[10px] text-red-400/80 font-mono">
                [{message.generatedBy.model} • {message.generatedBy.provider}]
              </span>
            ) : (
              <span className="text-[10px] text-red-600 font-mono">[{settings.model}]</span>
            )}
          </>
        ) : (
          <>
            <span className="font-bold text-red-300 tracking-wide">OPERATOR</span>
            <div className="w-5 h-5 rounded-md bg-black/90 border border-red-900 flex items-center justify-center text-red-400">
              <User className="w-3 h-3" />
            </div>
          </>
        )}
        {message.timestamp && (
          <span className="text-[10px] text-red-700 font-mono select-none">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Message Bubble */}
      <div
        className={`max-w-[92%] sm:max-w-[85%] p-4 sm:p-5 rounded-2xl relative transition-all duration-200 select-text cursor-text font-mono ${
          isModel
            ? 'bg-[#080204]/95 border border-red-950/90 shadow-[0_0_20px_rgba(239,68,68,0.12)] text-red-100'
            : 'bg-red-950/70 border border-red-600/70 text-red-100 shadow-[0_0_15px_rgba(239,68,68,0.25)]'
        }`}
      >
        {/* Floating Copy Button */}
        <button
          onClick={handleCopyMessage}
          className={`absolute top-3 right-3 p-1.5 rounded-lg transition-all z-10 ${
            isHovered ? 'opacity-100' : 'opacity-30 hover:opacity-100'
          } ${
            copied
              ? 'bg-red-600 text-white shadow-[0_0_10px_rgba(239,68,68,0.6)]'
              : 'bg-black/90 text-red-300 hover:text-white hover:bg-red-950 border border-red-900/60'
          }`}
          title={copied ? 'Copied to clipboard!' : 'Copy message text'}
        >
          {copied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
        </button>

        {/* Attached Images */}
        {message.images && message.images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {message.images.map((img, idx) => (
              <img
                key={idx}
                src={img}
                alt="Attachment"
                className="max-h-48 max-w-full rounded-lg object-contain border border-red-900/70 shadow-[0_0_10px_rgba(239,68,68,0.2)]"
              />
            ))}
          </div>
        )}

        {/* Reasoning / Thinking Trace */}
        {message.thinking && (
          <div className="mb-4 rounded-xl bg-[#050102] border border-red-900/60 text-xs text-red-200 overflow-hidden shadow-[0_0_10px_rgba(239,68,68,0.1)]">
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="w-full px-3.5 py-2 bg-red-950/50 border-b border-red-900/50 text-red-300 font-semibold flex items-center justify-between text-[11px] font-mono"
            >
              <div className="flex items-center gap-2">
                <Brain className="w-3.5 h-3.5 text-red-400" />
                <span className="font-bold tracking-wide">NEURAL_REASONING &amp; COG_CHAIN</span>
              </div>
              <span className="text-[10px] text-red-400/80 font-mono">
                {showThinking ? '[-] Collapse' : '[+] Expand'}
              </span>
            </button>
            {showThinking && (
              <div className="p-3 font-mono text-[11px] text-red-300/90 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto custom-scrollbar">
                {message.thinking}
              </div>
            )}
          </div>
        )}

        {/* Live Tool Invocations */}
        {showToolDetails && message.toolInvocations && message.toolInvocations.length > 0 && (
          <div className="mb-3 space-y-2">
            {message.toolInvocations.map((inv, idx) => (
              <ToolInvocationCard
                key={inv.toolCallId || idx}
                invocation={inv}
                isActiveCall={isGenerating && idx === message.toolInvocations!.length - 1 && inv.state === 'call'}
              />
            ))}
          </div>
        )}

        {/* Active Tool Calling Status */}
        {isModel && isGenerating && activeToolCalling && (
          <div className="mb-3 px-3 py-2 rounded-xl bg-red-950/80 border border-red-500/70 text-red-200 text-xs font-mono flex items-center justify-between shadow-[0_0_15px_rgba(239,68,68,0.3)]">
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400 shrink-0" />
              <span className="truncate">
                Executing tool: <strong className="text-red-200 font-bold drop-shadow-[0_0_6px_rgba(239,68,68,0.6)]">{activeToolCalling}</strong>
              </span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-red-600/30 border border-red-500 text-red-200 text-[10px] font-mono shrink-0 animate-pulse font-bold">
              EXEC_ACTIVE
            </span>
          </div>
        )}

        {/* Error Panel or Content */}
        {isModel && isErrorMessage ? (
          <ErrorPanel
            message={{ ...message, errorType: errorType as any }}
            onRetry={onRetry}
          />
        ) : isModel && isGenerating && !message.content ? (
          <div className="flex items-center gap-2.5 text-xs font-mono text-red-400 py-1">
            <Loader2 className="w-4 h-4 animate-spin text-red-500 shrink-0" />
            <span className="font-semibold tracking-wide animate-pulse">
              {message.generatedBy
                ? `Streaming via ${message.generatedBy.model}...`
                : 'Streaming response...'}
            </span>
          </div>
        ) : (
          <div className="markdown-content text-sm leading-relaxed selection:bg-red-600 selection:text-white">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                code({ node, className, children, ...props }: any) {
                  if (className?.includes('language-math')) {
                    return <code className={className} {...props}>{children}</code>;
                  }
                  const inline = (props as any).inline;
                  const isInline = inline || (!className && !String(children).includes('\n'));
                  if (isInline) {
                    return <InlineCode>{children}</InlineCode>;
                  }
                  return (
                    <Suspense fallback={<div className="p-3 bg-black border border-red-950 text-red-400 font-mono text-xs animate-pulse">Loading syntax highlighter...</div>}>
                      <CodeBlock className={className} settings={settings}>{children}</CodeBlock>
                    </Suspense>
                  );
                },
                pre({ children }) {
                  return <>{children}</>;
                }
              }}
            >
              {cleanContent}
            </ReactMarkdown>

            {/* Streaming cursor at end of content */}
            {isModel && isGenerating && message.content && (
              <StreamingCursor />
            )}

            {/* Streaming status bar */}
            {isModel && isGenerating && message.content && (
              <div className="mt-3 pt-2 border-t border-red-950/80 flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2 text-red-400 animate-pulse">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-red-500" />
                  <span className="font-medium">
                    {message.generatedBy ? `${message.generatedBy.model} streaming...` : 'Streaming...'}
                  </span>
                </div>
                {message.generatedBy?.isFree && (
                  <span className="text-red-400/80 text-[10px]">● FREE TIER</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Generation Metadata Badge (Whitebox) */}
        {isModel && message.generatedBy && showMetadata && !isGenerating && (
          <GenerationBadge generatedBy={message.generatedBy} isGenerating={isGenerating} />
        )}

        {/* Quick Message Actions Strip */}
        {message.content && !isGenerating && (
          <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-red-950/80 text-[11px] text-red-400/80 select-none font-mono">
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleCopyMessage}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/80 hover:bg-red-950/80 hover:text-white border border-red-900/70 transition-all font-mono text-[10px]"
                title="Copy entire response text"
              >
                {copied ? <Check className="w-3 h-3 text-red-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied!' : 'Copy Text'}</span>
              </button>
            </div>
            <span className="text-[10px] font-mono text-red-700">
              {message.content.length.toLocaleString()} chars
            </span>
          </div>
        )}
      </div>

      {/* Routing Events Log */}
      {isModel && message.routingEvents && showRouting && (
        <div className="mt-1 ml-1 max-w-[92%] sm:max-w-[85%]">
          <RoutingLog events={message.routingEvents} />
        </div>
      )}

      {/* Sources */}
      {message.sources && message.sources.length > 0 && (
        <div className="mt-2 max-w-[92%] sm:max-w-[85%] flex flex-wrap gap-1.5">
          {message.sources.map((src, i) => (
            <a
              key={i}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] px-2 py-1 rounded-lg bg-black/80 border border-red-900/70 text-red-400 hover:text-red-100 hover:border-red-500 transition-all font-mono truncate max-w-[200px]"
            >
              [{i + 1}] {src.title || src.url}
            </a>
          ))}
        </div>
      )}
    </div>
  );
});
