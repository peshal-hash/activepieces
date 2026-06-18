import { HttpMethod, httpClient } from '@activepieces/pieces-common';

/**
 * Name of the environment variable (set on the Activepieces container) that
 * holds the SalesOpt backend base URL, e.g.
 *   https://salesoptai-app-prod.icystone-9246cdc7.canadaeast.azurecontainerapps.io
 *
 * A comma-separated list is tolerated; the first entry is used.
 */
const BACKEND_URL_ENV_VAR = 'AP_SALESOPTAI_BACKEND_APIS';

type SalesOptErrorResponse = {
  status?: number;
  body?: unknown;
};

type SalesOptRequestError = {
  message?: string;
  response?: SalesOptErrorResponse;
  errorMessage?: () => {
    response?: SalesOptErrorResponse;
  };
};

export const SALESOPT_API_PATHS = {
  agents: '/developer/agents',
  chat: (agentId: string) =>
    `/developer/ws/${encodeURIComponent(agentId)}/chat`,
};

export function getBackendBaseUrl(): string {
  const raw =
    process.env[BACKEND_URL_ENV_VAR] ||
    process.env['SALESOPTAI_BACKEND_APIS'] ||
    process.env['AP_SALESOPTAI_URLS'];

  if (!raw || raw.trim() === '') {
    const keys = Object.keys(process.env).filter((k) => k.startsWith('AP_'));
    throw new Error(
      `SalesOpt backend URL is not configured. Set the ${BACKEND_URL_ENV_VAR} environment variable on the Activepieces container. ` +
        `(Note: Ensure ${BACKEND_URL_ENV_VAR} is listed in AP_SANDBOX_PROPAGATED_ENV_VARS so the engine receives it. ` +
        `Current propagated AP_* vars: ${keys.join(', ')})`
    );
  }
  // Use the first URL if a comma-separated list is provided, and drop any
  // trailing slashes so paths can be appended cleanly.
  return raw.split(',')[0].trim().replace(/\/+$/, '');
}

function extractErrorDetail(error: unknown): string {
  const requestError = error as SalesOptRequestError;
  const response =
    requestError.response ?? requestError.errorMessage?.()?.response;
  const status = response?.status;
  const body = response?.body;

  let detail: string | undefined;
  if (typeof body === 'string') {
    detail = body;
  } else if (body && typeof body === 'object') {
    const bodyRecord = body as Record<string, unknown>;
    detail =
      typeof bodyRecord['detail'] === 'string'
        ? bodyRecord['detail']
        : JSON.stringify(body);
  }

  if (status && detail) {
    return `HTTP ${status}: ${detail}`;
  }
  if (status) {
    return `HTTP ${status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function makeRequest<T = unknown>(
  apiKey: string,
  method: HttpMethod,
  path: string,
  body?: unknown
): Promise<T> {
  try {
    const response = await httpClient.sendRequest<T>({
      method,
      url: `${getBackendBaseUrl()}${path}`,
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });
    return response.body;
  } catch (error: unknown) {
    throw new Error(`SalesOpt API error: ${extractErrorDetail(error)}`);
  }
}
