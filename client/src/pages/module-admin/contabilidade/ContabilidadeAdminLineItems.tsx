import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/_core/hooks/useAuth";
import { useQuery } from "@/hooks/useApi";

export default function ContabilidadeAdminLineItems() {
  const { user } = useAuth();
  const tenantId = user?.companyId;
  const { data: reviewData, isLoading: reviewLoading } = useQuery<any>(tenantId ? `/api/module/contabilidade/tenants/${tenantId}/admin/line-items/review` : null);
  const { data: qualityData, isLoading: qualityLoading } = useQuery<any>(tenantId ? `/api/module/contabilidade/tenants/${tenantId}/admin/line-items/quality` : null);
  const items = reviewData?.items || [];

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>Qualidade das linhas</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4 text-sm">
          {qualityLoading ? <Skeleton className="h-16 w-full md:col-span-4" /> : (
            <>
              <div>Total: <strong>{qualityData?.total_lines ?? 0}</strong></div>
              <div>Mapeadas: <strong>{qualityData?.mapped_lines ?? 0}</strong></div>
              <div>Revisão: <strong>{qualityData?.review_lines ?? 0}</strong></div>
              <div>Taxa mapeada: <strong>{qualityData?.mapped_rate_pct ?? 0}%</strong></div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>Linhas em revisão</CardTitle>
        </CardHeader>
        <CardContent>
          {reviewLoading ? <Skeleton className="h-40 w-full" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Posição</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any) => (
                  <TableRow key={item.line_item_id}>
                    <TableCell>{item.filename || item.invoice_number || "-"}</TableCell>
                    <TableCell>{item.position}</TableCell>
                    <TableCell>{item.description}</TableCell>
                    <TableCell>{item.line_total ?? "-"}</TableCell>
                    <TableCell>{item.review_reason || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
