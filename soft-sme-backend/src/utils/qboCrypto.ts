import sodium from 'libsodium-wrappers';

const EXPECTED_KEY_BYTES = 32;
const ENCRYPTION_VERSION = 1;
const SECRET_ENV_NAME = 'QBO_TOKEN_SECRET';

interface EncryptedPayload {
  v: number;
  nonce: string;
  ciphertext: string;
}

const decodeSecretKey = (raw: string): Uint8Array => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${SECRET_ENV_NAME} is not configured`);
  }

  try {
    const decoded = sodium.from_base64(trimmed, sodium.base64_variants.ORIGINAL_NO_PADDING);
    if (decoded.length === EXPECTED_KEY_BYTES) {
      return decoded;
    }
  } catch (error) {
    // ignore
  }

  try {
    const decoded = sodium.from_base64(trimmed, sodium.base64_variants.URLSAFE_NO_PADDING);
    if (decoded.length === EXPECTED_KEY_BYTES) {
      return decoded;
    }
  } catch (error) {
    // ignore
  }

  const normalizedHex = trimmed.replace(/^0x/, '');
  if (normalizedHex.length === EXPECTED_KEY_BYTES * 2) {
    try {
      return sodium.from_hex(normalizedHex);
    } catch (error) {
      // fallthrough
    }
  }

  throw new Error(`${SECRET_ENV_NAME} must be a 32-byte key in base64 or hex encoding`);
};

class QboSecretBox {
  private keyPromise: Promise<Uint8Array>;

  constructor(secretKey: string | undefined) {
    if (!secretKey || secretKey.trim().length === 0) {
      throw new Error(`${SECRET_ENV_NAME} environment variable is required for QBO token encryption`);
    }
    this.keyPromise = this.initialize(secretKey);
  }

  private async initialize(secretKey: string): Promise<Uint8Array> {
    await sodium.ready;
    return decodeSecretKey(secretKey);
  }

  async encrypt(plaintext: string): Promise<Omit<EncryptedPayload, 'v'>> {
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

  async decrypt(payload: Omit<EncryptedPayload, 'v'>): Promise<string> {
    await sodium.ready;
    const key = await this.keyPromise;
    const nonce = sodium.from_base64(payload.nonce, sodium.base64_variants.URLSAFE_NO_PADDING);
    const cipherBytes = sodium.from_base64(payload.ciphertext, sodium.base64_variants.URLSAFE_NO_PADDING);
    const messageBytes = sodium.crypto_secretbox_open_easy(cipherBytes, nonce, key);
    return sodium.to_string(messageBytes);
  }
}

let qboSecretBox: QboSecretBox | null = null;

const getQboSecretBox = (): QboSecretBox => {
  if (!qboSecretBox) {
    qboSecretBox = new QboSecretBox(process.env.QBO_TOKEN_SECRET);
  }
  return qboSecretBox;
};

const parseEncryptedPayload = (value: string): EncryptedPayload | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as EncryptedPayload;
    if (
      parsed &&
      parsed.v === ENCRYPTION_VERSION &&
      typeof parsed.nonce === 'string' &&
      typeof parsed.ciphertext === 'string'
    ) {
      return parsed;
    }
  } catch (error) {
    return null;
  }
  return null;
};

export const encryptQboValue = async (value: string): Promise<string> => {
  const box = getQboSecretBox();
  const encrypted = await box.encrypt(value);
  return JSON.stringify({ v: ENCRYPTION_VERSION, ...encrypted });
};

export const decryptQboValue = async (value: string): Promise<string> => {
  if (!value) {
    return value;
  }
  const parsed = parseEncryptedPayload(value);
  if (!parsed) {
    return value;
  }
  const box = getQboSecretBox();
  return box.decrypt({ nonce: parsed.nonce, ciphertext: parsed.ciphertext });
};

export const encryptQboConnectionFields = async (payload: {
  realmId: string;
  accessToken: string;
  refreshToken: string;
}): Promise<{ realmId: string; accessToken: string; refreshToken: string }> => {
  const [realmId, accessToken, refreshToken] = await Promise.all([
    encryptQboValue(payload.realmId),
    encryptQboValue(payload.accessToken),
    encryptQboValue(payload.refreshToken),
  ]);
  return { realmId, accessToken, refreshToken };
};

export const decryptQboConnectionRow = async <T extends { realm_id: string; access_token: string; refresh_token: string }>(
  row: T
): Promise<T> => {
  const [realmId, accessToken, refreshToken] = await Promise.all([
    decryptQboValue(row.realm_id),
    decryptQboValue(row.access_token),
    decryptQboValue(row.refresh_token),
  ]);

  return {
    ...row,
    realm_id: realmId,
    access_token: accessToken,
    refresh_token: refreshToken,
  };
};

export const maskQboValue = (value: string | null | undefined): string => {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return '***';
  }
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
};
