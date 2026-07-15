import { createPiece } from '@activepieces/pieces-framework';
import { PieceCategory } from '@activepieces/shared';
import { salesOptAuth } from './lib/common/auth';
import { chatWithAgent } from './lib/actions/chat-with-agent';
import { NEXOPTA_LOGO } from './lib/common/logo';

export const nexoptaAgent = createPiece({
  displayName: 'NexOpta Agent',
  description:
    'Select and chat with the AI agents from your NexOpta account.',
  auth: salesOptAuth,
  minimumSupportedRelease: '0.36.1',
  categories: [PieceCategory.ARTIFICIAL_INTELLIGENCE],
  logoUrl: NEXOPTA_LOGO,
  authors: [],
  actions: [chatWithAgent],
  triggers: [],
});
