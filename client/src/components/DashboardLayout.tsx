import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { LOGO_URL } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  Users,
  Puzzle,
  Coins,
  Building2,
  Settings,
  LogOut,
  PanelLeft,
  Shield,
  UserCircle,
  ChevronRight,
  Lock,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

// Sub-items inside "Definições"
const settingsSubItems = [
  { icon: Users, label: "Equipa", path: "/dashboard/team" },
  { icon: Puzzle, label: "Módulos", path: "/dashboard/modules" },
  { icon: Coins, label: "Tokens", path: "/dashboard/tokens" },
  { icon: Building2, label: "Empresa", path: "/dashboard/company" },
  { icon: UserCircle, label: "Perfil", path: "/dashboard/profile" },
  { icon: Lock, label: "Segurança", path: "/dashboard/settings" },
];

const adminMenuItems = [
  { icon: LayoutDashboard, label: "Visão Geral", path: "/admin" },
  { icon: Building2, label: "Empresas", path: "/admin/companies" },
  { icon: Coins, label: "Tokens", path: "/admin/tokens" },
  { icon: Puzzle, label: "Módulos", path: "/admin/modules" },
  { icon: Settings, label: "Planos", path: "/admin/plans" },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export default function DashboardLayout({
  children,
  variant = "company",
}: {
  children: React.ReactNode;
  variant?: "company" | "admin";
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user, logout } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <img src={LOGO_URL} alt="Via Oceânica" className="h-8 invert dark:invert-0" />
          <div className="flex flex-col items-center gap-4">
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              Acesso restrito
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Inicie sessão para aceder ao painel de controlo.
            </p>
          </div>
          <Button
            onClick={() => { window.location.href = "/login"; }}
            size="lg"
            className="w-full"
          >
            Iniciar sessão
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <DashboardLayoutContent
        setSidebarWidth={setSidebarWidth}
        variant={variant}
      >
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
  variant: "company" | "admin";
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
  variant,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Check if any settings sub-item is active
  const isSettingsActive = settingsSubItems.some(item => location.startsWith(item.path));
  const [settingsOpen, setSettingsOpen] = useState(isSettingsActive);

  // Keep collapsible open when navigating to a sub-item
  useEffect(() => {
    if (isSettingsActive) setSettingsOpen(true);
  }, [isSettingsActive]);

  // Determine active label for mobile header
  const getActiveLabel = () => {
    if (variant === "admin") {
      const item = adminMenuItems.find(i => location.startsWith(i.path) && i.path !== "/admin") || adminMenuItems[0];
      return item?.label ?? "Menu";
    }
    if (location === "/dashboard") return "Dashboard";
    const sub = settingsSubItems.find(i => location.startsWith(i.path));
    return sub?.label ?? "Dashboard";
  };

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none shrink-0"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed && (
                <div className="flex items-center gap-2 min-w-0">
                  <img src={LOGO_URL} alt="Via Oceânica" className="h-5 invert dark:invert-0" />
                  {variant === "admin" && (
                    <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">ADMIN</span>
                  )}
                </div>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            {variant === "admin" ? (
              /* ─── Admin: flat menu ─── */
              <SidebarMenu className="px-2 py-1">
                {adminMenuItems.map(item => {
                  const isActive = location === item.path || (item.path !== "/admin" && location.startsWith(item.path));
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => setLocation(item.path)}
                        tooltip={item.label}
                        className="h-10 transition-all font-normal"
                      >
                        <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            ) : (
              /* ─── Company: Dashboard + Definições (collapsible) ─── */
              <SidebarMenu className="px-2 py-1">
                {/* Dashboard — main item */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={location === "/dashboard"}
                    onClick={() => setLocation("/dashboard")}
                    tooltip="Dashboard"
                    className="h-10 transition-all font-normal"
                  >
                    <LayoutDashboard className={`h-4 w-4 ${location === "/dashboard" ? "text-primary" : ""}`} />
                    <span>Dashboard</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Definições — collapsible with sub-items */}
                <Collapsible
                  open={settingsOpen}
                  onOpenChange={setSettingsOpen}
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip="Definições"
                        className="h-10 transition-all font-normal"
                        isActive={isSettingsActive}
                      >
                        <Settings className={`h-4 w-4 ${isSettingsActive ? "text-primary" : ""}`} />
                        <span>Definições</span>
                        <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {settingsSubItems.map(sub => {
                          const isSubActive = location.startsWith(sub.path);
                          return (
                            <SidebarMenuSubItem key={sub.path}>
                              <SidebarMenuSubButton
                                isActive={isSubActive}
                                onClick={() => setLocation(sub.path)}
                                className="transition-all"
                              >
                                <sub.icon className={`h-3.5 w-3.5 ${isSubActive ? "text-primary" : ""}`} />
                                <span>{sub.label}</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              </SidebarMenu>
            )}

            {/* Switch between admin/company */}
            {user?.role === "admin" && (
              <SidebarMenu className="px-2 mt-4 pt-4 border-t border-sidebar-border">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setLocation(variant === "admin" ? "/dashboard" : "/admin")}
                    tooltip={variant === "admin" ? "Painel Empresa" : "Painel Admin"}
                    className="h-10 font-normal text-muted-foreground"
                  >
                    <Shield className="h-4 w-4" />
                    <span>{variant === "admin" ? "Painel Empresa" : "Painel Admin"}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            )}
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setLocation("/dashboard/profile")} className="cursor-pointer">
                  <UserCircle className="mr-2 h-4 w-4" />
                  Perfil
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocation("/dashboard/settings")} className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  Definições
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => { await logout(); window.location.href = "/"; }}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Terminar sessão
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <span className="tracking-tight text-foreground">
                {getActiveLabel()}
              </span>
            </div>
          </div>
        )}
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </>
  );
}
