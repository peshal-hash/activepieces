type DataTableToolbarProps = {
  children?: React.ReactNode;
};

const DataTableToolbar = (params: DataTableToolbarProps) => {
  return (
    // overflow-auto alone made narrow screens scroll sideways and clip the
    // trailing actions; wrapping keeps every control reachable instead.
    <div className="flex items-center justify-between pb-4 min-w-0">
      <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
        {params.children}
      </div>
    </div>
  );
};
DataTableToolbar.displayName = 'DataTableToolbar';

export { DataTableToolbar };
