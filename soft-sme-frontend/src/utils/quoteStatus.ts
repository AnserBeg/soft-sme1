export type QuoteStatus = 'Open' | 'Approved' | 'Rejected';

export const normalizeQuoteStatus = (status: string | null | undefined): QuoteStatus => {
  const normalized = (status ?? '').toString().trim().toLowerCase();
  if (normalized === 'approved') {
    return 'Approved';
  }
  if (normalized === 'rejected') {
    return 'Rejected';
  }
  return 'Open';
};
