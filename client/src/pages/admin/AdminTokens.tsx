import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@/hooks/useApi";
import { Coins, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminTokens() {
  const { data: transactions, isLoading } = useQuery<any[]>("/api/platform/tenants/admin/tokens/transactions");
  const { data: companies } = useQuery<any[]>("/api/platform/tenants/admin/companies");

  const getCompanyName = (companyId: number) => {
    return companies?.find((c: any) => c.id === companyId)?.name || `#${companyId}`;
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tokens</h1>
        <p className="text-muted-foreground mt-1">Histórico global de transações de tokens</p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Todas as transações</CardTitle>
          <CardDescription>{transactions?.length ?? 0} transações registadas</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : transactions && transactions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Quantidade</TableHead>
                  <TableHead>Módulo</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx: any) => (
                  <TableRow key={tx.id}>
                    <TableCell className="font-medium">{getCompanyName(tx.companyId)}</TableCell>
                    <TableCell>
                      {tx.type === "credit" ? (
                        <div className="flex items-center gap-1 text-emerald-600">
                          <ArrowUpRight className="h-3 w-3" />
                          <span className="text-sm">Crédito</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-red-500">
                          <ArrowDownRight className="h-3 w-3" />
                          <span className="text-sm">Débito</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {tx.source === "admin_grant" ? "Admin" : tx.source === "plan_renewal" ? "Plano" : tx.source === "external" ? "Externo" : "Interno"}
                      </Badge>
                    </TableCell>
                    <TableCell className={`font-medium ${tx.type === "credit" ? "text-emerald-600" : "text-red-500"}`}>
                      {tx.type === "credit" ? "+" : "-"}{tx.amount.toLocaleString("pt-PT")}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{tx.moduleSlug || "—"}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{tx.description || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(tx.createdAt).toLocaleDateString("pt-PT")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Coins className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>Sem transações registadas</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
