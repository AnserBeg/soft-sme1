import api from '../api/axios';

export interface Category {
  category_id: number;
  category_name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateCategoryRequest {
  category_name: string;
  description?: string;
}

export interface UpdateCategoryRequest {
  category_name: string;
  description?: string;
}

// Get all categories
export const getCategories = async (): Promise<Category[]> => {
  const response = await api.get('/api/categories');
  return response.data;
};

// Get a single category by ID
export const getCategory = async (id: number): Promise<Category> => {
  const response = await api.get(`/api/categories/${id}`);
  return response.data;
};

// Create a new category
export const createCategory = async (category: CreateCategoryRequest): Promise<Category> => {
  const response = await api.post('/api/categories', category);
  return response.data.category;
};

// Update a category
export const updateCategory = async (id: number, category: UpdateCategoryRequest): Promise<Category> => {
  const response = await api.put(`/api/categories/${id}`, category);
  return response.data.category;
};

// Delete a category
export const deleteCategory = async (id: number, reassign?: boolean): Promise<void> => {
  const params = reassign ? { reassign: 'true' } : {};
  await api.delete(`/api/categories/${id}`, { params });
};
