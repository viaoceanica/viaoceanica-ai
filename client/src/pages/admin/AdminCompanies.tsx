import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Building2, Coins, Eye } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminCompanies() {
  const { data: companies, isLoading, refetch } = trpc.admin.companies.useQuery();
  const { data: plans } = trpc.admin.plans.useQuery();
  const grantTokens = trpc.admin.grantTokens.useMutation({
    onSuccess: () => { refetch(); toast.success("Tokens atribuídos"); },
    onError: (e) => toast.error(e.message),
  });
  const assignPlan = trpc.admin.assignPlan.useMutation({
    onSuccess: () => { refetch(); toast.success("Plano atribuído"); },
    onError: (e) => toast.error(e.message),
  });

  const [grantDialog, setGrantDialog] = useState<{ open: boolean; companyId: number; companyName: string }>({ open: false, companyId: 0, companyName: "" });
  const [grantAmount, setGrantAmount] = useState("");
  const [grantSource, setGrantSource] = useState<"internal" | "external">("internal");
  const [grantDesc, setGrantDesc] = useState("");

  const [planDialog, setPlanDialog] = useState<{ open: boolean; companyId: number; companyName: string }>({ open: false, companyId: 0, companyName: "" });
  const [selectedPlan, setSelectedPlan] = useState("");

  const [detailDialog, setDetailDialog] = useState<{ open: boolean; companyId: number }>({ open: false, companyId: 0 });
  const { data: companyDetail } = trpc.admin.companyDetails.useQuery(
    { companyId: detailDialog.companyId },
    { enabled: detailDialog.open && detailDialog.companyId > 0 }
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
        <p className="text-muted-foreground mt-1">Gerir todas as empresas registadas na plataforma</p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Lista de empresas</CardTitle>
          <CardDescription>{companies?.length ?? 0} empresas registadas</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Tokens Int.</TableHead>
                  <TableHead>Tokens Ext.</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Registo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies?.map((c) => {
                  const companyPlan = plans?.find(p => p.id === c.planId);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-muted-foreground">{c.sector || "—"}</TableCell>
                      <TableCell>{c.tokensBalance.toLocaleString("pt-PT")}</TableCell>
                      <TableCell>{c.externalTokensBalance.toLocaleString("pt-PT")}</TableCell>
                      <TableCell>
                        <Badge variant={companyPlan ? "default" : "secondary"} className="text-xs">
                          {companyPlan?.name || "Sem plano"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(c.createdAt).toLocaleDateString("pt-PT")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDetailDialog({ open: true, companyId: c.id })}
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            Ver
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setGrantDialog({ open: true, companyId: c.id, companyName: c.name })}
                          >
                            <Coins className="h-3 w-3 mr-1" />
                            Tokens
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPlanDialog({ open: true, companyId: c.id, companyName: c.name })}
                          >
                            Plano
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!companies || companies.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Nenhuma empresa registada
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Grant tokens dialog */}
      <Dialog open={grantDialog.open} onOpenChange={(open) => setGrantDialog(p => ({ ...p, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atribuir tokens</DialogTitle>
            <DialogDescription>Atribuir tokens gratuitos a {grantDialog.companyName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Quantidade</Label>
              <Input type="number" placeholder="1000" value={grantAmount} onChange={(e) => setGrantAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Tipo de token</Label>
              <Select value={grantSource} onValueChange={(v) => setGrantSource(v as "internal" | "external")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Interno</SelectItem>
                  <SelectItem value="external">Externo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Descrição <span className="text-muted-foreground">(opcional)</span></Label>
              <Input placeholder="Ex: Tokens de boas-vindas" value={grantDesc} onChange={(e) => setGrantDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantDialog(p => ({ ...p, open: false }))}>Cancelar</Button>
            <Button
              onClick={() => {
                const amount = parseInt(grantAmount);
                if (!amount || amount <= 0) { toast.error("Quantidade inválida"); return; }
                grantTokens.mutate({ companyId: grantDialog.companyId, amount, source: grantSource, description: grantDesc || undefined });
                setGrantAmount("");
                setGrantDesc("");
                setGrantDialog(p => ({ ...p, open: false }));
              }}
              disabled={grantTokens.isPending}
            >
              Atribuir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign plan dialog */}
      <Dialog open={planDialog.open} onOpenChange={(open) => setPlanDialog(p => ({ ...p, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atribuir plano</DialogTitle>
            <DialogDescription>Selecionar plano para {planDialog.companyName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Plano</Label>
              <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                <SelectTrigger><SelectValue placeholder="Selecionar plano" /></SelectTrigger>
                <SelectContent>
                  {plans?.map(p => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialog(p => ({ ...p, open: false }))}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!selectedPlan) { toast.error("Selecione um plano"); return; }
                assignPlan.mutate({ companyId: planDialog.companyId, planId: parseInt(selectedPlan) });
                setSelectedPlan("");
                setPlanDialog(p => ({ ...p, open: false }));
              }}
              disabled={assignPlan.isPending}
            >
              Atribuir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Company detail dialog */}
      <Dialog open={detailDialog.open} onOpenChange={(open) => setDetailDialog(p => ({ ...p, open }))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{companyDetail?.company?.name || "Detalhes"}</DialogTitle>
            <DialogDescription>Informações detalhadas da empresa</DialogDescription>
          </DialogHeader>
          {companyDetail ? (
            <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Sector:</span> {companyDetail.company?.sector || "—"}</div>
                <div><span className="text-muted-foreground">Email:</span> {companyDetail.company?.email || "—"}</div>
                <div><span className="text-muted-foreground">Plano:</span> {companyDetail.plan?.name || "Sem plano"}</div>
                <div><span className="text-muted-foreground">Tokens int.:</span> {companyDetail.company?.tokensBalance.toLocaleString("pt-PT")}</div>
                <div><span className="text-muted-foreground">Tokens ext.:</span> {companyDetail.company?.externalTokensBalance.toLocaleString("pt-PT")}</div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Membros ({companyDetail.members.length})</h4>
                <div className="space-y-1">
                  {companyDetail.members.map(m => (
                    <div key={m.id} className="flex items-center justify-between text-sm py-1 px-2 rounded bg-muted/50">
                      <span>{m.name || m.email}</span>
                      <Badge variant="secondary" className="text-xs">{m.companyRole}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
