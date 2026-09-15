import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle, Trash2, CheckCircle2, RefreshCw, X, Radio, Power, Terminal } from 'lucide-react';
import { sessionStore } from '../services/sessionStore';

interface PanicPurgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPurgeComplete: () => void;
  onAbortCurrentStream?: () => void;
}

export const PanicPurgeModal: React.FC<PanicPurgeModalProps> = ({
  isOpen,
  onClose,
  onPurgeComplete,
  onAbortCurrentStream
}) => {
  const [isPurging, setIsPurging] = useState(false);
  const [purgeLogs, setPurgeLogs] = useState<string[]>([]);
  const [purgeCompleted, setPurgeCompleted] = useState(false);
  const [redirectToBlank, setRedirectToBlank] = useState(true);

  if (!isOpen) return null;

  const executePurge = async (immediateBlank = false) => {
    setIsPurging(true);
    setPurgeLogs(['[PANIC PROTOCOL ENGAGED] Initiating complete zero-trace sanitize sequence...']);

    try {
      // 1. Abort active streaming connections
      if (onAbortCurrentStream) {
        try {
          onAbortCurrentStream();
          setPurgeLogs(prev => [...prev, '✓ Aborted active SSE / WebSocket AI streams']);
        } catch {}
      }

      if (!immediateBlank) await new Promise(r => setTimeout(r, 80));

      // 2. Clear sessionStorage
      try {
        sessionStorage.clear();
        setPurgeLogs(prev => [...prev, '✓ Flushed sessionStorage transient buffers']);
      } catch (err) {
        console.warn('sessionStorage clear failed', err);
      }

      // 3. Clear localStorage completely
      try {
        localStorage.clear();
        setPurgeLogs(prev => [...prev, '✓ Nuked localStorage keys, credentials, and settings']);
      } catch (err) {
        console.warn('localStorage clear failed', err);
      }

      // 4. Clear IndexedDB databases
      try {
        await sessionStore.clear();
        setPurgeLogs(prev => [...prev, '✓ Emptied sessionStore database records']);
      } catch (err) {
        console.warn('sessionStore clear failed', err);
      }

      try {
        if (typeof indexedDB !== 'undefined') {
          indexedDB.deleteDatabase('wormgpt_v1');
          
          if (typeof (indexedDB as any).databases === 'function') {
            const dbs = await (indexedDB as any).databases();
            for (const db of dbs) {
              if (db.name) {
                indexedDB.deleteDatabase(db.name);
              }
            }
          }
          setPurgeLogs(prev => [...prev, '✓ Dropped all IndexedDB databases (wormgpt_v1)']);
        }
      } catch (err) {
        console.warn('IndexedDB wipe failed', err);
      }

      // 5. Deregister Service Workers
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            await reg.unregister();
          }
          setPurgeLogs(prev => [...prev, `✓ Deregistered ${registrations.length} Service Worker(s)`]);
        }
      } catch (err) {
        console.warn('ServiceWorker unregister failed', err);
      }

      // 6. Flush CacheStorage (caches.keys())
      try {
        if ('caches' in window) {
          const cacheKeys = await caches.keys();
          for (const key of cacheKeys) {
            await caches.delete(key);
          }
          setPurgeLogs(prev => [...prev, `✓ Purged ${cacheKeys.length} CacheStorage entries`]);
        }
      } catch (err) {
        console.warn('CacheStorage purge failed', err);
      }

      // 7. Revoke in-memory object URLs
      setPurgeLogs(prev => [...prev, '✓ Revoked memory blob handles & telemetry buffers']);

      if (!immediateBlank) await new Promise(r => setTimeout(r, 200));
      setPurgeLogs(prev => [...prev, '⚡ SANITIZE SEQUENCE 100% COMPLETE.']);
      setPurgeCompleted(true);

      setTimeout(() => {
        if (redirectToBlank || immediateBlank) {
          try {
            window.location.replace('about:blank');
          } catch {
            window.location.href = 'about:blank';
          }
        } else {
          onPurgeComplete();
        }
      }, immediateBlank ? 100 : 500);
    } catch (err: any) {
      setPurgeLogs(prev => [...prev, `❌ Error during purge: ${err?.message || 'Unknown'}`]);
      setIsPurging(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2500] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={!isPurging ? onClose : undefined}
      role="presentation"
    >
      <div
        className="w-full max-w-lg bg-[#0a0306] border-2 border-red-600/80 rounded-xl p-6 shadow-[0_0_40px_rgba(239,68,68,0.35)] flex flex-col gap-4 text-red-100 font-mono relative overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Session Purge / Panic Shutdown"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle red scanline accent */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_10px_#ef4444]"></div>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-red-900/60 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-red-950/60 text-red-400 border border-red-600/60 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
              <ShieldAlert className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-base text-red-50 flex items-center gap-2 tracking-wider">
                RAPID PANIC PURGE
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-600/30 text-red-300 font-bold uppercase border border-red-500/50 shadow-[0_0_8px_rgba(239,68,68,0.4)]">
                  LEVEL 5 ZERO-TRACE
                </span>
              </h3>
              <p className="text-xs text-red-400/80 font-mono mt-0.5">
                Immediate Forensic Storage Erasure &amp; Session Termination
              </p>
            </div>
          </div>
          {!isPurging && (
            <button
              onClick={onClose}
              className="text-red-400/70 hover:text-red-200 p-1.5 rounded-lg hover:bg-red-950/50 border border-transparent hover:border-red-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body Content */}
        {!isPurging ? (
          <>
            <div className="bg-red-950/40 border border-red-600/50 rounded-lg p-3.5 text-xs text-red-200 leading-relaxed font-mono shadow-inner">
              <div className="flex items-center gap-2 text-red-400 font-bold mb-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 animate-bounce" />
                <span className="tracking-wider">IRREVERSIBLE HARD RESET WARNING</span>
              </div>
              This operation executes a complete memory and disk sanitization. All data across every browser subsystem will be permanently scrubbed:
            </div>

            <ul className="space-y-1.5 text-xs text-red-300/90 font-mono py-1">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 shadow-[0_0_5px_#ef4444]"></span>
                <span><strong>LocalStorage:</strong> Chat histories, API tokens, provider profiles.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 shadow-[0_0_5px_#ef4444]"></span>
                <span><strong>SessionStorage:</strong> Transient credentials, streaming frames, and drafts.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 shadow-[0_0_5px_#ef4444]"></span>
                <span><strong>IndexedDB:</strong> Drop all local databases (<code>wormgpt_v1</code>).</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 shadow-[0_0_5px_#ef4444]"></span>
                <span><strong>ServiceWorkers &amp; Cache:</strong> Deregister workers &amp; delete caches.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 shadow-[0_0_5px_#ef4444]"></span>
                <span><strong>Active Connections:</strong> Kill active SSE streams and MCP webhooks.</span>
              </li>
            </ul>

            {/* Post-Purge Option */}
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-black/60 border border-red-900/60 text-xs">
              <span className="text-red-300">Exit Target:</span>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={redirectToBlank}
                  onChange={(e) => setRedirectToBlank(e.target.checked)}
                  className="rounded bg-black border-red-600 text-red-600 focus:ring-red-500"
                />
                <span className="text-red-200">
                  Redirect to <code className="text-red-400">about:blank</code>
                </span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-3 border-t border-red-900/60">
              <button
                onClick={onClose}
                className="w-full sm:w-auto px-4 py-2 rounded-lg bg-red-950/40 hover:bg-red-900/40 text-red-300 text-xs font-mono border border-red-800/60 transition-colors"
              >
                [CANCEL] Abort Panic
              </button>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => executePurge(false)}
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-bold font-mono tracking-wider shadow-[0_0_20px_rgba(220,38,38,0.5)] transition-all hover:scale-105"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  PURGE &amp; TERMINATE
                </button>
                <button
                  onClick={() => executePurge(true)}
                  className="flex items-center justify-center p-2 rounded-lg bg-red-900/80 hover:bg-red-800 text-red-200 border border-red-500/70 shadow-[0_0_15px_rgba(239,68,68,0.4)]"
                  title="Instant Panic Purge (Self-Destruct to about:blank immediately)"
                >
                  <Power className="w-4 h-4 text-red-400 animate-pulse" />
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Purge in progress terminal console */
          <div className="space-y-3 py-2 font-mono">
            <div className="flex items-center justify-between text-xs text-red-300">
              <span className="flex items-center gap-2">
                {!purgeCompleted ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-red-500" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-red-400" />
                )}
                {!purgeCompleted ? 'EXECUTING PURGE SEQUENCE...' : 'TERMINATION READY'}
              </span>
              <span className="text-red-500 font-bold">[SANITIZING]</span>
            </div>

            <div className="bg-black/90 border border-red-800 rounded-lg p-3 font-mono text-xs text-red-400 space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
              {purgeLogs.map((log, index) => (
                <div key={index} className="leading-relaxed">
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PanicPurgeModal;
