import useSWR from 'swr';
import { api } from '@/lib/api';

export function useSecretsPresencia() {
  return useSWR('/api/secrets/presencia', () => api.getSecretPresence(), { 
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });
}
export const SECRET_KEYS = [
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY',
  'OPENROUTER_API_KEY', 'AXIOM_LITELLM_KEY',
  'AXIOM_TELEGRAM_BOT_TOKEN', 'AXIOM_TELEGRAM_WEBHOOK_SECRET'
] as const;