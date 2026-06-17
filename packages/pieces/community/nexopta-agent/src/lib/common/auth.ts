import { PieceAuth } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';
import { makeRequest, SALESOPT_API_PATHS } from './client';

export const salesOptAuth = PieceAuth.SecretText({
  displayName: 'SalesOpt API Key',
  description: `**Enter your SalesOpt API Key**
---
1. Log in to the SalesOpt portal.
2. Open **Settings → API Keys**.
3. Create (or copy) an API key for your account and paste it here.

The backend URL is configured on the server via the
\`AP_SALESOPTAI_BACKEND_APIS\` environment variable, so you only need the key.`,
  required: true,
  validate: async ({ auth }) => {
    try {
      await makeRequest(
        auth as string,
        HttpMethod.GET,
        SALESOPT_API_PATHS.agents
      );
      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error:
          error?.message ||
          'Invalid API key, or the SalesOpt backend is not reachable.',
      };
    }
  },
});
