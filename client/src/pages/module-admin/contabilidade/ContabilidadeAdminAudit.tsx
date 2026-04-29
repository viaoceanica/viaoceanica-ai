import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/_core/hooks/useAuth";
import { useQuery } from "@/hooks/useApi";

export default function ContabilidadeAdminAudit() {
  const { user } = useAuth();
  const tenantId = user?.companyId;
  const { data, isLoading } = useQuery<any>(tenantId ? `/api/module/contabilidade/tenants/${tenantId}/admin/audit` : null);
  const items = data?.items || [];

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Auditoria</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-40 w-full" /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Ficheiro</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Razão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>{item.created_at ? new Date(item.created_at).toLocaleString("pt-PT") : "-"}</TableCell>
                  <TableCell>{item.filename}</TableCell>
                  <TableCell>{item.status}</TableCell>
                  <TableCell>{item.reason || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
