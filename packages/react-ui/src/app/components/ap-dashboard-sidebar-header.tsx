import { t } from 'i18next';
import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import apLogo from '@/assets/img/logo/ap-logo.png';

import { useEmbedding } from '@/components/embed-provider';
import { Button } from '@/components/ui/button';
import { SidebarHeader } from '@/components/ui/sidebar-shadcn';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ProjectSwitcher } from '@/features/projects/components/project-switcher';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { flagsHooks } from '@/hooks/flags-hooks';
import { cn, determineDefaultRoute } from '@/lib/utils';
import { ApEdition, ApFlagId } from '@activepieces/shared';

const ApDashboardSidebarHeader = ({
  isHomeDashboard,
}: {
  isHomeDashboard: boolean;
}) => {
  const { data: edition } = flagsHooks.useFlag<ApEdition>(ApFlagId.EDITION);
  // Correctly destructure the 'data' property and rename it to salesOptUrls
  const { data: salesOptUrls } = flagsHooks.useFlag<string>(ApFlagId.SALESOPTAI_URLS);
  const firstSalesOptUrl = useMemo(() => {
      // Check if the data exists and is a non-empty string
      if (salesOptUrls) {
          // Split the string by the comma, get the first element, and trim any whitespace
          return salesOptUrls.split(',')[0].trim();
      }
      return undefined; // or a default value like ''
  }, [salesOptUrls]);

  const { embedState } = useEmbedding();
  const isInPlatformAdmin = window.location.pathname.includes('platform');
  const showProjectSwitcher =
    edition !== ApEdition.COMMUNITY &&
    !embedState.isEmbedded &&
    !isInPlatformAdmin;
  const { checkAccess } = useAuthorization();
  const defaultRoute = determineDefaultRoute(checkAccess);

  const handleBackClick = () => {
    // Only attempt to redirect if the URL exists
    if (firstSalesOptUrl) {
      window.location.href = firstSalesOptUrl;
    } else {
      console.error('SalesOpt URL is not available from flags.');
    }
  };

  return (
    <SidebarHeader className="pb-0">
      <div
        className={cn('flex items-center justify-between grow gap-1', {
          'justify-start': !isHomeDashboard,
          'justify-center': embedState.hideProjectSettings,
        })}
      >
        {isHomeDashboard && !embedState.hideProjectSettings && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBackClick}
                // Disable the button until the URL has loaded from the backend
                disabled={!salesOptUrls}
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">{t('Go back')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('Go back')}</TooltipContent>
          </Tooltip>
        )}
        <Button
          variant="ghost"
          className={cn({ 'w-full': !isHomeDashboard && !showProjectSwitcher }, '-ml-1.5')}
        >
          <Link to={isHomeDashboard ? defaultRoute : '/platform'}>
            <Tooltip>
              <TooltipTrigger asChild>
                <>
                  {showProjectSwitcher && (
                    <img
                      src={apLogo}
                      alt={t('home')}
                      className="h-5 w-5 object-contain"
                    />
                  )}

                  {!showProjectSwitcher && (
                    <img
                      src={apLogo}
                      alt={t('home')}
                      width={160}
                      height={51}
                      className="max-h-[51px] max-w-[160px] object-contain"
                    />
                  )}
                </>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('Home')}</TooltipContent>
            </Tooltip>
          </Link>
        </Button>

        {showProjectSwitcher && (
          <div className="grow">
            <ProjectSwitcher />
          </div>
        )}
      </div>
    </SidebarHeader>
  );
};

ApDashboardSidebarHeader.displayName = 'ApDashboardSidebarHeader';

export { ApDashboardSidebarHeader };

