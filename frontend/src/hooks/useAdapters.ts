import useSWR from 'swr';
import { api } from '@/lib/api';
import { useState } from 'react';

export function useAdaptersConfig() {
  const { data, mutate, error } = useSWR('/api/adapters/config', api.getAdaptersConfig, { 
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });
  
  const [updating, setUpdating] = useState(false);
  
  const updateConfig = async (config: any) => {
    setUpdating(true);
    try {
      const result = await api.setAdaptersConfig(config);
      mutate(result);
      return result;
    } finally {
      setUpdating(false);
    }
  };

  return { 
    data, 
    error, 
    isLoading: !data && !error,
    updateConfig,
    updating 
  };
}

export function useAdaptersModelos(filtro = 'todos') {
  return useSWR(`/api/adapters/modelos?filtro=${filtro}`, () => 
    api.getModelos(filtro), 
    { 
      refreshInterval: 60000,
      revalidateOnFocus: true,
    }
  );
}