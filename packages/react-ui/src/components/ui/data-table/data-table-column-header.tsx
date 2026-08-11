import { Column } from '@tanstack/react-table';
import { ArrowDown, ArrowUpDown, LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
  icon?: LucideIcon;
  sortable?: boolean;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  icon: Icon,
  sortable = false,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (sortable) {
    const sortDirection = column.getIsSorted();
    const SortIcon = sortDirection === 'desc' ? ArrowDown : ArrowUpDown;

    return (
      <Button
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          if (sortDirection !== 'desc') {
            column.toggleSorting(true, false);
          }
        }}
        className={`h-auto text-foreground p-0 hover:bg-transparent -ml-3 ${className}`}
      >
        {Icon && (
          <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0 mr-2" />
        )}
        {title}
        <SortIcon className="ml-2 h-4 w-4" />
      </Button>
    );
  }

  return (
    <div
      className={`flex items-center justify-start gap-2 py-4 min-w-0 ${className}`}
    >
      {/* The icon costs ~24px of a column that may only be 70px wide on a
          phone, so keep the label and drop the decoration. */}
      {Icon && (
        <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0 hidden md:block" />
      )}
      <div className="text-sm text-foreground truncate">{title}</div>
    </div>
  );
}
