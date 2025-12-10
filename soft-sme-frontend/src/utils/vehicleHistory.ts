import { VehicleHistoryRecord } from '../types/vehicleHistory';

const normalizeKey = (value?: string | null) => (value ?? '').trim().toUpperCase();
const hasValue = (value: unknown) => value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');

export const buildVehicleOptionMaps = (records: VehicleHistoryRecord[]) => {
  const units: string[] = [];
  const vins: string[] = [];
  const unitToVins: Record<string, string[]> = {};
  const vinToUnits: Record<string, string[]> = {};
  const seenUnits = new Set<string>();
  const seenVins = new Set<string>();

  records.forEach((rec) => {
    const unitKey = normalizeKey(rec.unit_number);
    const vinKey = normalizeKey(rec.vin_number);

    if (unitKey && !seenUnits.has(unitKey) && rec.unit_number) {
      units.push(rec.unit_number);
      seenUnits.add(unitKey);
    }
    if (vinKey && !seenVins.has(vinKey) && rec.vin_number) {
      vins.push(rec.vin_number);
      seenVins.add(vinKey);
    }
    if (unitKey && vinKey && rec.unit_number && rec.vin_number) {
      if (!unitToVins[unitKey]) unitToVins[unitKey] = [];
      if (!unitToVins[unitKey].some((v) => normalizeKey(v) === vinKey)) {
        unitToVins[unitKey].push(rec.vin_number);
      }

      if (!vinToUnits[vinKey]) vinToUnits[vinKey] = [];
      if (!vinToUnits[vinKey].some((u) => normalizeKey(u) === unitKey)) {
        vinToUnits[vinKey].push(rec.unit_number);
      }
    }
  });

  return { units, vins, unitToVins, vinToUnits };
};

export const computeLatestVehicleValues = (
  records: VehicleHistoryRecord[],
  unit?: string | null,
  vin?: string | null
) => {
  const unitKey = normalizeKey(unit);
  const vinKey = normalizeKey(vin);

  const matches = records.filter((rec) => {
    const recUnit = normalizeKey(rec.unit_number);
    const recVin = normalizeKey(rec.vin_number);
    if (unitKey && recUnit !== unitKey) return false;
    if (vinKey && recVin !== vinKey) return false;
    return unitKey || vinKey ? true : false;
  });

  const pick = <K extends keyof VehicleHistoryRecord>(field: K): VehicleHistoryRecord[K] | undefined => {
    const match = matches.find((rec) => hasValue(rec[field]));
    return match ? match[field] : undefined;
  };

  return {
    unit_number: pick('unit_number'),
    vin_number: pick('vin_number'),
    vehicle_make: pick('vehicle_make'),
    vehicle_model: pick('vehicle_model'),
    mileage: pick('mileage'),
    product_name: pick('product_name'),
    product_description: pick('product_description'),
  };
};

export const normalizeVehicleKey = normalizeKey;
