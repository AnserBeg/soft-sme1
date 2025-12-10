import api from '../api/axios';
import { VehicleHistoryResponse } from '../types/vehicleHistory';

export const getCustomerVehicleHistory = async (customerId: number): Promise<VehicleHistoryResponse> => {
  const res = await api.get(`/api/customers/${customerId}/vehicle-history`);
  return res.data as VehicleHistoryResponse;
};
