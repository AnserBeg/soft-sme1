import api from '../api/axios';

export const getVendors = async () => {
  const response = await api.get('/api/vendors');
  return response.data;
}; 

export const getVendorContacts = async (vendorId: number) => {
  const response = await api.get(`/api/vendors/${vendorId}/contacts`);
  return response.data as { people: any[]; emails: any[]; phones: any[] };
};

export const addVendorContactPerson = async (vendorId: number, payload: { name: string; is_preferred?: boolean }) => {
  const response = await api.post(`/api/vendors/${vendorId}/contacts/people`, payload);
  return response.data;
};

export const updateVendorContactPerson = async (vendorId: number, personId: number, payload: { name?: string; is_preferred?: boolean }) => {
  const response = await api.put(`/api/vendors/${vendorId}/contacts/people/${personId}`, payload);
  return response.data;
};

export const deleteVendorContactPerson = async (vendorId: number, personId: number) => {
  const response = await api.delete(`/api/vendors/${vendorId}/contacts/people/${personId}`);
  return response.data;
};

export const addVendorEmail = async (vendorId: number, payload: { email: string; is_preferred?: boolean }) => {
  const response = await api.post(`/api/vendors/${vendorId}/contacts/emails`, payload);
  return response.data;
};

export const updateVendorEmail = async (vendorId: number, emailId: number, payload: { email?: string; is_preferred?: boolean }) => {
  const response = await api.put(`/api/vendors/${vendorId}/contacts/emails/${emailId}`, payload);
  return response.data;
};

export const deleteVendorEmail = async (vendorId: number, emailId: number) => {
  const response = await api.delete(`/api/vendors/${vendorId}/contacts/emails/${emailId}`);
  return response.data;
};

export const addVendorPhone = async (vendorId: number, payload: { phone: string; label?: string; is_preferred?: boolean }) => {
  const response = await api.post(`/api/vendors/${vendorId}/contacts/phones`, payload);
  return response.data;
};

export const updateVendorPhone = async (vendorId: number, phoneId: number, payload: { phone?: string; label?: string; is_preferred?: boolean }) => {
  const response = await api.put(`/api/vendors/${vendorId}/contacts/phones/${phoneId}`, payload);
  return response.data;
};

export const deleteVendorPhone = async (vendorId: number, phoneId: number) => {
  const response = await api.delete(`/api/vendors/${vendorId}/contacts/phones/${phoneId}`);
  return response.data;
};

export const importVendorsFromExcel = async (file: File, onUploadProgress?: (progressEvent: any) => void) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post('/api/vendors/import-excel', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  });

  return response.data;
};

export const downloadVendorExcelTemplate = () => {
  return api.get('/api/vendors/import-excel/template', { responseType: 'blob' });
};
