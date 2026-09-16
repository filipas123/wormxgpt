import React from 'react';
import { 
  Menu, Settings, Plus, Cpu, ChevronDown, Wrench, ShieldAlert, 
  Activity, ZapOff, ShieldCheck 
} from 'lucide-react';
import { useWormGPT } from '../context/GlobalContext';
import { countTokensForRequest } from '../utils/tokenManager';

export const Header: React.FC<{ 
  onNewSession: () => void;
  onOpenModelSelector: (mode?: 'text' | 'vision') => void;
  onToggleTelemetry?: () => void;
  isTelemetryOpen?: boolean;
  onOpenPanicModal?: () => void;
}> = ({ 
  onNewSession, 
  onOpenModelSelector,
  onToggleTelemetry,
  isTelemetryOpen = false,
  onOpenPanicModal
}) => {
  const { 
    isSidebarOpen, 
    setIsSidebarOpen, 
    activeSession, 
    settings, 
    setIsSettingsOpen,
    deviceDisplayId,
    activeArsenalToolIds,
    setIsArsenalOpen
  } = useWormGPT();

  const ctx = countTokensForRequest(activeSession.messages, settings.systemInstruction || '', settings.model);
  const pct = Math.min(ctx.pct, 1.0);
  const pctDisp = Math.round(pct * 100);
  const armedToolsCount = activeArsenalToolIds.length;

  return (
    <header 
      id="main-app-header"
      className="h-14 border-b border-red-900/60 bg-[#080204]/95 backdrop-blur-xl flex items-center px-3 sm:px-5 justify-between z-20 shrink-0 font-mono shadow-[0_4px_25px_rgba(239,68,68,0.18)]"
    >
      {/* Left controls: Sidebar toggle & Consolidated model router */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          className="p-2 rounded-lg text-red-400 hover:text-red-100 hover:bg-red-950/60 transition-colors border border-transparent hover:border-red-800/60"
          title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
        >
          <Menu className="w-4 h-4" />
        </button>

        {/* Sleek Model & Provider Trigger with Red Hacker Glow */}
        <button
          onClick={() => onOpenModelSelector('text')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-950/80 border border-red-900/80 hover:border-red-500 text-xs text-red-100 transition-all shrink-0 max-w-[220px] sm:max-w-[320px] hover:shadow-[0_0_15px_rgba(239,68,68,0.35)]"
          title="Switch Model or Provider"
        >
          <Cpu className="w-3.5 h-3.5 text-red-500 shrink-0 animate-pulse" />
          <span className="font-semibold text-red-100 truncate">{settings.model}</span>
          <span className="hidden sm:inline px-1.5 py-0.5 rounded text-[10px] uppercase font-mono bg-black/60 text-red-400 border border-red-900/60">
            {settings.aiProvider || 'auto'}
          </span>
          <ChevronDown className="w-3 h-3 text-red-500 ml-auto shrink-0" />
        </button>

        {/* Arsenal Tools Trigger */}
        <button
          onClick={() => setIsArsenalOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-950/30 hover:bg-red-900/40 border border-red-900/70 text-xs text-red-300 transition-all shrink-0 font-mono hover:border-red-600"
          title="Configure Armed MCP Tools & Arsenal"
        >
          <Wrench className="w-3.5 h-3.5 text-red-400" />
          <span className="hidden md:inline text-[11px] text-red-300">Tools</span>
          <span className="px-1.5 py-0.2 rounded-full bg-red-950 text-[10px] text-red-300 font-bold border border-red-600/60 shadow-[0_0_8px_rgba(239,68,68,0.4)]">
            {armedToolsCount}
          </span>
        </button>

        {/* System Override Warning Pill (if active) */}
        {settings.systemOverride && (
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-950/60 border border-red-500 text-red-200 text-[11px] font-mono font-medium hover:bg-red-900/60 transition-all shrink-0 shadow-[0_0_10px_rgba(239,68,68,0.4)]"
            title="System Override Active"
          >
            <ShieldAlert className="w-3 h-3 text-red-400 animate-pulse" />
            <span className="hidden lg:inline">OVERRIDE ACTIVE</span>
          </button>
        )}
      </div>

      {/* Right controls: Stream Telemetry, Context Gauge, Panic Purge, New Chat, Settings */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Real-Time Network Activity Stream Overlay Toggle */}
        <button
          onClick={onToggleTelemetry}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono transition-all border ${
            isTelemetryOpen 
              ? 'bg-red-950/80 border-red-500 text-red-200 shadow-[0_0_15px_rgba(239,68,68,0.45)]' 
              : 'bg-black/60 hover:bg-red-950/40 border-red-900/60 text-red-400 hover:text-red-200 hover:border-red-700'
          }`}
          title="Toggle Real-Time Network Activity Stream Overlay"
        >
          <Activity className={`w-3.5 h-3.5 ${isTelemetryOpen ? 'text-red-400 animate-pulse' : 'text-red-500'}`} />
          <span className="hidden sm:inline text-[11px] font-bold">Stream</span>
        </button>

        {/* Context Capacity Indicator */}
        <div 
          className="hidden xl:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-black/60 border border-red-900/60 text-[11px] text-red-400 font-mono"
          title={`Context window load: ${pctDisp}%`}
        >
          <span className="text-[10px] text-red-500">CTX</span>
          <div className="w-12 h-1.5 bg-black rounded-full overflow-hidden border border-red-950">
            <div 
              className={`h-full rounded-full transition-all duration-300 ${
                pct >= 0.8 ? 'bg-red-500 shadow-[0_0_8px_#ef4444]' : pct >= 0.5 ? 'bg-amber-400' : 'bg-red-600'
              }`}
              style={{ width: `${Math.max(pctDisp, 4)}%` }}
            />
          </div>
          <span className="text-[10px] text-red-300">{pctDisp}%</span>
        </div>

        {/* Device Fingerprint Tag */}
        <div 
          className="hidden 2xl:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/40 border border-red-900/40 text-[10px] text-red-400 font-mono cursor-default"
          title={`Isolated device node: ${deviceDisplayId}`}
        >
          <ShieldCheck className="w-3 h-3 text-red-500" />
          <span className="text-red-300">{deviceDisplayId}</span>
        </div>

        <div className="h-4 w-px bg-red-900/60 mx-0.5 hidden sm:block"></div>

        {/* Session Purge / Panic Rapid Shutdown Button */}
        <button
          onClick={onOpenPanicModal}
          aria-label="Rapid Session Purge"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-950/70 hover:bg-red-600 border-2 border-red-600 text-red-300 hover:text-white transition-all font-mono text-xs font-bold shadow-[0_0_15px_rgba(239,68,68,0.4)] group"
          title="Emergency Session Purge (Zero-Trace Wipe)"
        >
          <ZapOff className="w-3.5 h-3.5 shrink-0 text-red-400 group-hover:text-white animate-pulse" />
          <span className="hidden sm:inline tracking-wider">PANIC</span>
        </button>

        {/* New Session Button */}
        <button
          onClick={onNewSession}
          aria-label="New chat session"
          className="p-2 rounded-lg text-red-400 hover:text-red-100 hover:bg-red-950/60 border border-transparent hover:border-red-900/60 transition-colors"
          title="New Chat Session"
        >
          <Plus className="w-4 h-4" />
        </button>

        {/* Settings Button */}
        <button
          onClick={() => setIsSettingsOpen(true)}
          aria-label="Open settings"
          className="p-2 rounded-lg text-red-400 hover:text-red-100 hover:bg-red-950/60 border border-transparent hover:border-red-900/60 transition-colors"
          title="Open Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

export default Header;
