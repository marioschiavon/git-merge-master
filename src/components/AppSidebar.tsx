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
} from "lucide-react";
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
  { title: "Scripts IA", url: "/scripts", icon: FileText },
  { title: "Conversas", url: "/conversations", icon: Inbox },
  { title: "Relatórios", url: "/reports", icon: BarChart3 },
];

const settingsItems = [
  { title: "Equipe", url: "/settings/team", icon: Users },
  { title: "Integrações", url: "/settings/integrations", icon: Link },
  { title: "Configurações", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { isMasterAdmin, signOut, profile } = useAuth();

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
                      {!collapsed && <span>{item.title}</span>}
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
