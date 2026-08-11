import { cn } from '@/lib/utils';

const LargeWidgetWrapper = ({
  children,
  containerClassName,
}: {
  children: React.ReactNode;
  containerClassName?: string;
}) => {
  return (
    <div className="absolute top-[12px] z-40 w-full px-2 flex justify-center">
      <div
        className={cn(
          // flex-wrap + gap so the message and its actions stack instead of
          // colliding once the canvas is only a phone wide.
          'py-1.5 px-3.5 border min-h-11.5  border border-border  bg-background z-40  w-full animate animate-fade duration-300 rounded-md  flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5',
          containerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
};
LargeWidgetWrapper.displayName = 'LargeWidgetWrapper';
export default LargeWidgetWrapper;
