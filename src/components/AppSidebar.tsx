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
  ListChecks,
  Sparkles,
  FileClock,
  Landmark,
  ShieldBan,
  CircleDollarSign,
} from "lucide-react";
import leadereiLogo from "@/assets/brand/leaderei-white.png";
import { APP_VERSION } from "@/lib/version";
import { Badge } from "@/components/ui/badge";
import { usePendingApprovalsCount } from "@/hooks/useApprovals";
import { useInboxQueue } from "@/hooks/useHumanInbox";
import { useMunicipiaEnabled } from "@/hooks/useMunicipia";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

function useCompanyName(companyId: string | null) {
  return useQuery({
    queryKey: ["company-name", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("name").eq("id", companyId!).maybeSingle();
      return data?.name ?? null;
    },
  });
}

import { NavLink } from "@/components/NavLink";
import { useLocation, Link as RouterLink } from "react-router-dom";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronRight, HelpCircle, ChevronsUpDown } from "lucide-react";
import { useEffect, useState } from "react";

type Item = { title: string; url: string; icon: any; badge?: "approvals" | "inbox" };
type Group = { id: string; title: string; icon: any; items: Item[] };

const masterItems: Item[] = [
  { title: "Painel Master", url: "/master", icon: LayoutDashboard },
  { title: "Empresas", url: "/master/companies", icon: Building2 },
  { title: "Financeiro / Preços", url: "/master/pricing", icon: CircleDollarSign },
  { title: "Logs", url: "/master/logs", icon: FileClock },
  { title: "Integrações da Plataforma", url: "/master/platform-settings", icon: ShieldCheck },
];

const groups: Group[] = [
  {
    id: "prospect", title: "Prospecção & Leads", icon: Target, items: [
      { title: "Todos os Leads", url: "/leads", icon: Target },
      { title: "Listas", url: "/leads/lists", icon: ListChecks },
      { title: "Buscar no Apollo", url: "/apollo", icon: Sparkles },
      { title: "MunicipIA", url: "/municipia", icon: Landmark },
    ],
  },
  {
    id: "cadence", title: "Cadências & Automação", icon: Zap, items: [
      { title: "Cadências", url: "/cadences", icon: MessageSquare },
      { title: "Acompanhamento", url: "/cadences/dashboard", icon: Activity },
      { title: "Aprovações", url: "/approvals", icon: ShieldCheck, badge: "approvals" },
      { title: "Runs do Agente", url: "/agent-runs", icon: Bot },
    ],
  },
  {
    id: "comms", title: "Comunicação & Vendas", icon: Inbox, items: [
      { title: "Conversas", url: "/conversations", icon: MessageSquare },
      { title: "Inbox humana", url: "/inbox", icon: Inbox, badge: "inbox" },
      { title: "Reuniões", url: "/bookings", icon: Calendar },
      { title: "Anotações", url: "/annotations", icon: NotebookPen },
    ],
  },
  {
    id: "intel", title: "Inteligência & Scripts", icon: Workflow, items: [
      { title: "Scripts IA", url: "/scripts", icon: FileText },
      { title: "Base de Conhecimento", url: "/knowledge", icon: BookOpen },
      { title: "Relatórios", url: "/reports", icon: BarChart3 },
    ],
  },
];

const activeCls = "bg-sidebar-accent text-sidebar-accent-foreground font-medium";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { isMasterAdmin, signOut, profile, companyId } = useAuth();
  const { data: pendingCount = 0 } = usePendingApprovalsCount();
  const { data: inboxQueue = [] } = useInboxQueue();
  const inboxCount = inboxQueue.length;
  const { data: municipia } = useMunicipiaEnabled();
  const { data: companyName } = useCompanyName(companyId);

  const isActive = (path: string) => location.pathname === path;
  const visibleGroups = groups.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.url !== "/municipia" || municipia?.enabled),
  }));
  const groupHasActive = (g: Group) =>
    g.items.some((i) => location.pathname === i.url || location.pathname.startsWith(i.url + "/"));

  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const active = visibleGroups.find(groupHasActive);
    if (active) setOpen((o) => ({ ...o, [active.id]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const badgeFor = (b?: Item["badge"]) => {
    if (b === "approvals" && pendingCount > 0)
      return <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px] bg-amber-100 text-amber-800">{pendingCount}</Badge>;
    if (b === "inbox" && inboxCount > 0)
      return <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px] bg-blue-100 text-blue-800">{inboxCount}</Badge>;
    return null;
  };
  const groupBadgeTotal = (g: Group) =>
    g.items.reduce((n, i) => n + (i.badge === "approvals" ? pendingCount : i.badge === "inbox" ? inboxCount : 0), 0);

  const initials = (profile?.full_name || "?").split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <img src={leadereiLogo} alt="Leaderei" className="h-8 w-auto self-start" />
        {!collapsed && (
          <span className="mt-1 font-mono text-[10px] text-sidebar-foreground/50">{APP_VERSION}</span>
        )}
        {!collapsed && companyName && (
          <Badge variant="outline" className="mt-2 w-fit max-w-full truncate border-sidebar-border/60 bg-sidebar-accent/40 text-xs font-medium text-sidebar-foreground">
            <Building2 className="mr-1 h-3 w-3 shrink-0" />
            <span className="truncate">{companyName}</span>
          </Badge>
        )}
      </SidebarHeader>

      <SidebarContent>
        {isMasterAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administração</SidebarGroupLabel>
            <SidebarGroupContent>
              <Collapsible open={open.master ?? masterItems.some((i) => isActive(i.url))} onOpenChange={(v) => setOpen((o) => ({ ...o, master: v }))}>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip="Master">
                        <ShieldCheck className="h-4 w-4" />
                        {!collapsed && <span className="flex-1">Master</span>}
                        {!collapsed && <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90 [[data-state=open]>&]:rotate-90" />}
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {masterItems.map((item) => (
                          <SidebarMenuSubItem key={item.url}>
                            <SidebarMenuSubButton asChild isActive={isActive(item.url)}>
                              <NavLink to={item.url} end activeClassName={activeCls}>
                                <span>{item.title}</span>
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </SidebarMenu>
              </Collapsible>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Operação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/dashboard")} tooltip="Dashboard">
                  <NavLink to="/dashboard" end activeClassName={activeCls}>
                    <LayoutDashboard className="h-4 w-4" />
                    {!collapsed && <span>Dashboard</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {visibleGroups.map((g) => {
                const isOpen = open[g.id] ?? false;
                const total = groupBadgeTotal(g);
                return (
                  <Collapsible key={g.id} open={isOpen} onOpenChange={(v) => setOpen((o) => ({ ...o, [g.id]: v }))} asChild>
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={g.title} isActive={collapsed && groupHasActive(g)}>
                          <g.icon className="h-4 w-4" />
                          {!collapsed && <span className="flex-1">{g.title}</span>}
                          {!collapsed && !isOpen && total > 0 && (
                            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-amber-100 text-amber-800">{total}</Badge>
                          )}
                          {!collapsed && (
                            <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                          )}
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {g.items.map((item) => (
                            <SidebarMenuSubItem key={item.url}>
                              <SidebarMenuSubButton asChild isActive={isActive(item.url)}>
                                <NavLink to={item.url} end activeClassName={activeCls}>
                                  <span className="flex-1">{item.title}</span>
                                  {badgeFor(item.badge)}
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton tooltip="Central de Ajuda">
                  <HelpCircle className="h-4 w-4" />
                  {!collapsed && <span>Central de Ajuda</span>}
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-56">
                <DropdownMenuItem asChild><RouterLink to="/guides/manual">Manual do sistema</RouterLink></DropdownMenuItem>
                <DropdownMenuItem asChild><RouterLink to="/guides/whatsapp">Boas práticas WhatsApp</RouterLink></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><a href="/termos" target="_blank" rel="noreferrer">Termos de uso</a></DropdownMenuItem>
                <DropdownMenuItem asChild><a href="/privacidade" target="_blank" rel="noreferrer">Privacidade</a></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={location.pathname.startsWith("/settings")} tooltip="Configurações">
              <NavLink to="/settings" activeClassName={activeCls}>
                <Settings className="h-4 w-4" />
                {!collapsed && <span>Configurações</span>}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" tooltip={profile?.full_name || "Perfil"}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                    {initials}
                  </span>
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate text-sm">{profile?.full_name || "Minha conta"}</span>
                      <ChevronsUpDown className="h-4 w-4 opacity-60" />
                    </>
                  )}
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-56">
                <DropdownMenuLabel className="truncate">{profile?.full_name || "Minha conta"}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><RouterLink to="/settings/team"><Users className="mr-2 h-4 w-4" />Equipe</RouterLink></DropdownMenuItem>
                <DropdownMenuItem asChild><RouterLink to="/settings/integrations"><Link className="mr-2 h-4 w-4" />Integrações</RouterLink></DropdownMenuItem>
                <DropdownMenuItem asChild><RouterLink to="/settings/nao-prospectar"><ShieldBan className="mr-2 h-4 w-4" />Não prospectar</RouterLink></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}><LogOut className="mr-2 h-4 w-4" />Sair</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
