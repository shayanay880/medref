import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Copy, Download, Layers, RefreshCw, Eye, FileText, CheckCircle2, AlertTriangle, Wand2 } from 'lucide-react';
import { StructuredOutput, PipelineState, HighlightDensity, OutlinePriority } from '../types';
import { ConflictEvidence, ConflictResolutionItem, resolveConflictValues } from '../services/geminiService';

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

const PRIORITY_RANK: Record<OutlinePriority, number> = { high: 3, medium: 2, low: 1 };
const normalizePriority = (priority?: string): OutlinePriority => {
  const normalized = (priority || '').toLowerCase();
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') return normalized as OutlinePriority;
  return 'medium';
};
const priorityBadge = (priority: OutlinePriority) => {
  const styles: Record<OutlinePriority, string> = {
    high: 'bg-red-50 text-red-700 border border-red-100',
    medium: 'bg-amber-50 text-amber-700 border border-amber-100',
    low: 'bg-slate-50 text-slate-600 border border-slate-200'
  };
  const labels: Record<OutlinePriority, string> = {
    high: 'High priority',
    medium: 'Medium priority',
    low: 'Low priority'
  };
  return <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full font-semibold ${styles[priority]}`}>{labels[priority]}</span>;
};

type NumericEvidence = {
  value: string;
  context: string;
  contextKey: string;
  sourceLabel: string;
};

type ClusterValue = {
  normalizedValue: string;
  displayValue: string;
  sources: string[];
  snippets: string[];
};

type NumberCluster = {
  key: string;
  label: string;
  type: NumericType;
  unit: string;
  values: ClusterValue[];
};

type NumericType = 'dose' | 'duration' | 'percentage' | 'length' | 'age' | 'count' | 'other';

type NumericItem = {
  rawValue: string;
  normalizedValue: string;
  label: string;
  labelKey: string;
  type: NumericType;
  unit: string;
  snippet: string;
  sourceLabel: string;
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

const numberPattern = /\d+(?:[.,]\d+)?(?:\s?[–-]\s?\d+(?:[.,]\d+)?)?(?:\s?(?:%|mg\/kg|mg\/day|mg|g|g\/dL|mL\/kg|mL|cm|mm|mmHg|°C|bpm|kg|hours?|hrs?|minutes?|mins?|sec|seconds?|weeks?|months?|سال|روز|دقیقه|ساعت|روزها|هفته|ماه))?/gi;

const normalizeContextKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(numberPattern, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripMarkup = (text: string) => text.replace(/<[^>]+>/g, '').replace(/🟨|🟥|🟩/g, '').replace(/\[\[[A-Z]\]\]|\[\[\/[A-Z]\]\]/g, '').trim();

const normalizeNumericValue = (value: string) =>
  value.replace(/\s+/g, '').replace(/[–—]/g, '-').replace(/٫/g, '.').trim();

const normalizeUnit = (unit: string) => {
  const lookup: Record<string, string> = {
    '%': '%',
    'mg/kg': 'mg/kg',
    'mg/day': 'mg/day',
    mg: 'mg',
    g: 'g',
    'g/dl': 'g/dL',
    'g/dL': 'g/dL',
    'ml/kg': 'mL/kg',
    ml: 'mL',
    cm: 'cm',
    mm: 'mm',
    mmhg: 'mmHg',
    '°c': '°C',
    bpm: 'bpm',
    kg: 'kg',
    hour: 'h',
    hours: 'h',
    hr: 'h',
    hrs: 'h',
    minute: 'min',
    minutes: 'min',
    min: 'min',
    mins: 'min',
    second: 'sec',
    seconds: 'sec',
    sec: 'sec',
    week: 'wk',
    weeks: 'wk',
    month: 'mo',
    months: 'mo',
    روز: 'روز',
    روزها: 'روز',
    ساعت: 'ساعت',
    دقیقه: 'دقیقه',
    هفته: 'هفته',
    ماه: 'ماه'
  };
  const key = unit.toLowerCase();
  return lookup[key] || unit;
};

const classifyNumericType = (unit: string, context: string): NumericType => {
  const lcContext = context.toLowerCase();
  if (/%/.test(unit) || lcContext.includes('٪')) return 'percentage';
  if (/mg|g|\bkg\b|mcg/.test(unit) || /dose|دوز|mg\/kg/i.test(lcContext)) return 'dose';
  if (/h|hr|min|sec|ساعت|دقیقه/.test(unit) || /(duration|course|مدت)/i.test(lcContext)) return 'duration';
  if (/cm|mm|mmhg|°c/.test(unit)) return 'length';
  if (/(سال|year)/i.test(lcContext)) return 'age';
  return 'count';
};

const extractUnitFromValue = (value: string) => {
  const unitMatch = value.match(/(mg\/kg|mg\/day|mg|g\/dL|g|mL\/kg|mL|kg|cm|mmHg|mm|°C|bpm|%|hours?|hrs?|minutes?|mins?|sec|seconds?|weeks?|months?|سال|روز|دقیقه|ساعت|هفته|ماه)/i);
  return unitMatch ? normalizeUnit(unitMatch[1]) : '';
};

const inferLabelFromContext = (context: string) => {
  const clean = stripMarkup(context);
  const tokenized = clean.replace(numberPattern, ' [[NUM]] ');
  const idx = tokenized.indexOf('[[NUM]]');
  if (idx === -1) return clean.slice(0, 80) || 'Unlabeled number';
  const before = tokenized.slice(Math.max(0, idx - 80), idx).split(' ').slice(-8).join(' ');
  const after = tokenized.slice(idx + 7, idx + 80).split(' ').slice(0, 8).join(' ');
  const label = `${before} ${after}`.trim();
  return label || clean.slice(0, 80) || 'Unlabeled number';
};

const buildNumericItem = (value: string, context: string, sourceLabel: string): NumericItem => {
  const unit = extractUnitFromValue(value);
  const normalizedValue = normalizeNumericValue(value);
  const label = inferLabelFromContext(context);
  const labelKey = normalizeContextKey(label) || 'unlabeled';
  const type = classifyNumericType(unit, context);
  return {
    rawValue: value.trim(),
    normalizedValue,
    label,
    labelKey,
    type,
    unit,
    snippet: stripMarkup(context).slice(0, 160),
    sourceLabel
  };
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
  const hasCoverage = Boolean(pipelineState?.outline?.length);
  const coverageReport = pipelineState?.coverageReport || {};
  const [resolutionNotes, setResolutionNotes] = useState<ConflictResolutionItem[]>([]);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [numbersPanelOpen, setNumbersPanelOpen] = useState(true);
  const [numbersViewMode, setNumbersViewMode] = useState<'clusters' | 'conflicts'>('clusters');
  const [readingMode, setReadingMode] = useState<'Exam' | 'Deep'>('Exam');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  
  const sortedOutline = useMemo(() => {
    const outlineWithPriority = (pipelineState?.outline || []).map((section) => ({
      ...section,
      priority: normalizePriority((section as any).priority)
    }));
    return outlineWithPriority.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
  }, [pipelineState?.outline]);

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

  useEffect(() => {
    setExpandedSections(new Set());
  }, [readingMode]);

  const toggleSection = (title: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  const numericItems = useMemo<NumericItem[]>(() => {
    const findings: NumericItem[] = [];
    if (markdown) {
      markdown.split('\n').forEach((line) => {
        const spanRegex = /<span[^>]*class=["']?hl-yellow["']?[^>]*>(.*?)<\/span>/gi;
        const markerRegex = /\[\[Y\]\]([\s\S]*?)\[\[\/Y\]\]/g;

        let match;
        while ((match = spanRegex.exec(line)) !== null) {
          const value = match[1].trim();
          const context = stripMarkup(line).slice(0, 200);
          if (value) findings.push(buildNumericItem(value, context, 'Final Markdown (span)'));
        }

        while ((match = markerRegex.exec(line)) !== null) {
          const value = match[1].trim();
          const context = stripMarkup(line).slice(0, 200);
          if (value) findings.push(buildNumericItem(value, context, 'Final Markdown (marker)'));
        }
      });
    }

    (pipelineState?.chunkResults || []).forEach((chunk) => {
      (chunk.numbers || []).forEach((entry) => {
        const context = stripMarkup(entry).slice(0, 220) || entry;
        const matches = Array.from(context.matchAll(numberPattern));
        if (!matches.length) return;

        matches.forEach((m) => {
          const value = (m[0] || '').trim();
          if (value) {
            findings.push(buildNumericItem(value, context, `Chunk ${chunk.chunkId + 1}`));
          }
        });
      });
    });

    return findings;
  }, [markdown, pipelineState?.chunkResults]);

  const numberClusters = useMemo<NumberCluster[]>(() => {
    const grouped = new Map<string, NumberCluster>();

    numericItems.forEach((item) => {
      const key = `${item.labelKey}__${item.type}__${item.unit || 'unitless'}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          label: item.label,
          type: item.type,
          unit: item.unit,
          values: []
        });
      }

      const cluster = grouped.get(key)!;
      const existing = cluster.values.find((v) => v.normalizedValue === item.normalizedValue);
      if (existing) {
        if (!existing.sources.includes(item.sourceLabel)) existing.sources.push(item.sourceLabel);
        if (!existing.snippets.includes(item.snippet)) existing.snippets.push(item.snippet);
      } else {
        cluster.values.push({
          normalizedValue: item.normalizedValue,
          displayValue: item.rawValue,
          sources: [item.sourceLabel],
          snippets: item.snippet ? [item.snippet] : []
        });
      }
    });

    return Array.from(grouped.values())
      .map((cluster) => ({
        ...cluster,
        values: cluster.values.sort((a, b) => a.normalizedValue.localeCompare(b.normalizedValue))
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [numericItems]);

  const conflictClusters = useMemo(() => numberClusters.filter((cluster) => cluster.values.length > 1), [numberClusters]);

  const hasNumberClusters = numberClusters.length > 0;
  const hasTrueConflicts = conflictClusters.length > 0;

  useEffect(() => {
    if (!hasNumberClusters) {
      setNumbersPanelOpen(false);
    }
  }, [hasNumberClusters]);

  useEffect(() => {
    if (numbersViewMode === 'conflicts' && !hasTrueConflicts) {
      setNumbersViewMode('clusters');
    }
  }, [numbersViewMode, hasTrueConflicts]);

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
    if (!conflictClusters.length) return;
    setIsResolving(true);
    setResolveError(null);

    const payload: ConflictEvidence[] = conflictClusters.map((conflict) => ({
      contextLabel: `${conflict.label} ${conflict.unit ? '(' + conflict.unit + ')' : ''}`.trim(),
      values: conflict.values.map((v) => v.displayValue),
      snippets: conflict.values.flatMap((item) =>
        (item.snippets.length ? item.snippets : [item.displayValue]).map((snippet) => ({
          value: item.displayValue,
          context: snippet,
          source: item.sources.join(', '),
        }))
      ),
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

  const clustersToDisplay = numbersViewMode === 'conflicts' ? conflictClusters : numberClusters;
  const pinnedExamTitles = useMemo(
    () => [
      'تنظیمات خروجی',
      'عنوان + نقشه راه',
      'نسخه‌ی خیلی ساده (TL;DR)',
      'عددها و آستانه‌ها (Numbers & Cutoffs)',
      'الگوریتم عملی (IF/THEN)',
      'دام‌ها و اشتباهات رایج (Pitfalls)',
    ],
    []
  );

  const getSectionTitleFromContent = (content: string, index: number) => {
    const match = content.match(/^##\s*\d+\)\s*([^\n]+)/m);
    return match ? match[1].trim() : `Section ${index + 1}`;
  };

  const isExamMode = readingMode === 'Exam';
  const isDeepMode = readingMode === 'Deep';

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
             <div className="flex items-center gap-2 bg-slate-200 rounded-full p-0.5">
                <button onClick={() => setReadingMode('Exam')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${isExamMode ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500'}`}>
                  Exam Mode
                </button>
                <button onClick={() => setReadingMode('Deep')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${isDeepMode ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500'}`}>
                  Deep Mode
                </button>
             </div>
          </div>
        )}
      </div>

      {isGoalStale && (pipelineState?.chunkResults?.length || 0) > 0 && (
        <div className="mx-4 mt-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle size={18} />
            <span>Title/tags changed — output reflects previous goal. Re-synthesize?</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onResynthesizeStitch}
              disabled={isLoading || !onResynthesizeStitch}
              className="flex items-center gap-2 px-3 py-2 bg-amber-700 text-white text-sm font-semibold rounded-md shadow hover:bg-amber-800 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw size={16} />
              {isLoading ? 'Re-synthesizing...' : 'Re-run stitch'}
            </button>
          </div>
        </div>
      )}

      {/* Coverage Numbers Panel */}
      {activeTab === 'coverage' && hasNumberClusters && (
        <div className="px-4 md:px-8 pt-4">
          {numbersPanelOpen ? (
            <div className="max-w-4xl mx-auto bg-slate-50 border border-slate-200 rounded-xl shadow-sm p-4 md:p-6 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 font-semibold text-slate-800">
                    <AlertTriangle size={18} className={numbersViewMode === 'conflicts' ? 'text-amber-600' : 'text-slate-500'} />
                    <span>{numbersViewMode === 'conflicts' ? 'True conflicts' : 'Number clusters'} ({clustersToDisplay.length})</span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Dose vs duration are never compared; conflicts only appear when the same label, type, and unit disagree.
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <button
                    onClick={() => setViewMode('markers')}
                    className="text-xs font-medium text-teal-700 bg-white border border-teal-200 rounded-full px-3 py-1"
                  >
                    Review highlighted numbers
                  </button>
                  {hasTrueConflicts && (
                    <button
                      onClick={handleResolveConflicts}
                      disabled={isResolving}
                      className={`text-xs font-medium flex items-center gap-1 px-3 py-1 rounded-full border ${isResolving ? 'bg-amber-100 text-amber-600 border-amber-200' : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-100'}`}
                    >
                      <Wand2 size={14} />
                      {isResolving ? 'Resolving...' : 'Propose resolution'}
                    </button>
                  )}
                  <button
                    onClick={() => setNumbersPanelOpen(false)}
                    className="text-xs font-medium px-3 py-1 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  >
                    Close / Back to Coverage
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setNumbersViewMode('clusters')}
                  className={`text-xs px-3 py-1.5 rounded-full border ${numbersViewMode === 'clusters' ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                >
                  Number clusters
                </button>
                <button
                  onClick={() => setNumbersViewMode('conflicts')}
                  disabled={!hasTrueConflicts}
                  className={`text-xs px-3 py-1.5 rounded-full border ${numbersViewMode === 'conflicts' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'} ${!hasTrueConflicts ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  True conflicts
                </button>
              </div>

              <div className="space-y-3">
                {clustersToDisplay.length === 0 && (
                  <p className="text-sm text-slate-700">No true conflicts detected. Numbers are grouped below for reference.</p>
                )}
                {clustersToDisplay.map((cluster) => {
                  const resolution = resolutionByContext.get(normalizeContextKey(cluster.label));
                  return (
                    <div key={cluster.key} className="bg-white border border-slate-200 rounded-lg p-3 md:p-4 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{cluster.label}</div>
                          <p className="text-xs text-slate-500 mt-0.5">Type: {cluster.type} · Unit: {cluster.unit || 'unitless'}</p>
                        </div>
                        <span className="text-[11px] text-slate-600 bg-slate-100 px-2 py-1 rounded-md">Values {cluster.values.length}</span>
                      </div>

                      <div className="mt-3 space-y-2">
                        {cluster.values.map((value) => (
                          <div key={value.normalizedValue} className="border border-slate-100 rounded-md p-2 bg-slate-50">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-slate-800">{value.displayValue}</span>
                              <span className="text-[11px] text-slate-600">Sources: {value.sources.join(', ')}</span>
                            </div>
                            {value.snippets.length > 0 && (
                              <details className="mt-1 text-xs text-slate-600">
                                <summary className="cursor-pointer text-teal-700">Sources ({value.snippets.length})</summary>
                                <ul className="list-disc pl-4 mt-1 space-y-1 text-slate-600">
                                  {value.snippets.map((snippet, idx) => (
                                    <li key={idx}>{snippet}</li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>

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
          ) : (
            <div className="max-w-4xl mx-auto bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-800">Numbers panel hidden</p>
                <p className="text-sm text-slate-600">Reopen to review clusters and conflicts without losing coverage navigation.</p>
              </div>
              <button
                onClick={() => setNumbersPanelOpen(true)}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 shadow-sm"
              >
                Open numbers review
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 md:p-8 text-right" dir="rtl">
        {activeTab === 'study' ? (
          <div className="max-w-4xl mx-auto space-y-6">
            {sections.map((sectionContent, index) => {
              const sectionTitle = getSectionTitleFromContent(sectionContent, index);
              const sectionKey = `${index}-${sectionTitle}`;
              const pinnedForExam = isExamMode && pinnedExamTitles.some((title) => sectionTitle.includes(title));
              const isCollapsed = isDeepMode
                ? !expandedSections.has(sectionKey)
                : isExamMode
                  ? !pinnedForExam && !expandedSections.has(sectionKey)
                  : false;
              const preview = stripMarkup(sectionContent).slice(0, 220);
              const processed = !isCollapsed ? getProcessedContent(sectionContent) : '';
              return (
                <div key={index} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 md:p-8">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <p className="text-[11px] text-slate-500">Section {index + 1}</p>
                      <h4 className="font-bold text-slate-800 text-lg">{sectionTitle}</h4>
                    </div>
                    {(isDeepMode || !pinnedForExam) && (
                      <button
                        onClick={() => toggleSection(sectionKey)}
                        className="text-xs font-medium text-teal-700 bg-teal-50 border border-teal-100 px-3 py-1 rounded-full hover:bg-teal-100"
                      >
                        {isCollapsed ? 'Expand' : 'Collapse'}
                      </button>
                    )}
                  </div>

                  {isCollapsed ? (
                    <p className="text-sm text-slate-600 leading-7">{preview}{preview.length >= 220 ? '…' : ''}</p>
                  ) : (
                    <article className="prose prose-slate prose-lg max-w-none prose-headings:font-bold prose-headings:text-teal-800 prose-p:leading-8">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw, sanitizePlugin]}
                        components={markdownComponents}
                      >
                        {processed}
                      </ReactMarkdown>
                    </article>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-bold text-lg mb-4 text-slate-800">Pipeline Coverage Report</h3>
            {sortedOutline.length ? (
              <ul className="space-y-3">
                {sortedOutline.map(section => {
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-800 block">{section.title}</span>
                          {priorityBadge(normalizePriority((section as any).priority))}
                        </div>
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