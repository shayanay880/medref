import React from 'react';
import { AppSettings } from '../types';
import { Settings, Sparkles, Loader2, AlertCircle, Layers, Languages, Highlighter } from 'lucide-react';

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
  resumeAvailable?: boolean;
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
  resumeAvailable,
  isLoading,
  error
}) => {
  const isLongText = text.length > 30000;

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

      <div className="space-y-4 flex-1 flex flex-col min-h-0">
        <input
          type="text"
          placeholder="Topic Title (Optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full p-3 rounded-lg border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all text-right"
          dir="auto"
        />
        
        <div className="relative flex-1">
           <textarea
            placeholder="Paste English medical text here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            dir="ltr"
            className="w-full h-full p-4 rounded-lg border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none resize-none font-mono text-sm leading-relaxed transition-all text-left"
          />
          {isLongText && (
             <div className="absolute top-2 right-2 bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold flex items-center gap-1 shadow-sm">
               <Layers size={12} />
               Large Context Mode ({Math.round(text.length / 1000)}k chars)
             </div>
          )}
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

            {/* Row 3: Highlight density */}
            <div className="flex items-start gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
               <Highlighter size={16} className="text-slate-400 ml-2 mt-0.5" />
               <div className="flex flex-col gap-1 flex-1">
                 <div className="flex items-center gap-2">
                   <select
                     value={settings.highlightDensity}
                     onChange={(e) => setSettings({...settings, highlightDensity: e.target.value as AppSettings['highlightDensity']})}
                     className="bg-transparent text-sm font-medium outline-none text-slate-700 cursor-pointer"
                   >
                     <option value="Medium">Medium</option>
                     <option value="Low">Low</option>
                   </select>
                   <span className="text-xs text-slate-500">Low = fewer colored spans; Medium = fuller coverage on numbers and red flags.</span>
                 </div>
               </div>
            </div>
          </div>
        </div>

        <button
          onClick={onGenerate}
          disabled={isLoading || !text.trim()}
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
              <span>{isLongText ? "Start Deep Pipeline" : "Generate Study Guide"}</span>
            </>
          )}
        </button>

        {resumeAvailable && onResume && (
          <button
            type="button"
            onClick={onResume}
            disabled={isLoading}
            className="w-full py-3 mt-2 border border-teal-200 text-teal-700 font-semibold rounded-lg hover:bg-teal-50 disabled:cursor-not-allowed"
          >
            Continue pipeline from saved progress
          </button>
        )}
      </div>
    </div>
  );
};