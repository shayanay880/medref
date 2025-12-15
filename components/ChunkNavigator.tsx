import React from 'react';
import { ChunkPlanEntry, ChunkResultState, SectionOutline } from '../types';
import { RotateCw, AlertTriangle, CheckCircle2, PauseCircle } from 'lucide-react';

interface ChunkNavigatorProps {
  chunkPlan?: ChunkPlanEntry[];
  chunkStates: Record<number, ChunkResultState>;
  outline?: SectionOutline[];
  coverageReport?: Record<string, { covered: boolean; chunkIds: number[] }>;
  onRunChunk: (chunkId: number) => void;
  onRetryFailed: () => void;
  onContinueAll: () => void;
  isProcessing: boolean;
}

const statusBadge = (state?: ChunkResultState) => {
  if (!state || state.status === 'pending') return <span className="px-2 py-1 text-xs bg-slate-100 text-slate-600 rounded-full">Pending</span>;
  if (state.status === 'running') return <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">Running</span>;
  if (state.status === 'complete') return <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">Done</span>;
  return <span className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-full">Error</span>;
};

export const ChunkNavigator: React.FC<ChunkNavigatorProps> = ({
  chunkPlan,
  chunkStates,
  outline,
  coverageReport,
  onRunChunk,
  onRetryFailed,
  onContinueAll,
  isProcessing
}) => {
  if (!chunkPlan || !chunkPlan.length) return null;

  const failedCount = chunkPlan.filter((c) => chunkStates[c.chunkId]?.status === 'error').length;
  const pendingCount = chunkPlan.filter((c) => chunkStates[c.chunkId]?.status !== 'complete').length;
  const handleJump = (chunkId: number) => {
    const target = document.getElementById(`chunk-card-${chunkId}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <RotateCw size={16} className="text-teal-600" />
          Chunk Navigator
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onContinueAll}
            disabled={isProcessing || pendingCount === 0}
            className="px-3 py-1.5 text-xs font-semibold bg-teal-600 text-white rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            Continue pipeline
          </button>
          <button
            onClick={onRetryFailed}
            disabled={isProcessing || failedCount === 0}
            className="px-3 py-1.5 text-xs font-semibold border border-amber-300 text-amber-700 rounded-lg disabled:cursor-not-allowed"
          >
            Retry failed chunks
          </button>
        </div>
      </div>
      {outline && outline.length > 0 && (
        <div className="mb-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-600 mb-2">Outline coverage</p>
          <div className="space-y-2 max-h-32 overflow-y-auto pr-1">
            {outline.map((section) => {
              const coverage = coverageReport?.[section.id];
              const isCovered = coverage?.covered;
              return (
                <div key={section.id} className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 text-sm text-slate-700">
                    {isCovered ? (
                      <CheckCircle2 size={14} className="text-green-600 mt-0.5" />
                    ) : (
                      <AlertTriangle size={14} className="text-amber-500 mt-0.5" />
                    )}
                    <span className="font-medium">{section.title}</span>
                  </div>
                  {coverage?.chunkIds?.length ? (
                    <button
                      onClick={() => handleJump(coverage.chunkIds[0])}
                      className="text-xs text-teal-600 font-semibold hover:underline"
                    >
                      Jump to chunk {coverage.chunkIds[0] + 1}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500">Awaiting coverage</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {chunkPlan.map((chunk) => {
          const state = chunkStates[chunk.chunkId];
          return (
            <div
              key={chunk.chunkId}
              id={`chunk-card-${chunk.chunkId}`}
              className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-teal-200"
            >
              <div className="flex items-center gap-3">
                {state?.status === 'complete' ? (
                  <CheckCircle2 size={16} className="text-green-600" />
                ) : state?.status === 'error' ? (
                  <AlertTriangle size={16} className="text-red-600" />
                ) : state?.status === 'running' ? (
                  <RotateCw size={16} className="text-blue-600 animate-spin" />
                ) : (
                  <PauseCircle size={16} className="text-slate-400" />
                )}
                <div>
                  <p className="font-semibold text-sm text-slate-800">{chunk.title}</p>
                  <p className="text-xs text-slate-500">Attempts: {state?.attempts || 0}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {statusBadge(state)}
                <button
                  onClick={() => onRunChunk(chunk.chunkId)}
                  disabled={isProcessing}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed"
                >
                  {state?.status === 'complete' ? 'Rerun' : state?.status === 'error' ? 'Retry' : 'Run'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};