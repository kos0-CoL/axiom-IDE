import useSWR from 'swr';
import { api } from '@/lib/api';

export function useTrabajo() {
  return useSWR('/api/trabajo', () => api.getTrabajo(), {
    refreshInterval: 5000,
    revalidateOnFocus: true,
    onError: (err: Error) => console.error('Error loading trabajo:', err),
  });
}