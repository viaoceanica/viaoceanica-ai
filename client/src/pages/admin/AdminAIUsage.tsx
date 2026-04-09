import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@/hooks/useApi";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, Zap, DollarSign, Activity, BarChart3, Clock } from "lucide-react";
import { useState, useMemo } from "react";

interface TenantUsage {
  tenant_id: number;
  total_requests: number;
  total_tokens: number;
  total_cost_usd: number;
}

interface AdminUsageData {
  period: string;
  period_start: string;
  tenants: TenantUsage[];
}

interface Company {
  id: number;
  name: string;
}

export default function AdminAIUsage() {
  const { data: usageData, isLoading: usageLoading } = useQuery<AdminUsageData>("/api/ai/usage/admin");
  const { data: companies } = useQuery<Company[]>("/api/platform/tenants/admin/companies");

  const [selectedTenant, setSelectedTenant] = useState<number | null>(null);

  // Map tenant IDs to company names
  const companyMap = useMemo(() => {
    const map: Record<number, string> = {};
    if (companies) {
      for (const c of companies) {
        map[c.id] = c.name;
      }
    }
    return map;
  }, [companies]);

  // Totals
  const totals = useMemo(() => {
    if (!usageData?.tenants) return { requests: 0, tokens: 0, cost: 0, tenants: 0 };
    return usageData.tenants.reduce(
      (acc, t) => ({
        requests: acc.requests + t.total_requests,
        tokens: acc.tokens + t.total_tokens,
        cost: acc.cost + t.total_cost_usd,
        tenants: acc.tenants + 1,
      }),
      { requests: 0, tokens: 0, cost: 0, tenants: 0 }
    );
  }, [usageData]);

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  const formatCost = (n: number) => `$${n.toFixed(4)}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" />
          Consumo AI
        </h1>
        <p className="text-muted-foreground mt-1">
          Monitorização do consumo de IA por tenant e módulo — {usageData?.period_start ? new Date(usageData.period_start).toLocaleDateString("pt-PT", { month: "long", year: "numeric" }) : "mês atual"}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Pedidos</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {usageLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{totals.requests.toLocaleString("pt-PT")}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">este mês</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Tokens</CardTitle>
            <Zap className="h-4 w-4 text-chart-2" />
          </CardHeader>
          <CardContent>
            {usageLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{formatTokens(totals.tokens)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">consumidos</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Custo Estimado</CardTitle>
            <DollarSign className="h-4 w-4 text-chart-3" />
          </CardHeader>
          <CardContent>
            {usageLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{formatCost(totals.cost)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">USD este mês</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tenants Ativos</CardTitle>
            <BarChart3 className="h-4 w-4 text-chart-4" />
          </CardHeader>
          <CardContent>
            {usageLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{totals.tenants}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">com consumo AI</p>
          </CardContent>
        </Card>
      </div>

      {/* Usage by Tenant */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Consumo por Tenant
          </CardTitle>
          <CardDescription>Distribuição do consumo de IA por empresa</CardDescription>
        </CardHeader>
        <CardContent>
          {usageLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : usageData?.tenants && usageData.tenants.length > 0 ? (
            <div className="space-y-3">
              {/* Header */}
              <div className="grid grid-cols-5 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <div className="col-span-2">Empresa</div>
                <div className="text-right">Pedidos</div>
                <div className="text-right">Tokens</div>
                <div className="text-right">Custo (USD)</div>
              </div>

              {usageData.tenants
                .sort((a, b) => b.total_tokens - a.total_tokens)
                .map((tenant) => {
                  const pct = totals.tokens > 0 ? (tenant.total_tokens / totals.tokens) * 100 : 0;
                  return (
                    <div
                      key={tenant.tenant_id}
                      className={`grid grid-cols-5 gap-4 items-center p-4 rounded-lg border transition-colors cursor-pointer ${
                        selectedTenant === tenant.tenant_id
                          ? "border-primary bg-primary/5"
                          : "border-border/50 hover:border-border"
                      }`}
                      onClick={() =>
                        setSelectedTenant(selectedTenant === tenant.tenant_id ? null : tenant.tenant_id)
                      }
                    >
                      <div className="col-span-2">
                        <p className="font-medium text-sm">
                          {companyMap[tenant.tenant_id] || `Tenant #${tenant.tenant_id}`}
                        </p>
                        <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${Math.max(pct, 2)}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-medium">{tenant.total_requests.toLocaleString("pt-PT")}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-medium">{formatTokens(tenant.total_tokens)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-medium">{formatCost(tenant.total_cost_usd)}</span>
                      </div>
                    </div>
                  );
                })}

              {/* Total row */}
              <div className="grid grid-cols-5 gap-4 items-center p-4 rounded-lg bg-muted/50 font-semibold text-sm">
                <div className="col-span-2">Total</div>
                <div className="text-right">{totals.requests.toLocaleString("pt-PT")}</div>
                <div className="text-right">{formatTokens(totals.tokens)}</div>
                <div className="text-right">{formatCost(totals.cost)}</div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <Brain className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">Nenhum consumo de IA registado este mês</p>
              <p className="text-xs text-muted-foreground mt-1">
                O consumo será registado quando os módulos utilizarem o serviço de IA
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cost estimation info */}
      <Card className="border-border/50 bg-muted/20">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Sobre os custos estimados
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Os custos apresentados são estimativas baseadas nos preços públicos dos modelos OpenAI.
            O custo real pode variar conforme o modelo utilizado e eventuais descontos de volume.
            Os dados são agregados mensalmente e atualizados em tempo real a cada chamada ao serviço de IA.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
