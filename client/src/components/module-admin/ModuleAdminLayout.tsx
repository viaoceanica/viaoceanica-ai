import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/_core/hooks/useAuth";
import { ShieldAlert } from "lucide-react";
import { moduleAdminRegistry, type ModuleAdminSection } from "@/lib/moduleAdminRegistry";
import { ModuleAdminTabs } from "./ModuleAdminTabs";

export function ModuleAdminLayout({ moduleKey, currentSection, children }: { moduleKey: string; currentSection: ModuleAdminSection; children: React.ReactNode }) {
  const { user } = useAuth();
  const definition = moduleAdminRegistry[moduleKey];

  if (!definition) {
    return (
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Módulo sem administração</AlertTitle>
        <AlertDescription>Este módulo ainda não tem superfície de administração no dashboard.</AlertDescription>
      </Alert>
    );
  }

  const canAdminModule = user?.companyRole === "owner" || user?.companyRole === "admin";

  if (!canAdminModule) {
    return (
      <Card className="border-dashed border-destructive/30">
        <CardContent className="py-12">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Sem permissão</AlertTitle>
            <AlertDescription>A administração do módulo está disponível apenas para proprietários e administradores da empresa.</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const Icon = definition.icon;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{definition.label} Admin</h1>
            <p className="text-muted-foreground mt-1">Administração do módulo dentro do dashboard da empresa</p>
          </div>
        </div>
        <Badge variant="outline">Tenant: {user?.companyName || user?.companyId || "-"}</Badge>
      </div>

      <ModuleAdminTabs moduleKey={moduleKey} currentSection={currentSection} sections={definition.sections} />

      {children}
    </div>
  );
}
