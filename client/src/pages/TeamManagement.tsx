import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQuery, useMutation, useDynamicMutation } from "@/hooks/useApi";
import { useAuth } from "@/_core/hooks/useAuth";
import { Plus, Send, Trash2, Users, UserPlus, MoreHorizontal, ShieldCheck, User, UserMinus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

type PortalMember = {
  id: number;
  name?: string | null;
  email?: string | null;
  companyRole?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type PortalTeam = {
  id: number;
  name: string;
  description?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  memberCount?: number;
  members?: PortalMember[];
};

export default function TeamManagement() {
  const { user: currentUser } = useAuth();

  const { data: members, isLoading: membersLoading, refetch: refetchMembers } = useQuery<PortalMember[]>("/api/platform/tenants/members");
  const { data: teams, isLoading: teamsLoading, refetch: refetchTeams } = useQuery<PortalTeam[]>("/api/platform/tenants/teams");
  const { data: pendingInvites, refetch: refetchInvites } = useQuery<any[]>("/api/platform/tenants/invitations");

  const createTeam = useMutation<{ name: string }>("/api/platform/tenants/teams", "POST", {
    onSuccess: () => { refetchTeams(); toast.success("Equipa criada"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteTeamMut = useDynamicMutation("DELETE", {
    onSuccess: () => { refetchTeams(); toast.success("Equipa eliminada"); },
    onError: (e) => toast.error(e.message),
  });

  const inviteMut = useMutation<{ email: string; role: string }>("/api/platform/tenants/invitations", "POST", {
    onSuccess: () => { refetchMembers(); refetchTeams(); refetchInvites(); toast.success("Convite enviado"); },
    onError: (e) => toast.error(e.message),
  });

  const updateRoleMut = useDynamicMutation("PUT", {
    onSuccess: () => { refetchMembers(); toast.success("Papel atualizado"); },
    onError: (e) => toast.error(e.message),
  });

  const removeMemberMut = useDynamicMutation("DELETE", {
    onSuccess: () => { refetchMembers(); toast.success("Membro removido"); },
    onError: (e) => toast.error(e.message),
  });

  const addTeamMemberMut = useDynamicMutation("POST", {
    onSuccess: () => { refetchTeams(); toast.success("Membro adicionado à equipa"); },
    onError: (e) => toast.error(e.message),
  });

  const removeTeamMemberMut = useDynamicMutation("DELETE", {
    onSuccess: () => { refetchTeams(); toast.success("Membro removido da equipa"); },
    onError: (e) => toast.error(e.message),
  });

  const [newTeamName, setNewTeamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [teamMemberSelection, setTeamMemberSelection] = useState<Record<number, string>>({});

  const canManageMembers = currentUser?.companyRole === "owner" || currentUser?.companyRole === "admin";

  const getRoleBadge = (role: string | null) => {
    switch (role) {
      case "owner": return <Badge variant="default">Proprietário</Badge>;
      case "admin": return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Admin</Badge>;
      default: return <Badge variant="secondary">Membro</Badge>;
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Equipa</h1>
        <p className="text-muted-foreground mt-1">Gerir membros e equipas da sua organização</p>
      </div>

      {/* Members */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Membros</CardTitle>
            <CardDescription>Utilizadores com acesso à empresa</CardDescription>
          </div>
          {canManageMembers ? <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus className="h-4 w-4 mr-1" />
                Convidar
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Convidar membro</DialogTitle>
                <DialogDescription>Envie um convite por email para adicionar um novo membro à empresa.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    placeholder="membro@exemplo.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Papel</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "admin" | "member")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Membro</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>Cancelar</Button>
                <Button
                  onClick={async () => {
                    if (!inviteEmail) return;
                    await inviteMut.mutateAsync({ email: inviteEmail, role: inviteRole });
                    setInviteEmail("");
                    setInviteRole("member");
                    setInviteDialogOpen(false);
                  }}
                  disabled={inviteMut.isPending}
                >
                  <Send className="h-4 w-4 mr-1" />
                  Enviar convite
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog> : null}
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Desde</TableHead>
                  {canManageMembers && <TableHead className="w-[60px]">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members?.map((m) => {
                  const isOwner = m.companyRole === "owner";
                  const isSelf = m.id === currentUser?.id;
                  const canActOn = canManageMembers && !isOwner && !isSelf;

                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.name || "—"}</TableCell>
                      <TableCell>{m.email || "—"}</TableCell>
                      <TableCell>{getRoleBadge(m.companyRole || null)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {m.createdAt ? new Date(m.createdAt).toLocaleDateString("pt-PT") : "—"}
                      </TableCell>
                      {canManageMembers && (
                        <TableCell>
                          {canActOn ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {m.companyRole === "member" ? (
                                  <DropdownMenuItem
                                    onClick={() => updateRoleMut.mutateAsync(`/api/platform/tenants/members/${m.id}/role`, { role: "admin" })}
                                    className="cursor-pointer"
                                  >
                                    <ShieldCheck className="h-4 w-4 mr-2" />
                                    Promover a Admin
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    onClick={() => updateRoleMut.mutateAsync(`/api/platform/tenants/members/${m.id}/role`, { role: "member" })}
                                    className="cursor-pointer"
                                  >
                                    <User className="h-4 w-4 mr-2" />
                                    Alterar para Membro
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem
                                      onSelect={(e) => e.preventDefault()}
                                      className="cursor-pointer text-destructive focus:text-destructive"
                                    >
                                      <UserMinus className="h-4 w-4 mr-2" />
                                      Remover da empresa
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Remover membro</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Tem a certeza que deseja remover <strong>{m.name || m.email}</strong> da empresa?
                                        Esta ação não pode ser desfeita.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => removeMemberMut.mutateAsync(`/api/platform/tenants/members/${m.id}`)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        Remover
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {isSelf ? "Você" : ""}
                            </span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {(!members || members.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={canManageMembers ? 5 : 4} className="text-center text-muted-foreground py-8">
                      Nenhum membro encontrado
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {/* Pending invitations */}
          {pendingInvites && pendingInvites.length > 0 && (
            <div className="mt-6 pt-6 border-t">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Convites pendentes</h3>
              <div className="space-y-2">
                {pendingInvites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">{inv.email}</span>
                      <Badge variant="outline" className="text-xs capitalize">{inv.role}</Badge>
                    </div>
                    <Badge variant="outline" className="text-xs">Pendente</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Teams */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Equipas</CardTitle>
            <CardDescription>Organize os membros em equipas para partilhar recursos</CardDescription>
          </div>
          {canManageMembers ? <Dialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" />
                Nova equipa
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar equipa</DialogTitle>
                <DialogDescription>Crie uma nova equipa para organizar os membros.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Nome da equipa</Label>
                  <Input
                    placeholder="Ex: Marketing, Desenvolvimento..."
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTeamDialogOpen(false)}>Cancelar</Button>
                <Button
                  onClick={async () => {
                    if (!newTeamName) return;
                    await createTeam.mutateAsync({ name: newTeamName });
                    setNewTeamName("");
                    setTeamDialogOpen(false);
                  }}
                  disabled={createTeam.isPending}
                >
                  Criar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog> : null}
        </CardHeader>
        <CardContent>
          {teamsLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : teams && teams.length > 0 ? (
            <div className="space-y-3">
              {teams.map((team) => (
                <div key={team.id} className="flex items-center justify-between p-4 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Users className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{team.name}</p>
                            <Badge variant="outline" className="text-xs">{team.memberCount ?? team.members?.length ?? 0} membros</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {team.createdAt ? `Criada em ${new Date(team.createdAt).toLocaleDateString("pt-PT")}` : ""}
                          </p>
                        </div>
                      </div>
                      {canManageMembers ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Eliminar equipa</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem a certeza que deseja eliminar a equipa <strong>{team.name}</strong>? Todos os membros serão removidos da equipa.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteTeamMut.mutateAsync(`/api/platform/tenants/teams/${team.id}`)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Eliminar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Membros da equipa</div>
                      {(team.members || []).length > 0 ? (
                        <div className="space-y-2">
                          {(team.members || []).map((member) => (
                            <div key={`${team.id}-${member.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
                              <div>
                                <div className="text-sm font-medium">{member.name || member.email || `Membro ${member.id}`}</div>
                                <div className="text-xs text-muted-foreground">{member.email || "Sem email"}</div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">{member.companyRole || "member"}</Badge>
                                {canManageMembers ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    onClick={() => removeTeamMemberMut.mutateAsync(`/api/platform/tenants/teams/${team.id}/members/${member.id}`)}
                                  >
                                    <UserMinus className="h-4 w-4" />
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-sm text-muted-foreground">
                          Nenhum membro atribuído. O Helpdesk só considera técnicos que pertençam a uma equipa no portal.
                        </div>
                      )}
                    </div>

                    {canManageMembers ? (() => {
                      const assignedMemberIds = new Set((team.members || []).map((member) => member.id));
                      const availableMembers = (members || []).filter((member) => !assignedMemberIds.has(member.id));

                      if (availableMembers.length === 0) {
                        return <div className="text-xs text-muted-foreground">Todos os membros da empresa já estão atribuídos a esta equipa.</div>;
                      }

                      return (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Select
                            value={teamMemberSelection[team.id] || undefined}
                            onValueChange={(value) => setTeamMemberSelection((prev) => ({ ...prev, [team.id]: value }))}
                          >
                            <SelectTrigger className="sm:flex-1">
                              <SelectValue placeholder="Selecionar membro para adicionar" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableMembers.map((member) => (
                                <SelectItem key={member.id} value={String(member.id)}>
                                  {(member.name || member.email || `Membro ${member.id}`) + (member.email ? ` • ${member.email}` : "")}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            onClick={async () => {
                              const selectedUserId = teamMemberSelection[team.id];
                              if (!selectedUserId) return;
                              await addTeamMemberMut.mutateAsync(`/api/platform/tenants/teams/${team.id}/members`, { userId: Number(selectedUserId) });
                              setTeamMemberSelection((prev) => ({ ...prev, [team.id]: "" }));
                            }}
                            disabled={!teamMemberSelection[team.id] || addTeamMemberMut.isPending}
                          >
                            Adicionar membro
                          </Button>
                        </div>
                      );
                    })() : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>Nenhuma equipa criada</p>
              <p className="text-sm mt-1">Crie equipas para organizar os membros da empresa</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
