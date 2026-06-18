import { createAction, Property, ApFile } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';
import { salesOptAuth } from '../common/auth';
import { agentIdDropdown } from '../common/agent-dropdown';
import { makeRequest, SALESOPT_API_PATHS, getMediaType } from '../common/client';

/** Shape of a single file the SalesOpt backend's ChatFilePayload expects. */
type ChatFilePayload = {
  filename: string;
  media_type: string;
  data: string;
};

/**
 * Sentinel used as the `data` of the JSON field's example default value.
 * Entries still carrying it are treated as the unedited template and skipped,
 * so the example never gets sent as a real (and invalid) attachment.
 */
const BASE64_PLACEHOLDER = 'PASTE_BASE64_FILE_CONTENT_HERE';

/** Strip a leading `data:<mime>;base64,` prefix if the caller included one. */
function stripDataUriPrefix(data: string): string {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(data.trim());
  return match ? match[2] : data.trim();
}

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
      displayName: 'Files (upload / attach)',
      description:
        'Upload files directly or attach them from a previous step. Images: PNG/JPEG/GIF/WEBP (require a vision-capable model). Documents: PDF/DOCX/TXT (text is extracted).',
      required: false,
      properties: {
        file: Property.File({
          displayName: 'File',
          description: 'File to attach.',
          required: true,
        }),
      },
    }),
    filesJson: Property.Json({
      displayName: 'Files (base64 JSON)',
      description:
        'Alternative to uploading: an array of files as base64. ' +
        '"filename" and "data" are required; "media_type" is optional ' +
        '(inferred from the filename) and "data" may include a ' +
        '"data:...;base64," prefix. See the example below for the exact shape.',
      required: false,
      defaultValue: [
        {
          filename: 'report.pdf',
          media_type: 'application/pdf',
          data: BASE64_PLACEHOLDER,
        },
      ],
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

    const files: ChatFilePayload[] = [];

    // 1. Files uploaded / attached directly via the File picker.
    const uploaded = (propsValue.files as Array<{ file: ApFile }>) ?? [];
    for (const entry of uploaded) {
      const file = entry?.file;
      if (!file) continue;
      files.push({
        filename: file.filename,
        media_type: getMediaType(file.filename, file.extension),
        // ApFile.base64 returns raw base64 content (no data: URI prefix),
        // which is exactly what the backend's ChatFilePayload expects.
        data: file.base64,
      });
    }

    // 2. Files supplied directly as base64 JSON.
    const rawJson = propsValue.filesJson;
    if (rawJson != null) {
      const items = Array.isArray(rawJson) ? rawJson : [rawJson];
      for (const item of items) {
        const obj = item as Record<string, unknown>;
        const filename = typeof obj?.['filename'] === 'string' ? obj['filename'] : '';
        const data = typeof obj?.['data'] === 'string' ? obj['data'] : '';
        // Skip the unedited example template so it isn't sent as a real file.
        if (data === BASE64_PLACEHOLDER) {
          continue;
        }
        if (!filename || !data) {
          throw new Error(
            'Each "Files (base64 JSON)" entry must include a non-empty "filename" and "data" (base64) field.'
          );
        }
        const mediaType =
          typeof obj['media_type'] === 'string' && obj['media_type']
            ? (obj['media_type'] as string)
            : getMediaType(filename);
        files.push({
          filename,
          media_type: mediaType,
          data: stripDataUriPrefix(data),
        });
      }
    }

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
