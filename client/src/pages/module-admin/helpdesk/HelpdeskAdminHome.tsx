import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { useQuery } from "@/hooks/useApi";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export default function HelpdeskAdminHome() {
  const { user } = useAuth();
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const tenantId = user?.companyId;
  const { data, isLoading, refetch } = useQuery<any>(
    tenantId ? `/module/helpdesk/api-proxy/api/tenants/${tenantId}/admin/summary` : null,
    { refetchIntervalMs: 15000 }
  );

  const summaryCards = useMemo(
    () => [
      ["Total", data?.summary?.total ?? 0],
      ["Abertos", data?.summary?.open ?? 0],
      ["Em progresso", data?.summary?.in_progress ?? 0],
      ["Urgentes", data?.summary?.urgent ?? 0],
    ],
    [data]
  );

  const refresh = async () => {
    const result = await refetch();
    if (result.data !== undefined) {
      const now = new Date();
      setLastRefreshAt(now);
      toast.success(`Helpdesk atualizado às ${now.toLocaleTimeString("pt-PT")}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Administração</div>
          <h2 className="text-lg font-semibold">Helpdesk</h2>
          <p className="text-sm text-muted-foreground">Resumo operacional do módulo e atalho para a gestão interna.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
          </Button>
          <Badge variant="outline">{user?.companyName || user?.companyId || "-"}</Badge>
        </div>
      </div>

      {lastRefreshAt ? (
        <div className="text-xs text-muted-foreground text-right">Atualizado: {lastRefreshAt.toLocaleTimeString("pt-PT")}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(([label, value]) => (
          <Card key={label as string} className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label as string}</CardTitle>
            </CardHeader>
            <CardContent>{isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{value as number}</div>}</CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Resumo operacional</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 text-sm">
          {isLoading ? (
            <>
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </>
          ) : (
            <>
              <div>Módulo: <strong>{data?.module || "helpdesk"}</strong></div>
              <div>Tenant: <strong>{data?.tenant_id || tenantId || "-"}</strong></div>
              <div>Acesso admin: <strong>{data?.admin_access ? "sim" : "não"}</strong></div>
              <div>Perfil empresa: <strong>{data?.company_role || "-"}</strong></div>
              <div>Perfis da plataforma: <strong>{Array.isArray(data?.platform_roles) ? data.platform_roles.join(", ") : "-"}</strong></div>
              <div>Mensagem: <strong>{data?.message || "Resumo operacional do Helpdesk"}</strong></div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Entrar no módulo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="text-muted-foreground">A superfície completa do helpdesk continua no iframe do módulo.</div>
          <Button asChild variant="secondary" size="sm">
            <a href="/dashboard/module/helpdesk">
              Abrir módulo <ArrowUpRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
