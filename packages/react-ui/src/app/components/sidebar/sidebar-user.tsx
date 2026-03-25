import { useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import {
  ChevronsUpDown,
  KeyRound,
  LogOut,
  Shield,
  UserCogIcon,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useEmbedding } from '@/components/embed-provider';
import { useTelemetry } from '@/components/telemetry-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar-shadcn';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/ui/user-avatar';
import { InviteUserDialog } from '@/features/members/component/invite-user-dialog';
import {
  useIsPlatformAdmin,
  useAuthorization,
} from '@/hooks/authorization-hooks';
import { platformHooks } from '@/hooks/platform-hooks';
import { userHooks } from '@/hooks/user-hooks';
import { authenticationSession } from '@/lib/authentication-session';
import { Permission } from '@activepieces/shared';

import AccountSettingsDialog from '../account-settings';
import { HelpAndFeedback } from '../help-and-feedback';

export function SidebarUser() {
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [inviteUserOpen, setInviteUserOpen] = useState(false);
  const { embedState } = useEmbedding();
  const { state } = useSidebar();
  const location = useLocation();
  const { data: user } = userHooks.useCurrentUser();
  const { platform } = platformHooks.useCurrentPlatform();
  const queryClient = useQueryClient();
  const { reset } = useTelemetry();
  const { checkAccess } = useAuthorization();
  const canInviteUsers = checkAccess(Permission.WRITE_INVITATION);
  const isInPlatformAdmin = location.pathname.startsWith('/platform');
  const isCollapsed = state === 'collapsed';

  if (!user || embedState.isEmbedded) {
    return null;
  }

  const handleLogout = () => {
    userHooks.invalidateCurrentUser(queryClient);
    authenticationSession.logOut();
    reset();
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu modal>
          {isCollapsed ? (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger className="flex items-center justify-center size-9 rounded-md hover:bg-accent cursor-pointer">
                    <UserAvatar
                      name={user.firstName + ' ' + user.lastName}
                      email={user.email}
                      imageUrl={user.imageUrl}
                      size={28}
                      disableTooltip={true}
                    />
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right" align="center">
                  <div className="flex flex-col">
                    <span>{user.firstName + ' ' + user.lastName}</span>
                    <span className="text-xs text-muted-foreground">
                      {platform.name}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent px-2 data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="flex items-center gap-2 w-full text-left text-sm">
                  <UserAvatar
                    name={user.firstName + ' ' + user.lastName}
                    email={user.email}
                    imageUrl={user.imageUrl}
                    size={32}
                    disableTooltip={true}
                  />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate">
                      {user.firstName + ' ' + user.lastName}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </div>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
          )}
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side="right"
            align="end"
            sideOffset={4}
          >

            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setAccountSettingsOpen(true)}>
                <KeyRound className="w-4 h-4 mr-2" />
                {t('API Keys')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      <AccountSettingsDialog
        open={accountSettingsOpen}
        onClose={() => setAccountSettingsOpen(false)}
      />
      <InviteUserDialog open={inviteUserOpen} setOpen={setInviteUserOpen} />
    </SidebarMenu>
  );
}

