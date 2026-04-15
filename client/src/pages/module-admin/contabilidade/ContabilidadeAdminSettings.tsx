import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { useQuery } from "@/hooks/useApi";

export default function ContabilidadeAdminSettings() {
  const { user } = useAuth();
  const tenantId = user?.companyId;
  const { data, isLoading } = useQuery<any>(tenantId ? `/api/module/contabilidade/tenants/${tenantId}/admin/settings` : null);

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Definições do módulo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading ? <Skeleton className="h-24 w-full" /> : (
          <>
            <div>Empresa: <strong>{data?.profile?.company_name || "-"}</strong></div>
            <div>NIF: <strong>{data?.profile?.company_nif || "-"}</strong></div>
            <div>Nota: <strong>superfície read-only na fase 1</strong></div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
