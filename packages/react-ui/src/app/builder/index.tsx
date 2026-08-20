import { useRef, useState } from 'react';

import { useBuilderStateContext } from '@/app/builder/builder-hooks';
import { DataSelector } from '@/app/builder/data-selector';
import { CanvasControls } from '@/app/builder/flow-canvas/canvas-controls';
import { StepSettingsProvider } from '@/app/builder/step-settings/step-settings-context';
import { ChatDrawer } from '@/app/routes/chat/chat-drawer';
import { ShowPoweredBy } from '@/components/show-powered-by';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable-panel';
import { piecesHooks } from '@/features/pieces/lib/pieces-hooks';
import { platformHooks } from '@/hooks/platform-hooks';
import { useIsMobile } from '@/hooks/use-mobile';
import { RightSideBarType } from '@/lib/types';
import {
  FlowAction,
  FlowActionType,
  FlowTrigger,
  FlowTriggerType,
  FlowVersionState,
  flowStructureUtil,
  isNil,
} from '@activepieces/shared';

import { cn, useElementSize } from '../../lib/utils';

import { BuilderHeader } from './builder-header/builder-header';
import { FlowCanvas } from './flow-canvas';
import { flowCanvasHooks } from './flow-canvas/hooks';
import { flowCanvasConsts } from './flow-canvas/utils/consts';
import PublishFlowReminderWidget from './flow-canvas/widgets/publish-flow-reminder-widget';
import { RunInfoWidget } from './flow-canvas/widgets/run-info-widget';
import { ViewingOldVersionWidget } from './flow-canvas/widgets/viewing-old-version-widget';
import { FlowVersionsList } from './flow-versions';
import { RunsList } from './run-list';
import { CursorPositionProvider } from './state/cursor-position-context';
import { StepSettingsContainer } from './step-settings';
import { ResizableVerticalPanelsProvider } from './step-settings/resizable-vertical-panels-context';
const minWidthOfSidebar = 'min-w-[max(20vw,400px)]';
const animateResizeClassName = `transition-all `;

const BuilderPage = () => {
  const { platform } = platformHooks.useCurrentPlatform();
  const isMobile = useIsMobile();
  const [flowVersion, rightSidebar, selectedStep] = useBuilderStateContext(
    (state) => [state.flowVersion, state.rightSidebar, state.selectedStep],
  );
  flowCanvasHooks.useShowBuilderIsSavingWarningBeforeLeaving();
  const { memorizedSelectedStep } = useBuilderStateContext((state) => {
    const flowVersion = state.flowVersion;
    if (isNil(state.selectedStep) || isNil(flowVersion)) {
      return {
        memorizedSelectedStep: undefined,
      };
    }
    const step = flowStructureUtil.getStep(
      state.selectedStep,
      flowVersion.trigger,
    );
    return {
      memorizedSelectedStep: step,
    };
  });
  const middlePanelRef = useRef<HTMLDivElement>(null);
  const middlePanelSize = useElementSize(middlePanelRef);
  const [isDraggingHandle, setIsDraggingHandle] = useState(false);
  const rightHandleRef = flowCanvasHooks.useAnimateSidebar(rightSidebar);
  const rightSidePanelRef = useRef<HTMLDivElement>(null);
  const { pieceModel, refetch: refetchPiece } =
    piecesHooks.usePieceModelForStepSettings({
      name: memorizedSelectedStep?.settings.pieceName,
      version: memorizedSelectedStep?.settings.pieceVersion,
      enabled:
        memorizedSelectedStep?.type === FlowActionType.PIECE ||
        memorizedSelectedStep?.type === FlowTriggerType.PIECE,
      getExactVersion: flowVersion.state === FlowVersionState.LOCKED,
    });
  flowCanvasHooks.useSetSocketListener(refetchPiece);
  const [hasCanvasBeenInitialised, setHasCanvasBeenInitialised] =
    useState(false);
  const isMobileSidebarOpen =
    isMobile && rightSidebar !== RightSideBarType.NONE;

  // Shared by the desktop resizable panel and the mobile full-screen overlay.
  const sidebarContent = (
    <>
      {rightSidebar === RightSideBarType.PIECE_SETTINGS &&
        memorizedSelectedStep && (
          <ResizableVerticalPanelsProvider>
            <StepSettingsProvider
              pieceModel={pieceModel}
              selectedStep={memorizedSelectedStep}
              key={constructContainerKey({
                flowVersionId: flowVersion.id,
                step: memorizedSelectedStep,
                hasPieceModelLoaded: !!pieceModel,
              })}
            >
              <StepSettingsContainer />
            </StepSettingsProvider>
          </ResizableVerticalPanelsProvider>
        )}
      {rightSidebar === RightSideBarType.RUNS && <RunsList />}
      {rightSidebar === RightSideBarType.VERSIONS && <FlowVersionsList />}
    </>
  );

  return (
    <div className="flex h-full w-full flex-col relative overflow-hidden">
      {/* Above the canvas chrome, below the mobile sheet (z-60). */}
      <div className="relative z-50 shrink-0">
        <BuilderHeader />
      </div>
      <ResizablePanelGroup
        direction="horizontal"
        className="flex-1 min-h-0 min-w-0"
      >
        <ResizablePanel
          defaultSize={100}
          order={2}
          id="flow-canvas"
          className="min-w-0"
        >
          <div
            ref={middlePanelRef}
            className="relative h-full w-full overflow-hidden"
          >
            <CursorPositionProvider>
              <FlowCanvas
                setHasCanvasBeenInitialised={setHasCanvasBeenInitialised}
              ></FlowCanvas>
            </CursorPositionProvider>

            {/* Unreachable while the mobile sheet covers the canvas, so skip
                it rather than stack it underneath. */}
            {!isMobileSidebarOpen && (
              <>
                <PublishFlowReminderWidget />
                <RunInfoWidget />
                <ViewingOldVersionWidget />
                {middlePanelRef.current &&
                  middlePanelRef.current.clientWidth > 0 && (
                    <CanvasControls
                      canvasHeight={middlePanelRef.current?.clientHeight ?? 0}
                      canvasWidth={middlePanelRef.current?.clientWidth ?? 0}
                      hasCanvasBeenInitialised={hasCanvasBeenInitialised}
                      selectedStep={selectedStep}
                    ></CanvasControls>
                  )}

                <ShowPoweredBy
                  position="absolute"
                  show={platform?.plan.showPoweredBy}
                />
              </>
            )}
            <DataSelector
              parentHeight={middlePanelSize.height}
              parentWidth={middlePanelSize.width}
            ></DataSelector>
          </div>
        </ResizablePanel>

        {/* The sidebar has a 400px min-width, which does not fit beside the
            canvas on a phone. Below the mobile breakpoint it becomes a
            full-screen overlay instead of a resizable panel. */}
        {!isMobile && (
          <>
            <ResizableHandle
              disabled={rightSidebar === RightSideBarType.NONE}
              withHandle={rightSidebar !== RightSideBarType.NONE}
              onDragging={setIsDraggingHandle}
              className={
                rightSidebar === RightSideBarType.NONE ? 'bg-transparent' : ''
              }
            />

            <ResizablePanel
              ref={rightHandleRef}
              id="right-sidebar"
              defaultSize={0}
              minSize={0}
              maxSize={60}
              order={3}
              className={cn('min-w-0 bg-background z-30', {
                [minWidthOfSidebar]: rightSidebar !== RightSideBarType.NONE,
                [animateResizeClassName]: !isDraggingHandle,
              })}
              style={{
                transitionDuration: `${
                  isDraggingHandle
                    ? 0
                    : flowCanvasConsts.SIDEBAR_ANIMATION_DURATION
                }ms`,
              }}
            >
              <div ref={rightSidePanelRef} className="h-full w-full">
                {sidebarContent}
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Starts below the header and sits above every canvas overlay (which
          top out at z-50) so nothing bleeds through the step settings. */}
      {isMobileSidebarOpen && (
        <div
          className="absolute inset-x-0 bottom-0 z-[60] bg-background flex flex-col overscroll-contain"
          style={{ top: `${flowCanvasConsts.BUILDER_HEADER_HEIGHT}px` }}
        >
          {/* No close button here on purpose. Every panel this overlay can
              host (step settings, runs, versions) already renders its own
              SidebarHeader with an X that performs the same close, so adding
              one here stacked two identical crosses on top of each other and
              left it ambiguous which one returned to the flow. The panel's own
              header is the one to keep: it sits beside the step name, so it
              reads as "close this step" rather than a bare anonymous X. */}
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
            {sidebarContent}
          </div>
        </div>
      )}

      <ChatDrawer />
    </div>
  );
};

BuilderPage.displayName = 'BuilderPage';
export { BuilderPage };

function constructContainerKey({
  flowVersionId,
  step,
  hasPieceModelLoaded,
}: {
  flowVersionId: string;
  step?: FlowAction | FlowTrigger;
  hasPieceModelLoaded: boolean;
}) {
  const stepName = step?.name;
  const triggerOrActionName =
    step?.type === FlowTriggerType.PIECE
      ? step?.settings.triggerName
      : step?.settings.actionName;
  const pieceName =
    step?.type === FlowTriggerType.PIECE || step?.type === FlowActionType.PIECE
      ? step?.settings.pieceName
      : undefined;
  //we need to re-render the step settings form when the step is skipped, so when the user edits the settings after setting it to skipped the changes are reflected in the update request
  const isSkipped =
    step?.type != FlowTriggerType.EMPTY &&
    step?.type != FlowTriggerType.PIECE &&
    step?.skip;
  return `${flowVersionId}-${stepName ?? ''}-${triggerOrActionName ?? ''}-${
    pieceName ?? ''
  }-${'skipped-' + !!isSkipped}-${
    hasPieceModelLoaded ? 'loaded' : 'not-loaded'
  }`;
}
