import React, { useEffect, useMemo, useState } from 'react';
import { AppSettings } from '../types';
import { Settings, Sparkles, Loader2, AlertCircle, Layers, Languages, Highlighter, AlertTriangle, BookMarked } from 'lucide-react';
import { CHUNK_SIZE_CHARS, splitTextIntoChunks } from '../services/pipelineService';

interface InputPanelProps {
  title: string;
  setTitle: (v: string) => void;
  text: string;
  setText: (v: string) => void;
  tags: string;
  setTags: (v: string) => void;
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  onGenerate: () => void;
  onResume?: () => void;
  onStartFresh?: () => void;
  resumeAvailable?: boolean;
  resumeDetails?: string;
  isLoading: boolean;
  error: string | null;
}

export const InputPanel: React.FC<InputPanelProps> = ({
  title, setTitle,
  text, setText,
  tags, setTags,
  settings, setSettings,
  onGenerate,
  onResume,
  onStartFresh,
  resumeAvailable,
  resumeDetails,
  isLoading,
  error
}) => {
  const [limitOverrideConfirmed, setLimitOverrideConfirmed] = useState(false);

  const CONTEXT_CHAR_LIMIT = 180000; // ~45k tokens assuming ~4 chars/token
  const MULTIPASS_OUTLINE_THRESHOLD = 40000;
  const WARNING_THRESHOLD = CHUNK_SIZE_CHARS * 0.75;

  const isLongText = text.length > CHUNK_SIZE_CHARS;
  const exceedsContextLimit = text.length > CONTEXT_CHAR_LIMIT;
  const nearingLimit = !exceedsContextLimit && text.length > CONTEXT_CHAR_LIMIT * 0.8;
  const usesMultipassOutline = text.length > MULTIPASS_OUTLINE_THRESHOLD;
  const showChunkEstimate = text.length > WARNING_THRESHOLD;

  const estimatedChunks = useMemo(() => {
    if (!text.trim()) return 0;
    return splitTextIntoChunks(text).length;
  }, [text]);

  const estimatedTokens = Math.ceil(text.length / 4);
  const maxTokens = Math.round(CONTEXT_CHAR_LIMIT / 4);
  const generationBlocked = (exceedsContextLimit && !limitOverrideConfirmed) || isLoading || !text.trim();

  useEffect(() => {
    if (text.length <= CONTEXT_CHAR_LIMIT && limitOverrideConfirmed) {
      setLimitOverrideConfirmed(false);
    }
  }, [text, limitOverrideConfirmed, CONTEXT_CHAR_LIMIT]);

  return (
    <div className="h-full flex flex-col p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800 mb-2">New Study Session</h2>
        <p className="text-sm text-slate-500">Paste your English medical text below.</p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700 text-sm animate-in fade-in slide-in-from-top-2">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {resumeAvailable && onResume && (
        <div className="mb-4 p-4 bg-indigo-50 border border-indigo-100 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2">
           <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg shrink-0">
                 <Sparkles size={18} />
              </div>
              <div>
                 <h3 className="font-semibold text-indigo-900 text-sm">Resume previous session?</h3>
                 <p className="text-xs text-indigo-700 mt-0.5">{resumeDetails}</p>
              </div>
           </div>
           <div className="flex items-center gap-2 w-full sm:w-auto">
              <button 
                onClick={onStartFresh}
                className="flex-1 sm:flex-none px-3 py-2 text-xs font-medium text-slate-600 hover:bg-white rounded-lg transition-colors"
              >
                Start Fresh
              </button>
              <button 
                onClick={onResume}
                className="flex-1 sm:flex-none px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-all active:scale-95"
              >
                Resume
              </button>
           </div>
        </div>
      )}

      {(nearingLimit || exceedsContextLimit) && (
        <div className={`mb-4 p-4 rounded-lg border text-sm flex items-start gap-3 ${exceedsContextLimit ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-blue-50 border-blue-200 text-slate-700'}`}>
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="font-semibold">Context window guidance</p>
            <p>
              Inputs above ~{(CHUNK_SIZE_CHARS / 1000).toFixed(0)}k characters will be split into multiple chunks. Staying under {CONTEXT_CHAR_LIMIT.toLocaleString()} characters (~{maxTokens.toLocaleString()} tokens) keeps generation reliable; longer inputs may be slower and less coherent.
            </p>
            {exceedsContextLimit && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <span className="text-xs text-amber-700">Trim the source text or confirm you still want to proceed.</span>
                <button
                  type="button"
                  onClick={() => setLimitOverrideConfirmed(true)}
                  className="inline-flex items-center justify-center rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  I understand—continue anyway
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {usesMultipassOutline && (
        <div className="mb-4 p-3 bg-cyan-50 border border-cyan-100 rounded-lg text-xs text-cyan-800 flex items-start gap-2">
          <Layers size={14} className="mt-0.5 text-cyan-600" />
          <div className="space-y-1">
            <p className="font-semibold text-cyan-900">Multi-pass outlining enabled</p>
            <p>Inputs over 40k characters are scanned in sequential windows to merge section headings from the whole document.</p>
          </div>
        </div>
      )}

      <div className="space-y-4 flex-1 flex flex-col min-h-0">
        <input
          type="text"
          placeholder="Topic Title (Optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full p-3 rounded-lg border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all text-right"
          dir="auto"
        />
        
        <div className="relative flex-1 group">
           <textarea
            placeholder="Paste English medical text here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            dir="ltr"
            className="w-full h-full p-4 rounded-lg border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none resize-none font-mono text-sm leading-relaxed transition-all text-left"
          />
          
          {text && (
            <button
              onClick={() => setText('')}
              className="absolute top-2 right-2 p-1.5 bg-slate-100/80 hover:bg-slate-200 text-slate-500 rounded-lg transition-all opacity-0 group-hover:opacity-100 z-10"
              title="Clear text"
            >
              <div className="w-4 h-4 flex items-center justify-center">✕</div>
            </button>
          )}

          {isLongText && text && (
             <div className="absolute top-2 right-12 bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold flex items-center gap-1 shadow-sm">
               <Layers size={12} />
               Large Context Mode ({Math.round(text.length / 1000)}k chars)
             </div>
          )}

          {showChunkEstimate && (
            <div className="absolute bottom-2 left-2 bg-white/90 backdrop-blur px-2 py-1 rounded text-[11px] text-slate-600 border border-slate-200 shadow-sm flex items-center gap-2">
              <Layers size={12} className="text-teal-500" />
              <span>
                Estimated {estimatedChunks} chunk{estimatedChunks !== 1 ? 's' : ''} (~{Math.round(CHUNK_SIZE_CHARS / 1000)}k chars each with overlap)
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-600">Length check:</span>
            <span>{text.length.toLocaleString()} characters · ~{estimatedTokens.toLocaleString()} tokens</span>
            <span className="text-slate-400">(limit: {CONTEXT_CHAR_LIMIT.toLocaleString()} chars / ~{maxTokens.toLocaleString()} tokens)</span>
          </div>
          <p>
            Shorter inputs finish faster. We split long passages into overlapping {Math.round(CHUNK_SIZE_CHARS / 1000)}k-character chunks; more chunks mean longer pipelines and a higher chance of drift. Trim boilerplate when possible.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
           <input
            type="text"
            placeholder="Tags (e.g. Cardio, Pharmacology)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full p-2.5 rounded-lg border border-slate-200 focus:border-teal-500 outline-none text-sm text-right"
            dir="auto"
          />
          
          <div className="flex flex-col gap-2">
            {/* Row 1: Mode & Strict */}
            <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
              <Settings size={16} className="text-slate-400 ml-2" />
              <select 
                value={settings.outputLength}
                onChange={(e) => setSettings({...settings, outputLength: e.target.value as any})}
                className="bg-transparent text-sm font-medium outline-none text-slate-700 flex-1 cursor-pointer"
              >
                <option value="Light">Light</option>
                <option value="Standard">Standard</option>
                <option value="Deep">Deep</option>
              </select>
              
              <div className="h-4 w-px bg-slate-300 mx-2"></div>

              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600 select-none">
                  <input 
                    type="checkbox" 
                    checked={!settings.includeExtra} 
                    onChange={(e) => setSettings({...settings, includeExtra: !e.target.checked})}
                    className="rounded text-teal-600 focus:ring-teal-500 border-gray-300"
                  />
                  <span>Strict Mode</span>
              </label>
            </div>

            {/* Row 2: Translation */}
            <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
               <Languages size={16} className="text-slate-400 ml-2" />
               <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600 select-none flex-1">
                  <input
                    type="checkbox"
                    checked={settings.includeTranslation}
                    onChange={(e) => setSettings({...settings, includeTranslation: e.target.checked})}
                    className="rounded text-teal-600 focus:ring-teal-500 border-gray-300"
                  />
                  <span>Translation</span>
              </label>
            </div>

            {/* Row 3: Glossary auto-include */}
            <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
              <BookMarked size={16} className="text-slate-400 ml-2" />
              <div className="flex flex-col gap-0.5 flex-1">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={settings.autoIncludeGlossary}
                    onChange={(e) => setSettings({ ...settings, autoIncludeGlossary: e.target.checked })}
                    className="rounded text-teal-600 focus:ring-teal-500 border-gray-300"
                  />
                  <span>Glossary & flashcards</span>
                </label>
                <p className="text-[11px] text-slate-500 ml-1">
                  When on, add a glossary section to the markdown and show glossary flashcards beside active recall prompts.
                </p>
              </div>
            </div>

            {/* Row 4: Highlight density */}
            <div className="flex items-start gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
               <Highlighter size={16} className="text-slate-400 ml-2 mt-0.5" />
               <div className="flex flex-col gap-1 flex-1">
                 <div className="flex items-center gap-2">
                   <select
                     value={settings.highlightDensity}
                     onChange={(e) => setSettings({...settings, highlightDensity: e.target.value as AppSettings['highlightDensity']})}
                     className="bg-transparent text-sm font-medium outline-none text-slate-700 cursor-pointer"
                   >
                     <option value="High">High</option>
                     <option value="Medium">Medium</option>
                     <option value="Low">Low</option>
                   </select>
                   <span className="text-xs text-slate-500">Low = sparse markers, Medium = default balance, High = liberal emphasis.</span>
                 </div>
               </div>
            </div>
          </div>
        </div>

        <button
          onClick={onGenerate}
          disabled={generationBlocked}
          className="w-full py-4 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-teal-600/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-4"
        >
          {isLoading ? (
            <>
              <Loader2 className="animate-spin" size={20} />
              <span>{isLongText ? "Processing Large Text..." : "Teaching..."}</span>
            </>
          ) : (
            <>
              <Sparkles size={20} />
              <span>
                {exceedsContextLimit && !limitOverrideConfirmed
                  ? 'Confirm limit to start'
                  : isLongText
                    ? 'Start Deep Pipeline'
                    : 'Generate Study Guide'}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};