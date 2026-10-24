import useSWRMutation from 'swr/mutation';
import useSWR from 'swr';
import { api } from '@/lib/api';

export function useRunSpec() {
  return useSWRMutation('/api/run', (_, { arg }: { arg: any }) => 
    api.run(arg.id, arg.maxRondas, arg.tokens, arg.calls, arg.dryRun, arg.agente)
  );
}

export function useRunStatus() {
  return useSWR<{ ok: true; status: string; rondas: number; tokens: number } | { ok: false; error: string }>(
    '/api/run/status', 
    () => api.runStatus(),
    { refreshInterval: 5000 }
  );
}