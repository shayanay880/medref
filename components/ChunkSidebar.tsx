import React from 'react';
import { ChunkResultState } from '../types';
import { Play, RefreshCw, Notebook, BadgeInfo } from 'lucide-react';

interface ChunkSidebarProps {
  chunkResults: ChunkResultState[];
  onRunChunk: (index: number) => void;
  onRetryChunk: (index: number) => void;
  onViewNotes: (index: number) => void;
}

const statusStyles: Record<ChunkResultState['status'], { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-slate-100 text-slate-700 border border-slate-200' },
  processing: { label: 'Running', className: 'bg-blue-100 text-blue-700 border border-blue-200' },
  success: { label: 'Complete', className: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  error: { label: 'Failed', className: 'bg-rose-100 text-rose-700 border border-rose-200' }
};

export const ChunkSidebar: React.FC<ChunkSidebarProps> = ({
  chunkResults,
  onRunChunk,
  onRetryChunk,
  onViewNotes
}) => {
  if (!chunkResults || chunkResults.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center gap-2 text-slate-600 text-sm">
          <BadgeInfo size={16} />
          <span>Chunks will appear here after outlining finishes.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-800 text-sm">Chunk Plan</h3>
        <span className="text-xs text-slate-500">{chunkResults.length} parts</span>
      </div>
      <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
        {chunkResults.map((entry) => {
          const status = statusStyles[entry.status];
          const hasNotes = Boolean(entry.data);

          return (
            <div key={entry.chunkId} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Chunk {entry.chunkId + 1}</p>
                  <p className="text-[11px] text-slate-500">
                    {entry.sourceStart !== undefined ? `Chars ${entry.sourceStart} - ${entry.sourceEnd}` : 'Waiting to start'}
                  </p>
                </div>
                <span className={`text-[11px] px-2 py-1 rounded-full font-semibold ${status.className}`}>
                  {status.label}
                </span>
              </div>
              {entry.lastError && (
                <p className="text-[11px] text-rose-600 mb-2">{entry.lastError}</p>
              )}
              <div className="flex items-center justify-between text-[11px] text-slate-600 mb-2">
                <span>Attempts: {entry.attempts}</span>
              </div>
              <div className="flex gap-2">
                {entry.status === 'pending' && (
                  <button
                    className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700"
                    onClick={() => onRunChunk(entry.chunkId)}
                  >
                    <Play size={14} /> Run
                  </button>
                )}
                {entry.status === 'error' && (
                  <button
                    className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1.5 rounded bg-rose-600 text-white hover:bg-rose-700"
                    onClick={() => onRetryChunk(entry.chunkId)}
                  >
                    <RefreshCw size={14} /> Retry
                  </button>
                )}
                {entry.status === 'success' && (
                  <button
                    className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() => onRetryChunk(entry.chunkId)}
                  >
                    <RefreshCw size={14} /> Retry
                  </button>
                )}
                <button
                  className={`flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1.5 rounded border ${hasNotes ? 'border-teal-200 text-teal-700 bg-teal-50' : 'border-slate-200 text-slate-600 bg-white'} hover:border-teal-300`}
                  onClick={() => onViewNotes(entry.chunkId)}
                >
                  <Notebook size={14} /> Notes
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};