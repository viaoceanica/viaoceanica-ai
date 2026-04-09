import { useLocation } from "wouter";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@/hooks/useApi";
import { UtensilsCrossed, Mail, Puzzle, Construction, ShieldAlert, Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";

const iconMap: Record<string, React.ElementType> = {
  restauracao: UtensilsCrossed,
  "gestao-email": Mail,
  contabilidade: Receipt,
};

const nameMap: Record<string, string> = {
  restauracao: "Restauração",
  "gestao-email": "Gestão Email",
  contabilidade: "Contabilidade",
};

/**
 * Modules with iframe-based frontends.
 * The URL is relative to the current origin — the gateway proxies
 * /module/<key>/* to the module's frontend container.
 *
 * For contabilidade, the ViaContab Next.js frontend runs on port 7100
 * and is accessible via the nginx reverse proxy at /module/contabilidade/
 */
const iframeModules: Record<string, string> = {
  contabilidade: "/module/contabilidade/",
};

export default function ModulePage() {
  const [location, setLocation] = useLocation();
  const slug = location.replace("/dashboard/module/", "");
  const Icon = iconMap[slug] || Puzzle;
  const name = nameMap[slug] || slug;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // Check if user has access to this module
  const { data: activeModules, isLoading } = useQuery<any[]>("/api/platform/entitlements/modules");

  // Send tenant context to iframe via postMessage when loaded
  useEffect(() => {
    if (iframeLoaded && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "viao-context",
          // The gateway already injects x-viao-* headers on API calls,
          // but the iframe frontend needs to know the tenant for its own API calls
        },
        "*"
      );
    }
  }, [iframeLoaded]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasAccess = activeModules?.some((m: any) => m.moduleKey === slug && m.enabled);

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

  // Check if this module has an iframe frontend
  const iframeSrc = iframeModules[slug];

  if (iframeSrc) {
    return (
      <div className="space-y-4">
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

        <div className="relative w-full rounded-lg border bg-card overflow-hidden" style={{ minHeight: "calc(100vh - 200px)" }}>
          {!iframeLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">A carregar módulo...</p>
              </div>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="w-full border-0"
            style={{ height: "calc(100vh - 200px)", minHeight: "600px" }}
            onLoad={() => setIframeLoaded(true)}
            allow="clipboard-write; clipboard-read"
            title={`Módulo ${name}`}
          />
        </div>
      </div>
    );
  }

  // Default: "Em desenvolvimento" placeholder for modules without iframe frontend
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
