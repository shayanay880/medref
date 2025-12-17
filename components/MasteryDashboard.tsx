import React from 'react';
import { AlertTriangle, CheckCircle2, Lightbulb, RefreshCw } from 'lucide-react';
import { ChunkPlanEntry, MasteryStatus, SectionOutline } from '../types';

interface MasteryDashboardProps {
  outline: SectionOutline[];
  masteryStatus?: MasteryStatus;
  coverageReport?: Record<string, { covered: boolean; chunkIds: number[] }>;
  chunkPlan?: ChunkPlanEntry[];
  onRunChunk: (chunkId: number) => void;
  isProcessing: boolean;
}

const statusColor: Record<string, string> = {
  mastered: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  learning: 'bg-amber-50 text-amber-700 border-amber-100',
  unstarted: 'bg-slate-50 text-slate-600 border-slate-200'
};

export const MasteryDashboard: React.FC<MasteryDashboardProps> = ({
  outline,
  masteryStatus,
  coverageReport,
  chunkPlan,
  onRunChunk,
  isProcessing
}) => {
  if (!outline?.length) return null;

  const scorePercent = Math.round((masteryStatus?.score || 0) * 100);
  const atRiskSections = outline.filter((section) => {
    const progress = masteryStatus?.sectionProgress?.[section.id];
    if (!progress) return true;
    return progress.masteryScore < 0.75 || progress.status !== 'mastered';
  });

  const getSectionChunks = (sectionId: string) => {
    const byCoverage = coverageReport?.[sectionId]?.chunkIds || [];
    const planned = chunkPlan?.filter((entry) => entry.outlineIds?.includes(sectionId)).map((entry) => entry.chunkId) || [];
    return Array.from(new Set([...byCoverage, ...planned]));
  };

  const handleJumpToChunk = (chunkId: number) => {
    const target = document.getElementById(`chunk-card-${chunkId}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4 p-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-semibold text-slate-500">Study mastery</p>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-teal-500 to-emerald-500"
                  style={{ width: `${Math.min(scorePercent, 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {masteryStatus?.completedSections || 0} / {masteryStatus?.totalSections || outline.length} sections mastered ·
                Mastery score {scorePercent}%
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
          <Lightbulb size={14} className="text-amber-500" />
          Focus on low-confidence sections to boost recall.
        </div>
      </div>

      {atRiskSections.length > 0 ? (
        <div className="space-y-3">
          {atRiskSections.map((section) => {
            const progress = masteryStatus?.sectionProgress?.[section.id];
            const completion = Math.round((progress?.completion || 0) * 100);
            const mastery = Math.round((progress?.masteryScore || 0) * 100);
            const chunks = getSectionChunks(section.id);
            const isCovered = coverageReport?.[section.id]?.covered;
            const statusKey = progress?.status || 'unstarted';

            return (
              <div
                key={section.id}
                className="border border-slate-200 rounded-lg p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
              >
                <div className="flex items-start gap-2">
                  {isCovered ? (
                    <CheckCircle2 size={16} className="text-emerald-600 mt-0.5" />
                  ) : (
                    <AlertTriangle size={16} className="text-amber-500 mt-0.5" />
                  )}
                  <div>
                    <p className="font-semibold text-slate-800">{section.title}</p>
                    <p className="text-xs text-slate-500">Completion {completion}% · Mastery {mastery}%</p>
                    <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border ${statusColor[statusKey]}`}>
                      {statusKey === 'mastered' ? 'Mastered' : statusKey === 'learning' ? 'In progress' : 'Not started'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {chunks.length > 0 ? (
                    <>
                      <button
                        onClick={() => handleJumpToChunk(chunks[0])}
                        className="px-2.5 py-1 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-100 rounded-md hover:bg-teal-100"
                      >
                        Jump to chunk {chunks[0] + 1}
                      </button>
                      <button
                        onClick={() => onRunChunk(chunks[0])}
                        disabled={isProcessing}
                        className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 disabled:opacity-60"
                      >
                        <RefreshCw size={12} className="inline mr-1" /> Regenerate
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">Waiting for extraction plan</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-600">All sections look strong. Keep reviewing active-recall prompts for mastery.</p>
      )}
    </div>
  );
};