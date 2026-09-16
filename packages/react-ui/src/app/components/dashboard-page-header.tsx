import { PageHeader } from '@/components/custom/page-header';
import { useIsPlatformAdmin } from '@/hooks/authorization-hooks';

export const DashboardPageHeader = ({
  title,
  children,
  description,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  description?: React.ReactNode;
}) => {
  // Collapsing/expanding the sidebar is platform-admin only, on every
  // viewport. For anyone else the trigger is hidden and the provider keeps
  // the sidebar closed regardless.
  const isPlatformAdmin = useIsPlatformAdmin();
  return (
    <PageHeader
      title={title}
      description={description}
      rightContent={children}
      className="min-w-full z-30 -mx-4"
      hideSidebarTrigger={!isPlatformAdmin}
    />
  );
};
