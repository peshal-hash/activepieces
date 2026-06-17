import { createAction, Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';
import { salesOptAuth } from '../common/auth';
import { agentIdDropdown } from '../common/agent-dropdown';
import { makeRequest } from '../common/client';

export const chatWithAgent = createAction({
  auth: salesOptAuth,
  name: 'chat_with_agent',
  displayName: 'Chat with Agent',
  description:
    'Send a message to one of your SalesOpt agents and return its reply.',
  props: {
    agentId: agentIdDropdown,
    message: Property.LongText({
      displayName: 'Message',
      description: 'The message to send to the agent.',
      required: true,
    }),
    conversationId: Property.ShortText({
      displayName: 'Conversation ID',
      description:
        'Optional external conversation ID to continue an existing conversation. Leave empty to start a new one.',
      required: false,
    }),
    includeDetail: Property.Checkbox({
      displayName: 'Include Execution Detail',
      description: 'Include structured agent execution detail in the response.',
      required: false,
      defaultValue: false,
    }),
  },
  async run({ auth, propsValue }) {
    const { agentId, message, conversationId, includeDetail } = propsValue;

    return await makeRequest(
      auth.secret_text,
      HttpMethod.POST,
      `/api/ws/${agentId}/chat`,
      {
        message,
        conversation_id: conversationId,
        // Force non-streaming so the action returns a single JSON response.
        stream: false,
        include_detail: includeDetail ?? false,
      }
    );
  },
});
