import { Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';
import { makeRequest } from './client';
import { salesOptAuth } from './auth';

type SalesOptAgent = {
  // The API serializes the id under its alias "id"; accept "agent_id" too for safety.
  id?: string;
  agent_id?: string;
  name?: string;
};

/**
 * Dropdown that lists the SalesOpt agents the connected API key can manage.
 * Calls GET {backend}/api/agents and maps each agent to a selectable option.
 */
export const agentIdDropdown = Property.Dropdown<string, true, typeof salesOptAuth>({
  auth: salesOptAuth,
  displayName: 'Agent',
  description: 'Select one of your SalesOpt agents.',
  required: true,
  refreshers: ['auth'],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your SalesOpt account first',
        options: [],
      };
    }

    try {
      const agents = await makeRequest<SalesOptAgent[]>(
        auth.secret_text,
        HttpMethod.GET,
        '/api/agents'
      );

      if (!Array.isArray(agents)) {
        return {
          disabled: true,
          placeholder: 'Unexpected response while loading agents',
          options: [],
        };
      }

      return {
        disabled: false,
        options: agents
          .map((agent) => {
            const value = agent.id ?? agent.agent_id;
            if (!value) {
              return undefined;
            }
            return {
              label: agent.name ?? `Agent ${value}`,
              value,
            };
          })
          .filter(
            (option): option is { label: string; value: string } =>
              option !== undefined
          ),
      };
    } catch (error: any) {
      return {
        disabled: true,
        placeholder: `Failed to load agents: ${error?.message || error}`,
        options: [],
      };
    }
  },
});
