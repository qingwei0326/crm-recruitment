import { useQuery } from '@tanstack/react-query';
import api from '../api';
import {
  FALLBACK_OUTCOME_CATALOG,
  outcomeCatalogByCode,
  resolveOutcomeCatalog,
} from '../domain/outcomeCatalog';

export default function useLeadOutcomeCatalog() {
  const query = useQuery({
    queryKey: ['lead-outcome-catalog'],
    queryFn: async () => {
      const response = await api.get('/lead-outcome-reasons');
      if (response.data?.code !== 0) throw new Error(response.data?.msg || '结果目录加载失败');
      return response.data?.data || [];
    },
    staleTime: 5 * 60_000,
  });
  const catalog = query.data
    ? resolveOutcomeCatalog(query.data)
    : FALLBACK_OUTCOME_CATALOG;

  return {
    ...query,
    catalog,
    results: catalog.filter((item) => item.operatorVisible && item.agentVisible !== false),
    byCode: outcomeCatalogByCode(catalog),
  };
}
