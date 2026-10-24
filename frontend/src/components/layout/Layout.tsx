import { useState } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { OrquestacionPanel } from '@/components/orquestacion/OrquestacionPanel';
import { TrabajoPanel } from '@/components/trabajo/TrabajoPanel';
import { ChatView } from '@/components/chat/ChatView';
import { ActivityBar } from './ActivityBar';
import { StatusBar } from './StatusBar';

type ActiveView = 'orquestacion' | 'trabajo' | 'chat';

export function Layout() {
  const [activeView, setActiveView] = useState<ActiveView>('orquestacion');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="h-screen flex flex-col">
      {/* Main Header */}
      <Header activeView={activeView} onViewChange={setActiveView} />

      {/* Sidebar */}
      <Sidebar open={sidebarOpen} setOpen={setSidebarOpen} />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* View Panels */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="h-full">
            {activeView === 'orquestacion' && <OrquestacionPanel />}
            {activeView === 'trabajo' && <TrabajoPanel />}
            {activeView === 'chat' && <ChatView />}
          </div>
        </div>
      </main>

      {/* Activity Bar (Bottom) */}
      <ActivityBar />

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
}