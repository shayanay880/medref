import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Copy, Download, Layers, RefreshCw, Eye, FileText, CheckCircle2 } from 'lucide-react';
import { StructuredOutput, PipelineState } from '../types';

interface OutputPanelProps {
  markdown: string;
  json: StructuredOutput | null;
  pipelineState?: PipelineState;
  isLoading: boolean;
}

const allowedTags = new Set([
  'p',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'br',
  'span',
  'div'
]);

const allowedSpanClasses = new Set(['hl-red', 'hl-yellow', 'hl-blue']);
const allowedDivClasses = new Set(['chunk-separator']);

const sanitizePlugin = () => {
  return (tree: any) => {
    const sanitizeNodes = (nodes: any[]) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];

        if (node.type === 'element') {
          if (!allowedTags.has(node.tagName)) {
            nodes.splice(i, 1);
            continue;
          }

          node.properties = node.properties || {};
          if (node.tagName === 'span') {
            const classList = (node.properties.className as string[] | string | undefined) || [];
            const normalized = Array.isArray(classList) ? classList : String(classList).split(/\s+/);
            const kept = normalized.filter((c) => allowedSpanClasses.has(c));
            if (kept.length) {
              node.properties.className = kept;
            } else {
              delete node.properties.className;
            }
          } else if (node.tagName === 'div') {
            const classList = (node.properties.className as string[] | string | undefined) || [];
            const normalized = Array.isArray(classList) ? classList : String(classList).split(/\s+/);
            const kept = normalized.filter((c) => allowedDivClasses.has(c));
            if (kept.length) {
              node.properties.className = kept;
            } else {
              delete node.properties.className;
            }
          } else {
            delete node.properties.className;
          }

          Object.keys(node.properties).forEach((key) => {
            if (['colspan', 'rowspan'].includes(key)) return;
            if (key === 'className') return;
            if (key.startsWith('on')) delete node.properties[key];
          });
        }

        if (node.children) {
          sanitizeNodes(node.children);
        }
      }
    };

    if (tree.children) {
      sanitizeNodes(tree.children);
    }
  };
};

export const OutputPanel: React.FC<OutputPanelProps> = ({ 
  markdown, 
  json,
  pipelineState,
  isLoading
}) => {
  const [viewMode, setViewMode] = useState<'rich' | 'markers'>('rich');
  const [activeTab, setActiveTab] = useState<'study' | 'coverage'>('study');
  const hasCoverage = Boolean(pipelineState?.outline?.length);

  useEffect(() => {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
      const flashcardsPresent = Boolean((json as any)?.flashcards);
      console.info('[Regression] Flashcards present in output state:', flashcardsPresent);
      console.info('[Regression] Coverage tab available:', hasCoverage);
      console.info('[Regression] Sanitization allows highlight spans:', allowedSpanClasses.size > 0);
      console.info('[Regression] Sanitization blocks script tags:', !allowedTags.has('script'));
    }
  }, [json, hasCoverage]);

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown);
  };

  const handleExportHtml = () => {
    const safeContent = sanitizeForExport(getProcessedContent(markdown));
    const htmlContent = `
      <html>
      <head>
        <style>
          body { font-family: sans-serif; direction: rtl; padding: 20px; }
          .hl-red { background: #ffe4e6; color: #9f1239; font-weight: bold; }
          .hl-yellow { background: #fef9c3; color: #854d0e; font-weight: bold; }
          .hl-blue { background: #eff6ff; color: #1e40af; font-weight: bold; }
        </style>
      </head>
      <body>${safeContent}</body>
      </html>
    `;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'medref-study-guide.html';
    a.click();
  };

  const getProcessedContent = (content: string) => {
    if (viewMode === 'markers') return content;
    // Replace custom highlights or existing spans with standard classes if needed
    // The Gemini prompt generates <span class="hl-red">; sanitization will keep only allowed spans/classes.
    // However, if the model outputs emojis in Phase C (legacy support), we replace them too:
    return content
      .replace(/🟥([\s\S]*?)🟥/g, '<span class="hl-red">$1</span>')
      .replace(/🟨([\s\S]*?)🟨/g, '<span class="hl-yellow">$1</span>')
      .replace(/🟩([\s\S]*?)🟩/g, '<span class="hl-blue">$1</span>'); // Using Blue for 3rd level in this version
  };

  const sanitizeForExport = (content: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');

    doc.querySelectorAll('script,style,iframe').forEach((el) => el.remove());

    const allowedClasses = new Set(['hl-red', 'hl-yellow', 'hl-blue', 'chunk-separator']);
    doc.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        if (attr.name === 'class') {
          const kept = attr.value.split(/\s+/).filter((c) => allowedClasses.has(c));
          if (kept.length) {
            el.setAttribute('class', kept.join(' '));
          } else {
            el.removeAttribute('class');
          }
        } else if (['colspan', 'rowspan'].includes(attr.name)) {
          return;
        } else {
          el.removeAttribute(attr.name);
        }
      });
    });

    return doc.body.innerHTML;
  };

  const markdownComponents: any = {
    a: ({ node, ...props }: any) => (
      <a {...props} target="_blank" rel="noopener noreferrer" className="text-teal-600 underline font-medium" />
    ),
  };

  // Sections Parsing
  const sections = useMemo(() => {
    if (!markdown) return [];
    const splitRegex = /(?=^##\s)/gm;
    const parts = markdown.split(splitRegex);
    return parts.filter(p => p.trim().length > 0);
  }, [markdown]);

  if (isLoading && !markdown) { // Only show full loader if no partial content
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
         {/* Loader handled by parent/PipelineUI usually, but fallback here */}
         <div className="relative">
             <div className="w-16 h-16 border-4 border-slate-200 border-t-teal-500 rounded-full animate-spin"></div>
             <div className="absolute inset-0 flex items-center justify-center">
               <RefreshCw size={24} className="text-teal-500 opacity-50" />
             </div>
         </div>
         <p className="animate-pulse font-medium">Generating...</p>
      </div>
    );
  }

  if (!markdown && !isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
        <Layers size={48} className="opacity-20" />
        <p>No output generated yet.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-200 z-10">
        <div className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
              <div className="flex bg-slate-100 rounded-lg p-1">
                 <button
                   onClick={() => setActiveTab('study')}
                   className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'study' ? 'bg-white shadow text-teal-700' : 'text-slate-500'}`}
                 >
                   Study Guide
                 </button>
                 {hasCoverage && (
                    <button
                      onClick={() => setActiveTab('coverage')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'coverage' ? 'bg-white shadow text-teal-700' : 'text-slate-500'}`}
                    >
                      Coverage
                    </button>
                 )}
             </div>
          </div>
          <div className="flex items-center gap-2">
              <button onClick={handleCopy} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
                <Copy size={18} />
              </button>
              <button onClick={handleExportHtml} title="Export HTML" className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
                <Download size={18} />
              </button>
          </div>
        </div>

        {activeTab === 'study' && (
          <div className="px-4 pb-2 flex flex-wrap items-center justify-between gap-3 text-sm border-b border-slate-100 bg-slate-50/50">
             <div className="flex items-center gap-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm hl-red border-none"></span>
                  <span className="text-slate-600 text-xs">Critical</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm hl-yellow border-none"></span>
                  <span className="text-slate-600 text-xs">Numbers</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm hl-blue border-none"></span>
                  <span className="text-slate-600 text-xs">Key Terms</span>
                </div>
             </div>
             
             <div className="flex items-center gap-2 bg-slate-200 rounded-full p-0.5">
                <button onClick={() => setViewMode('rich')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${viewMode === 'rich' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500'}`}>
                  <Eye size={14} /> Rich
                </button>
                <button onClick={() => setViewMode('markers')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${viewMode === 'markers' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500'}`}>
                  <FileText size={14} /> Text
                </button>
             </div>
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 text-right" dir="rtl">
        {activeTab === 'study' ? (
          <div className="max-w-4xl mx-auto space-y-6">
            {sections.map((sectionContent, index) => {
              const processed = getProcessedContent(sectionContent);
              return (
                <div key={index} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 md:p-8">
                  <article className="prose prose-slate prose-lg max-w-none prose-headings:font-bold prose-headings:text-teal-800 prose-p:leading-8">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw, sanitizePlugin]}
                      components={markdownComponents}
                    >
                      {processed}
                    </ReactMarkdown>
                  </article>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-bold text-lg mb-4 text-slate-800">Pipeline Coverage Report</h3>
            {pipelineState?.outline.length ? (
              <ul className="space-y-3">
                {pipelineState.outline.map(section => (
                  <li key={section.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                    <CheckCircle2 className="text-green-600 shrink-0 mt-1" size={20} />
                    <div>
                      <span className="font-bold text-slate-800 block">{section.title}</span>
                      <span className="text-sm text-slate-500">{section.summary}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">No outline data available.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};