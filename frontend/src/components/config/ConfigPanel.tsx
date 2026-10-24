import { useState } from 'react';
import { useAdaptersConfig, useAdaptersModelos } from '@/hooks/useAdapters';
import { useTelegramConfig } from '@/hooks/useTelegram';
import { useModulos } from '@/hooks/useModules';
import { useStaging } from '@/hooks/useStaging';
import { Card, Button, Input, Select, Chip, CardGrid, CardField } from '@/components/common';

type ConfigTab = 'adapters' | 'telegram' | 'modules' | 'staging';

export function ConfigPanel() {
  const [activeTab, setActiveTab] = useState<'adapters' | 'telegram' | 'modules' | 'staging'>('adapters');
  const [proveedor, setProveedor] = useState('openrouter');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [maxChars, setMaxChars] = useState(8000);

  const { data: adapters } = useAdaptersConfig();
  const { data: models } = useAdaptersModelos('todos');
  const { data: telegram } = useTelegramConfig();
  const { data: modulos } = useModulos();
  const { data: staging } = useStaging();

  const tabs = ['adapters', 'telegram', 'modules', 'staging'];
  const tabLabels = { adapters: 'LLM Provider', telegram: 'Telegram', modules: 'Módulos', staging: 'Staging' };

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-gray-700 px-4">
        {['adapters', 'telegram', 'modules', 'staging'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab as any)} className={`px-4 py-2 text-sm border-b-2 transition-colors ${activeTab === tab ? 'border-red-500 text-white' : 'border-transparent text-gray-400 hover:text-white'}`}>
            {({ adapters: 'LLM Provider', telegram: 'Telegram', modules: 'Módulos', staging: 'Staging' })[tab]}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'adapters' && (
          <div className="space-y-4">
            <div className="p-4 bg-gray-900 border border-gray-700 rounded-none">
              <h3 className="text-lg font-bold text-white uppercase tracking-wider mb-2">PROVEEDOR LLM</h3>
              <p className="text-sm text-gray-400 mb-4">Configura el proveedor activo</p>
              <div className="space-y-4">
                <div><label className="block text-sm text-gray-400 mb-1">Proveedor</label>
                  <select value={proveedor} onChange={e => setProveedor(e.target.value)} className="w-full p-2 bg-gray-900 border border-gray-700 rounded-none text-white">
                    {['off', 'ollama', 'litellm', 'openai', 'anthropic', 'google', 'openrouter'].map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                  </select>
                </div>
                <div><label className="block text-sm text-gray-400 mb-1">Modelo</label>
                  <input type="text" value={model} onChange={e => setModel(e.target.value)} className="w-full p-2 bg-gray-900 border border-gray-700 rounded-none text-white" placeholder="modelo" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm text-gray-400 mb-1">Timeout (ms)</label><input type="number" value={timeoutMs} onChange={e => setTimeoutMs(Number(e.target.value))} className="w-full p-2 bg-gray-900 border border-gray-700 rounded-none text-white" /></div>
                  <div><label className="block text-sm text-gray-400 mb-1">Max chars</label><input type="number" value={maxChars} onChange={e => setMaxChars(Number(e.target.value))} className="w-full p-2 bg-gray-900 border border-gray-700 rounded-none text-white" /></div>
                </div>
                <div className="flex justify-end gap-2">
                  <button className="px-4 py-2 bg-gray-800 text-white border border-gray-700 rounded-none hover:bg-gray-700">Restablecer</button>
                  <button className="px-4 py-2 bg-red-500 text-white rounded-none">Guardar</button>
                </div>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'telegram' && (
          <div className="space-y-4">
            <div className="p-4 bg-gray-900 border border-gray-700 rounded-none">
              <h3 className="text-lg font-bold text-white uppercase tracking-wider mb-2">CANAL TELEGRAM</h3>
              <p className="text-sm text-gray-400 mb-4">Canal de notificaciones y aprobaciones</p>
              <div className="space-y-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" defaultChecked={false} className="w-5 h-5 accent-red-500" />
                  <span>Telegram: ON</span>
                </label>
                <div className="space-y-2">
                  <label className="block text-sm text-gray-400 mb-1">Allowlist (Chat IDs)</label>
                  <input type="text" className="w-full p-2 bg-gray-900 border border-gray-700 rounded-none text-white" placeholder="Chat IDs separados por comas" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm text-gray-400 mb-1">Expiración (min)</label><input type="number" className="w-full p-2 bg-gray-900 border border-gray-700 rounded-none text-white" defaultValue="30" /></div>
                </div>
                <div className="flex justify-end gap-2">
                  <button className="px-4 py-2 bg-red-500 text-white rounded-none">Pausar canal</button>
                </div>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'modules' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="p-3 bg-gray-800/50 border border-gray-700 flex items-center justify-between">
                <span className="text-sm font-medium">adapters</span>
                <input type="checkbox" defaultChecked className="w-5 h-5 accent-red-500" />
              </div>
            </div>
            <button className="px-4 py-2 bg-red-500 text-white rounded-none">Crear esqueleto</button>
          </div>
        )}
        {activeTab === 'staging' && (
          <div className="space-y-4">
            <div className="p-4 bg-gray-900 border border-gray-700 rounded-none">
              <h3 className="text-lg font-bold text-white uppercase tracking-wider mb-2">STAGING ALLOWLIST</h3>
              <p className="text-sm text-gray-400 mb-4">Archivos fuera: 0</p>
              <div className="flex gap-2"><input type="text" placeholder="Patrón (ej: notas/**)" className="flex-1 p-2 bg-gray-900 border border-gray-700 rounded-none text-white" /><button className="px-4 py-2 bg-red-500 text-white rounded-none">Agregar</button></div>
              <div className="mt-4 flex gap-2"><button className="px-4 py-2 bg-red-600 text-white rounded-none">Restablecer defecto</button></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
