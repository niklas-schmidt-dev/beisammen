export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  /** iOS app icon badge; omitted leaves the badge untouched. */
  badge?: number;
  /** Android notification channel created by the app at startup. */
  channelId?: string;
  /** Replaces an in-flight or displayed notification with the same key. */
  collapseId?: string;
  /** iOS: groups notifications visually in Notification Center. */
  threadId?: string;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  /** Seconds the push service keeps trying to deliver to an offline device. */
  ttl?: number;
}

/**
 * Ticket/receipt errors that describe a temporary condition. Attempts stay
 * queued and are retried by the next cron pass instead of being failed.
 */
export const EXPO_TRANSIENT_PUSH_ERRORS = new Set(['MessageRateExceeded']);

export function isTransientExpoError(details: { error?: string } | undefined): boolean {
  return details?.error !== undefined && EXPO_TRANSIENT_PUSH_ERRORS.has(details.error);
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
}

export interface ExpoPushReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: {
    error?: string;
  };
}

type ExpoTransportFailure = {
  ok: false;
  transient: boolean;
  message: string;
};

type ExpoTicketSuccess = {
  ok: true;
  tickets: ExpoPushTicket[];
};

type ExpoReceiptSuccess = {
  ok: true;
  receipts: Record<string, ExpoPushReceipt>;
};

export type ExpoPushSendResult = ExpoTransportFailure | ExpoTicketSuccess;
export type ExpoPushReceiptResult = ExpoTransportFailure | ExpoReceiptSuccess;

export function expoPushAccessToken(): string | null {
  return process.env.EXPO_PUSH_ACCESS_TOKEN?.trim() || null;
}

function expoHeaders(accessToken: string | null): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function bodyMessage(body: unknown): string | null {
  if (typeof body === 'string') {
    return body;
  }

  if (body && typeof body === 'object' && 'errors' in body) {
    const errors = (body as { errors?: Array<{ message?: string }> }).errors;
    const message = errors?.find((error) => error.message)?.message;

    if (message) {
      return message;
    }
  }

  return null;
}

function networkErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Expo push network request failed.';
}

export async function sendExpoPushMessages(
  messages: ExpoPushMessage[],
  accessToken: string | null,
): Promise<ExpoPushSendResult> {
  const response = await fetch(EXPO_PUSH_SEND_URL, {
    method: 'POST',
    headers: expoHeaders(accessToken),
    body: JSON.stringify(messages),
  }).catch((error: unknown) => {
    return {
      networkError: networkErrorMessage(error),
    };
  });

  if ('networkError' in response) {
    return {
      ok: false,
      transient: true,
      message: response.networkError,
    };
  }

  const body = await readBody(response);

  if (!response.ok) {
    return {
      ok: false,
      transient: isTransientStatus(response.status),
      message: bodyMessage(body) ?? `Expo push send failed with HTTP ${response.status}.`,
    };
  }

  const data = body && typeof body === 'object' && 'data' in body
    ? (body as { data?: ExpoPushTicket[] | ExpoPushTicket }).data
    : undefined;

  return {
    ok: true,
    tickets: Array.isArray(data) ? data : data ? [data] : [],
  };
}

export async function fetchExpoPushReceipts(
  receiptIds: string[],
  accessToken: string | null,
): Promise<ExpoPushReceiptResult> {
  const response = await fetch(EXPO_PUSH_RECEIPTS_URL, {
    method: 'POST',
    headers: expoHeaders(accessToken),
    body: JSON.stringify({ ids: receiptIds }),
  }).catch((error: unknown) => {
    return {
      networkError: networkErrorMessage(error),
    };
  });

  if ('networkError' in response) {
    return {
      ok: false,
      transient: true,
      message: response.networkError,
    };
  }

  const body = await readBody(response);

  if (!response.ok) {
    return {
      ok: false,
      transient: isTransientStatus(response.status),
      message: bodyMessage(body) ?? `Expo push receipt check failed with HTTP ${response.status}.`,
    };
  }

  const data = body && typeof body === 'object' && 'data' in body
    ? (body as { data?: Record<string, ExpoPushReceipt> }).data
    : undefined;

  return {
    ok: true,
    receipts: data ?? {},
  };
}
