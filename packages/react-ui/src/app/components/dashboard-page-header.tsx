import { PageHeader } from '@/components/custom/page-header';
import { useIsMobile } from '@/hooks/use-mobile';

export const DashboardPageHeader = ({
  title,
  children,
  description,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  description?: React.ReactNode;
}) => {
  const isMobile = useIsMobile();
  return (
    <PageHeader
      title={title}
      description={description}
      rightContent={children}
      className="min-w-full z-30 -mx-4"
      hideSidebarTrigger={!isMobile}
    />
  );
};
