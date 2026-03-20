import { t } from 'i18next';
import { Link } from 'react-router-dom';

import { useEmbedding } from '@/components/embed-provider';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar-shadcn';
import { PlatformSwitcher } from '@/features/projects/components/platform-switcher';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { flagsHooks } from '@/hooks/flags-hooks';
import { platformHooks } from '@/hooks/platform-hooks';
import { cn, determineDefaultRoute } from '@/lib/utils';
import { ApEdition, ApFlagId } from '@activepieces/shared';

export const AppSidebarHeader = () => {
  const { embedState } = useEmbedding();
  const { data: edition } = flagsHooks.useFlag<ApEdition>(ApFlagId.EDITION);
  const branding = flagsHooks.useWebsiteBranding();
  const showSwitcher = edition === ApEdition.CLOUD && !embedState.isEmbedded;
  const { state } = useSidebar();
  const { platform: currentPlatform } = platformHooks.useCurrentPlatform();
  const { checkAccess } = useAuthorization();
  const defaultRoute = determineDefaultRoute(checkAccess);
  const platformDisplayName = currentPlatform?.name ?? branding.websiteName;

  if (!showSwitcher) {
    return (
      <SidebarHeader
        className="relative w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <SidebarMenu className="w-full">
          <SidebarMenuItem
            className={cn(
              'flex items-center gap-1',
              state === 'collapsed' ? 'justify-center' : 'justify-between',
            )}
          >
            {state === 'collapsed' ? (
              <Link to={defaultRoute}>
                <Button variant="ghost" size="icon">
                  <img
                    src={branding.logos.logoIconUrl}
                    alt={t('Home')}
                    className="h-5 w-5 object-contain"
                    draggable={false}
                  />
                </Button>
              </Link>
            ) : (
              <div className="flex items-center gap-2 w-full">
                <Link to={defaultRoute}>
                  <Button variant="ghost" size="icon">
                    <img
                      src={branding.logos.logoIconUrl}
                      alt={t('Home')}
                      className="h-5 w-5 object-contain"
                      draggable={false}
                    />
                  </Button>
                </Link>
                <Separator orientation="vertical" className="h-4" />
                <SidebarMenuButton asChild className="px-2 h-9 gap-3 flex-1 min-w-0">
                  <Link to={defaultRoute}>
                    <h1 className="flex-1 min-w-0 truncate font-semibold">
                      {platformDisplayName}
                    </h1>
                  </Link>
                </SidebarMenuButton>
              </div>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
    );
  }

  return (
    <SidebarHeader className="relative" onClick={(e) => e.stopPropagation()}>
      <SidebarMenu>
        <SidebarMenuItem
          className={cn(
            'flex items-center gap-1',
            state === 'collapsed' ? 'justify-center' : 'justify-between',
          )}
        >
          <div
            className={cn(
              'flex items-center gap-1',
              state === 'collapsed' ? 'w-auto' : 'w-full',
            )}
          >
            {state === 'collapsed' ? (
              <Link to={defaultRoute}>
                <Button variant="ghost" size="icon">
                  <img
                    src={branding.logos.logoIconUrl}
                    alt={t('Home')}
                    className="h-5 w-5 object-contain"
                  />
                </Button>
              </Link>
            ) : (
              <div className="flex items-center gap-2 w-full">
                <Link to={defaultRoute}>
                  <Button variant="ghost" size="icon">
                    <img
                      src={branding.logos.logoIconUrl}
                      alt={t('Home')}
                      className="h-5 w-5 object-contain"
                    />
                  </Button>
                </Link>
                <Separator orientation="vertical" className="h-4" />
                <PlatformSwitcher>
                  <SidebarMenuButton className="px-2 h-9 gap-3 flex-1 min-w-0">
                    <h1 className="flex-1 min-w-0 truncate font-semibold">
                      {platformDisplayName}
                    </h1>
                    {/* ✅ removed ChevronsUpDown */}
                  </SidebarMenuButton>
                </PlatformSwitcher>
              </div>
            )}
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
};
