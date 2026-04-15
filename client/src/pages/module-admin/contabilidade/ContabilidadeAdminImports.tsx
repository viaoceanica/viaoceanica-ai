import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/_core/hooks/useAuth";
import { useQuery } from "@/hooks/useApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowUpDown, Download, ExternalLink, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function statusBadgeVariant(status: string) {
  switch ((status || "").toLowerCase()) {
    case "ingested":
      return "default" as const;
    case "duplicate":
      return "secondary" as const;
    case "failed":
    case "rejected":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

export default function ContabilidadeAdminImports() {
  const { user } = useAuth();
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [sortKey, setSortKey] = useState<string>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const tenantId = user?.companyId;
  const { data, isLoading, refetch } = useQuery<any>(tenantId ? `/api/module/contabilidade/tenants/${tenantId}/admin/import-events` : null, { refetchIntervalMs: 10000 });
  const items = data?.items || [];
  const filteredItems = useMemo(() => {
    const filtered = items.filter((item: any) => {
      const statusMatches = statusFilter === "all" || (item.status || "").toLowerCase() === statusFilter;
      const searchMatches = !searchTerm.trim() || (item.filename || "").toLowerCase().includes(searchTerm.trim().toLowerCase());
      const itemDate = item.created_at ? new Date(item.created_at) : null;
      const now = new Date();
      let dateMatches = true;
      if (dateFilter === "today" && itemDate) {
        dateMatches = itemDate.toDateString() === now.toDateString();
      } else if (dateFilter === "24h" && itemDate) {
        dateMatches = now.getTime() - itemDate.getTime() <= 24 * 60 * 60 * 1000;
      } else if (dateFilter === "7d" && itemDate) {
        dateMatches = now.getTime() - itemDate.getTime() <= 7 * 24 * 60 * 60 * 1000;
      }
      return statusMatches && searchMatches && dateMatches;
    });

    return [...filtered].sort((a: any, b: any) => {
      const aValue = a?.[sortKey] ?? "";
      const bValue = b?.[sortKey] ?? "";
      const compare = sortKey === "created_at"
        ? new Date(aValue).getTime() - new Date(bValue).getTime()
        : String(aValue).localeCompare(String(bValue), "pt");
      return sortDir === "asc" ? compare : -compare;
    });
  }, [items, statusFilter, searchTerm, dateFilter, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  const exportCsv = () => {
    const header = ["data", "ficheiro", "estado", "origem", "fornecedor_nif", "fatura", "total", "razao"];
    const rows = filteredItems.map((item: any) => [
      item.created_at || "",
      item.filename || "",
      item.status || "",
      item.source || "",
      item.supplier_nif || "",
      item.invoice_number || "",
      item.total ?? "",
      item.reason || "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `contabilidade-imports-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("CSV exportado");
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-3 flex-wrap">
        <CardTitle>Eventos de importação</CardTitle>
        <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Procurar ficheiro" className="w-[220px] pl-8" />
          </div>
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo o período</SelectItem>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="24h">Últimas 24h</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filtrar estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estados</SelectItem>
              <SelectItem value="ingested">Ingerido</SelectItem>
              <SelectItem value="duplicate">Duplicado</SelectItem>
              <SelectItem value="failed">Falhou</SelectItem>
              <SelectItem value="rejected">Rejeitado</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-2" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => { refetch(); const now = new Date(); setLastRefreshAt(now); toast.success(`Imports atualizados às ${now.toLocaleTimeString("pt-PT")}`); }}>
            <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {lastRefreshAt && <div className="mb-3 text-xs text-muted-foreground text-right">Atualizado: {lastRefreshAt.toLocaleTimeString("pt-PT")}</div>}
        {isLoading ? <Skeleton className="h-40 w-full" /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><Button variant="ghost" size="sm" onClick={() => toggleSort("created_at")}><ArrowUpDown className="h-4 w-4 mr-1" />Data</Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => toggleSort("filename")}><ArrowUpDown className="h-4 w-4 mr-1" />Ficheiro</Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => toggleSort("status")}><ArrowUpDown className="h-4 w-4 mr-1" />Estado</Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => toggleSort("source")}><ArrowUpDown className="h-4 w-4 mr-1" />Origem</Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => toggleSort("supplier_nif")}><ArrowUpDown className="h-4 w-4 mr-1" />Fornecedor</Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => toggleSort("invoice_number")}><ArrowUpDown className="h-4 w-4 mr-1" />Fatura</Button></TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>{item.created_at ? new Date(item.created_at).toLocaleString("pt-PT") : "-"}</TableCell>
                  <TableCell>{item.filename}</TableCell>
                  <TableCell><Badge variant={statusBadgeVariant(item.status)} className="uppercase">{item.status}</Badge></TableCell>
                  <TableCell>{item.source}</TableCell>
                  <TableCell>{item.supplier_nif || "-"}</TableCell>
                  <TableCell>{item.invoice_number || "-"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {item.invoice_id && (
                        <Button variant="ghost" size="sm" onClick={() => window.open(`/dashboard/module/contabilidade`, "_blank") } title="Abrir módulo">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setSelectedItem(item)}>Detalhes</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhes do import</DialogTitle>
            <DialogDescription>{selectedItem?.filename || "Evento de importação"}</DialogDescription>
          </DialogHeader>
          {selectedItem && (
            <div className="grid gap-3 text-sm">
              <div><strong>Estado:</strong> {selectedItem.status}</div>
              <div><strong>Origem:</strong> {selectedItem.source || "-"}</div>
              <div><strong>Fornecedor NIF:</strong> {selectedItem.supplier_nif || "-"}</div>
              <div><strong>Número fatura:</strong> {selectedItem.invoice_number || "-"}</div>
              <div><strong>Total:</strong> {selectedItem.total ?? "-"}</div>
              <div><strong>Criado em:</strong> {selectedItem.created_at ? new Date(selectedItem.created_at).toLocaleString("pt-PT") : "-"}</div>
              <div><strong>Razão:</strong> {selectedItem.reason || "-"}</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
