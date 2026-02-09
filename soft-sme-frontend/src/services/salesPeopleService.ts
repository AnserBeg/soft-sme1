import api from '../api/axios';
import { SalesPerson } from '../types/salesPerson';

export const getSalesPeople = async (): Promise<SalesPerson[]> => {
  const res = await api.get('/api/sales-people');
  return res.data || [];
};

export const getSalesPerson = async (id: number | string): Promise<SalesPerson> => {
  const res = await api.get(`/api/sales-people/${id}`);
  return res.data;
};

export const createSalesPerson = async (payload: Partial<SalesPerson>): Promise<SalesPerson> => {
  const res = await api.post('/api/sales-people', payload);
  return res.data;
};

export const updateSalesPerson = async (id: number | string, payload: Partial<SalesPerson>): Promise<SalesPerson> => {
  const res = await api.put(`/api/sales-people/${id}`, payload);
  return res.data;
};

export const getSalesPersonSalesOrderSummary = async (id: number | string): Promise<{
  total_estimated_cost: number;
  orders: Array<{
    sales_order_id: number;
    sales_order_number: string;
    sales_date: string;
    estimated_cost: number;
  }>;
}> => {
  const res = await api.get(`/api/sales-people/${id}/sales-orders-summary`);
  return res.data;
};
