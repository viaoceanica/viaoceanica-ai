import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import {
  CreditCard, Plus, Pencil, Trash2, Check, Users, Zap, Building2, Crown, Puzzle
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Types ──────────────────────────────────────────────────────────

type PlanForm = {
  name: string;
  description: string;
  tokensPerMonth: number;
  maxMembers: number;
  price: number; // cents
  isActive: boolean;
  modulesAccess: string; // comma-separated module slugs or empty
};

const defaultForm: PlanForm = {
  name: "",
  description: "",
  tokensPerMonth: 1000,
  maxMembers: 3,
  price: 0,
  isActive: true,
  modulesAccess: "",
};

// ─── Helpers ────────────────────────────────────────────────────────

function formatPrice(cents: number): string {
  if (cents === 0) return "Gratuito";
  return `${(cents / 100).toFixed(2).replace(".", ",")}€`;
}

function formatMembers(max: number): string {
  if (max < 0 || max >= 999) return "Ilimitados";
  return `${max}`;
}

// ─── Main Component ─────────────────────────────────────────────────

export default function AdminPlans() {
  const utils = trpc.useUtils();
  const { data: plans, isLoading } = trpc.admin.plansWithCounts.useQuery();
  const { data: allModules } = trpc.admin.allModules.useQuery();

  const createMut = trpc.admin.createPlan.useMutation({
    onSuccess: () => { utils.admin.plansWithCounts.invalidate(); toast.success("Plano criado com sucesso"); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.admin.updatePlan.useMutation({
    onSuccess: () => { utils.admin.plansWithCounts.invalidate(); toast.success("Plano atualizado"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.admin.deletePlan.useMutation({
    onSuccess: () => { utils.admin.plansWithCounts.invalidate(); toast.success("Plano eliminado"); },
    onError: (e) => toast.error(e.message),
  });

  const [formDialog, setFormDialog] = useState<{ open: boolean; editId: number | null }>({ open: false, editId: null });
  const [form, setForm] = useState<PlanForm>(defaultForm);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; planId: number; planName: string }>({ open: false, planId: 0, planName: "" });

  const openCreate = () => {
    setForm(defaultForm);
    setFormDialog({ open: true, editId: null });
  };

  const openEdit = (plan: any) => {
    setForm({
      name: plan.name || "",
      description: plan.description || "",
      tokensPerMonth: plan.tokensPerMonth ?? 0,
      maxMembers: plan.maxMembers ?? 3,
      price: plan.price ?? 0,
      isActive: plan.isActive ?? true,
      modulesAccess: plan.modulesAccess || "",
    });
    setFormDialog({ open: true, editId: plan.id });
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Nome é obrigatório"); return; }

    const payload = {
      name: form.name,
      description: form.description || undefined,
      tokensPerMonth: form.tokensPerMonth,
      maxMembers: form.maxMembers,
      price: form.price,
      modulesAccess: form.modulesAccess || undefined,
    };

    if (formDialog.editId) {
      await updateMut.mutateAsync({
        id: formDialog.editId,
        ...payload,
        isActive: form.isActive,
      });
    } else {
      await createMut.mutateAsync(payload);
    }
    setFormDialog({ open: false, editId: null });
  };

  // Parse module slugs for display
  const parseModuleAccess = (access: string | null): string[] => {
    if (!access) return [];
    try {
      const parsed = JSON.parse(access);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return access.split(",").map(s => s.trim()).filter(Boolean);
    }
  };

  const getModuleName = (slug: string): string => {
    const mod = allModules?.find((m: any) => m.slug === slug);
    return mod?.name || slug;
  };

  // Toggle module in modulesAccess
  const toggleModuleAccess = (slug: string) => {
    const current = parseModuleAccess(form.modulesAccess);
    const updated = current.includes(slug)
      ? current.filter(s => s !== slug)
      : [...current, slug];
    setForm(p => ({ ...p, modulesAccess: JSON.stringify(updated) }));
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Planos</h1>
          <p className="text-muted-foreground mt-1">Gerir planos de subscrição — preços, limites, e acesso a módulos</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Novo Plano
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans?.map((plan: any) => {
            const moduleAccess = parseModuleAccess(plan.modulesAccess);
            return (
              <Card key={plan.id} className={`border-border/50 hover:border-border transition-colors ${!plan.isActive ? "opacity-60" : ""}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Crown className="h-4.5 w-4.5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{plan.name}</CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                          {plan.companyCount || 0} {plan.companyCount === 1 ? "empresa" : "empresas"}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant={plan.isActive ? "default" : "secondary"} className="text-xs">
                        {plan.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-3xl font-bold tracking-tight">
                    {formatPrice(plan.price)}
                    {plan.price > 0 && <span className="text-sm font-normal text-muted-foreground">/mês</span>}
                  </div>

                  {plan.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{plan.description}</p>
                  )}

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span>{plan.tokensPerMonth.toLocaleString("pt-PT")} tokens/mês</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span>{formatMembers(plan.maxMembers)} membros</span>
                    </div>
                    {moduleAccess.length > 0 && (
                      <div className="flex items-start gap-2">
                        <Puzzle className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                        <div className="flex flex-wrap gap-1">
                          {moduleAccess.map(slug => (
                            <Badge key={slug} variant="outline" className="text-xs font-mono">
                              {getModuleName(slug)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-border/30">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(plan)}>
                      <Pencil className="h-3 w-3 mr-1.5" /> Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteDialog({ open: true, planId: plan.id, planName: plan.name })}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {(!plans || plans.length === 0) && (
            <div className="col-span-3 text-center py-16 text-muted-foreground">
              <CreditCard className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">Nenhum plano configurado</p>
              <p className="text-sm mt-1">Crie o primeiro plano de subscrição</p>
              <Button variant="outline" className="mt-6" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" /> Criar primeiro plano
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ─── Create / Edit Dialog ──────────────────────────────────── */}
      <Dialog open={formDialog.open} onOpenChange={(open) => setFormDialog(p => ({ ...p, open }))}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {formDialog.editId ? "Editar Plano" : "Novo Plano"}
            </DialogTitle>
            <DialogDescription>
              {formDialog.editId
                ? "Atualizar as definições do plano de subscrição"
                : "Criar um novo plano com preço, limites e acesso a módulos"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 mt-2">
            {/* Name */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Nome do Plano *</Label>
              <Input
                placeholder="Ex: Starter, Professional, Enterprise..."
                value={form.name}
                onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label className="text-sm">Descrição</Label>
              <Textarea
                placeholder="Descrição breve do plano..."
                value={form.description}
                onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))}
                rows={2}
              />
            </div>

            {/* Price */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm">Preço Mensal (cêntimos)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.price}
                  onChange={(e) => setForm(p => ({ ...p, price: parseInt(e.target.value) || 0 }))}
                />
                <p className="text-xs text-muted-foreground">
                  {form.price === 0 ? "Gratuito" : `${(form.price / 100).toFixed(2).replace(".", ",")}€/mês`}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Tokens por Mês</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.tokensPerMonth}
                  onChange={(e) => setForm(p => ({ ...p, tokensPerMonth: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>

            {/* Members */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm">Máximo de Membros</Label>
                <Input
                  type="number"
                  value={form.maxMembers}
                  onChange={(e) => setForm(p => ({ ...p, maxMembers: parseInt(e.target.value) || 1 }))}
                />
                <p className="text-xs text-muted-foreground">
                  Use -1 para ilimitado
                </p>
              </div>
              {formDialog.editId && (
                <div className="space-y-2">
                  <Label className="text-sm">Estado</Label>
                  <div className="flex items-center gap-3 pt-2">
                    <Switch
                      checked={form.isActive}
                      onCheckedChange={(checked) => setForm(p => ({ ...p, isActive: checked }))}
                    />
                    <span className="text-sm">{form.isActive ? "Ativo" : "Inativo"}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Module Access */}
            {allModules && allModules.length > 0 && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Acesso a Módulos</Label>
                <p className="text-xs text-muted-foreground">
                  Selecione quais módulos estão incluídos neste plano. Se nenhum for selecionado, o plano dá acesso a todos os módulos.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {allModules.map((mod: any) => {
                    const isSelected = parseModuleAccess(form.modulesAccess).includes(mod.slug);
                    return (
                      <Button
                        key={mod.id}
                        type="button"
                        variant={isSelected ? "default" : "outline"}
                        size="sm"
                        className="justify-start text-xs h-9"
                        onClick={() => toggleModuleAccess(mod.slug)}
                      >
                        {isSelected && <Check className="h-3 w-3 mr-1.5 shrink-0" />}
                        {mod.name}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setFormDialog(p => ({ ...p, open: false }))}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {createMut.isPending || updateMut.isPending ? "A guardar..." : formDialog.editId ? "Guardar" : "Criar Plano"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirmation ───────────────────────────────────── */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog(p => ({ ...p, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar plano</DialogTitle>
            <DialogDescription>
              Tem a certeza que deseja eliminar o plano <strong>{deleteDialog.planName}</strong>? As empresas associadas a este plano ficarão sem plano atribuído.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(p => ({ ...p, open: false }))}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await deleteMut.mutateAsync({ id: deleteDialog.planId });
                setDeleteDialog(p => ({ ...p, open: false }));
              }}
              disabled={deleteMut.isPending}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
