import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Copy, Download, Layers, RefreshCw, Eye, FileText, CheckCircle2, AlertTriangle, Wand2 } from 'lucide-react';
import { StructuredOutput, PipelineState, HighlightDensity } from '../types';
import { ConflictEvidence, ConflictResolutionItem, resolveConflictValues } from '../services/geminiService';

interface OutputPanelProps {
  markdown: string;
  json: StructuredOutput | null;
  pipelineState?: PipelineState;
  isLoading: boolean;
  highlightDensity: HighlightDensity;
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

const highlightLimits: Record<HighlightDensity, Record<'R' | 'Y' | 'B', number>> = {
  Low: { R: 3, Y: 8, B: 4 },
  Medium: { R: 6, Y: 14, B: 8 },
  High: { R: 8, Y: 18, B: 12 }
};

const markerClassMap: Record<'R' | 'Y' | 'B', string> = {
  R: 'hl-red',
  Y: 'hl-yellow',
  B: 'hl-blue'
};

type NumericEvidence = {
  value: string;
  context: string;
  contextKey: string;
  sourceLabel: string;
};

type ConflictWarning = {
  contextKey: string;
  contextLabel: string;
  values: string[];
  items: NumericEvidence[];
};

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

const applyHighlightMarkers = (content: string, density: HighlightDensity) => {
  const limits = highlightLimits[density] || highlightLimits.Medium;
  const counts: Record<'R' | 'Y' | 'B', number> = { R: 0, Y: 0, B: 0 };

  return content.replace(/\[\[(R|Y|B)\]\]([\s\S]*?)\[\[\/\1\]\]/g, (_match, marker: 'R' | 'Y' | 'B', inner: string) => {
    counts[marker] += 1;
    if (counts[marker] > limits[marker]) {
      return inner;
    }
    const className = markerClassMap[marker];
    return `<span class="${className}">${inner}</span>`;
  });
};

const numberPattern = /[<>]?\s?\d+(?:[.,]\d+)?(?:\s?[–-]\s?\d+(?:[.,]\d+)?)?(?:\s?(?:%|mg\/kg|mL\/kg|mL|mg|cm|mmHg|°C|bpm|g\/dL|g|kg|hours?|hrs?|minutes?|mins?|sec|seconds?|weeks?|months?|سال|روز|دقیقه|ساعت))?/gi;

const normalizeContextKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(numberPattern, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripMarkup = (text: string) => text.replace(/<[^>]+>/g, '').replace(/🟨|🟥|🟩/g, '').trim();

export const OutputPanel: React.FC<OutputPanelProps> = ({ 
  markdown, 
  json,
  pipelineState,
  isLoading,
  highlightDensity
}) => {
  const [viewMode, setViewMode] = useState<'rich' | 'markers'>('rich');
  const [activeTab, setActiveTab] = useState<'study' | 'coverage'>('study');
  const hasCoverage = Boolean(pipelineState?.outline?.length);
  const coverageReport = pipelineState?.coverageReport || {};
  const [resolutionNotes, setResolutionNotes] = useState<ConflictResolutionItem[]>([]);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const handleJumpToChunk = (chunkId: number) => {
    const target = document.getElementById(`chunk-card-${chunkId}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
      const flashcardsPresent = Boolean((json as any)?.flashcards);
      console.info('[Regression] Flashcards present in output state:', flashcardsPresent);
      console.info('[Regression] Coverage tab available:', hasCoverage);
      console.info('[Regression] Sanitization allows highlight spans:', allowedSpanClasses.size > 0);
      console.info('[Regression] Sanitization blocks script tags:', !allowedTags.has('script'));
    }
  }, [json, hasCoverage]);

  const numericEvidence = useMemo<NumericEvidence[]>(() => {
    const findings: NumericEvidence[] = [];
    if (markdown) {
      markdown.split('\n').forEach((line) => {
        const spanRegex = /<span[^>]*class=["']?hl-yellow["']?[^>]*>(.*?)<\/span>/gi;
        const markerRegex = /\[\[Y\]\]([\s\S]*?)\[\[\/Y\]\]/g; // Updated to check for bracketed markers too

        let match;
        while ((match = spanRegex.exec(line)) !== null) {
          const value = match[1].trim();
          const context = stripMarkup(line).slice(0, 200);
          const contextKey = normalizeContextKey(context || value);
          if (contextKey) {
            findings.push({ value, context, contextKey, sourceLabel: 'Final Markdown' });
          }
        }

        while ((match = markerRegex.exec(line)) !== null) {
          const value = match[1].trim();
          const context = stripMarkup(line).slice(0, 200);
          const contextKey = normalizeContextKey(context || value);
          if (contextKey) {
            findings.push({ value, context, contextKey, sourceLabel: 'Final Markdown (marker)' });
          }
        }
      });
    }

    (pipelineState?.chunkResults || []).forEach((chunk) => {
      (chunk.numbers || []).forEach((entry) => {
        const context = stripMarkup(entry).slice(0, 200);
        const matches = Array.from(context.matchAll(numberPattern));
        if (!matches.length) return;

        matches.forEach((m) => {
          const value = (m[0] || '').trim();
          const contextKey = normalizeContextKey(context || value);
          if (contextKey) {
            findings.push({
              value,
              context,
              contextKey,
              sourceLabel: `Chunk ${chunk.chunkId + 1}`
            });
          }
        });
      });
    });

    return findings;
  }, [markdown, pipelineState?.chunkResults]);

  const conflictWarnings = useMemo<ConflictWarning[]>(() => {
    const grouped = new Map<string, NumericEvidence[]>();
    numericEvidence.forEach((evidence) => {
      if (!evidence.contextKey) return;
      const existing = grouped.get(evidence.contextKey) || [];
      existing.push(evidence);
      grouped.set(evidence.contextKey, existing);
    });

    const conflicts: ConflictWarning[] = [];
    grouped.forEach((items, key) => {
      const values = Array.from(new Set(items.map((i) => i.value))).filter(Boolean);
      if (values.length > 1) {
        conflicts.push({
          contextKey: key,
          contextLabel: items[0]?.context || key,
          values,
          items,
        });
      }
    });

    return conflicts;
  }, [numericEvidence]);

  useEffect(() => {
    setResolutionNotes([]);
    setResolveError(null);
  }, [markdown]);

  const resolutionByContext = useMemo(() => {
    const map = new Map<string, ConflictResolutionItem>();
    resolutionNotes.forEach((note) => {
      map.set(normalizeContextKey(note.contextLabel), note);
    });
    return map;
  }, [resolutionNotes]);

  const handleResolveConflicts = async () => {
    if (!conflictWarnings.length) return;
    setIsResolving(true);
    setResolveError(null);

    const payload: ConflictEvidence[] = conflictWarnings.map((conflict) => ({
      contextLabel: conflict.contextLabel,
      values: conflict.values,
      snippets: conflict.items.map((item) => ({
        value: item.value,
        context: item.context,
        source: item.sourceLabel,
      })),
    }));

    try {
      const results = await resolveConflictValues(payload);
      setResolutionNotes(results);
    } catch (err: any) {
      setResolveError(err?.message || 'Conflict resolver failed');
    } finally {
      setIsResolving(false);
    }
  };

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
    return applyHighlightMarkers(content, highlightDensity);
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
      {conflictWarnings.length > 0 && (
        <div className="px-4 md:px-8 pt-4">
          <div className="max-w-4xl mx-auto bg-amber-50 border border-amber-200 rounded-xl shadow-sm p-4 md:p-6 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-amber-800 font-semibold">
                <AlertTriangle size={18} />
                <span>Potential numeric conflicts detected</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setViewMode('markers')}
                  className="text-xs font-medium text-amber-800 bg-white border border-amber-200 rounded-full px-3 py-1"
                >
                  Review highlighted numbers
                </button>
                <button
                  onClick={handleResolveConflicts}
                  disabled={isResolving}
                  className={`text-xs font-medium flex items-center gap-1 px-3 py-1 rounded-full border ${isResolving ? 'bg-amber-100 text-amber-600 border-amber-200' : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-100'}`}
                >
                  <Wand2 size={14} />
                  {isResolving ? 'Resolving...' : 'Propose resolution'}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {conflictWarnings.map((conflict) => {
                const resolution = resolutionByContext.get(conflict.contextKey);
                return (
                  <div key={conflict.contextKey} className="bg-white border border-amber-100 rounded-lg p-3 md:p-4 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
                    <div className="font-semibold text-amber-900">
                      {conflict.values.join(' vs ')}
                    </div>
                    <p className="text-sm text-slate-700 mt-1">{conflict.contextLabel}</p>
                    <p className="text-xs text-slate-500 mt-1">Sources: {conflict.items.map((i) => i.sourceLabel).join(', ')}</p>
                    {resolution && (
                      <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-md p-3 text-emerald-800 text-sm">
                        <div className="font-semibold">Model suggestion: {resolution.resolvedValue}</div>
                        <p className="mt-1 leading-relaxed">{resolution.rationale}</p>
                        {resolution.sources?.length > 0 && (
                          <p className="mt-1 text-xs text-emerald-700">Based on: {resolution.sources.join(', ')}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {resolveError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{resolveError}</p>
            )}
          </div>
        </div>
      )}

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
                {pipelineState.outline.map(section => {
                  const coverage = coverageReport[section.id];
                  const isCovered = coverage?.covered;
                  return (
                    <li key={section.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                      {isCovered ? (
                        <CheckCircle2 className="text-green-600 shrink-0 mt-1" size={20} />
                      ) : (
                        <RefreshCw className="text-amber-500 shrink-0 mt-1" size={20} />
                      )}
                      <div className="flex-1">
                        <span className="font-bold text-slate-800 block">{section.title}</span>
                        <span className="text-sm text-slate-500 block mb-2">{section.summary}</span>
                        {coverage?.chunkIds?.length ? (
                          <div className="flex flex-wrap gap-2 text-xs">
                            {coverage.chunkIds.map((chunkId) => (
                              <button
                                key={chunkId}
                                onClick={() => handleJumpToChunk(chunkId)}
                                className="px-2 py-1 bg-teal-50 text-teal-700 rounded-md border border-teal-100 hover:bg-teal-100"
                              >
                                Jump to chunk {chunkId + 1}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">Coverage pending</span>
                        )}
                      </div>
                    </li>
                  );
                })}
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