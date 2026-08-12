import { Column, ColumnDef, Row } from '@tanstack/react-table';
import { t } from 'i18next';
import { EllipsisVertical, Tag, Blocks, Clock, ToggleLeft } from 'lucide-react';
import { Dispatch, SetStateAction } from 'react';

import FlowActionMenu from '@/app/components/flow-actions-menu';
import { Button } from '@/components/ui/button';
import { RowDataWithActions } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { TruncatedColumnTextValue } from '@/components/ui/data-table/truncated-column-text-value';
import { FormattedDate } from '@/components/ui/formatted-date';
import { FlowStatusToggle } from '@/features/flows/components/flow-status-toggle';
import { PieceIconList } from '@/features/pieces/components/piece-icon-list';
import { cn } from '@/lib/utils';
import { PopulatedFlow } from '@activepieces/shared';

type FlowsTableColumnsProps = {
  refetch: () => void;
  refresh: number;
  setRefresh: Dispatch<SetStateAction<number>>;
  isMobile?: boolean;
};

export const flowsTableColumns = ({
  refetch,
  refresh,
  setRefresh,
  isMobile = false,
}: FlowsTableColumnsProps): (ColumnDef<RowDataWithActions<PopulatedFlow>> & {
  accessorKey: string;
})[] => [
  {
    accessorKey: 'name',
    // Sizes are applied as hard width/minWidth/maxWidth by DataTable, so they
    // have to shrink on a phone or the row overflows and gets clipped.
    // Mobile budget: 40 select + 168 name + 64 steps + 56 status + 40 actions.
    size: isMobile ? 168 : 200,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={t('Name')} icon={Tag} />
    ),
    cell: ({ row }) => {
      const displayName = row.original.version.displayName;
      return <TruncatedColumnTextValue value={displayName} />;
    },
  },
  {
    accessorKey: 'steps',
    size: isMobile ? 64 : 150,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={t('Steps')} icon={Blocks} />
    ),
    cell: ({ row }) => {
      return (
        <PieceIconList
          trigger={row.original.version.trigger}
          maxNumberOfIconsToShow={2}
        />
      );
    },
  },
  // "Last modified" has no size cap, so it soaks up whatever width is left.
  // Drop it on mobile and keep the room for Name / Steps / Status.
  ...(isMobile
    ? []
    : [
        {
          accessorKey: 'updated',
          header: ({
            column,
          }: {
            column: Column<RowDataWithActions<PopulatedFlow>>;
          }) => (
            <DataTableColumnHeader
              column={column}
              title={t('Last modified')}
              icon={Clock}
            />
          ),
          cell: ({ row }: { row: Row<RowDataWithActions<PopulatedFlow>> }) => {
            const updated = row.original.updated;
            return (
              <FormattedDate
                date={new Date(updated)}
                className="text-left font-medium"
              />
            );
          },
        },
      ]),
  {
    accessorKey: 'status',
    // 40px switch + 16px cell padding — anything wider shows up as a gap
    // between the toggle and the actions column on a phone.
    size: isMobile ? 56 : undefined,
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={t('Status')}
        icon={ToggleLeft}
      />
    ),
    cell: ({ row }) => {
      return (
        <div
          className={cn('flex items-center space-x-2', {
            'justify-end space-x-0': isMobile,
          })}
          onClick={(e) => e.stopPropagation()}
        >
          <FlowStatusToggle
            flow={row.original}
            hideStatusIcon={isMobile}
          ></FlowStatusToggle>
        </div>
      );
    },
  },
  {
    accessorKey: 'actions',
    size: isMobile ? 40 : undefined,
    header: ({ column }) => <DataTableColumnHeader column={column} title="" />,
    cell: ({ row }) => {
      const flow = row.original;
      return (
        <div
          className={cn({ 'flex justify-end': isMobile })}
          onClick={(e) => e.stopPropagation()}
        >
          <FlowActionMenu
            insideBuilder={false}
            onVersionsListClick={null}
            flow={flow}
            readonly={false}
            flowVersion={flow.version}
            onRename={() => {
              setRefresh(refresh + 1);
              refetch();
            }}
            onMoveTo={() => {
              setRefresh(refresh + 1);
              refetch();
            }}
            onDuplicate={() => {
              setRefresh(refresh + 1);
              refetch();
            }}
            onDelete={() => {
              setRefresh(refresh + 1);
              refetch();
            }}
            onOwnerChange={() => {
              setRefresh(refresh + 1);
              refetch();
            }}
          >
            {/* mr-8 pushes the trigger 32px left, which is most of a 44px
                mobile column — drop the offset so it sits flush with the row. */}
            <Button
              variant="ghost"
              size="icon"
              className={cn({ 'mr-8': !isMobile, 'size-8': isMobile })}
            >
              <EllipsisVertical className="h-4 w-4" />
            </Button>
          </FlowActionMenu>
        </div>
      );
    },
  },
  {
    accessorKey: 'connectionExternalId',
    enableHiding: true,
  },
];
