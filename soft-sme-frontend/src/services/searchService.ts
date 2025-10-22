import api from '../api/axios';

export type FuzzySearchType = 'customer' | 'vendor' | 'part';

export interface FuzzySearchMatch<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  id: number;
  label: string;
  score: number;
  extra: TExtra;
}

interface FuzzySearchResponse<TExtra extends Record<string, unknown>> {
  matches: Array<FuzzySearchMatch<TExtra>>;
}

interface FuzzySearchParams {
  limit?: number;
  minScore?: number;
  signal?: AbortSignal;
}

export const fuzzySearch = async <TExtra extends Record<string, unknown> = Record<string, unknown>>(
  type: FuzzySearchType,
  query: string,
  params?: FuzzySearchParams,
): Promise<Array<FuzzySearchMatch<TExtra>>> => {
  const response = await api.get<FuzzySearchResponse<TExtra>>('/api/search/fuzzy', {
    params: {
      type,
      q: query,
      limit: params?.limit,
      minScore: params?.minScore,
    },
    signal: params?.signal,
  });

  return response.data.matches ?? [];
};
