import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { useQuery } from "@/hooks/useApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function statusBadgeVariant(status: string) {
  switch ((status || "").toLowerCase()) {
    case "ingested":
      return "default" as const;
    case "duplicate":
      return "secondary" as const;
    case "failed":
    case "rejected":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

export default function ContabilidadeAdminHome() {
  const { user } = useAuth();
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const tenantId = user?.companyId;
  const { data, isLoading, refetch } = useQuery<any>(tenantId ? `/api/module/contabilidade/tenants/${tenantId}/admin/summary` : null, { refetchIntervalMs: 15000 });
  const { data: importsData, isLoading: importsLoading, refetch: refetchImports } = useQuery<any>(tenantId ? `/api/module/contabilidade/tenants/${tenantId}/admin/import-events?limit=5` : null, { refetchIntervalMs: 15000 });
  const latestFailedImport = (importsData?.items || []).find((item: any) => ["failed", "rejected"].includes((item.status || "").toLowerCase()));

  const cards = [
    ["Imports 24h", data?.importsLast24h ?? 0],
    ["Falhas 24h", data?.failedImportsLast24h ?? 0],
    ["Duplicados 24h", data?.duplicateCandidatesLast24h ?? 0],
    ["Bloqueios", data?.automationBlockers ?? 0],
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => { refetch(); refetchImports(); const now = new Date(); setLastRefreshAt(now); toast.success(`Admin atualizado às ${now.toLocaleTimeString("pt-PT")}`); }}>
          <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
        </Button>
      </div>

      {lastRefreshAt && (
        <div className="text-xs text-muted-foreground text-right">Atualizado: {lastRefreshAt.toLocaleTimeString("pt-PT")}</div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => (
          <Card key={label} className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{value}</div>}
            </CardContent>
          </Card>
        ))}

        <Card className="border-border/50 md:col-span-2 xl:col-span-4">
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
                <div>Último import com sucesso: <strong>{data?.lastSuccessfulImportAt ? new Date(data.lastSuccessfulImportAt).toLocaleString("pt-PT") : "-"}</strong></div>
                <div>Uploads pendentes: <strong>{data?.storageQueue?.pending ?? 0}</strong></div>
                <div>Uploads falhados: <strong>{data?.storageQueue?.failed ?? 0}</strong></div>
                <div>Linhas totais: <strong>{data?.lineItemsQuality?.total_lines ?? 0}</strong></div>
                <div>Linhas mapeadas: <strong>{data?.lineItemsQuality?.mapped_lines ?? 0}</strong></div>
                <div>Linhas em revisão: <strong>{data?.lineItemsQuality?.review_lines ?? 0}</strong></div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Últimos imports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
          {importsLoading ? (
            <>
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </>
          ) : (
            (importsData?.items || []).map((item: any) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{item.filename}</div>
                  <div className="text-xs text-muted-foreground">{item.created_at ? new Date(item.created_at).toLocaleString("pt-PT") : "-"}</div>
                </div>
                <Badge variant={statusBadgeVariant(item.status)} className="uppercase">{item.status}</Badge>
              </div>
            ))
          )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Último import com falha</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {importsLoading ? (
              <>
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </>
            ) : latestFailedImport ? (
              <div className="space-y-2 rounded-lg border border-border/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium truncate">{latestFailedImport.filename}</div>
                  <Badge variant={statusBadgeVariant(latestFailedImport.status)} className="uppercase">{latestFailedImport.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{latestFailedImport.created_at ? new Date(latestFailedImport.created_at).toLocaleString("pt-PT") : "-"}</div>
                <div className="text-sm">{latestFailedImport.reason || "Sem detalhe adicional"}</div>
              </div>
            ) : (
              <div className="text-muted-foreground">Sem falhas recentes.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
