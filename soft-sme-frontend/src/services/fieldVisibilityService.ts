import api from '../api/axios';

export type SalesOrderFieldVisibility = {
  customerPoNumber: boolean;
  quotedPrice: boolean;
  sourceQuote: boolean;
  vin: boolean;
  unitNumber: boolean;
  vehicleMake: boolean;
  vehicleModel: boolean;
  invoiceStatus: boolean;
  wantedByDate: boolean;
  wantedByTimeOfDay: boolean;
  productDescription: boolean;
  terms: boolean;
  mileage: boolean;
};

export type InvoiceFieldVisibility = {
  vin: boolean;
  productDescription: boolean;
  unitNumber: boolean;
  vehicleMake: boolean;
  vehicleModel: boolean;
  mileage: boolean;
};

export type FieldVisibilitySettings = {
  salesOrders: SalesOrderFieldVisibility;
  invoices: InvoiceFieldVisibility;
};

export const DEFAULT_FIELD_VISIBILITY_SETTINGS: FieldVisibilitySettings = {
  salesOrders: {
    customerPoNumber: true,
    quotedPrice: true,
    sourceQuote: true,
    vin: true,
    unitNumber: true,
    vehicleMake: true,
    vehicleModel: true,
    invoiceStatus: true,
    wantedByDate: true,
    wantedByTimeOfDay: true,
    productDescription: true,
    terms: true,
    mileage: true,
  },
  invoices: {
    vin: true,
    productDescription: true,
    unitNumber: true,
    vehicleMake: true,
    vehicleModel: true,
    mileage: true,
  },
};

const coerceSettings = (data: any): FieldVisibilitySettings => {
  const defaults = DEFAULT_FIELD_VISIBILITY_SETTINGS;
  const normalize = <T extends Record<string, boolean>>(incoming: any, fallback: T): T => {
    const result = { ...fallback };
    if (!incoming || typeof incoming !== 'object') return result;
    (Object.keys(fallback) as (keyof T)[]).forEach(key => {
      const value = (incoming as any)[key];
      result[key] = typeof value === 'boolean' ? value : fallback[key];
    });
    return result;
  };
  return {
    salesOrders: normalize(data?.salesOrders, defaults.salesOrders),
    invoices: normalize(data?.invoices, defaults.invoices),
  };
};

export const fieldVisibilityService = {
  async fetchSettings(): Promise<FieldVisibilitySettings> {
    try {
      const response = await api.get('/api/settings/field-visibility');
      return coerceSettings(response.data?.settings);
    } catch (error) {
      console.warn('Failed to fetch field visibility settings, using defaults', error);
      return { ...DEFAULT_FIELD_VISIBILITY_SETTINGS };
    }
  },

  async updateSettings(settings: FieldVisibilitySettings): Promise<FieldVisibilitySettings> {
    const response = await api.put('/api/settings/field-visibility', settings);
    return coerceSettings(response.data?.settings);
  },
};

export default fieldVisibilityService;
