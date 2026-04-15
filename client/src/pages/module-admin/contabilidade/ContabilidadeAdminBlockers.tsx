import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/_core/hooks/useAuth";
import { useQuery } from "@/hooks/useApi";

export default function ContabilidadeAdminBlockers() {
  const { user } = useAuth();
  const tenantId = user?.companyId;
  const { data, isLoading } = useQuery<any>(tenantId ? `/api/module/contabilidade/tenants/${tenantId}/admin/blockers` : null);
  const items = data?.items || [];

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Bloqueios de automação</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-40 w-full" /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Severidade</TableHead>
                <TableHead>Mensagem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: any) => (
                <TableRow key={`${item.invoice_id}-${item.code}`}>
                  <TableCell>{item.filename || item.invoice_number || "-"}</TableCell>
                  <TableCell>{item.vendor || "-"}</TableCell>
                  <TableCell>{item.code}</TableCell>
                  <TableCell>{item.severity}</TableCell>
                  <TableCell>{item.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
