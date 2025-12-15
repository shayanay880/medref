import React from 'react';
import { Menu, X, BookOpen, GraduationCap } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  sidebar: React.ReactNode;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const Layout: React.FC<LayoutProps> = ({ 
  children, 
  sidebar, 
  isSidebarOpen, 
  toggleSidebar 
}) => {
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
               <h1 className="text-lg font-bold tracking-tight">MedRef Tutor</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-white font-bold bg-gradient-to-r from-blue-600 to-teal-500 px-3 py-1 rounded shadow-sm">
              Gemini 3 Pro
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-hidden relative">
          {children}
        </div>
      </main>
    </div>
  );
};