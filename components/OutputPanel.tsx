
import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Copy, Eye, FileText, CheckCircle2, AlertTriangle, ExternalLink, Globe, Cpu, Check } from 'lucide-react';
import { StructuredOutput, PipelineState, HighlightDensity } from '../types';
import { MODEL_DISPLAY_NAME } from '../constants';

interface OutputPanelProps {
  markdown: string;
  json: StructuredOutput | null;
  pipelineState?: PipelineState;
  isLoading: boolean;
  highlightDensity: HighlightDensity;
  onResynthesizeStitch?: () => void;
  isGoalStale?: boolean;
}

const allowedTags = new Set([
  'p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'span', 'div',
  'details', 'summary'
]);
const allowedSpanClasses = new Set(['hl-red', 'hl-yellow', 'hl-blue', 'extra-inline']);

const sanitizePlugin = () => (tree: any) => {
  const sanitizeNodes = (nodes: any[]) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.type === 'element') {
        if (!allowedTags.has(node.tagName)) { nodes.splice(i, 1); continue; }
        node.properties = node.properties || {};
        if (node.tagName === 'span') {
          const classList = (node.properties.className as string[] | string | undefined) || [];
          const normalized = Array.isArray(classList) ? classList : String(classList).split(/\s+/);
          const kept = normalized.filter((c) => allowedSpanClasses.has(c));
          if (kept.length) node.properties.className = kept;
          else delete node.properties.className;
        } else { delete node.properties.className; }
      }
      if (node.children) sanitizeNodes(node.children);
    }
  };
  if (tree.children) sanitizeNodes(tree.children);
};

// Helper function to convert custom brackets to HTML spans
const preprocessText = (text: string) => {
  if (!text) return '';
  return text
    .replace(/\[\[R\]\](.*?)\[\[\/R\]\]/g, '<span class="hl-red">$1</span>')
    .replace(/\[\[Y\]\](.*?)\[\[\/Y\]\]/g, '<span class="hl-yellow">$1</span>')
    .replace(/\[\[B\]\](.*?)\[\[\/B\]\]/g, '<span class="hl-blue">$1</span>')
    .replace(/\[\[EXTRA\]\](.*?)\[\[\/EXTRA\]\]/g, '<span class="extra-inline">$1</span>');
};

export const OutputPanel: React.FC<OutputPanelProps> = ({ 
  markdown, 
  json, 
  pipelineState, 
  isLoading, 
  highlightDensity, 
  onResynthesizeStitch, 
  isGoalStale 
}) => {
  const [viewMode, setViewMode] = useState<'rich' | 'markers'>('rich');
  const [activeTab, setActiveTab] = useState<'study' | 'coverage'>('study');
  const [copied, setCopied] = useState(false);
  
  const processedMarkdown = useMemo(() => {
    return preprocessText(markdown);
  }, [markdown]);

  const hasCoverage = Boolean(pipelineState?.outline?.length);
  const sections = useMemo(() => (processedMarkdown || '').split(/(?=^##\s)/gm).filter(p => p.trim().length > 0), [processedMarkdown]);

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading && !markdown) return <div className="h-full flex items-center justify-center text-slate-400">Loading study guide...</div>;
  if (!markdown) return <div className="h-full flex items-center justify-center text-slate-400">No output generated yet.</div>;

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="sticky top-0 bg-white border-b border-slate-200 z-10 p-3 flex items-center justify-between shadow-sm">
        <div className="flex bg-slate-100 rounded-lg p-1">
          <button onClick={() => setActiveTab('study')} className={`px-3 py-1.5 text-sm rounded-md transition-all ${activeTab === 'study' ? 'bg-white shadow text-teal-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}>Study Guide</button>
          {hasCoverage && <button onClick={() => setActiveTab('coverage')} className={`px-3 py-1.5 text-sm rounded-md transition-all ${activeTab === 'coverage' ? 'bg-white shadow text-teal-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}>Coverage</button>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setViewMode(viewMode === 'rich' ? 'markers' : 'rich')} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors" title={viewMode === 'rich' ? "View Raw Markers" : "View Rich Text"}>
            {viewMode === 'rich' ? <FileText size={18} /> : <Eye size={18} />}
          </button>
          <button 
            onClick={handleCopy} 
            className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${copied ? 'bg-green-50 text-green-600' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Copy to Clipboard"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8 text-right" dir="rtl">
        {activeTab === 'study' ? (
          <div className="max-w-4xl mx-auto space-y-6">
            {json?.groundingSources && json.groundingSources.length > 0 && (
              <div className="bg-white border border-teal-200 rounded-xl p-5 shadow-sm space-y-3">
                <div className="flex items-center gap-2 text-teal-700 font-bold mb-2">
                  <Globe size={18} />
                  <span>Verified Web Sources</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {json.groundingSources.map((source, i) => (
                    <a key={i} href={source.uri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs hover:bg-teal-50 transition-colors">
                      <ExternalLink size={12} />
                      <span className="truncate max-w-[200px]">{source.title || 'Source'}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
            {sections.map((section, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 md:p-8">
                <article className="prose prose-slate prose-lg max-w-none prose-headings:font-bold prose-headings:text-teal-900 prose-p:leading-relaxed prose-li:marker:text-teal-500">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, sanitizePlugin]}>
                    {section}
                  </ReactMarkdown>
                </article>
              </div>
            ))}
            
            <div className="flex items-center justify-center pt-8 pb-4 opacity-40 hover:opacity-100 transition-opacity">
               <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                 <Cpu size={12} />
                 <span>Generated by {MODEL_DISPLAY_NAME}</span>
               </div>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto bg-white border border-slate-200 p-6 rounded-xl">
            <h3 className="font-bold text-lg mb-4">Pipeline Coverage</h3>
            <ul className="space-y-2">
              {pipelineState?.outline.map(o => (
                <li key={o.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <span>{o.title}</span>
                  {pipelineState?.coverageReport?.[o.id]?.covered ? <CheckCircle2 className="text-green-600" size={18} /> : <AlertTriangle className="text-amber-500" size={18} />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
