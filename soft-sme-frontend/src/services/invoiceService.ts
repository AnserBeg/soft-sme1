import api from '../api/axios';
import { Invoice, InvoiceListResponse } from '../types/invoice';

export const fetchInvoices = async (params?: { customer_id?: number; status?: string }) => {
  const response = await api.get<InvoiceListResponse>('/api/invoices', { params });
  return response.data;
};

export const getInvoice = async (id: string | number) => {
  const response = await api.get(`/api/invoices/${id}`);
  return response.data as { invoice: Invoice; lineItems: any[] };
};

export const createInvoiceFromSalesOrder = async (salesOrderId: number) => {
  const response = await api.post('/api/invoices/from-sales-order/' + salesOrderId);
  return response.data;
};

export const createInvoice = async (payload: any) => {
  const response = await api.post('/api/invoices', payload);
  return response.data;
};

export const updateInvoice = async (id: number, payload: any) => {
  const response = await api.put('/api/invoices/' + id, payload);
  return response.data;
};

export const deleteInvoice = async (id: number) => {
  const response = await api.delete('/api/invoices/' + id);
  return response.data;
};

export const downloadMonthlyStatement = async (customerId: number, month: string) => {
  return api.get(`/api/invoices/customers/${customerId}/statement`, {
    params: { month },
    responseType: 'blob',
  });
};
