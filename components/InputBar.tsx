import React, { useRef, useState, useEffect, useMemo } from 'react';
import { 
  Send, Square, Paperclip, X, Eye, ShieldAlert, Mic, Zap, Loader2
} from 'lucide-react';
import { useWormGPT } from '../context/GlobalContext';
import { AutocompleteDropdown } from './AutocompleteDropdown';
import { ATTACHED_TOOLS } from '../services';
import { MODEL_OPTIONS } from '../constants';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { pxpipeEngine, PxpipeTokenStats } from '../services/pxpipe';

export const InputBar: React.FC<{
  suggestions?: string[];
  onOpenModelSelector?: (mode?: 'text' | 'vision') => void;
}> = ({ onOpenModelSelector }) => {
  const { 
    input, 
    setInput, 
    handleSend, 
    handleAbort, 
    isStreaming, 
    activeToolCalling,
    attachments, 
    setAttachments, 
    removeAttachment,
    settings,
    setSettings,
    autocomplete,
    setAutocomplete,
    setIsSettingsOpen,
    setIsArsenalOpen,
    activeArsenalToolIds
  } = useWormGPT();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pxpipeStats, setPxpipeStats] = useState<PxpipeTokenStats | null>(null);
  const [isCompressingPxpipe, setIsCompressingPxpipe] = useState(false);

  // Auto-grow the textarea with content (capped by max-h-48 CSS)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Speech Recognition Hook
  const {
    isListening,
    transcript,
    isSupported: isSpeechSupported,
    startListening,
    stopListening
  } = useSpeechRecognition();

  // Sync speech transcript with input
  useEffect(() => {
    if (transcript) {
      const trimmed = input.trim();
      setInput(trimmed ? `${trimmed} ${transcript}` : transcript);
    }
  }, [transcript]);

  const handleToggleDictation = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // Convert large text prompt into a compressed visual image via pxpipe
  const handleCompressWithPxpipe = async () => {
    if (!input.trim() || isCompressingPxpipe) return;
    setIsCompressingPxpipe(true);
    try {
      const result = await pxpipeEngine.renderTextToImage(input, {
        fontSize: 11,
        lineHeight: 15,
        theme: 'terminal-green',
        maxWidth: 1024,
        title: 'PROMPT_INPUT_COMPRESSION'
      });
      const newImages = result.images && result.images.length > 0 ? result.images : [result.dataUrl];
      setAttachments(prev => [...prev, ...newImages]);
      setPxpipeStats(result.stats);
      const frameCount = newImages.length;
      const escapeNotice = result.preservedPlainText ? `\n${result.preservedPlainText}\n` : '';
      setInput(`[PXPIPE ARBITRAGE ATTACHED // ${frameCount} FRAME${frameCount > 1 ? 'S' : ''} - SAVED ${result.stats.tokenSavingsPct}% TOKENS]${escapeNotice}Analyze the attached dense context and answer thoroughly.`);
    } catch (err) {
      console.error('pxpipe compression failed:', err);
    } finally {
      setIsCompressingPxpipe(false);
    }
  };

  // Autocomplete filtering for models and tools
  const filteredAutocompleteModels = useMemo(() => {
    if (autocomplete.type !== 'model') return [];
    const q = (autocomplete.query || '').toLowerCase().trim();
    if (!q) return MODEL_OPTIONS.slice(0, 40);
    return MODEL_OPTIONS.filter(m => 
      m.label.toLowerCase().includes(q) ||
      m.value.toLowerCase().includes(q) ||
      (m.provider && m.provider.toLowerCase().includes(q))
    ).slice(0, 40);
  }, [autocomplete.type, autocomplete.query]);

  const filteredAutocompleteTools = useMemo(() => {
    if (autocomplete.type !== 'tool') return [];
    const q = (autocomplete.query || '').toLowerCase().trim();
    const allTools = Object.entries(ATTACHED_TOOLS || {}).map(([key, t]) => ({
      name: t?.function?.name || key,
      description: t?.function?.description || 'System intelligence utility',
      parameters: Object.keys(t?.function?.parameters?.properties || {})
    }));
    if (!q) return allTools.slice(0, 40);
    return allTools.filter(t => 
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q)
    ).slice(0, 40);
  }, [autocomplete.type, autocomplete.query]);

  // Check text before cursor to trigger autocomplete on /tool or @model
  const checkAutocomplete = (text: string, cursorPosition: number) => {
    const textBeforeCursor = text.slice(0, cursorPosition);
    
    // Check for triggers @ or /
    const lastAt = textBeforeCursor.lastIndexOf('@');
    const lastSlash = textBeforeCursor.lastIndexOf('/');
    const triggerIndex = Math.max(lastAt, lastSlash);

    if (triggerIndex === -1) {
      if (autocomplete.visible) {
        setAutocomplete({ visible: false, type: null, query: '', index: 0, startIndex: 0 });
      }
      return;
    }

    // Must be start of string or preceded by whitespace
    if (triggerIndex > 0 && !/\s/.test(textBeforeCursor[triggerIndex - 1])) {
      if (autocomplete.visible) {
        setAutocomplete({ visible: false, type: null, query: '', index: 0, startIndex: 0 });
      }
      return;
    }

    const triggerChar = textBeforeCursor[triggerIndex];
    const afterTrigger = textBeforeCursor.slice(triggerIndex + 1);

    // If there is a newline between trigger and cursor, do not show autocomplete
    if (afterTrigger.includes('\n')) {
      if (autocomplete.visible) {
        setAutocomplete({ visible: false, type: null, query: '', index: 0, startIndex: 0 });
      }
      return;
    }

    if (triggerChar === '@') {
      let query = afterTrigger.trim();
      const modelMatch = afterTrigger.match(/^models?(?:\s+(.*))?$/i);
      if (modelMatch) {
        query = (modelMatch[1] || '').trim();
      }
      setAutocomplete({
        visible: true,
        type: 'model',
        query,
        index: 0,
        startIndex: triggerIndex
      });
      return;
    }

    if (triggerChar === '/') {
      let query = afterTrigger.trim();
      const toolMatch = afterTrigger.match(/^tools?(?:\s+(.*))?$/i);
      if (toolMatch) {
        query = (toolMatch[1] || '').trim();
      }
      setAutocomplete({
        visible: true,
        type: 'tool',
        query,
        index: 0,
        startIndex: triggerIndex
      });
      return;
    }
  };

  const handleAutocompleteSelect = (item: any) => {
    const cursor = inputRef.current?.selectionStart ?? input.length;
    const startIndex = autocomplete.startIndex ?? Math.max(input.lastIndexOf('@'), input.lastIndexOf('/'));
    
    if (startIndex === -1) return;

    const before = input.slice(0, startIndex);
    const after = input.slice(cursor);

    if (autocomplete.type === 'model') {
      const modelOpt = item;
      const modelVal = modelOpt.value || item;
      const provider = modelOpt.provider;

      // Auto-set the active model and provider in settings
      setSettings(prev => ({
        ...prev,
        model: modelVal,
        ...(provider ? { aiProvider: provider } : {})
      }));

      // Cleanly update input text
      const nextInput = (before + after).trim();
      setInput(nextInput);

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const newPos = before.length;
          inputRef.current.setSelectionRange(newPos, newPos);
        }
      }, 10);
    } else if (autocomplete.type === 'tool') {
      const toolName = typeof item === 'string' ? item : item.name;

      // Auto-arm the selected tool
      setSettings(prev => {
        const set = new Set(prev.enabledTools || []);
        set.add(toolName);
        return { ...prev, enabledTools: Array.from(set) };
      });

      // Cleanly update input text
      const nextInput = (before + after).trim();
      setInput(nextInput);

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const newPos = before.length;
          inputRef.current.setSelectionRange(newPos, newPos);
        }
      }, 10);
    }

    setAutocomplete({ visible: false, type: null, query: '', index: 0, startIndex: 0 });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocomplete.visible) {
      const activeList = autocomplete.type === 'model' ? filteredAutocompleteModels : filteredAutocompleteTools;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (activeList.length > 0) {
          setAutocomplete(prev => ({ ...prev, index: (prev.index + 1) % activeList.length }));
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (activeList.length > 0) {
          setAutocomplete(prev => ({ ...prev, index: (prev.index - 1 + activeList.length) % activeList.length }));
        }
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (activeList.length > 0) {
          const selected = activeList[autocomplete.index] || activeList[0];
          if (selected) {
            handleAutocompleteSelect(selected);
          }
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAutocomplete({ visible: false, type: null, query: '', index: 0, startIndex: 0 });
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    checkAutocomplete(val, e.target.selectionStart || val.length);
  };

  const handleInputCursorCheck = () => {
    if (inputRef.current) {
      checkAutocomplete(input, inputRef.current.selectionStart || input.length);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB per file — avoids data-URL memory blowups

    Array.from(files).forEach(file => {
      if (file.size > MAX_FILE_BYTES) {
        alert(`"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB — attachments are limited to 8 MB.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        const result = uploadEvent.target?.result as string;
        if (result) {
          setAttachments(prev => [...prev, result]);
        }
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const hasAttachments = attachments.length > 0;
  const visionModelName = settings.visionModel || 'gemini-2.5-flash';
  const showPxpipeSuggestion = input.length > 300 || settings.pxpipeEnabled;

  return (
    <div className="p-3 sm:p-4 bg-[#050102] border-t border-red-950/80 relative z-40">
      <div className="max-w-4xl mx-auto space-y-2 relative">

        {/* Autocomplete Dropdown */}
        <AutocompleteDropdown
          visible={autocomplete.visible}
          type={autocomplete.type}
          query={autocomplete.query}
          activeIndex={autocomplete.index}
          activeModelValue={settings.model}
          enabledTools={settings.enabledTools}
          onSelect={handleAutocompleteSelect}
          onClose={() => setAutocomplete({ visible: false, type: null, query: '', index: 0, startIndex: 0 })}
        />

        {/* Model Router Dynamic Notice when Vision attachments are present */}
        {hasAttachments && (
          <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-red-950/40 border border-red-800/60 text-xs text-red-200 animate-in fade-in duration-200 font-mono">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-red-400 shrink-0" />
              <span>
                <strong>Vision Input:</strong> {attachments.length} frame{attachments.length > 1 ? 's' : ''} staged. Routed via <strong>{visionModelName}</strong>.
              </span>
            </div>
            <button 
              onClick={() => onOpenModelSelector?.('vision')}
              className="text-[11px] underline hover:text-red-100 text-red-400 shrink-0 font-mono"
            >
              Configure Vision Model
            </button>
          </div>
        )}

        {/* pxpipe Token Arbitrage Stats Banner */}
        {pxpipeStats && (
          <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-red-950/50 border border-red-700/60 text-xs text-red-200 animate-in fade-in duration-200 font-mono">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-red-500 shrink-0" />
              <span>
                <strong>pxpipe Arbitrage:</strong> Compressed {pxpipeStats.originalChars} chars → ~{pxpipeStats.estimatedVisualTokens} visual tokens (<strong className="text-red-200">-{pxpipeStats.tokenSavingsPct}% reduction</strong>)
              </span>
            </div>
            <button
              onClick={() => setPxpipeStats(null)}
              className="text-red-400 hover:text-red-100 text-xs font-bold"
            >
              ×
            </button>
          </div>
        )}

        {/* Voice Dictation Active Indicator */}
        {isListening && (
          <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-red-950/80 border border-red-500/80 text-xs text-red-200 animate-in fade-in duration-200 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600"></span>
              </span>
              <span className="font-mono font-bold text-[11px] tracking-wider text-red-300">
                VOICE_STREAM_ACTIVE // LISTENING...
              </span>
            </div>
            <button 
              onClick={handleToggleDictation}
              className="text-[11px] font-bold text-red-400 hover:text-red-100 uppercase tracking-wider font-mono border border-red-800 px-2 py-0.5 rounded bg-black/60"
            >
              TERMINATE
            </button>
          </div>
        )}

        {/* Attachments preview row */}
        {hasAttachments && (
          <div className="flex flex-wrap gap-2 pt-1">
            {attachments.map((img, idx) => (
              <div key={idx} className="relative group/att">
                <img 
                  src={img} 
                  alt="upload preview" 
                  className="w-14 h-14 object-cover rounded-lg border border-red-600/70 shadow-[0_0_8px_rgba(239,68,68,0.3)]"
                />
                <button
                  onClick={() => removeAttachment(idx)}
                  className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-black border border-red-900 text-red-300 hover:text-white opacity-90 group-hover/att:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main Input Box Row (Clean, minimal, single bar) */}
        <div className="relative rounded-2xl bg-[#080204] border border-red-900/80 hover:border-red-700/90 focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-400 focus-within:shadow-[0_0_35px_rgba(239,68,68,0.7),0_0_15px_rgba(255,60,60,0.4)] shadow-lg shadow-black/80 transition-all duration-200">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onClick={handleInputCursorCheck}
            onKeyUp={handleInputCursorCheck}
            onKeyDown={handleKeyDown}
            aria-label="Message input"
            placeholder={
              settings.systemOverride
                ? "ROOT_COMMAND_PROMPT >> (System Override Active)"
                : "PROMPT >> /tool to arm weapons, @model to route payload..."
            }
            rows={1}
            className="w-full pl-4 pr-28 pt-3.5 pb-3 bg-transparent text-sm font-mono text-red-100 placeholder-red-700/60 focus:outline-none resize-none leading-relaxed min-h-[48px] max-h-48 overflow-y-auto caret-red-500 focus:caret-white transition-[caret-color] duration-200"
          />

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            multiple
            accept="image/*,.pdf,.txt,.json,.js,.ts"
            className="hidden"
          />

          {/* Right Action Buttons */}
          <div className="absolute right-2.5 bottom-2 flex items-center gap-1">
            {/* pxpipe Vision Arbitrage quick button for large text context */}
            {showPxpipeSuggestion && (
              <button
                type="button"
                onClick={handleCompressWithPxpipe}
                disabled={isCompressingPxpipe}
                className="px-2 py-1 rounded-md bg-red-950/70 border border-red-600/60 text-[10px] font-mono text-red-200 hover:bg-red-900/60 transition-all flex items-center gap-1 shadow-sm"
                title="pxpipe Vision Arbitrage: Render dense text to image to slash token costs by ~65%"
              >
                <Zap className="w-3 h-3 text-red-500" />
                <span className="hidden sm:inline">{isCompressingPxpipe ? '...' : 'pxpipe'}</span>
              </button>
            )}

            {/* Dictation (Speech Recognition) Button */}
            {isSpeechSupported && (
              <button
                type="button"
                onClick={handleToggleDictation}
                className={`p-2 rounded-lg transition-all ${
                  isListening
                    ? 'bg-red-600 text-white shadow-[0_0_15px_rgba(239,68,68,0.8)] animate-pulse'
                    : 'text-red-400 hover:text-red-200 hover:bg-red-950/60'
                }`}
                title={isListening ? "Listening... Click to stop dictation" : "Voice Dictation"}
              >
                <Mic className="w-4 h-4" />
              </button>
            )}

            {/* Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-lg text-red-400 hover:text-red-200 hover:bg-red-950/60 transition-colors"
              title="Attach images or documents"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            {/* Send / Stop Button */}
            {isStreaming ? (
              <button
                type="button"
                onClick={handleAbort}
                className="px-2.5 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white shadow-[0_0_20px_rgba(239,68,68,0.8)] border border-red-400 flex items-center gap-1.5 transition-all animate-pulse"
                title="Stop generation"
              >
                <Square className="w-4 h-4 fill-current" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider">HALT</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim() && attachments.length === 0}
                className="p-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-25 disabled:hover:bg-red-600 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)] border border-red-500/50 transition-all"
                title="Send message (Enter)"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Bottom Helper Bar (Clean, uncluttered, refined hierarchy) */}
        <div className="flex items-center justify-between text-[11px] text-red-500/80 px-1 font-mono">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAutocomplete({ visible: true, type: 'tool', query: '', index: 0, startIndex: input.length });
                if (inputRef.current) inputRef.current.focus();
              }}
              className="hover:text-red-200 transition-colors flex items-center gap-1 group px-1.5 py-0.5 rounded bg-black/90 border border-red-950 hover:border-red-800"
              title="Click or type /tool to arm system tools"
            >
              <span className="text-red-500 group-hover:text-red-300">/tool</span>
              <span className="text-red-300 font-bold">
                {settings.enabledTools && settings.enabledTools.length > 0
                  ? `${settings.enabledTools.length} armed`
                  : 'catalog'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setAutocomplete({ visible: true, type: 'model', query: '', index: 0, startIndex: input.length });
                if (inputRef.current) inputRef.current.focus();
              }}
              className="hover:text-red-200 transition-colors flex items-center gap-1 group px-1.5 py-0.5 rounded bg-black/90 border border-red-950 hover:border-red-800"
              title="Click or type @model to switch models"
            >
              <span className="text-red-500 group-hover:text-red-300">@model</span>
              <span className="text-red-200 font-bold truncate max-w-[140px]">{settings.model}</span>
            </button>
          </div>

          <span className="hidden sm:inline text-red-700/80 text-[11px] font-mono">
            Enter to fire • Shift+Enter for newline
          </span>
        </div>

      </div>
    </div>
  );
};

export default InputBar;
