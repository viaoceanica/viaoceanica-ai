import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Brain, Zap, DollarSign, Activity, BarChart3, Clock, TrendingUp, Layers, AlertCircle, CheckCircle2 } from "lucide-react";
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";

// ─── Module display names & colors ────────────────────────────────────
const MODULE_LABELS: Record<string, string> = {
  platform: "Plataforma",
  contabilidade: "Contabilidade",
  restauracao: "Restauração",
  "gestao-email": "Gestão Email",
  unknown: "Desconhecido",
};

const MODULE_COLORS = [
  "oklch(0.65 0.2 160)",   // teal
  "oklch(0.65 0.2 250)",   // blue
  "oklch(0.65 0.2 30)",    // orange
  "oklch(0.65 0.2 310)",   // purple
  "oklch(0.65 0.15 80)",   // yellow-green
  "oklch(0.55 0.15 0)",    // red
];

// ─── Helpers ──────────────────────────────────────────────────────────
const formatTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
};

const formatCost = (n: number) => `$${n.toFixed(4)}`;

const formatDay = (dateStr: string) => {
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

export default function AdminAIUsage() {
  // ─── Data queries ─────────────────────────────────────────────────
  const { data: usageData, isLoading: usageLoading } = trpc.admin.aiUsage.useQuery();
  const { data: dailyData, isLoading: dailyLoading } = trpc.admin.aiUsageDaily.useQuery();
  const { data: modulesData, isLoading: modulesLoading } = trpc.admin.aiUsageModules.useQuery();
  const { data: recentData, isLoading: recentLoading } = trpc.admin.aiUsageRecent.useQuery();

  // ─── Computed totals ──────────────────────────────────────────────
  const totals = useMemo(() => {
    if (!usageData?.tenants) return { requests: 0, tokens: 0, cost: 0, tenants: 0 };
    return usageData.tenants.reduce(
      (acc, t) => ({
        requests: acc.requests + t.total_requests,
        tokens: acc.tokens + t.total_tokens,
        cost: acc.cost + t.total_cost_usd,
        tenants: acc.tenants + (t.total_requests > 0 ? 1 : 0),
      }),
      { requests: 0, tokens: 0, cost: 0, tenants: 0 }
    );
  }, [usageData]);

  // ─── Chart configs ────────────────────────────────────────────────
  const dailyChartConfig: ChartConfig = {
    prompt_tokens: { label: "Prompt Tokens", color: "oklch(0.65 0.2 160)" },
    completion_tokens: { label: "Completion Tokens", color: "oklch(0.65 0.2 250)" },
  };

  const requestsChartConfig: ChartConfig = {
    total_requests: { label: "Pedidos", color: "oklch(0.65 0.2 30)" },
  };

  // Prepare daily chart data
  const dailyChartData = useMemo(() => {
    if (!dailyData?.days) return [];
    return dailyData.days.map(d => ({
      day: formatDay(d.day),
      prompt_tokens: d.prompt_tokens,
      completion_tokens: d.completion_tokens,
      total_tokens: d.total_tokens,
      total_requests: d.total_requests,
    }));
  }, [dailyData]);

  // Prepare module pie data
  const modulePieData = useMemo(() => {
    if (!modulesData?.modules) return [];
    return modulesData.modules.map((m, i) => ({
      name: MODULE_LABELS[m.module_key] || m.module_key,
      value: m.total_requests,
      tokens: m.total_tokens,
      fill: MODULE_COLORS[i % MODULE_COLORS.length],
    }));
  }, [modulesData]);

  const moduleChartConfig: ChartConfig = useMemo(() => {
    const cfg: ChartConfig = {};
    modulePieData.forEach((m) => {
      cfg[m.name] = { label: m.name, color: m.fill };
    });
    return cfg;
  }, [modulePieData]);

  const periodLabel = usageData?.period_start
    ? new Date(usageData.period_start + "T00:00:00").toLocaleDateString("pt-PT", { month: "long", year: "numeric" })
    : "mês atual";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" />
          Consumo AI
        </h1>
        <p className="text-muted-foreground mt-1">
          Monitorização do consumo de IA por tenant e módulo — {periodLabel}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Total Pedidos"
          icon={<Activity className="h-4 w-4 text-primary" />}
          value={totals.requests.toLocaleString("pt-PT")}
          subtitle="este mês"
          loading={usageLoading}
        />
        <SummaryCard
          title="Total Tokens"
          icon={<Zap className="h-4 w-4 text-chart-2" />}
          value={formatTokens(totals.tokens)}
          subtitle="consumidos"
          loading={usageLoading}
        />
        <SummaryCard
          title="Custo Estimado"
          icon={<DollarSign className="h-4 w-4 text-chart-3" />}
          value={formatCost(totals.cost)}
          subtitle="USD este mês"
          loading={usageLoading}
        />
        <SummaryCard
          title="Tenants Ativos"
          icon={<BarChart3 className="h-4 w-4 text-chart-4" />}
          value={totals.tenants.toString()}
          subtitle="com consumo AI"
          loading={usageLoading}
        />
      </div>

      {/* Charts Section */}
      <Tabs defaultValue="daily" className="space-y-4">
        <TabsList>
          <TabsTrigger value="daily" className="gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Tendência Diária
          </TabsTrigger>
          <TabsTrigger value="modules" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            Por Módulo
          </TabsTrigger>
        </TabsList>

        {/* Daily Trend Chart */}
        <TabsContent value="daily">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-base">Tokens por Dia</CardTitle>
                <CardDescription>Prompt vs Completion tokens diários</CardDescription>
              </CardHeader>
              <CardContent>
                {dailyLoading ? (
                  <Skeleton className="h-[250px] w-full" />
                ) : dailyChartData.length > 0 ? (
                  <ChartContainer config={dailyChartConfig} className="h-[250px] w-full">
                    <AreaChart data={dailyChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis dataKey="day" className="text-xs" />
                      <YAxis className="text-xs" tickFormatter={formatTokens} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="prompt_tokens" stackId="1" fill="var(--color-prompt_tokens)" stroke="var(--color-prompt_tokens)" fillOpacity={0.4} />
                      <Area type="monotone" dataKey="completion_tokens" stackId="1" fill="var(--color-completion_tokens)" stroke="var(--color-completion_tokens)" fillOpacity={0.4} />
                    </AreaChart>
                  </ChartContainer>
                ) : (
                  <EmptyState message="Sem dados de tokens diários" />
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-base">Pedidos por Dia</CardTitle>
                <CardDescription>Número de chamadas à API de IA</CardDescription>
              </CardHeader>
              <CardContent>
                {dailyLoading ? (
                  <Skeleton className="h-[250px] w-full" />
                ) : dailyChartData.length > 0 ? (
                  <ChartContainer config={requestsChartConfig} className="h-[250px] w-full">
                    <BarChart data={dailyChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis dataKey="day" className="text-xs" />
                      <YAxis className="text-xs" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="total_requests" fill="var(--color-total_requests)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <EmptyState message="Sem dados de pedidos diários" />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Module Breakdown */}
        <TabsContent value="modules">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-base">Distribuição por Módulo</CardTitle>
                <CardDescription>Pedidos de IA por módulo</CardDescription>
              </CardHeader>
              <CardContent>
                {modulesLoading ? (
                  <Skeleton className="h-[280px] w-full" />
                ) : modulePieData.length > 0 ? (
                  <ChartContainer config={moduleChartConfig} className="h-[280px] w-full">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                      <Pie
                        data={modulePieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        innerRadius={50}
                        paddingAngle={2}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {modulePieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                ) : (
                  <EmptyState message="Sem dados de módulos" />
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-base">Detalhes por Módulo</CardTitle>
                <CardDescription>Tokens e pedidos por módulo</CardDescription>
              </CardHeader>
              <CardContent>
                {modulesLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
                  </div>
                ) : modulesData?.modules && modulesData.modules.length > 0 ? (
                  <div className="space-y-3">
                    {modulesData.modules.map((m, i) => {
                      const totalReqs = modulesData.modules.reduce((s, x) => s + x.total_requests, 0);
                      const pct = totalReqs > 0 ? (m.total_requests / totalReqs) * 100 : 0;
                      return (
                        <div key={m.module_key} className="flex items-center gap-3 p-3 rounded-lg border border-border/50">
                          <div
                            className="h-3 w-3 rounded-full shrink-0"
                            style={{ backgroundColor: MODULE_COLORS[i % MODULE_COLORS.length] }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">
                                {MODULE_LABELS[m.module_key] || m.module_key}
                              </span>
                              <span className="text-xs text-muted-foreground">{pct.toFixed(0)}%</span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${Math.max(pct, 3)}%`,
                                  backgroundColor: MODULE_COLORS[i % MODULE_COLORS.length],
                                }}
                              />
                            </div>
                            <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
                              <span>{m.total_requests} pedidos</span>
                              <span>{formatTokens(m.total_tokens)} tokens</span>
                              <span>{m.unique_tenants} tenant{m.unique_tenants !== 1 ? "s" : ""}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState message="Sem dados de módulos" />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Tenant Breakdown Table */}
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
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : usageData?.tenants && usageData.tenants.some(t => t.total_requests > 0) ? (
            <div className="space-y-3">
              <div className="grid grid-cols-5 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <div className="col-span-2">Empresa</div>
                <div className="text-right">Pedidos</div>
                <div className="text-right">Tokens</div>
                <div className="text-right">Custo (USD)</div>
              </div>
              {usageData.tenants
                .filter(t => t.total_requests > 0)
                .sort((a, b) => b.total_tokens - a.total_tokens)
                .map(tenant => {
                  const pct = totals.tokens > 0 ? (tenant.total_tokens / totals.tokens) * 100 : 0;
                  return (
                    <div
                      key={tenant.tenant_id}
                      className="grid grid-cols-5 gap-4 items-center p-4 rounded-lg border border-border/50 hover:border-border transition-colors"
                    >
                      <div className="col-span-2">
                        <p className="font-medium text-sm">
                          {tenant.company_name || `Tenant #${tenant.tenant_id}`}
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
              <div className="grid grid-cols-5 gap-4 items-center p-4 rounded-lg bg-muted/50 font-semibold text-sm">
                <div className="col-span-2">Total</div>
                <div className="text-right">{totals.requests.toLocaleString("pt-PT")}</div>
                <div className="text-right">{formatTokens(totals.tokens)}</div>
                <div className="text-right">{formatCost(totals.cost)}</div>
              </div>
            </div>
          ) : (
            <EmptyState message="Nenhum consumo de IA registado este mês" />
          )}
        </CardContent>
      </Card>

      {/* Recent Events */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Eventos Recentes
          </CardTitle>
          <CardDescription>Últimas chamadas ao serviço de IA</CardDescription>
        </CardHeader>
        <CardContent>
          {recentLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : recentData?.events && recentData.events.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase">Data</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase">Empresa</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase">Módulo</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase">Modelo</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground uppercase">Tokens</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground uppercase">Duração</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground uppercase">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {recentData.events.map(event => (
                    <tr key={event.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(event.created_at).toLocaleString("pt-PT", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2.5 px-3 font-medium">{event.company_name}</td>
                      <td className="py-2.5 px-3">
                        <Badge variant="outline" className="text-xs">
                          {MODULE_LABELS[event.module_key] || event.module_key}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground font-mono">{event.model}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-xs">
                        {event.total_tokens > 0 ? formatTokens(event.total_tokens) : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-xs text-muted-foreground">
                        {event.duration_ms > 0 ? `${(event.duration_ms / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {event.status === "success" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-500 mx-auto" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="Nenhum evento de IA registado" />
          )}
        </CardContent>
      </Card>

      {/* Info footer */}
      <Card className="border-border/50 bg-muted/20">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Sobre os custos estimados
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Os custos apresentados são estimativas baseadas nos preços públicos dos modelos utilizados.
            O custo real pode variar conforme o modelo e eventuais descontos de volume.
            Os dados são agregados mensalmente e atualizados em tempo real a cada chamada ao serviço de IA.
            Chamadas via OpenClaw podem não reportar contagem de tokens (mostram 0 tokens mas registam o pedido).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Reusable sub-components ──────────────────────────────────────────

function SummaryCard({ title, icon, value, subtitle, loading }: {
  title: string;
  icon: React.ReactNode;
  value: string;
  subtitle: string;
  loading: boolean;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12">
      <Brain className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
      <p className="text-muted-foreground">{message}</p>
      <p className="text-xs text-muted-foreground mt-1">
        O consumo será registado quando os módulos utilizarem o serviço de IA
      </p>
    </div>
  );
}
