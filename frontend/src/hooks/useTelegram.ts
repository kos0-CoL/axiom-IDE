import useSWR from 'swr';
import { api } from '@/lib/api';

export function useTelegramConfig() {
  return useSWR('/api/telegram/config', () => api.getTelegramConfig(), {
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });
}