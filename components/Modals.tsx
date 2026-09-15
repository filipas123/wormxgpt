import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, X, Copy, Download, Upload, Info, Terminal } from 'lucide-react';
import { ChatSession } from '../types';

export interface ToastNotification {
  id: string;
  message: string;
  type?: 'success' | 'error' | 'info' | 'warning';
}

/** Shared hook: close on Escape + lock background scroll while a modal is open */
const useModalBehavior = (isOpen: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);
};

export const ConfirmModal: React.FC<{
  isOpen: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  isOpen,
  title = 'Confirmation Required',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDanger = false,
  onConfirm,
  onCancel,
}) => {
  useModalBehavior(isOpen, onCancel);
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-md bg-[#080204] border border-red-700/80 rounded-xl p-6 shadow-[0_0_30px_rgba(239,68,68,0.3)] shadow-black/90 flex flex-col gap-4 text-red-100 font-mono"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-lg ${isDanger ? 'bg-rose-950/80 text-rose-400 border border-rose-600/60 shadow-[0_0_10px_rgba(244,63,94,0.3)]' : 'bg-red-950/80 text-red-400 border border-red-600/60 shadow-[0_0_10px_rgba(239,68,68,0.3)]'}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-red-100">{title}</h3>
            <p className="text-xs text-red-400/70 mt-0.5 font-mono">WormGPT Security & Harness Control</p>
          </div>
        </div>

        <p className="text-sm text-red-200/90 leading-relaxed font-mono py-1">
          {message}
        </p>

        <div className="flex justify-end gap-2.5 pt-2 font-mono">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-[#0d0205] hover:bg-red-950/70 text-red-300 text-xs font-medium border border-red-900/80 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-xs font-semibold shadow-md transition-all ${
              isDanger
                ? 'bg-rose-700 hover:bg-rose-600 text-white shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                : 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const AlertModal: React.FC<{
  isOpen: boolean;
  title?: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  onClose: () => void;
}> = ({ isOpen, title = 'Notification', message, type = 'info', onClose }) => {
  useModalBehavior(isOpen, onClose);
  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
      case 'error':
        return <AlertTriangle className="w-5 h-5 text-rose-400" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-400" />;
      default:
        return <Info className="w-5 h-5 text-indigo-400" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md bg-[#080204] border border-red-700/80 rounded-xl p-6 shadow-[0_0_30px_rgba(239,68,68,0.3)] shadow-black/90 flex flex-col gap-4 text-red-100 font-mono"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#0d0205] border border-red-900/80 shadow-[0_0_10px_rgba(239,68,68,0.2)]">
              {getIcon()}
            </div>
            <h3 className="font-semibold text-base text-red-100 font-mono">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-red-400/80 hover:text-red-100 hover:bg-red-950/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-red-200/90 leading-relaxed py-1 font-mono">
          {message}
        </p>

        <div className="flex justify-end pt-2 font-mono">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-all shadow-[0_0_15px_rgba(239,68,68,0.4)]"
          >
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
};

export const ExportImportModal: React.FC<{
  isOpen: boolean;
  sessions: ChatSession[];
  onClose: () => void;
  onImport: (sessions: ChatSession[]) => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}> = ({ isOpen, sessions, onClose, onImport, onToast }) => {
  const [importJson, setImportJson] = useState('');
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [copied, setCopied] = useState(false);

  useModalBehavior(isOpen, onClose);

  if (!isOpen) return null;

  const exportData = JSON.stringify(sessions, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportData);
      setCopied(true);
      onToast('Session logs copied to clipboard', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onToast('Failed to copy to clipboard', 'error');
    }
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([exportData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wormxgpt_sessions_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onToast('Session logs exported as JSON file', 'success');
    } catch {
      onToast('Failed to export session logs', 'error');
    }
  };

  const handleImportSubmit = () => {
    try {
      if (!importJson.trim()) {
        onToast('Please paste valid JSON logs', 'error');
        return;
      }
      const parsed = JSON.parse(importJson);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id) {
        onImport(parsed);
        onToast(`Successfully restored ${parsed.length} chat sessions`, 'success');
        onClose();
      } else {
        onToast('Invalid session format: expected array of chat sessions', 'error');
      }
    } catch {
      onToast('JSON parse error: check syntax of pasted logs', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-xl bg-[#080204] border border-red-700/80 rounded-xl p-6 shadow-[0_0_35px_rgba(239,68,68,0.3)] shadow-black/90 flex flex-col gap-4 text-red-100 font-mono"
        role="dialog"
        aria-modal="true"
        aria-label="Conversation Data Hub"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-red-950/80 pb-3">
          <div className="flex items-center gap-2.5">
            <Terminal className="w-5 h-5 text-red-400" />
            <h3 className="font-semibold text-base text-red-100 font-mono">Conversation Data Hub</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-red-400/80 hover:text-red-100 hover:bg-red-950/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-2 p-1 bg-[#050102] rounded-lg border border-red-950/80">
          <button
            onClick={() => setActiveTab('export')}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-2 font-mono ${
              activeTab === 'export'
                ? 'bg-red-600 text-white shadow-[0_0_10px_rgba(239,68,68,0.4)]'
                : 'text-red-400/70 hover:text-red-200'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            Export Logs ({sessions.length})
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-2 font-mono ${
              activeTab === 'import'
                ? 'bg-red-600 text-white shadow-[0_0_10px_rgba(239,68,68,0.4)]'
                : 'text-red-400/70 hover:text-red-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            Import Logs
          </button>
        </div>

        {activeTab === 'export' ? (
          <div className="flex flex-col gap-3 font-mono">
            <p className="text-xs text-red-300">
              Export all stored threads, message histories, and reasoning traces in portable JSON format:
            </p>
            <div className="relative">
              <pre className="p-3 bg-[#050102] border border-red-950/90 rounded-lg text-[11px] font-mono text-red-200 max-h-48 overflow-y-auto custom-scrollbar">
                {exportData}
              </pre>
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={handleCopy}
                className="px-4 py-2 rounded-lg bg-[#0d0205] hover:bg-red-950/80 text-red-200 text-xs font-medium border border-red-900/80 flex items-center gap-1.5 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
              <button
                onClick={handleDownload}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-[0_0_15px_rgba(239,68,68,0.4)]"
              >
                <Download className="w-3.5 h-3.5" />
                Download JSON
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 font-mono">
            <p className="text-xs text-red-300">
              Paste exported JSON session array below to restore threads:
            </p>
            <textarea
              value={importJson}
              onChange={e => setImportJson(e.target.value)}
              placeholder='[ { "id": "...", "title": "...", "messages": [...] } ]'
              rows={6}
              className="w-full p-3 bg-[#050102] border border-red-950/90 rounded-lg text-[11px] font-mono text-red-100 placeholder-red-800/60 focus:outline-none focus:border-red-500 focus:shadow-[0_0_12px_rgba(239,68,68,0.4)] transition-colors resize-none"
            />
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-[#0d0205] hover:bg-red-950/70 text-red-300 text-xs font-medium border border-red-900/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-[0_0_15px_rgba(239,68,68,0.4)]"
              >
                <Upload className="w-3.5 h-3.5" />
                Restore Sessions
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const Toast: React.FC<{
  message: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  isVisible: boolean;
  onClose: () => void;
}> = ({ message, type = 'success', isVisible, onClose }) => {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(onClose, 3000);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  const getTheme = () => {
    switch (type) {
      case 'error':
        return 'border-rose-600/70 bg-[#140205] text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.4)]';
      case 'warning':
        return 'border-amber-600/70 bg-[#140a02] text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.4)]';
      case 'info':
        return 'border-red-600/70 bg-[#0e0205] text-red-200 shadow-[0_0_15px_rgba(239,68,68,0.4)]';
      default:
        return 'border-emerald-600/70 bg-[#03140a] text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.4)]';
    }
  };

  return (
    <div className="fixed top-4 right-4 z-[2100] animate-in slide-in-from-top-2 fade-in duration-200 font-mono">
      <div className={`border rounded-lg px-4 py-3 shadow-xl backdrop-blur-md flex items-center gap-3 text-xs font-medium ${getTheme()}`}>
        {type === 'error' ? (
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
        ) : type === 'warning' ? (
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        ) : type === 'info' ? (
          <Info className="w-4 h-4 text-red-400 shrink-0" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        )}
        <span>{message}</span>
        <button
          onClick={onClose}
          className="ml-2 opacity-60 hover:opacity-100 p-0.5 text-red-300"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
