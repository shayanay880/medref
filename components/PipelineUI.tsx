import React from 'react';
import { PipelineState } from '../types';
import { Loader2, CheckCircle2, Circle, AlertTriangle, FileText, Layers, Combine } from 'lucide-react';

interface PipelineUIProps {
  state: PipelineState;
  onRetry?: () => void;
}

export const PipelineUI: React.FC<PipelineUIProps> = ({ state, onRetry }) => {
  if (state.status === 'idle') return null;

  const steps = [
    { id: 'outlining', label: 'Phase A: Structural Analysis', icon: Layers },
    { id: 'chunking', label: `Phase B: Extraction (${state.processedChunks}/${state.totalChunks})`, icon: FileText },
    { id: 'stitching', label: 'Phase C: Synthesis & Teaching', icon: Combine },
  ];

  const getCurrentStepIndex = () => {
    if (state.status === 'outlining') return 0;
    if (state.status === 'chunking') return 1;
    if (state.status === 'stitching') return 2;
    if (state.status === 'complete') return 3;
    return -1;
  };

  const currentIdx = getCurrentStepIndex();

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-700 flex items-center gap-2">
           <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse"></span>
           Deep Processing Pipeline
        </h3>
        {state.status === 'error' && (
           <span className="text-xs text-red-600 font-bold px-2 py-1 bg-red-50 rounded border border-red-100">
             Error Occurred
           </span>
        )}
      </div>

      <div className="space-y-4">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          let statusColor = 'text-slate-400';
          let bgColor = 'bg-slate-100';
          let border = 'border-slate-200';
          
          if (idx < currentIdx || state.status === 'complete') {
            statusColor = 'text-teal-600';
            bgColor = 'bg-teal-50';
            border = 'border-teal-200';
          } else if (idx === currentIdx && state.status !== 'error') {
            statusColor = 'text-blue-600';
            bgColor = 'bg-blue-50';
            border = 'border-blue-200';
          }

          return (
            <div key={step.id} className={`flex items-center gap-3 p-3 rounded-lg border ${border} ${bgColor} transition-all`}>
              <div className={`${statusColor}`}>
                {idx < currentIdx || state.status === 'complete' ? (
                  <CheckCircle2 size={20} />
                ) : idx === currentIdx && state.status !== 'error' ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Circle size={20} />
                )}
              </div>
              <div className="flex-1">
                <p className={`text-sm font-medium ${idx === currentIdx ? 'text-slate-900' : 'text-slate-500'}`}>
                  {step.label}
                </p>
                {idx === 1 && state.status === 'chunking' && (
                  <div className="w-full bg-slate-200 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div 
                      className="bg-blue-500 h-full transition-all duration-500"
                      style={{ width: `${(state.processedChunks / Math.max(state.totalChunks, 1)) * 100}%` }}
                    />
                  </div>
                )}
              </div>
              <Icon size={18} className="text-slate-300" />
            </div>
          );
        })}
      </div>

      {state.status === 'error' && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
           <div className="flex items-center gap-2 text-red-700 text-sm">
             <AlertTriangle size={16} />
             <span>{state.currentError || "Process failed."}</span>
           </div>
           {onRetry && (
             <button onClick={onRetry} className="text-xs font-bold text-red-700 hover:underline">
               Retry
             </button>
           )}
        </div>
      )}
    </div>
  );
};