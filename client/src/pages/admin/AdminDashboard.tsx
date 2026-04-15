import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@/hooks/useApi";
import { Building2, Users, Coins, Puzzle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminDashboard() {
  // Admin endpoints: GET /api/platform/tenants/admin/*
  const { data: companies, isLoading: companiesLoading } = useQuery<any[]>("/api/platform/tenants/admin/companies");
  const { data: users, isLoading: usersLoading } = useQuery<any[]>("/api/platform/tenants/admin/users");
  const { data: modules, isLoading: modulesLoading } = useQuery<any[]>("/api/platform/registry/modules");
  const { data: plans, isLoading: plansLoading } = useQuery<any[]>("/api/platform/tenants/admin/plans");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
        <p className="text-muted-foreground mt-1">Visão geral da plataforma</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Empresas</CardTitle>
            <Building2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {companiesLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{companies?.length ?? 0}</div>}
            <p className="text-xs text-muted-foreground mt-1">registadas</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Utilizadores</CardTitle>
            <Users className="h-4 w-4 text-chart-2" />
          </CardHeader>
          <CardContent>
            {usersLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{users?.length ?? 0}</div>}
            <p className="text-xs text-muted-foreground mt-1">total</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Módulos</CardTitle>
            <Puzzle className="h-4 w-4 text-chart-3" />
          </CardHeader>
          <CardContent>
            {modulesLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{modules?.length ?? 0}</div>}
            <p className="text-xs text-muted-foreground mt-1">disponíveis</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Planos</CardTitle>
            <Coins className="h-4 w-4 text-chart-4" />
          </CardHeader>
          <CardContent>
            {plansLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{plans?.length ?? 0}</div>}
            <p className="text-xs text-muted-foreground mt-1">configurados</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent companies */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Empresas recentes</CardTitle>
          <CardDescription>Últimas empresas registadas na plataforma</CardDescription>
        </CardHeader>
        <CardContent>
          {companiesLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : companies && companies.length > 0 ? (
            <div className="space-y-3">
              {companies.slice(0, 5).map((c: any) => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.sector || "Sem sector"}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{c.tokensBalance.toLocaleString("pt-PT")} tokens</p>
                    <p className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString("pt-PT")}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center py-8 text-muted-foreground">Nenhuma empresa registada</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
