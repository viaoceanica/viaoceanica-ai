import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@/hooks/useApi";
import { ArrowLeft, Building2, LifeBuoy, Search, TicketPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type SupportCompany = {
  id: number;
  name: string;
  sector?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  createdAt?: string | null;
};

export default function AdminSupport() {
  const { user } = useAuth();
  const { data: companies, isLoading, error } = useQuery<SupportCompany[]>("/api/platform/tenants/support/companies");
  const [search, setSearch] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<SupportCompany | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const visibleCompanies = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-PT");
    if (!query) return companies || [];
    return (companies || []).filter((company) =>
      [company.name, company.sector, company.email, company.phone]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt-PT").includes(query))
    );
  }, [companies, search]);

  const sendIframeContext = () => {
    if (!iframeRef.current?.contentWindow || !selectedCompany || !user) return;
    iframeRef.current.contentWindow.postMessage(
      {
        type: "viao-context",
        tenantId: String(selectedCompany.id),
        userId: String(user.id),
        companyName: selectedCompany.name,
        companyEmail: selectedCompany.email || "",
        supportMode: true,
      },
      window.location.origin
    );
  };

  useEffect(() => {
    if (iframeLoaded) sendIframeContext();
  }, [iframeLoaded, selectedCompany, user]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "viao-context-request") sendIframeContext();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [selectedCompany, user]);

  if (selectedCompany) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LifeBuoy className="h-4 w-4" /> Suporte / Clientes
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{selectedCompany.name}</h1>
            <p className="mt-1 text-muted-foreground">Criar e gerir tickets deste cliente.</p>
          </div>
          <Button variant="outline" onClick={() => { setSelectedCompany(null); setIframeLoaded(false); }}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Ver clientes
          </Button>
        </div>

        <Card className="border-border/50">
          <CardContent className="grid gap-2 p-4 text-sm text-muted-foreground sm:grid-cols-3">
            <span><strong className="font-medium text-foreground">Sector:</strong> {selectedCompany.sector || "—"}</span>
            <span><strong className="font-medium text-foreground">Email:</strong> {selectedCompany.email || "—"}</span>
            <span><strong className="font-medium text-foreground">Telefone:</strong> {selectedCompany.phone || "—"}</span>
          </CardContent>
        </Card>

        <div className="relative overflow-hidden rounded-lg border bg-card" style={{ minHeight: "calc(100vh - 290px)" }}>
          {!iframeLoaded && <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm text-muted-foreground">A carregar Helpdesk…</div>}
          <iframe
            ref={iframeRef}
            src="/module/helpdesk/"
            className="w-full border-0"
            style={{ height: "calc(100vh - 290px)", minHeight: "650px" }}
            onLoad={() => setIframeLoaded(true)}
            allow="clipboard-write; clipboard-read"
            title={`Helpdesk — ${selectedCompany.name}`}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><LifeBuoy className="h-4 w-4" /> Suporte</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Clientes e tickets</h1>
        <p className="mt-1 text-muted-foreground">Seleccione um cliente para consultar ou criar tickets. Esta área não permite alterar planos, módulos ou tokens.</p>
      </div>

      <Card className="border-border/50">
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg">Clientes</CardTitle>
            <CardDescription>{companies?.length ?? 0} clientes disponíveis para suporte</CardDescription>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Pesquisar cliente" aria-label="Pesquisar cliente" />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((index) => <Skeleton key={index} className="h-14 w-full" />)}</div>
          ) : error ? (
            <p className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">Não foi possível carregar os clientes autorizados para suporte.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead className="text-right">Tickets</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleCompanies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium"><span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />{company.name}</span></TableCell>
                    <TableCell className="text-muted-foreground">{company.sector || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{company.email || company.phone || "—"}</TableCell>
                    <TableCell className="text-right"><Button size="sm" onClick={() => setSelectedCompany(company)}><TicketPlus className="mr-2 h-4 w-4" /> Abrir tickets</Button></TableCell>
                  </TableRow>
                ))}
                {!visibleCompanies.length && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Nenhum cliente encontrado.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
