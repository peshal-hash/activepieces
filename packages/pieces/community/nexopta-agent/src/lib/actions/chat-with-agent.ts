import { createAction, Property, ApFile } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';
import { salesOptAuth } from '../common/auth';
import { agentIdDropdown } from '../common/agent-dropdown';
import { makeRequest, SALESOPT_API_PATHS, getMediaType } from '../common/client';

export const chatWithAgent = createAction({
  auth: salesOptAuth,
  name: 'chat_with_agent',
  displayName: 'Chat with Agent',
  description:
    'Send a message (and optionally files) to one of your SalesOpt agents and return its reply.',
  props: {
    agentId: agentIdDropdown,
    message: Property.LongText({
      displayName: 'Message',
      description: 'The message to send to the agent.',
      required: true,
    }),
    files: Property.Array({
      displayName: 'Files',
      description:
        'Optional file attachments (images: PNG/JPEG/GIF/WEBP, documents: PDF/DOCX/TXT). Images require a vision-capable model.',
      required: false,
      properties: {
        file: Property.File({
          displayName: 'File',
          description: 'File to attach.',
          required: true,
        }),
      },
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

    const fileEntries = (propsValue.files as Array<{ file: ApFile }>) ?? [];
    const files = fileEntries
      .map((entry) => entry?.file)
      .filter((file): file is ApFile => !!file)
      .map((file) => ({
        filename: file.filename,
        media_type: getMediaType(file.filename, file.extension),
        // ApFile.base64 returns the raw base64 content (no data: URI prefix),
        // which is exactly what the backend's ChatFilePayload expects.
        data: file.base64,
      }));

    return await makeRequest(
      auth.secret_text,
      HttpMethod.POST,
      SALESOPT_API_PATHS.chat(agentId),
      {
        message,
        files,
        conversation_id: conversationId,
        // Force non-streaming so the action returns a single JSON response.
        stream: false,
        include_detail: includeDetail ?? false,
      }
    );
  },
});
