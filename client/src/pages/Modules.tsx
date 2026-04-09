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
import { trpc } from "@/lib/trpc";
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
  const { data: allModules, isLoading } = trpc.modules.listAll.useQuery();
  const { data: companyMods, refetch: refetchCompanyMods } = trpc.modules.companyModules.useQuery();
  const { data: detailedMods, refetch: refetchDetailed } = trpc.modules.companyModulesDetailed.useQuery();
  const { data: teamsData } = trpc.teams.list.useQuery();
  const { data: membersData } = trpc.company.members.useQuery();

  const toggle = trpc.modules.toggle.useMutation({
    onSuccess: () => {
      refetchCompanyMods();
      refetchDetailed();
    },
    onError: (e) => toast.error(e.message),
  });

  const setPermissions = trpc.modules.setPermissions.useMutation({
    onSuccess: () => {
      toast.success("Permissões atualizadas");
      setPermDialogOpen(false);
      refetchCompanyMods();
      refetchDetailed();
    },
    onError: (e) => toast.error(e.message),
  });

  // Permission dialog state
  const [permDialogOpen, setPermDialogOpen] = useState(false);
  const [activeModuleForPerm, setActiveModuleForPerm] = useState<{
    moduleId: number;
    companyModuleId: number;
    name: string;
  } | null>(null);
  const [selectedTeams, setSelectedTeams] = useState<number[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [permLoading, setPermLoading] = useState(false);

  // Load existing permissions when dialog opens
  const { data: currentPerms, refetch: refetchPerms } = trpc.modules.getPermissions.useQuery(
    { companyModuleId: activeModuleForPerm?.companyModuleId ?? 0 },
    { enabled: !!activeModuleForPerm?.companyModuleId }
  );

  useEffect(() => {
    if (currentPerms && activeModuleForPerm) {
      setSelectedTeams(currentPerms.filter(p => p.teamId).map(p => p.teamId!));
      setSelectedUsers(currentPerms.filter(p => p.userId).map(p => p.userId!));
    }
  }, [currentPerms, activeModuleForPerm]);

  const isEnabled = (moduleId: number) => {
    return companyMods?.some(m => m.moduleId === moduleId && m.isEnabled) ?? false;
  };

  const getCompanyModuleId = (moduleId: number) => {
    return companyMods?.find(m => m.moduleId === moduleId)?.id;
  };

  const handleToggle = async (moduleId: number, checked: boolean, moduleName: string) => {
    await toggle.mutateAsync({ moduleId, isEnabled: checked });
    if (checked) {
      // After activating, open permission dialog
      // Need to refetch to get the companyModuleId
      const updated = await refetchCompanyMods();
      const cm = updated.data?.find(m => m.moduleId === moduleId);
      if (cm) {
        setActiveModuleForPerm({ moduleId, companyModuleId: cm.id, name: moduleName });
        setSelectedTeams([]);
        setSelectedUsers([]);
        setPermDialogOpen(true);
      }
      toast.success(`Módulo "${moduleName}" ativado`);
    } else {
      toast.success(`Módulo "${moduleName}" desativado`);
    }
  };

  const handleOpenPermissions = (moduleId: number, moduleName: string) => {
    const cmId = getCompanyModuleId(moduleId);
    if (!cmId) return;
    setActiveModuleForPerm({ moduleId, companyModuleId: cmId, name: moduleName });
    setPermDialogOpen(true);
  };

  const handleSavePermissions = async () => {
    if (!activeModuleForPerm) return;
    const permissions: PermissionEntry[] = [
      ...selectedTeams.map(teamId => ({ teamId })),
      ...selectedUsers.map(userId => ({ userId })),
    ];
    await setPermissions.mutateAsync({
      companyModuleId: activeModuleForPerm.companyModuleId,
      permissions,
    });
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
            const enabled = isEnabled(mod.id);
            const cmId = getCompanyModuleId(mod.id);
            return (
              <Card key={mod.id} className={`border-border/50 transition-all ${enabled ? "ring-1 ring-primary/20 bg-primary/[0.02]" : ""}`}>
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
                    onCheckedChange={(checked) => handleToggle(mod.id, checked, mod.name)}
                    disabled={toggle.isPending}
                  />
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={enabled ? "default" : "secondary"} className="text-xs">
                        {enabled ? "Ativo" : "Inativo"}
                      </Badge>
                      {!mod.isActive && (
                        <Badge variant="outline" className="text-xs">Em breve</Badge>
                      )}
                    </div>
                    {enabled && cmId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-8"
                        onClick={() => handleOpenPermissions(mod.id, mod.name)}
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
            <Button onClick={handleSavePermissions} disabled={setPermissions.isPending}>
              {setPermissions.isPending ? "A guardar..." : "Guardar permissões"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
