import { decryptQboValue, encryptQboValue } from './qboCrypto';

export const encryptEmailCredential = async (value: string): Promise<string> => {
  return encryptQboValue(value);
};

export const decryptEmailCredential = async (value: string): Promise<string> => {
  return decryptQboValue(value);
};
