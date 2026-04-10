import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Receipt, TrendingUp, Building2, Coins } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminBilling() {
  const { data: billing, isLoading } = trpc.admin.tenantBilling.useQuery();

  const totalRevenue = billing?.reduce((sum, b) => sum + (b.planPrice || 0), 0) ?? 0;
  const totalTokens = billing?.reduce((sum, b) => sum + b.tokensBalance, 0) ?? 0;
  const totalExtTokens = billing?.reduce((sum, b) => sum + b.externalTokensBalance, 0) ?? 0;
  const activeCompanies = billing?.filter(b => b.planName !== "Sem plano").length ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Faturação</h1>
        <p className="text-muted-foreground mt-1">Visão geral da faturação por empresa</p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Receita Mensal</CardTitle>
            <Receipt className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{totalRevenue.toLocaleString("pt-PT")}€</div>}
            <p className="text-xs text-muted-foreground mt-1">planos ativos</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Empresas c/ Plano</CardTitle>
            <Building2 className="h-4 w-4 text-chart-2" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{activeCompanies}</div>}
            <p className="text-xs text-muted-foreground mt-1">de {billing?.length ?? 0} total</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tokens Internos</CardTitle>
            <Coins className="h-4 w-4 text-chart-3" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{totalTokens.toLocaleString("pt-PT")}</div>}
            <p className="text-xs text-muted-foreground mt-1">em circulação</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tokens Externos</CardTitle>
            <TrendingUp className="h-4 w-4 text-chart-4" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{totalExtTokens.toLocaleString("pt-PT")}</div>}
            <p className="text-xs text-muted-foreground mt-1">em circulação</p>
          </CardContent>
        </Card>
      </div>

      {/* Billing table */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Detalhe por Empresa</CardTitle>
          <CardDescription>Plano, tokens e módulos ativos de cada empresa</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead className="text-right">Preço/mês</TableHead>
                  <TableHead className="text-right">Tokens Int.</TableHead>
                  <TableHead className="text-right">Tokens Ext.</TableHead>
                  <TableHead className="text-center">Membros</TableHead>
                  <TableHead className="text-center">Módulos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {billing?.map((b) => (
                  <TableRow key={b.companyId}>
                    <TableCell className="font-medium">{b.companyName}</TableCell>
                    <TableCell className="text-muted-foreground">{b.sector || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={b.planName !== "Sem plano" ? "default" : "secondary"} className="text-xs">
                        {b.planName}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {b.planPrice > 0 ? `${b.planPrice.toLocaleString("pt-PT")}€` : "—"}
                    </TableCell>
                    <TableCell className="text-right">{b.tokensBalance.toLocaleString("pt-PT")}</TableCell>
                    <TableCell className="text-right">{b.externalTokensBalance.toLocaleString("pt-PT")}</TableCell>
                    <TableCell className="text-center">{b.memberCount}</TableCell>
                    <TableCell className="text-center">{b.activeModules}</TableCell>
                  </TableRow>
                ))}
                {(!billing || billing.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Nenhuma empresa registada
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
