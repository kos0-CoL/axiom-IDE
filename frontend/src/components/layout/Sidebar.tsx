export function Sidebar({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        absolute lg:static inset-y-0 z-50 lg:z-auto
        w-64 bg-sidebar-bg border-r border-line
        transform transition-transform duration-200
        ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-4">
          <h2 className="text-xs text-muted uppercase tracking-wider mb-3">Proyecto</h2>
          <div className="space-y-1">
            <div className="px-2 py-1 text-sm text-text font-medium">
              axiom
            </div>
            <button className="w-full text-left px-2 py-1 text-sm text-muted hover:text-text rounded transition-colors">
              Crear proyecto
            </button>
            <button className="w-full text-left px-2 py-1 text-sm text-muted hover:text-text rounded transition-colors">
              Usar proyecto existente
            </button>
          </div>
        </div>

        <div className="px-4">
          <div className="h-px bg-line mb-3" />
          <h2 className="text-xs text-muted uppercase tracking-wider mb-3">Recientes</h2>
          <div className="space-y-1">
            <button className="w-full text-left px-2 py-1 text-sm text-muted hover:text-text rounded transition-colors">
              • sesión-1
            </button>
            <button className="w-full text-left px-2 py-1 text-sm text-muted hover:text-text rounded transition-colors">
              • sesión-2
            </button>
          </div>
        </div>

        {/* Recent projects */}
        <div className="px-4 mt-6">
          <div className="h-px bg-line mb-3" />
          <h2 className="text-xs text-muted uppercase tracking-wider mb-3">Proyectos recientes</h2>
          <div className="space-y-1">
            <button className="w-full text-left px-2 py-1 text-sm text-muted hover:text-text rounded transition-colors">
              • proyecto-anterior
            </button>
          </div>
        </div>
      </aside>

      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed top-4 left-4 z-50 w-8 h-8 bg-card-bg border border-line rounded flex items-center justify-center
                   lg:hidden hover:bg-line transition-colors"
      >
        <svg 
          className={`w-4 h-4 text-text transition-transform ${!open ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    </>
  );
}