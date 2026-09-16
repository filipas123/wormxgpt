import React, { useState, useEffect, Suspense, lazy } from 'react';
import { WormGPTProvider, useWormGPT } from './context/GlobalContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatWindow } from './components/ChatWindow';
import { InputBar } from './components/InputBar';
import { ConfirmModal, ExportImportModal, Toast } from './components/Modals';

// Heavy panels are split out of the initial bundle and loaded the first time the
// operator opens them, then kept mounted so their tab/filter state survives.
const SettingsModal = lazy(() =>
  import('./components/SettingsModal/SettingsModal').then(m => ({ default: m.SettingsModal }))
);
const ModelSelectorModal = lazy(() =>
  import('./components/ModelSelectorModal').then(m => ({ default: m.ModelSelectorModal }))
);
const ActiveArsenalModal = lazy(() =>
  import('./components/ActiveArsenalModal').then(m => ({ default: m.ActiveArsenalModal }))
);
import { NetworkTelemetryOverlay } from './components/NetworkTelemetryOverlay';
import { PanicPurgeModal } from './components/PanicPurgeModal';
import { SETTINGS_KEY, SESSIONS_KEY } from './constants';

const WormGPTApp: React.FC = () => {
  const { 
    isSidebarOpen, setIsSidebarOpen,
    isSettingsOpen, setIsSettingsOpen,
    isArsenalOpen, setIsArsenalOpen,
    activeSession, sessions, setSessions,
    settings, setSettings,
    activeSessionId, setActiveSessionId,
    clearSessionBuffer, deleteSession, purgeAllSessions,
    handleAbort
  } = useWormGPT();

  // Custom Modal States (Replacing all window.alert and window.confirm)
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [modelSelectorTarget, setModelSelectorTarget] = useState<'text' | 'vision'>('text');
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isTelemetryOpen, setIsTelemetryOpen] = useState(false);
  const [isPanicPurgeOpen, setIsPanicPurgeOpen] = useState(false);
  
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  // Lazy panels mount on first open and stay mounted afterwards.
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [modelSelectorMounted, setModelSelectorMounted] = useState(false);
  const [arsenalMounted, setArsenalMounted] = useState(false);

  useEffect(() => { if (isSettingsOpen) setSettingsMounted(true); }, [isSettingsOpen]);
  useEffect(() => { if (isModelSelectorOpen) setModelSelectorMounted(true); }, [isModelSelectorOpen]);
  useEffect(() => { if (isArsenalOpen) setArsenalMounted(true); }, [isArsenalOpen]);

  const [toast, setToast] = useState<{ visible: boolean; message: string; type?: 'success' | 'error' | 'info' | 'warning' }>({ 
    visible: false, 
    message: '' 
  });

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') => {
    setToast({ visible: true, message, type });
  };

  const handleNewSession = () => {
    const newSession = { 
      id: crypto.randomUUID(), 
      messages: [], 
      title: 'New Session', 
      timestamp: Date.now() 
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    showToast('New session created', 'info');
  };

  const handleOpenModelSelector = (mode: 'text' | 'vision' = 'text') => {
    setModelSelectorTarget(mode);
    setIsModelSelectorOpen(true);
  };

  const handleExecuteClear = () => {
    clearSessionBuffer(activeSession.id);
    setConfirmClearOpen(false);
    showToast('Conversation buffer purged & network streams disposed', 'info');
  };

  const handleExecuteReset = async () => {
    await purgeAllSessions();
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(SESSIONS_KEY);
    setConfirmResetOpen(false);
    showToast('Zero-trace purge complete. Resetting terminal...', 'warning');
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const handleImportSessions = (imported: typeof sessions) => {
    setSessions(imported);
    if (imported.length > 0) {
      setActiveSessionId(imported[0].id);
    }
  };

  return (
    <div className="flex h-screen bg-[#050102] text-red-100 font-mono overflow-hidden relative">
      {/* Subtle CRT scanline overlay */}
      <div className="absolute inset-0 crt-grid-overlay pointer-events-none z-30 opacity-40"></div>

      {/* Collapsible Sidebar */}
      <Sidebar 
        onNewSession={handleNewSession}
        onDeleteSession={async (id) => {
          await deleteSession(id);
          showToast('Session purged from device with zero trace', 'info');
        }}
        onClear={() => setConfirmClearOpen(true)}
        onHardReset={() => setConfirmResetOpen(true)}
        onPanicPurge={() => setIsPanicPurgeOpen(true)}
        onExport={() => setIsExportOpen(true)}
      />

      {/* Main Workspace Area */}
      <main className={`flex-1 flex flex-col transition-all duration-300 h-full relative z-10 ${
        isSidebarOpen ? 'ml-16 sm:ml-72' : 'ml-16'
      }`}>
        <Header 
          onNewSession={handleNewSession}
          onOpenModelSelector={handleOpenModelSelector}
          onToggleTelemetry={() => setIsTelemetryOpen(prev => !prev)}
          isTelemetryOpen={isTelemetryOpen}
          onOpenPanicModal={() => setIsPanicPurgeOpen(true)}
        />

        <div className="flex-1 flex flex-col overflow-hidden relative bg-[#050102]">
          <ChatWindow onOpenModelSelector={handleOpenModelSelector} />
          <InputBar 
            suggestions={[
              'Perform an OSINT surface analysis',
              'Draft an automated penetration testing script',
              'Explain how neural network reasoning tokens work'
            ]}
            onOpenModelSelector={handleOpenModelSelector}
          />
        </div>

        {/* Dynamic Model Router & Selector Modal */}
        {modelSelectorMounted && (
          <Suspense fallback={null}>
            <ModelSelectorModal 
              isOpen={isModelSelectorOpen}
              onClose={() => setIsModelSelectorOpen(false)}
              targetMode={modelSelectorTarget}
            />
          </Suspense>
        )}

        {/* Active Arsenal (100 Remote HTTPS MCP Server Catalog) */}
        {arsenalMounted && (
          <Suspense fallback={null}>
            <ActiveArsenalModal 
              isOpen={isArsenalOpen}
              onClose={() => setIsArsenalOpen(false)}
            />
          </Suspense>
        )}

        {/* Settings & Model Harness Modal */}
        {settingsMounted && (
          <Suspense fallback={null}>
            <SettingsModal 
              onOpenExport={() => setIsExportOpen(true)}
              onConfirmClear={() => setConfirmClearOpen(true)}
              onConfirmReset={() => setConfirmResetOpen(true)}
            />
          </Suspense>
        )}

        {/* Export / Import Sessions Modal */}
        <ExportImportModal 
          isOpen={isExportOpen}
          sessions={sessions}
          onClose={() => setIsExportOpen(false)}
          onImport={handleImportSessions}
          onToast={showToast}
        />

        {/* Custom Themed Confirm Modals */}
        <ConfirmModal 
          isOpen={confirmClearOpen}
          title="Clear Conversation Buffer?"
          message="This will wipe all messages in the active thread. The session itself will remain active."
          confirmLabel="Clear Buffer"
          onConfirm={handleExecuteClear}
          onCancel={() => setConfirmClearOpen(false)}
        />

        <ConfirmModal 
          isOpen={confirmResetOpen}
          title="Hard Reset All Settings and Sessions?"
          message="This will permanently delete all conversation history, custom API keys, and configuration preferences from your browser local storage."
          confirmLabel="Reset Everything"
          isDanger={true}
          onConfirm={handleExecuteReset}
          onCancel={() => setConfirmResetOpen(false)}
        />

        {/* Real-Time Network Activity Stream Overlay */}
        <NetworkTelemetryOverlay 
          isOpen={isTelemetryOpen}
          onClose={() => setIsTelemetryOpen(false)}
        />

        {/* Rapid Session Purge / Panic Modal */}
        <PanicPurgeModal 
          isOpen={isPanicPurgeOpen}
          onClose={() => setIsPanicPurgeOpen(false)}
          onPurgeComplete={() => {
            setIsPanicPurgeOpen(false);
            window.location.reload();
          }}
          onAbortCurrentStream={handleAbort}
        />

        {/* Toast Feedback */}
        <Toast 
          isVisible={toast.visible} 
          message={toast.message} 
          type={toast.type}
          onClose={() => setToast(prev => ({ ...prev, visible: false }))} 
        />
      </main>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <WormGPTProvider>
      <WormGPTApp />
    </WormGPTProvider>
  );
};

export default App;
