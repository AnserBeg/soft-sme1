export interface ChatInSuccess {
  success: true;
  data: {
    sessionId: number;
    message: string;
    userId: number | null;
    companyId: number | null;
    idempotency_key?: string;
  };
}

export interface ChatInFailure {
  success: false;
  error: {
    flatten: () => {
      fieldErrors: Record<string, string[]>;
      formErrors: string[];
    };
  };
}

const toFlattenError = (fieldErrors: Record<string, string[]>, formErrors: string[]) => () => ({
  fieldErrors,
  formErrors,
});

const parsePositiveInteger = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
};

const addFieldError = (
  fieldErrors: Record<string, string[]>,
  field: string,
  message: string
) => {
  if (!fieldErrors[field]) {
    fieldErrors[field] = [];
  }
  fieldErrors[field].push(message);
};

export type ChatInResult = ChatInSuccess | ChatInFailure;

export const ChatIn = {
  safeParse(input: unknown): ChatInResult {
    const fieldErrors: Record<string, string[]> = {};
    const formErrors: string[] = [];

    if (!input || typeof input !== 'object') {
      formErrors.push('Expected an object body.');
      return { success: false, error: { flatten: toFlattenError(fieldErrors, formErrors) } };
    }

    const payload = input as Record<string, unknown>;

    const sessionIdParsed = parsePositiveInteger(payload.sessionId);
    if (sessionIdParsed == null) {
      addFieldError(fieldErrors, 'sessionId', 'A positive integer sessionId is required.');
    }

    const rawMessage = payload.message;
    let message: string | null = null;
    if (typeof rawMessage !== 'string') {
      addFieldError(fieldErrors, 'message', 'Message is required.');
    } else {
      const trimmed = rawMessage.trim();
      if (!trimmed) {
        addFieldError(fieldErrors, 'message', 'Message is required.');
      } else {
        message = trimmed;
      }
    }

    const primaryUserId =
      payload.userId !== undefined ? parsePositiveInteger(payload.userId) : null;
    if (payload.userId !== undefined && primaryUserId == null) {
      addFieldError(fieldErrors, 'userId', 'userId must be a positive integer.');
    }

    const secondaryUserId =
      payload.user_id !== undefined ? parsePositiveInteger(payload.user_id) : null;
    if (payload.user_id !== undefined && secondaryUserId == null) {
      addFieldError(fieldErrors, 'user_id', 'user_id must be a positive integer.');
    }

    const primaryCompanyId =
      payload.companyId !== undefined ? parsePositiveInteger(payload.companyId) : null;
    if (payload.companyId !== undefined && primaryCompanyId == null) {
      addFieldError(fieldErrors, 'companyId', 'companyId must be a positive integer.');
    }

    const secondaryCompanyId =
      payload.company_id !== undefined ? parsePositiveInteger(payload.company_id) : null;
    if (payload.company_id !== undefined && secondaryCompanyId == null) {
      addFieldError(fieldErrors, 'company_id', 'company_id must be a positive integer.');
    }

    let idempotencyKey: string | undefined;
    if (payload.idempotency_key !== undefined) {
      if (typeof payload.idempotency_key !== 'string') {
        addFieldError(fieldErrors, 'idempotency_key', 'idempotency_key must be a string.');
      } else {
        const trimmed = payload.idempotency_key.trim();
        if (trimmed) {
          idempotencyKey = trimmed;
        }
      }
    }

    const hasErrors =
      Object.keys(fieldErrors).length > 0 || formErrors.length > 0;

    if (hasErrors || sessionIdParsed == null || message == null) {
      return { success: false, error: { flatten: toFlattenError(fieldErrors, formErrors) } };
    }

    return {
      success: true,
      data: {
        sessionId: sessionIdParsed,
        message,
        userId: primaryUserId ?? secondaryUserId ?? null,
        companyId: primaryCompanyId ?? secondaryCompanyId ?? null,
        idempotency_key: idempotencyKey,
      },
    };
  },
};

export type ChatInData = ChatInSuccess['data'];

export const isChatInFailure = (result: ChatInResult): result is ChatInFailure => result.success === false;
