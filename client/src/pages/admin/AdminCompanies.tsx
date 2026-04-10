import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Building2, Coins, Eye, Trash2, Puzzle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminCompanies() {
  const utils = trpc.useUtils();
  const { data: companies, isLoading } = trpc.admin.companies.useQuery();
  const { data: plans } = trpc.admin.plans.useQuery();
  const { data: allModules } = trpc.admin.allModules.useQuery();

  const grantTokensMut = trpc.admin.grantTokens.useMutation({
    onSuccess: () => { utils.admin.companies.invalidate(); utils.admin.tenantBilling.invalidate(); toast.success("Tokens atribuídos"); },
    onError: (e) => toast.error(e.message),
  });
  const assignPlanMut = trpc.admin.assignPlan.useMutation({
    onSuccess: () => { utils.admin.companies.invalidate(); toast.success("Plano atribuído"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteCompanyMut = trpc.admin.deleteCompany.useMutation({
    onSuccess: () => { utils.admin.companies.invalidate(); utils.admin.tenantBilling.invalidate(); toast.success("Empresa eliminada"); },
    onError: (e) => toast.error(e.message),
  });
  const toggleModuleMut = trpc.admin.toggleCompanyModule.useMutation({
    onSuccess: () => { toast.success("Módulo atualizado"); },
    onError: (e) => toast.error(e.message),
  });

  // Grant tokens dialog
  const [grantDialog, setGrantDialog] = useState<{ open: boolean; companyId: number; companyName: string }>({ open: false, companyId: 0, companyName: "" });
  const [grantAmount, setGrantAmount] = useState("");
  const [grantSource, setGrantSource] = useState<"internal" | "external">("internal");
  const [grantDesc, setGrantDesc] = useState("");

  // Plan dialog
  const [planDialog, setPlanDialog] = useState<{ open: boolean; companyId: number; companyName: string }>({ open: false, companyId: 0, companyName: "" });
  const [selectedPlan, setSelectedPlan] = useState("");

  // Detail dialog
  const [detailDialog, setDetailDialog] = useState<{ open: boolean; companyId: number }>({ open: false, companyId: 0 });
  const { data: companyDetail } = trpc.admin.companyDetails.useQuery(
    { companyId: detailDialog.companyId },
    { enabled: detailDialog.open && detailDialog.companyId > 0 }
  );

  // Delete confirmation
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; companyId: number; companyName: string }>({ open: false, companyId: 0, companyName: "" });

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
                {companies?.map((c: any) => {
                  const companyPlan = plans?.find((p: any) => p.id === c.planId);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-muted-foreground">{c.sector || "—"}</TableCell>
                      <TableCell>{(c.tokensBalance ?? 0).toLocaleString("pt-PT")}</TableCell>
                      <TableCell>{(c.externalTokensBalance ?? 0).toLocaleString("pt-PT")}</TableCell>
                      <TableCell>
                        <Badge variant={companyPlan ? "default" : "secondary"} className="text-xs">
                          {companyPlan?.name || "Sem plano"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-PT") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setDetailDialog({ open: true, companyId: c.id })}>
                            <Eye className="h-3 w-3 mr-1" /> Ver
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setGrantDialog({ open: true, companyId: c.id, companyName: c.name })}>
                            <Coins className="h-3 w-3 mr-1" /> Tokens
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setPlanDialog({ open: true, companyId: c.id, companyName: c.name })}>
                            Plano
                          </Button>
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteDialog({ open: true, companyId: c.id, companyName: c.name })}>
                            <Trash2 className="h-3 w-3" />
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
            <DialogDescription>Atribuir tokens a {grantDialog.companyName}</DialogDescription>
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
              onClick={async () => {
                const amount = parseInt(grantAmount);
                if (!amount || amount <= 0) { toast.error("Quantidade inválida"); return; }
                await grantTokensMut.mutateAsync({ companyId: grantDialog.companyId, amount, source: grantSource, description: grantDesc || undefined });
                setGrantAmount(""); setGrantDesc("");
                setGrantDialog(p => ({ ...p, open: false }));
              }}
              disabled={grantTokensMut.isPending}
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
                  {plans?.map((p: any) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialog(p => ({ ...p, open: false }))}>Cancelar</Button>
            <Button
              onClick={async () => {
                if (!selectedPlan) { toast.error("Selecione um plano"); return; }
                await assignPlanMut.mutateAsync({ companyId: planDialog.companyId, planId: parseInt(selectedPlan) });
                setSelectedPlan("");
                setPlanDialog(p => ({ ...p, open: false }));
              }}
              disabled={assignPlanMut.isPending}
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
                <div><span className="text-muted-foreground">Tokens int.:</span> {(companyDetail.company?.tokensBalance ?? 0).toLocaleString("pt-PT")}</div>
                <div><span className="text-muted-foreground">Tokens ext.:</span> {(companyDetail.company?.externalTokensBalance ?? 0).toLocaleString("pt-PT")}</div>
              </div>

              {/* Members */}
              <div>
                <h4 className="text-sm font-medium mb-2">Membros ({companyDetail.members?.length ?? 0})</h4>
                <div className="space-y-1">
                  {companyDetail.members?.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between text-sm py-1 px-2 rounded bg-muted/50">
                      <span>{m.name || m.email}</span>
                      <Badge variant="secondary" className="text-xs">{m.companyRole}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              {/* Modules */}
              <div>
                <h4 className="text-sm font-medium mb-2">Módulos ({companyDetail.modules?.length ?? 0})</h4>
                <div className="space-y-2">
                  {allModules?.map((mod: any) => {
                    const cm = companyDetail.modules?.find((m: any) => m.moduleId === mod.id);
                    const isEnabled = cm?.isEnabled ?? false;
                    return (
                      <div key={mod.id} className="flex items-center justify-between text-sm py-2 px-3 rounded border border-border/50">
                        <div className="flex items-center gap-2">
                          <Puzzle className="h-4 w-4 text-muted-foreground" />
                          <span>{mod.name}</span>
                          <span className="text-xs text-muted-foreground">({mod.slug})</span>
                        </div>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={async (checked) => {
                            await toggleModuleMut.mutateAsync({ companyId: detailDialog.companyId, moduleId: mod.id, isEnabled: checked });
                            utils.admin.companyDetails.invalidate({ companyId: detailDialog.companyId });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recent transactions */}
              {companyDetail.transactions && companyDetail.transactions.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Últimas transações</h4>
                  <div className="space-y-1">
                    {companyDetail.transactions.slice(0, 5).map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between text-sm py-1 px-2 rounded bg-muted/50">
                        <span className="text-muted-foreground">{t.description || t.source}</span>
                        <span className={t.type === "credit" ? "text-green-600" : "text-red-600"}>
                          {t.type === "credit" ? "+" : "-"}{t.amount.toLocaleString("pt-PT")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog(p => ({ ...p, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar empresa</DialogTitle>
            <DialogDescription>
              Tem a certeza que deseja eliminar <strong>{deleteDialog.companyName}</strong>? Esta ação é irreversível e irá remover todos os dados associados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(p => ({ ...p, open: false }))}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await deleteCompanyMut.mutateAsync({ companyId: deleteDialog.companyId });
                setDeleteDialog(p => ({ ...p, open: false }));
              }}
              disabled={deleteCompanyMut.isPending}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
