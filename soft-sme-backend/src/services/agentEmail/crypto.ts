import sodium from 'libsodium-wrappers';

const EXPECTED_KEY_BYTES = 32;

const decodeSecretKey = (raw: string): Uint8Array => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('EMAIL_CONNECTION_SECRET is not configured');
  }

  // Try base64 first
  try {
    const decoded = sodium.from_base64(trimmed, sodium.base64_variants.ORIGINAL_NO_PADDING);
    if (decoded.length === EXPECTED_KEY_BYTES) {
      return decoded;
    }
  } catch (error) {
    // Ignore and try other formats
  }

  // Try URL-safe base64
  try {
    const decoded = sodium.from_base64(trimmed, sodium.base64_variants.URLSAFE_NO_PADDING);
    if (decoded.length === EXPECTED_KEY_BYTES) {
      return decoded;
    }
  } catch (error) {
    // Ignore and try hex
  }

  const normalizedHex = trimmed.replace(/^0x/, '');
  if (normalizedHex.length === EXPECTED_KEY_BYTES * 2) {
    try {
      return sodium.from_hex(normalizedHex);
    } catch (error) {
      // fallthrough
    }
  }

  throw new Error('EMAIL_CONNECTION_SECRET must be a 32-byte key in base64 or hex encoding');
};

export interface EncryptedPayload {
  nonce: string;
  ciphertext: string;
}

export class EmailSecretBox {
  private keyPromise: Promise<Uint8Array>;

  constructor(secretKey: string | undefined) {
    if (!secretKey || secretKey.trim().length === 0) {
      throw new Error('EMAIL_CONNECTION_SECRET environment variable is required for email encryption');
    }
    this.keyPromise = this.initialize(secretKey);
  }

  private async initialize(secretKey: string): Promise<Uint8Array> {
    await sodium.ready;
    return decodeSecretKey(secretKey);
  }

  async encrypt(plaintext: string): Promise<EncryptedPayload> {
    await sodium.ready;
    const key = await this.keyPromise;
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const messageBytes = sodium.from_string(plaintext);
    const cipherBytes = sodium.crypto_secretbox_easy(messageBytes, nonce, key);

    return {
      nonce: sodium.to_base64(nonce, sodium.base64_variants.URLSAFE_NO_PADDING),
      ciphertext: sodium.to_base64(cipherBytes, sodium.base64_variants.URLSAFE_NO_PADDING),
    };
  }

  async decrypt(payload: EncryptedPayload): Promise<string> {
    await sodium.ready;
    const key = await this.keyPromise;
    const nonce = sodium.from_base64(payload.nonce, sodium.base64_variants.URLSAFE_NO_PADDING);
    const cipherBytes = sodium.from_base64(payload.ciphertext, sodium.base64_variants.URLSAFE_NO_PADDING);
    const messageBytes = sodium.crypto_secretbox_open_easy(cipherBytes, nonce, key);
    return sodium.to_string(messageBytes);
  }
}

export const redact = (value: string | null | undefined): string => {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return '***';
  }
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
};
