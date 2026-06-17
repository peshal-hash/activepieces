import { HttpMethod, httpClient } from '@activepieces/pieces-common';

/**
 * Name of the environment variable (set on the Activepieces container) that
 * holds the SalesOpt backend base URL, e.g.
 *   https://salesoptai-app-prod.icystone-9246cdc7.canadaeast.azurecontainerapps.io
 *
 * A comma-separated list is tolerated; the first entry is used.
 */
const BACKEND_URL_ENV_VAR = 'AP_SALESOPTAI_BACKEND_APIS';

export function getBackendBaseUrl(): string {
  const raw = process.env[BACKEND_URL_ENV_VAR];
  if (!raw || raw.trim() === '') {
    throw new Error(
      `SalesOpt backend URL is not configured. Set the ${BACKEND_URL_ENV_VAR} environment variable on the Activepieces container.`
    );
  }
  // Use the first URL if a comma-separated list is provided, and drop any
  // trailing slashes so paths can be appended cleanly.
  return raw.split(',')[0].trim().replace(/\/+$/, '');
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
  } catch (error: any) {
    throw new Error(`SalesOpt API error: ${error?.message || String(error)}`);
  }
}
