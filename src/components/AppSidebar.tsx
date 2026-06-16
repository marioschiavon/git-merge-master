import {
  FileText,
  Inbox,
  LayoutDashboard,
  Building2,
  Users,
  Settings,
  Zap,
  Target,
  MessageSquare,
  BarChart3,
  Link,
  LogOut,
  BookOpen,
  Activity,
  Workflow,
  Calendar,
  Bot,
  ShieldCheck,
  NotebookPen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePendingApprovalsCount } from "@/hooks/useApprovals";
import { useInboxQueue } from "@/hooks/useHumanInbox";

import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const masterItems = [
  { title: "Painel Master", url: "/master", icon: LayoutDashboard },
  { title: "Empresas", url: "/master/companies", icon: Building2 },
];

const companyItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Leads", url: "/leads", icon: Target },
  { title: "Cadências", url: "/cadences", icon: MessageSquare },
  { title: "Acompanhamento", url: "/cadences/dashboard", icon: Activity },
  { title: "Aprovações", url: "/approvals", icon: ShieldCheck, showApprovalsBadge: true },
  { title: "Anotações", url: "/annotations", icon: NotebookPen },
  { title: "Scripts IA", url: "/scripts", icon: FileText },
  { title: "Base de Conhecimento", url: "/knowledge", icon: BookOpen },
  { title: "Conversas", url: "/conversations", icon: Inbox },
  { title: "Inbox humana", url: "/inbox", icon: Inbox, showInboxBadge: true },

  { title: "Relatórios", url: "/reports", icon: BarChart3 },
  { title: "Reuniões", url: "/bookings", icon: Calendar },
  { title: "Runs do Agente", url: "/agent-runs", icon: Bot },
];

const settingsItems = [
  { title: "Equipe", url: "/settings/team", icon: Users },
  { title: "Integrações", url: "/settings/integrations", icon: Link },
  { title: "Intents & Ações", url: "/settings/intents", icon: Workflow },
  { title: "Cal.com", url: "/settings/calcom", icon: Calendar },
  { title: "Configurações", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { isMasterAdmin, signOut, profile } = useAuth();
  const { data: pendingCount = 0 } = usePendingApprovalsCount();
  const { data: inboxQueue = [] } = useInboxQueue();
  const inboxCount = inboxQueue.length;


  const isActive = (path: string) => location.pathname === path;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="text-lg font-semibold text-foreground">SDR Auto</span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {isMasterAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administração</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {masterItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <NavLink to={item.url} end activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Operação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {companyItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} end activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span className="flex-1">{item.title}</span>}
                      {(item as any).showApprovalsBadge && pendingCount > 0 && (
                        <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px] bg-amber-100 text-amber-800">
                          {pendingCount}
                        </Badge>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Configurações</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} end activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <Separator className="mb-3" />
        {!collapsed && profile?.full_name && (
          <p className="mb-2 truncate text-sm text-muted-foreground">{profile.full_name}</p>
        )}
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" />
          {!collapsed && "Sair"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
