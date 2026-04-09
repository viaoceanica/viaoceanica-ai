import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useQuery, useDynamicMutation, apiFetch } from "@/hooks/useApi";
import { UtensilsCrossed, Mail, Puzzle, Users, UserCircle, Shield } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";

const iconMap: Record<string, React.ElementType> = {
  UtensilsCrossed,
  Mail,
};

type PermissionEntry = { teamId?: number; userId?: number };

export default function Modules() {
  // Registry: all available modules
  const { data: allModules, isLoading } = useQuery<any[]>("/api/platform/registry/modules");
  // Entitlements: tenant's modules (enabled/disabled)
  const { data: companyMods, refetch: refetchCompanyMods } = useQuery<any[]>("/api/platform/entitlements/modules");
  // Teams
  const { data: teamsData } = useQuery<any[]>("/api/platform/tenants/teams");
  // Members
  const { data: membersData } = useQuery<any[]>("/api/platform/tenants/members");

  const toggleMod = useDynamicMutation("PUT");
  const setPermsMut = useDynamicMutation("PUT");

  // Permission dialog state
  const [permDialogOpen, setPermDialogOpen] = useState(false);
  const [activeModuleForPerm, setActiveModuleForPerm] = useState<{
    moduleKey: string;
    name: string;
  } | null>(null);
  const [selectedTeams, setSelectedTeams] = useState<number[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);

  // Load existing permissions when dialog opens
  const { data: currentPerms, refetch: refetchPerms } = useQuery<any[]>(
    activeModuleForPerm ? `/api/platform/entitlements/modules/${activeModuleForPerm.moduleKey}/permissions` : null,
    { enabled: !!activeModuleForPerm }
  );

  useEffect(() => {
    if (currentPerms && activeModuleForPerm) {
      setSelectedTeams(currentPerms.filter(p => p.teamId).map(p => p.teamId!));
      setSelectedUsers(currentPerms.filter(p => p.userId).map(p => p.userId!));
    }
  }, [currentPerms, activeModuleForPerm]);

  const isEnabled = (moduleKey: string) => {
    return companyMods?.some(m => m.moduleKey === moduleKey && m.enabled) ?? false;
  };

  const handleToggle = async (moduleKey: string, checked: boolean, moduleName: string) => {
    try {
      await toggleMod.mutateAsync(`/api/platform/entitlements/modules/${moduleKey}`, { enabled: checked });
      await refetchCompanyMods();
      if (checked) {
        // After activating, open permission dialog
        setActiveModuleForPerm({ moduleKey, name: moduleName });
        setSelectedTeams([]);
        setSelectedUsers([]);
        setPermDialogOpen(true);
        toast.success(`Módulo "${moduleName}" ativado`);
      } else {
        toast.success(`Módulo "${moduleName}" desativado`);
      }
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleOpenPermissions = (moduleKey: string, moduleName: string) => {
    setActiveModuleForPerm({ moduleKey, name: moduleName });
    setPermDialogOpen(true);
  };

  const handleSavePermissions = async () => {
    if (!activeModuleForPerm) return;
    const permissions: PermissionEntry[] = [
      ...selectedTeams.map(teamId => ({ teamId })),
      ...selectedUsers.map(userId => ({ userId })),
    ];
    try {
      await setPermsMut.mutateAsync(
        `/api/platform/entitlements/modules/${activeModuleForPerm.moduleKey}/permissions`,
        { permissions }
      );
      toast.success("Permissões atualizadas");
      setPermDialogOpen(false);
      refetchCompanyMods();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const toggleTeam = (teamId: number) => {
    setSelectedTeams(prev =>
      prev.includes(teamId) ? prev.filter(id => id !== teamId) : [...prev, teamId]
    );
  };

  const toggleUser = (userId: number) => {
    setSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Módulos</h1>
        <p className="text-muted-foreground mt-1">Configure os módulos de IA disponíveis para a sua empresa</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {allModules?.map((mod) => {
            const Icon = iconMap[mod.icon || ""] || Puzzle;
            const enabled = isEnabled(mod.moduleKey);
            return (
              <Card key={mod.moduleKey} className={`border-border/50 transition-all ${enabled ? "ring-1 ring-primary/20 bg-primary/[0.02]" : ""}`}>
                <CardHeader className="flex flex-row items-start justify-between pb-3">
                  <div className="flex items-start gap-3">
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${enabled ? "bg-primary/10" : "bg-muted"}`}>
                      <Icon className={`h-5 w-5 ${enabled ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                      <CardTitle className="text-base">{mod.name}</CardTitle>
                      <CardDescription className="mt-1">{mod.description}</CardDescription>
                    </div>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) => handleToggle(mod.moduleKey, checked, mod.name)}
                    disabled={toggleMod.isPending}
                  />
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={enabled ? "default" : "secondary"} className="text-xs">
                        {enabled ? "Ativo" : "Inativo"}
                      </Badge>
                      {mod.status !== "active" && (
                        <Badge variant="outline" className="text-xs">Em breve</Badge>
                      )}
                    </div>
                    {enabled && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-8"
                        onClick={() => handleOpenPermissions(mod.moduleKey, mod.name)}
                      >
                        <Shield className="h-3.5 w-3.5 mr-1.5" />
                        Gerir acessos
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {allModules && allModules.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Puzzle className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">Nenhum módulo disponível</p>
          <p className="text-sm mt-1">Os módulos serão adicionados em breve</p>
        </div>
      )}

      {/* Permission Management Dialog */}
      <Dialog open={permDialogOpen} onOpenChange={setPermDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Gerir acessos — {activeModuleForPerm?.name}</DialogTitle>
            <DialogDescription>
              Defina que equipas e membros podem aceder a este módulo. Se nenhuma seleção for feita, todos os membros da empresa terão acesso.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4 max-h-[60vh] overflow-y-auto">
            {/* Teams section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-medium">Equipas</h4>
              </div>
              {teamsData && teamsData.length > 0 ? (
                <div className="space-y-2 pl-6">
                  {teamsData.map(team => (
                    <label
                      key={team.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-border/50 hover:bg-accent/50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={selectedTeams.includes(team.id)}
                        onCheckedChange={() => toggleTeam(team.id)}
                      />
                      <div className="flex items-center gap-2">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm">{team.name}</span>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground pl-6">Nenhuma equipa criada</p>
              )}
            </div>

            <Separator />

            {/* Members section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <UserCircle className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-medium">Membros individuais</h4>
              </div>
              {membersData && membersData.length > 0 ? (
                <div className="space-y-2 pl-6">
                  {membersData.map(member => (
                    <label
                      key={member.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-border/50 hover:bg-accent/50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={selectedUsers.includes(member.id)}
                        onCheckedChange={() => toggleUser(member.id)}
                      />
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium text-primary">
                          {member.name?.charAt(0).toUpperCase() || "?"}
                        </div>
                        <div>
                          <span className="text-sm">{member.name || "Sem nome"}</span>
                          <span className="text-xs text-muted-foreground ml-2">{member.email}</span>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground pl-6">Nenhum membro na empresa</p>
              )}
            </div>

            {selectedTeams.length === 0 && selectedUsers.length === 0 && (
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground text-center">
                  Sem seleção — todos os membros da empresa terão acesso a este módulo
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPermDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSavePermissions} disabled={setPermsMut.isPending}>
              {setPermsMut.isPending ? "A guardar..." : "Guardar permissões"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
