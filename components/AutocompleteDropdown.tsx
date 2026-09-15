import React, { useEffect, useRef, useMemo, useState } from 'react';
import { MODEL_OPTIONS, ModelOption } from '../constants';
import { ATTACHED_TOOLS } from '../services';
import { 
  Cpu, Wrench, X, Sparkles, Check, ChevronRight, Terminal, Layers, 
  Search, Eye, Zap, Brain, Code, Server, Shield, Globe, Lock, ArrowRight
} from 'lucide-react';

export interface ToolItemOption {
  name: string;
  description: string;
  parameters: string[];
  category?: string;
}

interface AutocompleteDropdownProps {
  visible: boolean;
  type: 'model' | 'tool' | null;
  query: string;
  onSelect: (item: any) => void;
  activeIndex: number;
  activeModelValue?: string;
  enabledTools?: string[];
  onClose?: () => void;
}

export const AutocompleteDropdown: React.FC<AutocompleteDropdownProps> = ({ 
  visible, 
  type, 
  query = '', 
  onSelect, 
  activeIndex,
  activeModelValue,
  enabledTools = [],
  onClose
}) => {
  const activeItemRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [modelCategory, setModelCategory] = useState<'all' | 'cloud' | 'local' | 'router' | 'free'>('all');
  const [toolCategory, setToolCategory] = useState<'all' | 'search' | 'browser' | 'code' | 'osint' | 'mcp'>('all');
  const [localSearch, setLocalSearch] = useState('');

  // Combine parent query with local search query
  const effectiveQuery = useMemo(() => {
    return (localSearch || query || '').toLowerCase().trim();
  }, [localSearch, query]);

  // Parse and filter model options
  const filteredModels = useMemo<ModelOption[]>(() => {
    if (type !== 'model') return [];
    
    return MODEL_OPTIONS.filter(m => {
      const q = effectiveQuery;
      const matchesSearch = !q || (
        m.label.toLowerCase().includes(q) ||
        m.value.toLowerCase().includes(q) ||
        (m.provider && m.provider.toLowerCase().includes(q))
      );

      if (!matchesSearch) return false;

      if (modelCategory === 'all') return true;
      if (modelCategory === 'free') return m.isFree || m.provider === 'pollinations' || m.provider === 'puter' || m.value.includes('free');
      if (modelCategory === 'local') {
        const localProviders = ['ollama', 'llamacpp', 'lmstudio', 'jan', 'vllm', 'sglang', 'localai', 'gpt4all', 'local_openai_proxy', 'unsloth', 'webgpu'];
        return localProviders.includes(m.provider || '') || m.value.includes('local');
      }
      if (modelCategory === 'router') {
        const routerProviders = ['openrouter', 'groq', 'together', 'fireworks', 'siliconflow', 'huggingface', 'deepinfra', 'novita', 'cloudflare', 'nvidia'];
        return routerProviders.includes(m.provider || '');
      }
      if (modelCategory === 'cloud') {
        const cloudProviders = ['openai', 'anthropic', 'gemini', 'deepseek', 'mistral', 'xai', 'cohere', 'perplexity', 'minimax', 'moonshot', 'kimi', 'alibaba', 'z_ai', 'webbrain_cloud', 'azure_openai', 'aws_bedrock'];
        return cloudProviders.includes(m.provider || '');
      }

      return true;
    }).slice(0, 60);
  }, [type, effectiveQuery, modelCategory]);

  // Parse and filter tools from ATTACHED_TOOLS
  const filteredTools = useMemo<ToolItemOption[]>(() => {
    if (type !== 'tool') return [];
    
    const allTools: ToolItemOption[] = Object.entries(ATTACHED_TOOLS || {}).map(([key, t]) => {
      const name = t?.function?.name || key;
      const desc = t?.function?.description || 'System intelligence utility';
      const params = Object.keys(t?.function?.parameters?.properties || {});
      
      let cat = 'general';
      const lowerName = name.toLowerCase();
      if (lowerName.includes('search') || lowerName.includes('duck') || lowerName.includes('yandex') || lowerName.includes('bing') || lowerName.includes('arxiv')) {
        cat = 'search';
      } else if (lowerName.includes('browse') || lowerName.includes('crawl') || lowerName.includes('firecrawl') || lowerName.includes('scrape') || lowerName.includes('fetch')) {
        cat = 'browser';
      } else if (lowerName.includes('code') || lowerName.includes('jdoodle') || lowerName.includes('compiler') || lowerName.includes('regex') || lowerName.includes('hash') || lowerName.includes('base64')) {
        cat = 'code';
      } else if (lowerName.includes('whois') || lowerName.includes('dns') || lowerName.includes('shodan') || lowerName.includes('ip') || lowerName.includes('recon') || lowerName.includes('pwned') || lowerName.includes('dork')) {
        cat = 'osint';
      } else if (lowerName.includes('memory') || lowerName.includes('file') || lowerName.includes('shell') || lowerName.includes('puppeteer') || lowerName.includes('mcp') || lowerName.includes('system')) {
        cat = 'mcp';
      }

      return {
        name,
        description: desc,
        parameters: params,
        category: cat
      };
    });

    return allTools.filter(t => {
      const q = effectiveQuery;
      const matchesSearch = !q || (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.parameters.some(p => p.toLowerCase().includes(q))
      );

      if (!matchesSearch) return false;

      if (toolCategory === 'all') return true;
      return t.category === toolCategory;
    }).slice(0, 60);
  }, [type, effectiveQuery, toolCategory]);

  // Keep active item in visible scroll area
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }, [activeIndex]);

  if (!visible || !type) return null;

  const totalCount = type === 'model' ? filteredModels.length : filteredTools.length;

  return (
    <div 
      className="absolute bottom-full left-0 mb-3 w-[22rem] sm:w-[30rem] md:w-[36rem] bg-[#070103] border border-red-600/70 rounded-2xl overflow-hidden shadow-[0_25px_70px_rgba(0,0,0,0.98),0_0_30px_rgba(239,68,68,0.25)] ring-1 ring-red-500/20 z-[200] animate-in fade-in slide-in-from-bottom-2 duration-150 select-none flex flex-col font-mono"
      onClick={e => e.stopPropagation()}
    >
      {/* Header bar */}
      <div className="px-3.5 py-2.5 bg-[#0a0204] border-b border-red-950/90 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {type === 'model' ? (
            <span className="p-1.5 rounded-lg bg-red-950/80 border border-red-600/60 text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.3)]">
              <Cpu className="w-4 h-4" />
            </span>
          ) : (
            <span className="p-1.5 rounded-lg bg-red-950/80 border border-red-600/60 text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.3)]">
              <Wrench className="w-4 h-4" />
            </span>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold tracking-wide uppercase text-red-100">
                {type === 'model' ? 'SELECT_TARGET_MODEL (@model)' : 'ARM_TOOL_ARSENAL (/tool)'}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black border border-red-800/80 text-red-300 font-bold">
                {totalCount} AVAIL
              </span>
            </div>
            <p className="text-[10px] text-red-400/80 font-mono">
              {type === 'model'
                ? 'Select neural LLM engine to direct payload queries'
                : 'Arm system utilities to empower WormGPT agents'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1 text-[9px] text-red-500 font-mono">
            <kbd className="px-1.5 py-0.5 rounded bg-black border border-red-950 text-red-400">↑↓</kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-black border border-red-950 text-red-400">ENTER</kbd>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-red-500 hover:text-red-200 hover:bg-red-950/60 transition-colors"
              title="Close dropdown"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Category Pills Bar */}
      <div className="px-3 py-2 bg-[#050102] border-b border-red-950/80 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 text-xs font-mono">
        {type === 'model' ? (
          <>
            {[
              { id: 'all', label: 'All Models' },
              { id: 'cloud', label: 'Cloud Frontier' },
              { id: 'local', label: 'Localhost Engine' },
              { id: 'router', label: 'Routers & Gateways' },
              { id: 'free', label: 'Free Tier' }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setModelCategory(tab.id as any)}
                className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition-all border font-mono ${
                  modelCategory === tab.id
                    ? 'bg-red-600 text-white border-red-400 font-bold shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                    : 'bg-black text-red-400 border-red-950 hover:text-red-200 hover:border-red-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </>
        ) : (
          <>
            {[
              { id: 'all', label: 'All Tools' },
              { id: 'search', label: 'Search & Recon' },
              { id: 'browser', label: 'Live Browser' },
              { id: 'code', label: 'Code & Compute' },
              { id: 'osint', label: 'OSINT & Recon' },
              { id: 'mcp', label: 'MCP Bridge' }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setToolCategory(tab.id as any)}
                className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition-all border font-mono ${
                  toolCategory === tab.id
                    ? 'bg-red-600 text-white border-red-400 font-bold shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                    : 'bg-black text-red-400 border-red-950 hover:text-red-200 hover:border-red-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Suggestion list */}
      <div 
        ref={scrollContainerRef}
        className="max-h-72 overflow-y-auto custom-scrollbar p-2 space-y-1.5 bg-[#050102]"
      >
        {totalCount === 0 ? (
          <div className="py-8 px-4 text-center text-xs text-red-400 font-mono">
            <p className="font-bold text-red-300 mb-1">
              NO MATCHING {type === 'model' ? 'MODELS' : 'TOOLS'} FOUND.
            </p>
            <p className="text-[11px] text-red-600 font-mono">
              Adjust category tabs or clear query.
            </p>
          </div>
        ) : type === 'model' ? (
          filteredModels.map((m, i) => {
            const isSelected = i === activeIndex;
            const isCurrentlyActive = activeModelValue === m.value;

            return (
              <div
                key={m.value + '-' + i}
                ref={isSelected ? activeItemRef : null}
                onClick={() => onSelect(m)}
                className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between group/item border font-mono ${
                  isSelected 
                    ? 'bg-red-950/80 border-red-500/80 shadow-[0_0_20px_rgba(239,68,68,0.3)]' 
                    : 'bg-[#080204]/90 border-red-950/70 hover:bg-red-950/40 hover:border-red-800/60'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <span className={`p-2 rounded-lg shrink-0 transition-colors ${
                    isSelected ? 'bg-red-600 text-white shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-black text-red-400 border border-red-950 group-hover/item:text-red-200'
                  }`}>
                    <Cpu className="w-4 h-4" />
                  </span>

                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold truncate ${
                        isSelected ? 'text-red-100 drop-shadow-[0_0_6px_rgba(239,68,68,0.6)]' : 'text-red-200'
                      }`}>
                        {m.label}
                      </span>
                      {isCurrentlyActive && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-950 border border-red-500 text-red-200 font-bold animate-pulse">
                          ARMED
                        </span>
                      )}
                      {m.isFree && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-950/60 border border-red-600/50 text-red-300 font-semibold">
                          FREE
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] font-mono text-red-500 truncate max-w-[220px]">
                        {m.value}
                      </span>
                      {m.provider && (
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-black border border-red-950 text-red-400 shrink-0">
                          {m.provider}
                        </span>
                      )}
                      {m.contextWindow && (
                        <span className="text-[9px] font-mono text-red-700 shrink-0">
                          {(m.contextWindow / 1000).toFixed(0)}k ctx
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isSelected ? (
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-600 text-white text-[10px] font-mono font-bold shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-pulse">
                      <span>ARM</span>
                      <ChevronRight className="w-3 h-3" />
                    </div>
                  ) : (
                    <ChevronRight className="w-4 h-4 text-red-800 opacity-0 group-hover/item:opacity-100 transition-opacity" />
                  )}
                </div>
              </div>
            );
          })
        ) : (
          filteredTools.map((tool, i) => {
            const isSelected = i === activeIndex;
            const isArmed = enabledTools.includes(tool.name);

            return (
              <div
                key={tool.name + '-' + i}
                ref={isSelected ? activeItemRef : null}
                onClick={() => onSelect(tool)}
                className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between group/item border font-mono ${
                  isSelected 
                    ? 'bg-red-950/80 border-red-500/80 shadow-[0_0_20px_rgba(239,68,68,0.3)]' 
                    : 'bg-[#080204]/90 border-red-950/70 hover:bg-red-950/40 hover:border-red-800/50'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <span className={`p-2 rounded-lg shrink-0 transition-colors ${
                    isSelected ? 'bg-red-600 text-white font-bold shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-black text-red-400 border border-red-950 group-hover/item:text-red-200'
                  }`}>
                    <Terminal className="w-4 h-4" />
                  </span>

                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-mono font-bold truncate ${
                        isSelected ? 'text-red-100 drop-shadow-[0_0_6px_rgba(239,68,68,0.6)]' : 'text-red-200'
                      }`}>
                        {tool.name}
                      </span>
                      {isArmed && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-950 border border-red-500 text-red-200 font-bold flex items-center gap-1">
                          <Check className="w-2.5 h-2.5" /> ARMED
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-red-300/80 font-mono line-clamp-1 mt-0.5">
                      {tool.description}
                    </p>

                    {tool.parameters.length > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {tool.parameters.slice(0, 4).map(p => (
                          <span key={p} className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-black border border-red-950 text-red-400">
                            {p}
                          </span>
                        ))}
                        {tool.parameters.length > 4 && (
                          <span className="text-[8px] font-mono text-red-700">
                            +{tool.parameters.length - 4} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isSelected ? (
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-600 text-white text-[10px] font-mono font-bold shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-pulse">
                      <span>ARM TOOL</span>
                      <ChevronRight className="w-3 h-3" />
                    </div>
                  ) : (
                    <ChevronRight className="w-4 h-4 text-red-800 opacity-0 group-hover/item:opacity-100 transition-opacity" />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer quick help */}
      <div className="px-3.5 py-2 bg-[#0a0204] border-t border-red-950/80 text-[10px] text-red-400 font-mono flex items-center justify-between shrink-0">
        <span className="flex items-center gap-1.5 text-red-300">
          <Sparkles className="w-3.5 h-3.5 text-red-400" />
          <span>{type === 'model' ? 'Enter/Click to switch target model' : 'Enter/Click to toggle & arm utility'}</span>
        </span>
        <span className="text-red-700">ESC to abort</span>
      </div>
    </div>
  );
};
