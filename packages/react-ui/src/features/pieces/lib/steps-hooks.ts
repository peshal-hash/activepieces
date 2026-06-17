import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { authenticationSession } from '@/lib/authentication-session';
import {
  FlowAction,
  FlowActionType,
  FlowTriggerType,
  LocalesEnum,
  SuggestionType,
  FlowTrigger,
} from '@activepieces/shared';

import {
  StepMetadataWithActionOrTriggerOrAgentDisplayName,
  StepMetadataWithSuggestions,
} from '../../../lib/types';

import { piecesApi } from './pieces-api';
import {
  CORE_ACTIONS_METADATA,
  CORE_STEP_METADATA,
  stepUtils,
} from './step-utils';

export const stepsHooks = {
  useStepMetadata: ({ step }: UseStepMetadata) => {
    const { i18n } = useTranslation();
    const query = useQuery<
      StepMetadataWithActionOrTriggerOrAgentDisplayName,
      Error
    >({
      queryKey: getQueryKeyForStepMetadata(step, i18n.language as LocalesEnum),
      queryFn: () => stepUtils.getMetadata(step, i18n.language as LocalesEnum),
    });
    return {
      stepMetadata: query.data,
      isLoading: query.isLoading,
    };
  },
  useStepsMetadata: (props: (FlowAction | FlowTrigger)[]) => {
    const { i18n } = useTranslation();
    return useQueries({
      queries: props.map((step) => {
        return {
          queryKey: getQueryKeyForStepMetadata(
            step,
            i18n.language as LocalesEnum,
          ),
          queryFn: () =>
            stepUtils.getMetadata(step, i18n.language as LocalesEnum),
          staleTime: Infinity,
        };
      }),
    });
  },
  useAllStepsMetadata: ({ searchQuery, type, enabled }: UseMetadataProps) => {
    const { i18n } = useTranslation();

    // --- helper to identify the built-in "Agent" piece we want to hide.
    // Match ONLY Activepieces' own agent piece by exact package name. Do NOT match
    // on a generic "agent" word: custom pieces such as @activepieces/piece-nexopta-agent
    // ("NexOpta Agent") legitimately contain "agent" and must remain visible.
    const isAgentPiece = (piece: { name?: string; displayName?: string }) => {
      const name = (piece.name ?? '').toLowerCase();
      return name === '@activepieces/piece-agent';
    };

    const query = useQuery<StepMetadataWithSuggestions[], Error>({
      queryKey: ['pieces-metadata', searchQuery, type],
      queryFn: async () => {
        const pieces = await piecesApi.list({
          projectId: authenticationSession.getProjectId()!,
          searchQuery,
          suggestionType:
            type === 'action' ? SuggestionType.ACTION : SuggestionType.TRIGGER,
          locale: i18n.language as LocalesEnum,
        });

        // keep only items that have suggestions for the requested mode…
        const filteredBySuggestionType = pieces.filter(
          (piece) =>
            (type === 'action' && piece.actions > 0) ||
            (type === 'trigger' && piece.triggers > 0),
        );

        // …and drop Agent items entirely
        const withoutAgent = filteredBySuggestionType.filter(
          (p) => !isAgentPiece(p),
        );

        const piecesMetadata = withoutAgent.map((piece) => {
          const metadata = stepUtils.mapPieceToMetadata({ piece, type });
          return {
            ...metadata,
            suggestedActions: piece.suggestedActions,
            suggestedTriggers: piece.suggestedTriggers,
          };
        });

        switch (type) {
          case 'action': {
            const filteredCoreActions = CORE_ACTIONS_METADATA.filter((step) =>
              passSearch(searchQuery, step),
            );
            return [...filteredCoreActions, ...piecesMetadata];
          }
          case 'trigger':
            return [...piecesMetadata];
        }
      },
      enabled,
      staleTime: searchQuery ? 0 : Infinity,
    });

    return {
      refetch: query.refetch,
      metadata: query.data,
      isLoading: query.isLoading,
    };
  },

};
function passSearch(
  searchQuery: string | undefined,
  data: (typeof CORE_STEP_METADATA)[keyof typeof CORE_STEP_METADATA],
) {
  if (!searchQuery) {
    return true;
  }
  return JSON.stringify({ data })
    .toLowerCase()
    .includes(searchQuery?.toLowerCase());
}

type UseStepMetadata = {
  step: FlowAction | FlowTrigger;
};

type UseMetadataProps = {
  searchQuery: string;
  enabled?: boolean;
  type: 'action' | 'trigger';
};

const getQueryKeyForStepMetadata = (
  step: FlowAction | FlowTrigger,
  locale: LocalesEnum,
): (string | undefined)[] => {
  const isPieceStep =
    step.type === FlowActionType.PIECE || step.type === FlowTriggerType.PIECE;
  const pieceName = isPieceStep ? step.settings.pieceName : undefined;
  const pieceVersion = isPieceStep ? step.settings.pieceVersion : undefined;
  const customLogoUrl =
    'customLogoUrl' in step ? (step.customLogoUrl as string) : undefined;
  const actionName =
    step.type === FlowActionType.PIECE ? step.settings.actionName : undefined;
  const triggerName =
    step.type === FlowTriggerType.PIECE ? step.settings.triggerName : undefined;
  return [
    actionName,
    triggerName,
    pieceName,
    pieceVersion,
    customLogoUrl,
    locale,
    step.type,
  ];
};
