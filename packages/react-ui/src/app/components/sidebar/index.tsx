import { t } from 'i18next';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  Link2,
  LockKeyhole,
  VideoIcon,
} from 'lucide-react';
import React from 'react';
import { Link, useLocation } from 'react-router-dom';

import { BetaBadge } from '@/components/custom/beta-badge';
import TutorialsDialog, { TabType } from '@/components/custom/tutorials-dialog';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { Dot } from '@/components/ui/dot';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,

  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuSubItem,
  SidebarMenuSub,
  SidebarMenuItem,
  SidebarGroupContent,
  SidebarMenuAction,
  SidebarSeparator,
} from '@/components/ui/sidebar-shadcn';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { flagsHooks } from '@/hooks/flags-hooks';
import { authenticationSession } from '@/lib/authentication-session';
import { cn } from '@/lib/utils';
import { ApEdition, ApFlagId, Permission } from '@activepieces/shared';

import { ShowPoweredBy } from '../../../components/show-powered-by';
import { platformHooks } from '../../../hooks/platform-hooks';
import { ApDashboardSidebarHeader } from '../ap-dashboard-sidebar-header';
import { HelpAndFeedback } from '../help-and-feedback';

import { SidebarInviteUserButton } from './sidebar-invite-user';
import { SidebarPlatformAdminButton } from './sidebar-platform-admin';
import { SidebarUser } from './sidebar-user';
import UsageLimitsButton from './usage-limits-button';
import {
  LayoutGrid,
  LineChart,
  Server,
  Shield,
  Users,
  Wrench,
} from 'lucide-react';
type Link = {
  icon: React.ReactNode;
  label: string;
  to: string;
  notification?: boolean;
};

type CustomTooltipLinkProps = {
  to: string;
  label: string;
  Icon?: React.ReactNode;
  extraClasses?: string;
  notification?: boolean;
  locked?: boolean;
  newWindow?: boolean;
  isActive?: (pathname: string) => boolean;
  isSubItem: boolean;
  tutorialTab?: TabType;
};
export const CustomTooltipLink = ({
  to,
  label,
  Icon,
  extraClasses,
  notification,
  locked,
  newWindow,
  isActive,
  tutorialTab,
}: CustomTooltipLinkProps) => {
  const location = useLocation();
  const isLinkActive =
    location.pathname.startsWith(to) || isActive?.(location.pathname);
  return (
    <Link
      to={to}
      target={newWindow ? '_blank' : ''}
      rel={newWindow ? 'noopener noreferrer' : ''}
    >
      <div
        className={cn(
          'relative flex group/link items-center gap-1 justify-between hover:bg-sidebar-accent rounded-sm transition-colors',
          extraClasses,
          isLinkActive && '!bg-primary/10 !text-primary',
        )}
      >
        <div
          className={`w-full flex items-center justify-between gap-2 px-2 py-1 ${
            !Icon ? 'p-2' : ''
          }`}
        >
          <div className="flex items-center gap-2  w-full">
            <div className="flex items-center gap-2">
              {Icon && React.isValidElement(Icon)
                ? React.cloneElement(
                    Icon as React.ReactElement<{ className?: string }>,
                    {
                      className: cn(Icon.props.className, 'size-4'),
                    },
                  )
                : null}
              <span className="text-sm">{label}</span>
            </div>
            <div className="grow"></div>
            {/* {tutorialTab && (
              <TutorialsDialog
                location="small-button-inside-sidebar-item"
                initialTab={tutorialTab}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="p-1 size-6 group-hover/link:opacity-100 opacity-0 transition-all duration-150 ease-in-out"
                >
                  <VideoIcon className="size-4"></VideoIcon>
                </Button>
              </TutorialsDialog>
            )}
            {label === 'Agents' && <BetaBadge showTooltip={false} />} */}
          </div>
          {locked && (
            <LockKeyhole className="size-4 stroke-[2px]" color="grey" />
          )}
        </div>
        {notification && !locked && (
          <Dot
            variant="destructive"
            className="absolute right-2 top-1/2 transform -translate-y-1/2 size-2 rounded-full "
          />
        )}
      </div>
    </Link>
  );
};

export type SidebarGroup = {
  name?: string;
  putEmptySpaceTop?: boolean;
  label: string;
  icon: React.ElementType;
  items: SidebarLink[];
  type: 'group';
  open: boolean;
  setOpen: (open: boolean) => void;
  isActive?: (pathname: string) => boolean;
  separatorBefore?: boolean;
  separatorAfter?: boolean;
};
export type SidebarGroupItem = {
   name?: string;
   putEmptySpaceTop?: boolean;
   label: string;
   icon: React.ElementType;
   items: SidebarLink[];
   type: 'group';
   open: boolean;
   setOpen: (open: boolean) => void;
   isActive?: (pathname: string) => boolean;
   separatorBefore?: boolean;
   separatorAfter?: boolean;
   defaultOpen?: boolean; // <- allow config files to set an initial open state
 };
export type SidebarLink = {
  to: string;
  label: string;
  name?: string;
  icon?: React.ReactNode;
  type: 'link';
  show: boolean;
  notification?: boolean;
  locked?: boolean;
  hasPermission?: boolean;
  isSubItem: boolean;
  isActive?: (pathname: string) => boolean;
  separatorBefore?: boolean;
  separatorAfter?: boolean;
  tutorialTab?: TabType;
};

export type SidebarItem = SidebarLink | SidebarGroupItem;

type SidebarProps = {
  children: React.ReactNode;
  items: SidebarItem[];
  isHomeDashboard?: boolean;
  hideSideNav?: boolean;
};
export function SidebarComponent({
  children,
  items,
  isHomeDashboard = false,
  hideSideNav = false,
}: SidebarProps) {
  const { platform } = platformHooks.useCurrentPlatform();
  const { data: edition } = flagsHooks.useFlag<ApEdition>(ApFlagId.EDITION);

  const location = useLocation();
  const { checkAccess } = useAuthorization();

  const showProjectUsage =
    location.pathname.startsWith('/project') && edition !== ApEdition.COMMUNITY;
  const showConnectionsLink =
    location.pathname.startsWith('/project') &&
    checkAccess(Permission.READ_APP_CONNECTION);
  const showTutorials = location.pathname.startsWith('/project');
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <div className="flex h-screen w-full">
        {!hideSideNav && (
          <Sidebar className="h-screen">
            <SidebarContent className="h-full flex flex-col">
              {/* <ApDashboardSidebarHeader isHomeDashboard={isHomeDashboard} /> */}
              <div className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="space-y-0">
                    {items.map((item, index) => (
                      <React.Fragment key={item.label}>
                        {item.separatorBefore && <SidebarSeparator />}
                        {item.type === 'group'
                          ? ApSidebarMenuGroup(item as SidebarGroupItem)
                          : ApSidebarMenuItem(item as SidebarLink, index)}
                        {item.separatorAfter && <SidebarSeparator />}
                      </React.Fragment>
                    ))}

                    <SidebarGroup>
                      <SidebarGroupLabel>
                        <div className="flex items-center gap-2">
                          <span>{t('Misc')}</span>
                        </div>
                      </SidebarGroupLabel>
                      <SidebarGroupContent>
                       <SidebarMenu>
                        {/* Setup AI link */}
                        {/* <SidebarMenuItem>
                          <SidebarMenuButton asChild>
                            <CustomTooltipLink
                              to={authenticationSession.appendProjectRoutePrefix("/setup/ai")}
                              label={t('Setup AI')}
                              Icon={<Wrench className="size-4" />}
                              isSubItem={false}
                            />
                          </SidebarMenuButton>
                        </SidebarMenuItem> */}


                        <SidebarMenuItem>
                        <Collapsible defaultOpen={false} className="group/collapsible">
                            <CollapsibleTrigger asChild>
                              <SidebarMenuButton className="gap-2 px-2 py-1">
                                <Server className="size-4 shrink-0 [stroke-width:2]" />
                                <span>{t("Infrastructure")}</span>
                                <SidebarMenuAction>
                                  <ChevronDownIcon className="transition-transform duration-200 group-data-[state=open]/infra:rotate-180" />
                                </SidebarMenuAction>
                              </SidebarMenuButton>
                            </CollapsibleTrigger>
                          <CollapsibleContent>
                            <SidebarMenuSub className="pl-3">
                              <SidebarMenuSubItem>
                                <SidebarMenuButton asChild className="gap-2 px-2 py-1">
                                  <CustomTooltipLink
                                    to={authenticationSession.appendProjectRoutePrefix("/infrastructure/workers")}
                                    label={t("Workers")}
                                    Icon={<Users className="size-4 shrink-0 [stroke-width:2]" />}
                                    isSubItem={true}
                                  />
                                </SidebarMenuButton>
                              </SidebarMenuSubItem>

                              <SidebarMenuSubItem>
                                <SidebarMenuButton asChild className="gap-2 px-2 py-1">
                                  <CustomTooltipLink
                                    to={authenticationSession.appendProjectRoutePrefix("/infrastructure/health")}
                                    label={t("Health")}
                                    Icon={<Shield className="size-4 shrink-0 [stroke-width:2]" />}
                                    isSubItem={true}
                                  />
                                </SidebarMenuButton>
                              </SidebarMenuSubItem>

                              <SidebarMenuSubItem>
                                <SidebarMenuButton asChild className="gap-2 px-2 py-1">
                                  <CustomTooltipLink
                                    to={authenticationSession.appendProjectRoutePrefix("/infrastructure/triggers")}
                                    label={t("Triggers")}
                                    Icon={<LineChart className="size-4 shrink-0 [stroke-width:2]" />}
                                    isSubItem={true}
                                  />
                                </SidebarMenuButton>
                              </SidebarMenuSubItem>
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </Collapsible>
                        </SidebarMenuItem>

                        {showConnectionsLink && (
                          <SidebarMenuItem>
                            <SidebarMenuButton asChild>
                              <CustomTooltipLink
                                to={authenticationSession.appendProjectRoutePrefix('/connections')}
                                label={t('Connections')}
                                Icon={<Link2 className="size-4" />}
                                isSubItem={false}
                              />
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        )}
                      </SidebarMenu>
                      </SidebarGroupContent>
                    </SidebarGroup>
                  </div>
                </ScrollArea>
              </div>
              <SidebarFooter className="pb-4 flex-shrink-0">
                {/* <SidebarMenu>
                  <SidebarInviteUserButton />
                </SidebarMenu>
                <SidebarMenu>
                  <HelpAndFeedback />
                </SidebarMenu>
                {showProjectUsage && (
                  <SidebarMenu>
                    <UsageLimitsButton />
                  </SidebarMenu>
                )}
                <SidebarUser /> */}
              </SidebarFooter>
            </SidebarContent>
          </Sidebar>
        )}
        <div
          className={cn('bg-sidebar w-full h-full overflow-hidden', {
            'pt-2 pr-2 pb-2': !hideSideNav,
          })}
        >
          <ScrollArea
            className={cn('w-full pb-6 pt-28 px-6 h-full bg-background', {
              'rounded-lg border-b-0 border': !hideSideNav,
            })}
            style={{
              boxShadow: hideSideNav
                ? '0 2px 2px #0000000a,0 8px 8px -8px #0000000a'
                : 'none',
            }}
          >
            {children}
          </ScrollArea>
        </div>
      </div>
      <ShowPoweredBy
        show={platform?.plan.showPoweredBy && isHomeDashboard}
        position="absolute"
      />
    </div>
  );
}
function ApSidebarMenuItem(item: SidebarLink, index: number) {
  return (
    <React.Fragment key={item.label}>
      <SidebarGroup key={item.label} className="py-0.5">
        {item.name && <SidebarGroupLabel>{item.name}</SidebarGroupLabel>}
        <SidebarMenu>
          <SidebarMenuItem key={item.label}>
            <SidebarMenuButton asChild>
              <CustomTooltipLink
                to={item.to}
                label={item.label}
                Icon={item.icon}
                key={index}
                notification={item.notification}
                locked={item.locked}
                isActive={item.isActive}
                isSubItem={item.isSubItem}
                tutorialTab={item.tutorialTab}
              />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </React.Fragment>
  );
}
function ApSidebarMenuGroup(item: SidebarGroupItem) {
  const location = useLocation();
  return (
    <React.Fragment key={item.label}>
      <SidebarGroup key={item.name} className="py-0.5 pl-4">
        {item.name && <SidebarGroupLabel>{item.name}</SidebarGroupLabel>}
        <SidebarMenu>
          <Collapsible
            open={item.open}
            defaultOpen={item.defaultOpen ?? item.isActive?.(location.pathname) ?? false}
            onOpenChange={item.setOpen}
            className="group/collapsible"
          >
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton>
                  {item.icon && <item.icon className="size-4" />}
                  <span>{item.label}</span>
                  <SidebarMenuAction asChild>
                    {item.open ? <ChevronUpIcon /> : <ChevronDownIcon />}
                  </SidebarMenuAction>
                </SidebarMenuButton>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.items.map(
                    (link, index) =>
                      link.show && (
                        <SidebarMenuSubItem key={link.label}>
                          <SidebarMenuButton asChild>
                            <CustomTooltipLink
                              to={link.to}
                              label={link.label}
                              Icon={link.icon}
                              key={index}
                              notification={link.notification}
                              locked={link.locked}
                              isActive={link.isActive}
                              isSubItem={link.isSubItem}
                            />
                          </SidebarMenuButton>
                        </SidebarMenuSubItem>
                      ),
                  )}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        </SidebarMenu>
      </SidebarGroup>
    </React.Fragment>
  );
}
