import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useDynamicMutation } from "@/hooks/useApi";
import { Building2, Coins, Eye, Plus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

type CompanyForm = {
  name: string;
  sector: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  planId: string;
};

const defaultCompanyForm: CompanyForm = {
  name: "",
  sector: "",
  email: "",
  phone: "",
  address: "",
  website: "",
  planId: "",
};

export default function AdminCompanies() {
  const { data: companies, isLoading, refetch } = useQuery<any[]>("/api/platform/tenants/admin/companies");
  const { data: plans } = useQuery<any[]>("/api/platform/tenants/admin/plans");

  const createCompanyMut = useMutation<any, any>("/api/platform/tenants/admin/companies", "POST", {
    onSuccess: () => { refetch(); toast.success("Tenant criado com sucesso"); },
    onError: (e) => toast.error(e.message),
  });
  const updateCompanyMut = useDynamicMutation("PUT", {
    onSuccess: () => { refetch(); toast.success("Tenant atualizado"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteCompanyMut = useDynamicMutation("DELETE", {
    onSuccess: () => { refetch(); toast.success("Tenant removido"); },
    onError: (e) => toast.error(e.message),
  });

  const grantTokensMut = useDynamicMutation("POST", {
    onSuccess: () => { refetch(); toast.success("Tokens atribuídos"); },
    onError: (e) => toast.error(e.message),
  });
  const assignPlanMut = useDynamicMutation("PUT", {
    onSuccess: () => { refetch(); toast.success("Plano atribuído"); },
    onError: (e) => toast.error(e.message),
  });

  const [companyDialog, setCompanyDialog] = useState<{ open: boolean; editId: number | null }>({ open: false, editId: null });
  const [companyForm, setCompanyForm] = useState<CompanyForm>(defaultCompanyForm);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; companyId: number; companyName: string }>({ open: false, companyId: 0, companyName: "" });

  const [grantDialog, setGrantDialog] = useState<{ open: boolean; companyId: number; companyName: string }>({ open: false, companyId: 0, companyName: "" });
  const [grantAmount, setGrantAmount] = useState("");
  const [grantSource, setGrantSource] = useState<"internal" | "external">("internal");
  const [grantDesc, setGrantDesc] = useState("");

  const [planDialog, setPlanDialog] = useState<{ open: boolean; companyId: number; companyName: string }>({ open: false, companyId: 0, companyName: "" });
  const [selectedPlan, setSelectedPlan] = useState("");

  const [detailDialog, setDetailDialog] = useState<{ open: boolean; companyId: number }>({ open: false, companyId: 0 });
  const { data: companyDetail } = useQuery<any>(
    detailDialog.open && detailDialog.companyId > 0
      ? `/api/platform/tenants/admin/companies/${detailDialog.companyId}`
      : null,
    { enabled: detailDialog.open && detailDialog.companyId > 0 }
  );

  const openCreateCompany = () => {
    setCompanyForm(defaultCompanyForm);
    setCompanyDialog({ open: true, editId: null });
  };

  const openEditCompany = (company: any) => {
    setCompanyForm({
      name: company.name || "",
      sector: company.sector || "",
      email: company.email || "",
      phone: company.phone || "",
      address: company.address || "",
      website: company.website || "",
      planId: company.planId ? String(company.planId) : "",
    });
    setCompanyDialog({ open: true, editId: company.id });
  };

  const handleSaveCompany = async () => {
    if (!companyForm.name.trim()) {
      toast.error("Nome do tenant é obrigatório");
      return;
    }

    const payload = {
      name: companyForm.name.trim(),
      sector: companyForm.sector || null,
      email: companyForm.email || null,
      phone: companyForm.phone || null,
      address: companyForm.address || null,
      website: companyForm.website || null,
      planId: companyForm.planId ? Number(companyForm.planId) : null,
    };

    if (companyDialog.editId) {
      await updateCompanyMut.mutateAsync(`/api/platform/tenants/admin/companies/${companyDialog.editId}`, payload);
    } else {
      await createCompanyMut.mutateAsync(payload);
    }

    setCompanyDialog({ open: false, editId: null });
    setCompanyForm(defaultCompanyForm);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas / Tenants</h1>
          <p className="text-muted-foreground mt-1">CRUD de tenants da plataforma e gestão operacional</p>
        </div>
        <Button onClick={openCreateCompany}>
          <Plus className="h-4 w-4 mr-1.5" />
          Novo tenant
        </Button>
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
                  <TableHead>Tenant</TableHead>
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
                            onClick={() => openEditCompany(c)}
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            Editar
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
                            onClick={() => {
                              setSelectedPlan(c.planId ? String(c.planId) : "");
                              setPlanDialog({ open: true, companyId: c.id, companyName: c.name });
                            }}
                          >
                            Plano
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteDialog({ open: true, companyId: c.id, companyName: c.name })}
                          >
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

      {/* Create/Edit tenant dialog */}
      <Dialog open={companyDialog.open} onOpenChange={(open) => setCompanyDialog((p) => ({ ...p, open }))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{companyDialog.editId ? "Editar tenant" : "Novo tenant"}</DialogTitle>
            <DialogDescription>
              {companyDialog.editId ? "Atualizar dados da empresa" : "Criar um novo tenant manualmente no portal admin"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={companyForm.name} onChange={(e) => setCompanyForm((p) => ({ ...p, name: e.target.value }))} placeholder="Nome da empresa" />
            </div>
            <div className="space-y-2">
              <Label>Sector</Label>
              <Input value={companyForm.sector} onChange={(e) => setCompanyForm((p) => ({ ...p, sector: e.target.value }))} placeholder="Ex: Turismo" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={companyForm.email} onChange={(e) => setCompanyForm((p) => ({ ...p, email: e.target.value }))} placeholder="contacto@empresa.com" />
            </div>
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input value={companyForm.phone} onChange={(e) => setCompanyForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+351 ..." />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Morada</Label>
              <Input value={companyForm.address} onChange={(e) => setCompanyForm((p) => ({ ...p, address: e.target.value }))} placeholder="Morada" />
            </div>
            <div className="space-y-2">
              <Label>Website</Label>
              <Input value={companyForm.website} onChange={(e) => setCompanyForm((p) => ({ ...p, website: e.target.value }))} placeholder="https://..." />
            </div>
            <div className="space-y-2">
              <Label>Plano</Label>
              <Select value={companyForm.planId || "none"} onValueChange={(value) => setCompanyForm((p) => ({ ...p, planId: value === "none" ? "" : value }))}>
                <SelectTrigger><SelectValue placeholder="Sem plano" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem plano</SelectItem>
                  {plans?.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompanyDialog((p) => ({ ...p, open: false }))}>Cancelar</Button>
            <Button onClick={handleSaveCompany} disabled={createCompanyMut.isPending || updateCompanyMut.isPending}>
              {companyDialog.editId ? "Guardar" : "Criar tenant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete tenant dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((p) => ({ ...p, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar tenant</DialogTitle>
            <DialogDescription>
              Vai eliminar <strong>{deleteDialog.companyName}</strong> e respetiva estrutura (equipas, permissões e convites). Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog((p) => ({ ...p, open: false }))}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await deleteCompanyMut.mutateAsync(`/api/platform/tenants/admin/companies/${deleteDialog.companyId}`);
                setDeleteDialog({ open: false, companyId: 0, companyName: "" });
              }}
              disabled={deleteCompanyMut.isPending}
            >
              Eliminar tenant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <Select value={grantSource} onValueChange={(v) => setGrantSource(v as "internal" | "external") }>
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
                await grantTokensMut.mutateAsync(
                  `/api/platform/tenants/admin/companies/${grantDialog.companyId}/tokens`,
                  { amount, source: grantSource, description: grantDesc || undefined }
                );
                setGrantAmount("");
                setGrantDesc("");
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
              <Select value={selectedPlan || "none"} onValueChange={(value) => setSelectedPlan(value === "none" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Selecionar plano" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem plano</SelectItem>
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
                await assignPlanMut.mutateAsync(
                  `/api/platform/tenants/admin/companies/${planDialog.companyId}/plan`,
                  { planId: selectedPlan ? parseInt(selectedPlan) : null }
                );
                setSelectedPlan("");
                setPlanDialog(p => ({ ...p, open: false }));
              }}
              disabled={assignPlanMut.isPending}
            >
              Guardar
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
            </div>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </DialogContent>
      </Dialog>

      {(!companies || companies.length === 0) && !isLoading && (
        <div className="text-center py-10 text-muted-foreground">
          <Building2 className="h-9 w-9 mx-auto mb-2 opacity-50" />
          <p>Nenhum tenant criado manualmente.</p>
        </div>
      )}
    </div>
  );
}
