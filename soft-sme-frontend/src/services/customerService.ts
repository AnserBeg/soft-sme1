import api from '../api/axios';
import { Customer } from '../types/customer';

export const getCustomerContacts = async (customerId: number) => {
  const response = await api.get(`/api/customers/${customerId}/contacts`);
  return response.data as { people: any[]; emails: any[]; phones: any[] };
};

export const addCustomerContactPerson = async (customerId: number, payload: { name: string; is_preferred?: boolean }) => {
  const response = await api.post(`/api/customers/${customerId}/contacts/people`, payload);
  return response.data;
};

export const updateCustomerContactPerson = async (customerId: number, personId: number, payload: { name?: string; is_preferred?: boolean }) => {
  const response = await api.put(`/api/customers/${customerId}/contacts/people/${personId}`, payload);
  return response.data;
};

export const deleteCustomerContactPerson = async (customerId: number, personId: number) => {
  const response = await api.delete(`/api/customers/${customerId}/contacts/people/${personId}`);
  return response.data;
};

export const addCustomerEmail = async (customerId: number, payload: { email: string; is_preferred?: boolean }) => {
  const response = await api.post(`/api/customers/${customerId}/contacts/emails`, payload);
  return response.data;
};

export const updateCustomerEmail = async (customerId: number, emailId: number, payload: { email?: string; is_preferred?: boolean }) => {
  const response = await api.put(`/api/customers/${customerId}/contacts/emails/${emailId}`, payload);
  return response.data;
};

export const deleteCustomerEmail = async (customerId: number, emailId: number) => {
  const response = await api.delete(`/api/customers/${customerId}/contacts/emails/${emailId}`);
  return response.data;
};

export const addCustomerPhone = async (customerId: number, payload: { phone: string; label?: string; is_preferred?: boolean }) => {
  const response = await api.post(`/api/customers/${customerId}/contacts/phones`, payload);
  return response.data;
};

export const updateCustomerPhone = async (customerId: number, phoneId: number, payload: { phone?: string; label?: string; is_preferred?: boolean }) => {
  const response = await api.put(`/api/customers/${customerId}/contacts/phones/${phoneId}`, payload);
  return response.data;
};

export const deleteCustomerPhone = async (customerId: number, phoneId: number) => {
  const response = await api.delete(`/api/customers/${customerId}/contacts/phones/${phoneId}`);
  return response.data;
};

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