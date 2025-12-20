
import React from 'react';
import { Menu, X, GraduationCap, AlertCircle, Timer } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  sidebar: React.ReactNode;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  errorMessage?: string | null;
  onDismissError?: () => void;
  generationTime?: number;
}

export const Layout: React.FC<LayoutProps> = ({ 
  children, 
  sidebar, 
  isSidebarOpen, 
  toggleSidebar,
  errorMessage,
  onDismissError,
  generationTime = 0
}) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Sidebar - Desktop */}
      <aside 
        className={`
          hidden lg:flex flex-col w-72 bg-white border-r border-slate-200 shadow-sm z-10 transition-all duration-300
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-72 w-0 overflow-hidden'}
        `}
      >
        {sidebar}
      </aside>

      {/* Sidebar - Mobile Overlay */}
      <div 
        className={`
          fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity duration-300
          ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
        onClick={toggleSidebar}
      />
      <aside 
        className={`
          fixed inset-y-0 left-0 w-64 bg-white z-50 shadow-xl transition-transform duration-300 lg:hidden
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {sidebar}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full min-w-0">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 shadow-sm z-20">
          <div className="flex items-center gap-3">
            <button 
              onClick={toggleSidebar}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-600"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 text-teal-700">
               <GraduationCap size={24} />
               <h1 className="text-lg font-bold tracking-tight hidden sm:block">MedRef Tutor</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {generationTime > 0 && (
              <div className="flex items-center gap-1.5 text-xs font-bold bg-purple-600 text-white px-3 py-1.5 rounded-full shadow-sm animate-in fade-in zoom-in-95 duration-300">
                <Timer size={14} />
                <span>{formatTime(generationTime)}</span>
              </div>
            )}
          </div>
        </header>
        
        <div className="flex-1 overflow-hidden relative">
          {errorMessage && (
            <div className="absolute inset-x-4 top-4 z-30">
              <div className="flex items-start gap-3 p-4 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl shadow-sm">
                <div className="p-2 bg-white/80 rounded-lg border border-amber-100">
                  <AlertCircle size={18} className="text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">History unavailable</p>
                  <p className="text-sm text-amber-800">{errorMessage}</p>
                </div>
                {onDismissError && (
                  <button
                    onClick={onDismissError}
                    className="p-1 text-amber-700 hover:text-amber-900 hover:bg-amber-100 rounded-md transition-colors"
                    aria-label="Dismiss history error"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
};
