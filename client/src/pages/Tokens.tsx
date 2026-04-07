import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { Coins, TrendingUp, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Tokens() {
  const { data: balance, isLoading: balanceLoading } = trpc.tokens.balance.useQuery();
  const { data: transactions, isLoading: txLoading } = trpc.tokens.transactions.useQuery();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tokens</h1>
        <p className="text-muted-foreground mt-1">Saldo e histórico de consumo de tokens</p>
      </div>

      {/* Balance cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tokens Internos</CardTitle>
            <Coins className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {balanceLoading ? (
              <Skeleton className="h-10 w-32" />
            ) : (
              <div className="text-3xl font-bold">{(balance?.internal ?? 0).toLocaleString("pt-PT")}</div>
            )}
            <p className="text-sm text-muted-foreground mt-1">Tokens do sistema interno</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tokens Externos</CardTitle>
            <TrendingUp className="h-4 w-4 text-chart-4" />
          </CardHeader>
          <CardContent>
            {balanceLoading ? (
              <Skeleton className="h-10 w-32" />
            ) : (
              <div className="text-3xl font-bold">{(balance?.external ?? 0).toLocaleString("pt-PT")}</div>
            )}
            <p className="text-sm text-muted-foreground mt-1">Tokens de API externa</p>
          </CardContent>
        </Card>
      </div>

      {/* Transactions */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Histórico de transações</CardTitle>
          <CardDescription>Todas as movimentações de tokens da empresa</CardDescription>
        </CardHeader>
        <CardContent>
          {txLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : transactions && transactions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Quantidade</TableHead>
                  <TableHead>Módulo</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      {tx.type === "credit" ? (
                        <div className="flex items-center gap-1 text-emerald-600">
                          <ArrowUpRight className="h-3 w-3" />
                          <span className="text-sm font-medium">Crédito</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-red-500">
                          <ArrowDownRight className="h-3 w-3" />
                          <span className="text-sm font-medium">Débito</span>
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
                      {new Date(tx.createdAt).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" })}
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
