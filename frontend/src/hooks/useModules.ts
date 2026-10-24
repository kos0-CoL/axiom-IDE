import useSWR from 'swr';
import { api } from '@/lib/api';

export function useModulos() {
  return useSWR('/api/modulos', () => api.getModulos(), {
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });
}