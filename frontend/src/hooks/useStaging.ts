import useSWR from 'swr';
import { api } from '@/lib/api';

export function useStaging() {
  return useSWR('/api/staging', () => api.getStaging(), { 
    refreshInterval: 10000,
    revalidateOnFocus: true,
  });
}

export function useStagingParsed() {
  const { data, error } = useStaging();
  if (error || !data) return { allowlist: '', fueraCount: 0, fueraFiles: [] };
  
  const files = data.archivos || [];
  const fuera = data.fuera || [];
  
  return { 
    allowlist: files.join(', '),
    fueraCount: fuera.length,
    fueraFiles: fuera
  };
}