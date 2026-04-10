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
import { Building2, Coins, Eye, Trash2, Puzzle, Plus, Pencil, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

type CompanyForm = {
  name: string;
  sector: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  nif: string;
};

const emptyForm: CompanyForm = {
  name: "",
  sector: "Tecnologia",
  email: "",
  phone: "",
  address: "",
  website: "",
  nif: "",
};

const sectorOptions = [
  "Tecnologia",
  "Restauração",
  "Comércio",
  "Serviços",
  "Saúde",
  "Educação",
  "Construção",
  "Turismo",
  "Indústria",
  "Outro",
];

export default function AdminCompanies() {
  const utils = trpc.useUtils();
  const { data: companies, isLoading } = trpc.admin.companies.useQuery();
  const { data: plans } = trpc.admin.plans.useQuery();
  const { data: allModules } = trpc.admin.allModules.useQuery();

  // Search
  const [search, setSearch] = useState("");
  const filteredCompanies = useMemo(() => {
    if (!companies) return [];
    if (!search.trim()) return companies;
    const q = search.toLowerCase();
    return companies.filter((c: any) =>
      c.name?.toLowerCase().includes(q) ||
      c.sector?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.nif?.toLowerCase().includes(q)
    );
  }, [companies, search]);

  // Mutations
  const createCompanyMut = trpc.admin.createCompany.useMutation({
    onSuccess: () => { utils.admin.companies.invalidate(); utils.admin.tenantBilling.invalidate(); toast.success("Empresa criada com sucesso"); },
    onError: (e) => toast.error(e.message),
  });
  const updateCompanyMut = trpc.admin.updateCompany.useMutation({
    onSuccess: () => { utils.admin.companies.invalidate(); utils.admin.tenantBilling.invalidate(); toast.success("Empresa atualizada"); },
    onError: (e) => toast.error(e.message),
  });
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

  // Create/Edit company dialog
  const [formDialog, setFormDialog] = useState<{ open: boolean; editId: number | null }>({ open: false, editId: null });
  const [form, setForm] = useState<CompanyForm>(emptyForm);

  const openCreate = () => {
    setForm(emptyForm);
    setFormDialog({ open: true, editId: null });
  };

  const openEdit = (c: any) => {
    setForm({
      name: c.name || "",
      sector: c.sector || "Tecnologia",
      email: c.email || "",
      phone: c.phone || "",
      address: c.address || "",
      website: c.website || "",
      nif: c.nif || "",
    });
    setFormDialog({ open: true, editId: c.id });
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Nome é obrigatório"); return; }
    if (formDialog.editId) {
      await updateCompanyMut.mutateAsync({
        companyId: formDialog.editId,
        name: form.name,
        sector: form.sector || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        website: form.website || undefined,
        nif: form.nif || undefined,
      });
    } else {
      await createCompanyMut.mutateAsync({
        name: form.name,
        sector: form.sector || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        website: form.website || undefined,
        nif: form.nif || undefined,
      });
    }
    setFormDialog({ open: false, editId: null });
  };

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
          <p className="text-muted-foreground mt-1">Gerir todas as empresas registadas na plataforma</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Nova Empresa
        </Button>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Lista de empresas</CardTitle>
              <CardDescription>{filteredCompanies.length} de {companies?.length ?? 0} empresas</CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Pesquisar empresa..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
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
                  <TableHead>NIF</TableHead>
                  <TableHead>Tokens Int.</TableHead>
                  <TableHead>Tokens Ext.</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Registo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCompanies.map((c: any) => {
                  const companyPlan = plans?.find((p: any) => p.id === c.planId);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium">{c.name}</span>
                          {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c.sector || "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{c.nif || "—"}</TableCell>
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
                          <Button variant="ghost" size="sm" onClick={() => setDetailDialog({ open: true, companyId: c.id })} title="Ver detalhes">
                            <Eye className="h-3 w-3 mr-1" /> Ver
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(c)} title="Editar empresa">
                            <Pencil className="h-3 w-3 mr-1" /> Editar
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setGrantDialog({ open: true, companyId: c.id, companyName: c.name })} title="Atribuir tokens">
                            <Coins className="h-3 w-3 mr-1" /> Tokens
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setPlanDialog({ open: true, companyId: c.id, companyName: c.name }); setSelectedPlan(c.planId?.toString() || ""); }} title="Atribuir plano">
                            Plano
                          </Button>
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteDialog({ open: true, companyId: c.id, companyName: c.name })} title="Eliminar empresa">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredCompanies.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      {search ? (
                        <div>
                          <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p>Nenhuma empresa encontrada para "{search}"</p>
                        </div>
                      ) : (
                        <div>
                          <Building2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p>Nenhuma empresa registada</p>
                          <Button variant="outline" className="mt-3" onClick={openCreate}>
                            <Plus className="h-4 w-4 mr-2" /> Criar primeira empresa
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ─── Create/Edit Company Dialog ─────────────────────────────── */}
      <Dialog open={formDialog.open} onOpenChange={(open) => setFormDialog(p => ({ ...p, open }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{formDialog.editId ? "Editar Empresa" : "Nova Empresa"}</DialogTitle>
            <DialogDescription>
              {formDialog.editId ? "Atualizar os dados da empresa" : "Registar uma nova empresa na plataforma"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input placeholder="Nome da empresa" value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>NIF</Label>
                <Input placeholder="123456789" value={form.nif} onChange={(e) => setForm(p => ({ ...p, nif: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Sector</Label>
                <Select value={form.sector} onValueChange={(v) => setForm(p => ({ ...p, sector: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecionar sector" /></SelectTrigger>
                  <SelectContent>
                    {sectorOptions.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" placeholder="empresa@exemplo.pt" value={form.email} onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input placeholder="+351 912 345 678" value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Website</Label>
                <Input placeholder="https://exemplo.pt" value={form.website} onChange={(e) => setForm(p => ({ ...p, website: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Morada</Label>
              <Input placeholder="Rua Exemplo, 123, Lisboa" value={form.address} onChange={(e) => setForm(p => ({ ...p, address: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormDialog(p => ({ ...p, open: false }))}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createCompanyMut.isPending || updateCompanyMut.isPending}>
              {formDialog.editId ? "Guardar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Grant Tokens Dialog ────────────────────────────────────── */}
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

      {/* ─── Assign Plan Dialog ─────────────────────────────────────── */}
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
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name} — {p.price ? `${p.price}€/mês` : "Grátis"}</SelectItem>
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

      {/* ─── Company Detail Dialog ──────────────────────────────────── */}
      <Dialog open={detailDialog.open} onOpenChange={(open) => setDetailDialog(p => ({ ...p, open }))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {companyDetail?.company?.name || "Detalhes"}
            </DialogTitle>
            <DialogDescription>Informações detalhadas da empresa</DialogDescription>
          </DialogHeader>
          {companyDetail ? (
            <div className="space-y-5 py-2 max-h-[60vh] overflow-y-auto">
              {/* Company info grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Sector:</span> {companyDetail.company?.sector || "—"}</div>
                <div><span className="text-muted-foreground">Email:</span> {companyDetail.company?.email || "—"}</div>
                <div><span className="text-muted-foreground">Telefone:</span> {(companyDetail.company as any)?.phone || "—"}</div>
                <div><span className="text-muted-foreground">NIF:</span> {(companyDetail.company as any)?.nif || "—"}</div>
                <div><span className="text-muted-foreground">Plano:</span> {companyDetail.plan?.name || "Sem plano"}</div>
                <div><span className="text-muted-foreground">Tokens int.:</span> {(companyDetail.company?.tokensBalance ?? 0).toLocaleString("pt-PT")}</div>
                <div><span className="text-muted-foreground">Tokens ext.:</span> {(companyDetail.company?.externalTokensBalance ?? 0).toLocaleString("pt-PT")}</div>
                <div><span className="text-muted-foreground">Website:</span> {(companyDetail.company as any)?.website || "—"}</div>
              </div>

              {/* Members */}
              <div>
                <h4 className="text-sm font-medium mb-2">Membros ({companyDetail.members?.length ?? 0})</h4>
                {companyDetail.members && companyDetail.members.length > 0 ? (
                  <div className="space-y-1">
                    {companyDetail.members.map((m: any) => (
                      <div key={m.id} className="flex items-center justify-between text-sm py-1.5 px-3 rounded bg-muted/50">
                        <div>
                          <span className="font-medium">{m.name || "Sem nome"}</span>
                          <span className="text-muted-foreground ml-2 text-xs">{m.email}</span>
                        </div>
                        <Badge variant="secondary" className="text-xs">{m.companyRole}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum membro registado</p>
                )}
              </div>

              {/* Modules */}
              <div>
                <h4 className="text-sm font-medium mb-2">Módulos</h4>
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

      {/* ─── Delete Confirmation Dialog ─────────────────────────────── */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog(p => ({ ...p, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar empresa</DialogTitle>
            <DialogDescription>
              Tem a certeza que deseja eliminar <strong>{deleteDialog.companyName}</strong>? Esta ação é irreversível e irá remover todos os dados associados (membros, módulos, transações).
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
