import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { Puzzle, Plus, Pencil, Trash2, UtensilsCrossed, Mail, Receipt, Brain, Globe, Package } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

const iconMap: Record<string, React.ElementType> = {
  UtensilsCrossed,
  Mail,
  Receipt,
  Brain,
  Globe,
  Package,
  Puzzle,
};

const availableIcons = [
  { value: "Puzzle", label: "Puzzle" },
  { value: "UtensilsCrossed", label: "Restauração" },
  { value: "Mail", label: "Email" },
  { value: "Receipt", label: "Faturação" },
  { value: "Brain", label: "AI" },
  { value: "Globe", label: "Web" },
  { value: "Package", label: "Pacote" },
];

const availableMountTypes = [
  { value: "iframe", label: "iframe (frontend separado)" },
  { value: "internal", label: "internal (dentro do shell)" },
  { value: "api_only", label: "api_only (só backend)" },
];

type ModuleForm = {
  name: string;
  slug: string;
  description: string;
  icon: string;
  mountType: string;
  backendUrl: string;
  frontendUrl: string;
  status: string;
};

const emptyForm: ModuleForm = {
  name: "",
  slug: "",
  description: "",
  icon: "Puzzle",
  mountType: "iframe",
  backendUrl: "",
  frontendUrl: "",
  status: "active",
};

export default function AdminModules() {
  const utils = trpc.useUtils();
  const { data: modules, isLoading } = trpc.admin.allModules.useQuery();

  const createMut = trpc.admin.createModule.useMutation({
    onSuccess: () => { utils.admin.allModules.invalidate(); toast.success("Módulo criado"); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.admin.updateModule.useMutation({
    onSuccess: () => { utils.admin.allModules.invalidate(); toast.success("Módulo atualizado"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.admin.deleteModule.useMutation({
    onSuccess: () => { utils.admin.allModules.invalidate(); toast.success("Módulo eliminado"); },
    onError: (e) => toast.error(e.message),
  });

  const [formDialog, setFormDialog] = useState<{ open: boolean; editId: number | null }>({ open: false, editId: null });
  const [form, setForm] = useState<ModuleForm>(emptyForm);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; moduleId: number; moduleName: string }>({ open: false, moduleId: 0, moduleName: "" });

  const openCreate = () => {
    setForm(emptyForm);
    setFormDialog({ open: true, editId: null });
  };

  const openEdit = (mod: any) => {
    setForm({
      name: mod.name || "",
      slug: mod.slug || mod.moduleKey || "",
      description: mod.description || "",
      icon: mod.icon || "Puzzle",
      mountType: mod.mountType || "iframe",
      backendUrl: mod.backendUrl || "",
      frontendUrl: mod.frontendUrl || "",
      status: mod.status || "active",
    });
    setFormDialog({ open: true, editId: mod.id });
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Nome é obrigatório"); return; }
    if (!form.slug.trim()) { toast.error("Slug é obrigatório"); return; }

    if (formDialog.editId) {
      await updateMut.mutateAsync({ id: formDialog.editId, ...form });
    } else {
      await createMut.mutateAsync(form);
    }
    setFormDialog({ open: false, editId: null });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Módulos</h1>
          <p className="text-muted-foreground mt-1">Gerir módulos disponíveis na plataforma</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Novo Módulo
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[1, 2].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {modules?.map((mod: any) => {
            const Icon = iconMap[mod.icon || ""] || Puzzle;
            return (
              <Card key={mod.id} className="border-border/50">
                <CardHeader className="flex flex-row items-start gap-3 pb-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{mod.name}</CardTitle>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(mod)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteDialog({ open: true, moduleId: mod.id, moduleName: mod.name })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <CardDescription className="mt-1">{mod.description}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={mod.status === "active" ? "default" : "secondary"} className="text-xs">
                      {mod.status === "active" ? "Ativo" : "Inativo"}
                    </Badge>
                    <span className="text-muted-foreground">Slug: {mod.slug || mod.moduleKey}</span>
                    <Badge variant="outline" className="text-xs">{mod.mountType || "iframe"}</Badge>
                  </div>
                  {(mod.backendUrl || mod.frontendUrl) && (
                    <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                      {mod.backendUrl && <p>Backend: {mod.backendUrl}</p>}
                      {mod.frontendUrl && <p>Frontend: {mod.frontendUrl}</p>}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {(!modules || modules.length === 0) && (
            <div className="col-span-2 text-center py-12 text-muted-foreground">
              <Puzzle className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum módulo registado</p>
              <Button variant="outline" className="mt-4" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" /> Criar primeiro módulo
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={formDialog.open} onOpenChange={(open) => setFormDialog(p => ({ ...p, open }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{formDialog.editId ? "Editar Módulo" : "Novo Módulo"}</DialogTitle>
            <DialogDescription>
              {formDialog.editId ? "Atualizar as definições do módulo" : "Registar um novo módulo na plataforma"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input placeholder="Contabilidade" value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Slug *</Label>
                <Input placeholder="contabilidade" value={form.slug} onChange={(e) => setForm(p => ({ ...p, slug: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea placeholder="Descrição do módulo..." value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Ícone</Label>
                <Select value={form.icon} onValueChange={(v) => setForm(p => ({ ...p, icon: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {availableIcons.map(i => (
                      <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo de montagem</Label>
                <Select value={form.mountType} onValueChange={(v) => setForm(p => ({ ...p, mountType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {availableMountTypes.map(m => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>URL do Backend</Label>
              <Input placeholder="http://mod-contabilidade:8000" value={form.backendUrl} onChange={(e) => setForm(p => ({ ...p, backendUrl: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>URL do Frontend</Label>
              <Input placeholder="http://mod-contabilidade-fe:3000" value={form.frontendUrl} onChange={(e) => setForm(p => ({ ...p, frontendUrl: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Estado</Label>
              <Select value={form.status} onValueChange={(v) => setForm(p => ({ ...p, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormDialog(p => ({ ...p, open: false }))}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {formDialog.editId ? "Guardar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog(p => ({ ...p, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar módulo</DialogTitle>
            <DialogDescription>
              Tem a certeza que deseja eliminar <strong>{deleteDialog.moduleName}</strong>? Esta ação é irreversível.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(p => ({ ...p, open: false }))}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await deleteMut.mutateAsync({ id: deleteDialog.moduleId });
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
