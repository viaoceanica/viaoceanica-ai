import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Puzzle, UtensilsCrossed, Mail } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const iconMap: Record<string, React.ElementType> = {
  UtensilsCrossed,
  Mail,
};

export default function AdminModules() {
  const { data: modules, isLoading } = trpc.admin.allModules.useQuery();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Módulos</h1>
        <p className="text-muted-foreground mt-1">Módulos disponíveis na plataforma</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[1, 2].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {modules?.map((mod) => {
            const Icon = iconMap[mod.icon || ""] || Puzzle;
            return (
              <Card key={mod.id} className="border-border/50">
                <CardHeader className="flex flex-row items-start gap-3 pb-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{mod.name}</CardTitle>
                    <CardDescription className="mt-1">{mod.description}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant={mod.isActive ? "default" : "secondary"} className="text-xs">
                      {mod.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                    <span className="text-muted-foreground">Slug: {mod.slug}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
