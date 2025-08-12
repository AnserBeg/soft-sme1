import api from '../api/axios';
import { Product } from '../types/product';

export const getProducts = async (): Promise<Product[]> => {
  const response = await api.get('/api/products');
  return response.data;
}; 