import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Coins, Users, Puzzle, TrendingUp, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: balance, isLoading: balanceLoading } = trpc.tokens.balance.useQuery();
  const { data: members, isLoading: membersLoading } = trpc.company.members.useQuery();
  const { data: plan, isLoading: planLoading } = trpc.plans.current.useQuery();
  const { data: companyMods, isLoading: modsLoading } = trpc.modules.companyModules.useQuery();
  const { data: allModules } = trpc.modules.listAll.useQuery();

  const activeModules = companyMods?.filter(m => m.isEnabled)?.length ?? 0;
  const totalModules = allModules?.length ?? 0;

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Bem-vindo, {user?.name?.split(" ")[0]}
        </h1>
        <p className="text-muted-foreground mt-1">
          Visão geral da sua empresa{user?.company ? ` — ${user.company.name}` : ""}
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tokens Internos</CardTitle>
            <Coins className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {balanceLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold">{(balance?.internal ?? 0).toLocaleString("pt-PT")}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">disponíveis</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tokens Externos</CardTitle>
            <TrendingUp className="h-4 w-4 text-chart-4" />
          </CardHeader>
          <CardContent>
            {balanceLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold">{(balance?.external ?? 0).toLocaleString("pt-PT")}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">disponíveis</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Membros</CardTitle>
            <Users className="h-4 w-4 text-chart-2" />
          </CardHeader>
          <CardContent>
            {membersLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{members?.length ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {plan ? `máx. ${plan.maxMembers >= 999 ? "ilimitados" : plan.maxMembers}` : "—"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Módulos ativos</CardTitle>
            <Puzzle className="h-4 w-4 text-chart-3" />
          </CardHeader>
          <CardContent>
            {modsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{activeModules} <span className="text-sm font-normal text-muted-foreground">/ {totalModules}</span></div>
            )}
            <p className="text-xs text-muted-foreground mt-1">configurados</p>
          </CardContent>
        </Card>
      </div>

      {/* Plan */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Plano ativo</CardTitle>
          <CardDescription>O seu plano de subscrição atual</CardDescription>
        </CardHeader>
        <CardContent>
          {planLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : plan ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl font-semibold">{plan.name}</p>
                <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                <div className="flex gap-6 mt-3 text-sm text-muted-foreground">
                  <span>{plan.tokensPerMonth.toLocaleString("pt-PT")} tokens/mês</span>
                  <span>{plan.maxMembers >= 999 ? "Membros ilimitados" : `Até ${plan.maxMembers} membros`}</span>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setLocation("/dashboard/company")}>
                Gerir plano
                <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">Nenhum plano atribuído</p>
          )}
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/50 hover:shadow-sm transition-shadow cursor-pointer" onClick={() => setLocation("/dashboard/team")}>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">Gerir equipa</p>
              <p className="text-sm text-muted-foreground">Convidar membros e gerir papéis</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 hover:shadow-sm transition-shadow cursor-pointer" onClick={() => setLocation("/dashboard/modules")}>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-chart-2/10 flex items-center justify-center shrink-0">
              <Puzzle className="h-5 w-5 text-chart-2" />
            </div>
            <div>
              <p className="font-medium">Configurar módulos</p>
              <p className="text-sm text-muted-foreground">Ativar ou desativar módulos de IA</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 hover:shadow-sm transition-shadow cursor-pointer" onClick={() => setLocation("/dashboard/tokens")}>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-chart-4/10 flex items-center justify-center shrink-0">
              <Coins className="h-5 w-5 text-chart-4" />
            </div>
            <div>
              <p className="font-medium">Ver tokens</p>
              <p className="text-sm text-muted-foreground">Saldo e histórico de consumo</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
