import api from '../api/axios';

export interface BusinessProfileData {
  city: string;
  province: string;
  country: string;
}

export const getBusinessProfileData = async (): Promise<BusinessProfileData> => {
  try {
    const response = await api.get('/api/business-profile');
    return {
      city: response.data.city || '',
      province: response.data.province || '',
      country: response.data.country || '',
    };
  } catch (error) {
    console.error('Error fetching business profile:', error);
    return {
      city: '',
      province: '',
      country: '',
    };
  }
}; 