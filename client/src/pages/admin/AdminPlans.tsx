import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@/hooks/useApi";
import { Settings, Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminPlans() {
  const { data: plans, isLoading } = useQuery<any[]>("/api/platform/tenants/admin/plans");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Planos</h1>
        <p className="text-muted-foreground mt-1">Planos de subscrição configurados na plataforma</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {plans?.map((p: any) => (
            <Card key={p.id} className="border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{p.name}</CardTitle>
                  <Badge variant={p.isActive ? "default" : "secondary"} className="text-xs">
                    {p.isActive ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                <CardDescription>{p.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold mb-4">
                  {(p.monthlyPrice ?? 0) === 0 ? "Gratuito" : `${((p.monthlyPrice ?? 0) / 100).toFixed(0)}€/mês`}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Check className="h-3 w-3 text-primary" />
                    <span>{p.tokensPerMonth.toLocaleString("pt-PT")} tokens/mês</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="h-3 w-3 text-primary" />
                    <span>{p.maxMembers < 0 || p.maxMembers >= 999 ? "Membros ilimitados" : `Até ${p.maxMembers} membros`}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
