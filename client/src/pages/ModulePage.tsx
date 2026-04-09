import { useLocation } from "wouter";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { UtensilsCrossed, Mail, Puzzle, Construction, ShieldAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const iconMap: Record<string, React.ElementType> = {
  restauracao: UtensilsCrossed,
  "gestao-email": Mail,
};

const nameMap: Record<string, string> = {
  restauracao: "Restauração",
  "gestao-email": "Gestão Email",
};

export default function ModulePage() {
  const [location, setLocation] = useLocation();
  // Extract slug from /dashboard/module/:slug
  const slug = location.replace("/dashboard/module/", "");
  const Icon = iconMap[slug] || Puzzle;
  const name = nameMap[slug] || slug;

  // Check if user has access to this module
  const { data: activeModules, isLoading } = trpc.modules.activeForUser.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasAccess = activeModules?.some(m => m.slug === slug);

  if (!hasAccess) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
            <ShieldAlert className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{name || "Módulo"}</h1>
            <p className="text-muted-foreground mt-0.5">Sem acesso</p>
          </div>
        </div>

        <Card className="border-dashed border-destructive/30">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ShieldAlert className="h-12 w-12 text-destructive/40 mb-4" />
            <CardTitle className="text-lg mb-2">Acesso não autorizado</CardTitle>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Não tem permissão para aceder a este módulo. Contacte o administrador da sua empresa
              para solicitar acesso.
            </p>
            <Button variant="outline" onClick={() => setLocation("/dashboard")}>
              Voltar ao Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          <p className="text-muted-foreground mt-0.5">Módulo de IA</p>
        </div>
        <Badge variant="default" className="ml-2">Ativo</Badge>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Construction className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <CardTitle className="text-lg mb-2">Em desenvolvimento</CardTitle>
          <p className="text-sm text-muted-foreground max-w-md">
            A interface funcional deste módulo será implementada numa fase posterior.
            Por agora, o módulo está ativo e configurado para a sua empresa.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
