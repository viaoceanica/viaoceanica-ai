import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { UtensilsCrossed, Mail, Puzzle } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

const iconMap: Record<string, React.ElementType> = {
  UtensilsCrossed,
  Mail,
};

export default function Modules() {
  const { data: allModules, isLoading } = trpc.modules.listAll.useQuery();
  const { data: companyMods, refetch } = trpc.modules.companyModules.useQuery();
  const toggle = trpc.modules.toggle.useMutation({
    onSuccess: () => { refetch(); toast.success("Módulo atualizado"); },
    onError: (e) => toast.error(e.message),
  });

  const isEnabled = (moduleId: number) => {
    return companyMods?.some(m => m.moduleId === moduleId && m.isEnabled) ?? false;
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Módulos</h1>
        <p className="text-muted-foreground mt-1">Configure os módulos de IA disponíveis para a sua empresa</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {allModules?.map((mod) => {
            const Icon = iconMap[mod.icon || ""] || Puzzle;
            const enabled = isEnabled(mod.id);
            return (
              <Card key={mod.id} className={`border-border/50 transition-all ${enabled ? "ring-1 ring-primary/20 bg-primary/[0.02]" : ""}`}>
                <CardHeader className="flex flex-row items-start justify-between pb-3">
                  <div className="flex items-start gap-3">
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${enabled ? "bg-primary/10" : "bg-muted"}`}>
                      <Icon className={`h-5 w-5 ${enabled ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                      <CardTitle className="text-base">{mod.name}</CardTitle>
                      <CardDescription className="mt-1">{mod.description}</CardDescription>
                    </div>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) => toggle.mutate({ moduleId: mod.id, isEnabled: checked })}
                    disabled={toggle.isPending}
                  />
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Badge variant={enabled ? "default" : "secondary"} className="text-xs">
                      {enabled ? "Ativo" : "Inativo"}
                    </Badge>
                    {!mod.isActive && (
                      <Badge variant="outline" className="text-xs">Em breve</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {allModules && allModules.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Puzzle className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">Nenhum módulo disponível</p>
          <p className="text-sm mt-1">Os módulos serão adicionados em breve</p>
        </div>
      )}
    </div>
  );
}
