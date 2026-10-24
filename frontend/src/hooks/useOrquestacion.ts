import useSWR from 'swr';
import { api } from '@/lib/api';

export function useOrquestacion() {
  return useSWR('/api/orquestacion', () => 
    api.getOrquestacion().then(r => r),
    {
      refreshInterval: 5000,
      revalidateOnFocus: true,
      onError: (err: Error) => console.error('Error loading orquestacion:', err),
    }
  );
}