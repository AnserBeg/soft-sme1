import api from "../api/axios";
import { Customer } from '../types/customer';

export const getCustomers = async (): Promise<Customer[]> => {
  const response = await api.get('/api/customers');
  return response.data;
};

export const getCustomer = async (id: string): Promise<Customer> => {
  const response = await api.get(`/api/customers/${id}`);
  return response.data;
};

export const createCustomer = async (customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>): Promise<Customer> => {
  const response = await api.post('/api/customers', customer);
  return response.data;
};

export const updateCustomer = async (id: string, customer: Partial<Customer>): Promise<Customer> => {
  const response = await api.put(`/api/customers/${id}`, customer);
  return response.data;
};

export const deleteCustomer = async (id: string): Promise<void> => {
  await api.delete(`/api/customers/${id}`);
}; 