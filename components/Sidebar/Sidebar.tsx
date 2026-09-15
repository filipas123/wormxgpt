import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Settings, Download, Trash2, ChevronLeft, ChevronRight, 
  MessageSquare, Search, Terminal, ShieldAlert, ZapOff
} from 'lucide-react';
import { useWormGPT } from '../../context/GlobalContext';

export interface SidebarProps {
  sessions?: Array<{ id: string; title: string; updatedAt?: number; messages?: any[] }>;
  activeSessionId?: string;
  onSelectSession?: (id: string) => void;
  onNewSession?: () => void;
  onDeleteSession?: (id: string) => void;
  onClear?: () => void;
  onHardReset?: () => void;
  onPanicPurge?: () => void;
  onExport?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions: propSessions,
  activeSessionId: propActiveSessionId,
  onSelectSession,
  onNewSession: propOnNewSession,
  onDeleteSession,
  onClear,
  onHardReset,
  onPanicPurge,
  onExport
}) => {
  // Track viewport to switch between overlay drawer (mobile) and push layout (desktop)
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  useEffect(() => {
    const checkViewport = () => setIsMobile(window.innerWidth < 640);
    checkViewport();
    window.addEventListener('resize', checkViewport);
    return () => window.removeEventListener('resize', checkViewport);
  }, []);
  const { 
    sessions: ctxSessions, 
    activeSessionId: ctxActiveSessionId, 
    setActiveSessionId: ctxSetActiveSessionId, 
    isSidebarOpen, 
    setIsSidebarOpen,
    setIsSettingsOpen,
    settings
  } = useWormGPT();
  
  const rawSessions = propSessions || ctxSessions;
  const currentActiveId = propActiveSessionId || ctxActiveSessionId;
  const handleSelect = onSelectSession || ctxSetActiveSessionId;

  const [searchTerm, setSearchTerm] = useState('');
  // Pending delete confirmation: which session id is awaiting confirmation
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Normalize sessions with valid updatedAt
  const normalizedSessions = useMemo(() => {
    return rawSessions.map(s => {
      let ts = s.updatedAt;
      if (!ts && s.messages && s.messages.length > 0) {
        ts = s.messages[s.messages.length - 1].timestamp;
      }
      return {
        ...s,
        updatedAt: ts || Date.now()
      };
    });
  }, [rawSessions]);

  // Filter sessions by title keywords or creation/update timestamp
  const filteredSessions = useMemo(() => {
    if (!searchTerm.trim()) return normalizedSessions;
    const query = searchTerm.toLowerCase();
    return normalizedSessions.filter((s) => {
      const titleMatch = (s.title || '').toLowerCase().includes(query);
      const dateStr = new Date(s.updatedAt).toLocaleDateString().toLowerCase();
      const dateMatch = dateStr.includes(query);
      return titleMatch || dateMatch;
    });
  }, [normalizedSessions, searchTerm]);

  const handleNew = () => {
    if (propOnNewSession) {
      propOnNewSession();
    }
    // Close the drawer after creating a session on mobile so the chat is visible
    if (isMobile) setIsSidebarOpen(false);
  };

  const handleSelectSession = (id: string) => {
    handleSelect(id);
    // Close the drawer after selecting a session on mobile so the chat is visible
    if (isMobile) setIsSidebarOpen(false);
  };  return (
    <>
      {/* Mobile backdrop: tap to close the overlay drawer */}
      {isMobile && isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm sm:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
      aria-label="Session list sidebar"
      className={`fixed inset-y-0 left-0 z-50 bg-[#080204]/95 backdrop-blur-xl border-r border-red-950/80 flex flex-col transition-all duration-300 ease-in-out ${
        isSidebarOpen ? 'w-64 sm:w-72' : 'w-16'
      } shadow-[5px_0_30px_rgba(239,68,68,0.15)] font-mono select-none`}
    >
      {/* Brand Header */}
      <div className="p-3.5 border-b border-red-950/80 flex items-center justify-between h-16 shrink-0 bg-black/80">
        {isSidebarOpen ? (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-red-950/60 border border-red-600/60 flex items-center justify-center text-red-500 shadow-[0_0_12px_rgba(239,68,68,0.4)] shrink-0">
              <Terminal className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xs font-mono font-bold tracking-tight text-red-100 truncate drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]">WormGPT Terminal</h1>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_6px_#ef4444]"></span>
                <span className="text-[10px] text-red-400/80 font-mono">v4.7 RED_HARNESS</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full flex justify-center">
            <div className="w-8 h-8 rounded-lg bg-red-950/60 border border-red-600/60 flex items-center justify-center text-red-500 shadow-[0_0_12px_rgba(239,68,68,0.4)]">
              <Terminal className="w-4 h-4" />
            </div>
          </div>
        )}

        {/* Toggle Collapse Button */}
        {isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="p-1.5 rounded-lg text-red-400 hover:text-red-100 hover:bg-red-950/60 border border-transparent hover:border-red-900/60 transition-colors"
            title="Collapse Sidebar"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Action Header: + NEW SESSION & Search Filter */}
      <div className="p-3 border-b border-red-950/70 space-y-2 shrink-0">
        <button
          onClick={handleNew}
          className={`w-full py-2 px-3 text-xs font-mono font-bold tracking-wider rounded-lg bg-red-600 hover:bg-red-500 text-white transition-all shadow-[0_0_18px_rgba(239,68,68,0.45)] border border-red-400 flex items-center justify-center gap-2 ${
            !isSidebarOpen ? 'px-0' : ''
          }`}
          title="New Session"
        >
          <Plus className="w-4 h-4 shrink-0 stroke-[2.5]" />
          {isSidebarOpen && <span>+ NEW SESSION</span>}
        </button>

        {isSidebarOpen && (
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search sessions..."
              className="w-full bg-black/80 border border-red-950/80 rounded-md px-2.5 py-1.5 text-xs text-red-100 placeholder-red-800/80 focus:outline-none focus:border-red-500 focus:shadow-[0_0_10px_rgba(239,68,68,0.35)] font-mono"
            />
            {searchTerm ? (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1.5 text-red-400 hover:text-red-200 text-xs font-mono px-1"
                title="Clear filter"
              >
                ×
              </button>
            ) : (
              <Search className="w-3 h-3 text-red-700 absolute right-2.5 top-2.5 pointer-events-none" />
            )}
          </div>
        )}
      </div>

      {/* System Override status indicator in sidebar */}
      {isSidebarOpen && settings.systemOverride && (
        <div className="mx-3 my-1.5 p-2 rounded-lg bg-red-950/50 border border-red-500/50 flex items-center gap-2 text-red-300 text-[11px] font-medium shrink-0 shadow-[0_0_10px_rgba(239,68,68,0.25)]">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-red-400 animate-pulse" />
          <span className="truncate font-semibold tracking-wide">System Override Active</span>
        </div>
      )}

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
        {filteredSessions.length === 0 ? (
          isSidebarOpen ? (
            <p className="text-[11px] font-mono text-zinc-500 text-center py-6">
              No matching sessions found
            </p>
          ) : null
        ) : (
          filteredSessions.map((session) => {
            const isActive = session.id === currentActiveId;
            return (
              <div
                key={session.id}
                onClick={() => handleSelectSession(session.id)}
                className={`group relative w-full text-left p-2 rounded-md transition-all text-xs font-mono flex items-center gap-2 cursor-pointer ${
                  isActive
                    ? 'bg-red-950/70 text-red-100 border border-red-600/70 shadow-[0_0_12px_rgba(239,68,68,0.3)]'
                    : 'text-red-400/80 hover:bg-red-950/40 hover:text-red-100 border border-transparent hover:border-red-900/50'
                }`}
                title={session.title}
              >
                <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-red-400' : 'text-red-700'}`} />

                {isSidebarOpen && (
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="truncate font-medium text-xs">
                      {session.title || 'Untitled Session'}
                    </span>
                    <span className="text-[10px] text-red-700">
                      {new Date(session.updatedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                )}

                {isSidebarOpen && onDeleteSession && (
                  pendingDeleteId === session.id ? (
                    // Inline confirm: replaces the trash icon for 5s or until decided
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingDeleteId(null);
                          onDeleteSession(session.id);
                        }}
                        aria-label="Confirm delete session"
                        className="px-1.5 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold transition-colors shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                        title="Confirm delete"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(null)}
                        aria-label="Cancel delete"
                        className="px-1.5 py-0.5 rounded bg-black border border-red-900 text-red-300 text-[10px] font-bold transition-colors"
                        title="Cancel"
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDeleteId(session.id);
                        // Auto-cancel after 5 seconds of inaction
                        setTimeout(() => {
                          setPendingDeleteId(prev => prev === session.id ? null : prev);
                        }, 5000);
                      }}
                      aria-label={`Delete session: ${session.title || 'Untitled'}`}
                      className="opacity-0 group-hover:opacity-100 p-1 text-red-600 hover:text-red-400 rounded transition-all shrink-0"
                      title="Delete Session"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Controls */}
      <div className="p-3 border-t border-red-950/70 bg-black/80 space-y-1 shrink-0 font-mono text-xs">
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="w-full flex justify-center p-2 rounded-lg text-red-400 hover:text-red-100 hover:bg-red-950/60 transition-colors"
            title="Expand Sidebar"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {onExport && (
          <button
            onClick={onExport}
            className={`w-full flex items-center gap-2 p-2 rounded-md text-red-400 hover:text-red-100 hover:bg-red-950/40 border border-transparent hover:border-red-900/50 transition-colors ${
              !isSidebarOpen ? 'justify-center' : ''
            }`}
            title="Export Conversation Logs"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            {isSidebarOpen && <span>Export Logs</span>}
          </button>
        )}

        {onClear && (
          <button
            onClick={onClear}
            className={`w-full flex items-center gap-2 p-2 rounded-md text-red-400 hover:text-red-100 hover:bg-red-950/40 border border-transparent hover:border-red-900/50 transition-colors ${
              !isSidebarOpen ? 'justify-center' : ''
            }`}
            title="Clear Current Chat"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0 text-red-500" />
            {isSidebarOpen && <span>Clear Chat</span>}
          </button>
        )}

        {onPanicPurge && (
          <button
            onClick={onPanicPurge}
            className={`w-full flex items-center gap-2 p-2 rounded-md bg-red-950/60 border border-red-600/70 text-red-200 hover:bg-red-900/70 hover:text-white shadow-[0_0_12px_rgba(239,68,68,0.35)] transition-all ${
              !isSidebarOpen ? 'justify-center' : ''
            }`}
            title="Emergency Panic Purge (Zero-Trace Wipe)"
          >
            <ZapOff className="w-3.5 h-3.5 shrink-0 text-red-400 animate-pulse" />
            {isSidebarOpen && <span className="font-bold tracking-wider text-red-100">PANIC PURGE</span>}
          </button>
        )}

        <button
          onClick={() => setIsSettingsOpen(true)}
          className={`w-full flex items-center gap-2 p-2 rounded-md text-red-400 hover:text-red-100 hover:bg-red-950/40 border border-transparent hover:border-red-900/50 transition-colors ${
            !isSidebarOpen ? 'justify-center' : ''
          }`}
          title="Console & System Settings"
        >
          <Settings className="w-3.5 h-3.5 shrink-0" />
          {isSidebarOpen && <span>Settings & Harness</span>}
        </button>
      </div>
    </aside>
    </>
  );
};

export default Sidebar;
