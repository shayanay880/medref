import React, { useState } from 'react';
import { Session } from '../types';
import { Search, Plus, Trash2, Clock, ChevronLeft } from 'lucide-react';
import { format } from 'date-fns';

interface HistorySidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewSession: () => void;
  onClearDraft: () => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onNewSession,
  onClearDraft,
  setIsOpen
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredSessions = sessions.filter(s => 
    s.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.tags.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="p-4 border-b border-slate-200 bg-white">
        <div className="flex gap-2 mb-4">
          <button
            onClick={onNewSession}
            className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            <Plus size={18} />
            New Session
          </button>
          <button
            onClick={onClearDraft}
            className="py-2.5 px-3 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg font-medium transition-colors"
          >
            Clear draft
          </button>
        </div>
        
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search history..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-teal-500 outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredSessions.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            <Clock size={32} className="mx-auto mb-2 opacity-20" />
            <p>No sessions found.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filteredSessions.map(session => (
              <li key={session.id} className="group relative">
                <button
                  onClick={() => onSelectSession(session.id)}
                  className={`
                    w-full text-left p-4 hover:bg-white transition-colors
                    ${currentSessionId === session.id ? 'bg-white border-l-4 border-teal-500' : 'border-l-4 border-transparent'}
                  `}
                >
                  <div className="font-semibold text-slate-800 truncate pr-6 text-sm mb-1">
                    {session.title || 'Untitled Session'}
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {session.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                        #{tag}
                      </span>
                    ))}
                  </div>
                  <div className="mb-2">
                    {(() => {
                      const masteryScore = session.masteryStatus?.score ?? session.pipelineState?.masteryStatus?.score ?? 0;
                      const coverageFallback = session.pipelineState?.totalChunks
                        ? (session.pipelineState.processedChunks / Math.max(session.pipelineState.totalChunks || 1, 1))
                        : 0;
                      const progressPercent = Math.round((masteryScore || coverageFallback) * 100);
                      const label = masteryScore > 0 ? 'Mastery' : 'Extraction progress';
                      return (
                        <div>
                          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-teal-500 to-emerald-500"
                              style={{ width: `${Math.min(progressPercent, 100)}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1">{label}: {progressPercent}%</p>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="text-xs text-slate-400">
                    {format(session.createdAt, 'MMM d, h:mm a')}
                  </div>
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    if(confirm('Delete this session?')) onDeleteSession(session.id);
                  }}
                  className="absolute right-2 top-4 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-3 border-t border-slate-200 bg-white lg:hidden">
         <button onClick={() => setIsOpen(false)} className="flex items-center gap-2 text-slate-500 text-sm">
             <ChevronLeft size={16} /> Close Sidebar
         </button>
      </div>
    </div>
  );
};