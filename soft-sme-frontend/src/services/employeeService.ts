import api from '../api/axios';

export const getEmployees = async () => {
  const response = await api.get('/api/employees');
  return response.data;
}; 