import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import {
  User,
  Mail,
  Building2,
  Calendar,
  Clock,
  Shield,
  Users,
  Coins,
  Send,
  Save,
  Pencil,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

export default function UserProfile() {
  const { data: profile, isLoading, refetch } = trpc.profile.get.useQuery();
  const updateName = trpc.profile.updateName.useMutation({
    onSuccess: () => {
      refetch();
      setIsEditing(false);
      toast.success("Nome atualizado");
    },
    onError: (e) => toast.error(e.message),
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    if (profile) setEditName(profile.name || "");
  }, [profile]);

  const getRoleBadge = (role: string | null | undefined) => {
    switch (role) {
      case "admin":
        return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Administrador</Badge>;
      case "owner":
        return <Badge variant="default">Proprietário</Badge>;
      default:
        return <Badge variant="secondary">Membro</Badge>;
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "token_credit":
        return <div className="h-8 w-8 rounded-full bg-emerald-50 flex items-center justify-center"><Coins className="h-4 w-4 text-emerald-600" /></div>;
      case "token_debit":
        return <div className="h-8 w-8 rounded-full bg-red-50 flex items-center justify-center"><Coins className="h-4 w-4 text-red-500" /></div>;
      case "invitation":
        return <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center"><Send className="h-4 w-4 text-blue-600" /></div>;
      default:
        return <div className="h-8 w-8 rounded-full bg-gray-50 flex items-center justify-center"><Clock className="h-4 w-4 text-gray-500" /></div>;
    }
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString("pt-PT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatDateTime = (date: Date | string) => {
    return new Date(date).toLocaleDateString("pt-PT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-1" />
          <Skeleton className="h-80 lg:col-span-2" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Perfil</h1>
        <p className="text-muted-foreground mt-1">As suas informações pessoais e atividade recente</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — User info card */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="border-border/50">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center">
                <Avatar className="h-20 w-20 border-2 border-primary/20">
                  <AvatarFallback className="text-2xl font-semibold bg-primary/10 text-primary">
                    {profile?.name?.charAt(0).toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>

                <div className="mt-4 w-full">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="text-center"
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (editName.trim()) updateName.mutate({ name: editName.trim() });
                        }}
                        disabled={updateName.isPending}
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <h2 className="text-lg font-semibold">{profile?.name || "—"}</h2>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setIsEditing(true)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground mt-1">{profile?.email}</p>
                </div>

                <div className="flex items-center gap-2 mt-3">
                  {getRoleBadge(profile?.companyRole)}
                  {profile?.role === "admin" && (
                    <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">
                      <Shield className="h-3 w-3 mr-1" />
                      Admin Plataforma
                    </Badge>
                  )}
                </div>
              </div>

              <Separator className="my-5" />

              <div className="space-y-4 text-sm">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">Email</p>
                    <p className="font-medium">{profile?.email || "—"}</p>
                  </div>
                </div>

                {profile?.company && (
                  <div className="flex items-center gap-3">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-muted-foreground text-xs">Empresa</p>
                      <p className="font-medium">{profile.company.name}</p>
                      {profile.company.sector && (
                        <p className="text-xs text-muted-foreground">{profile.company.sector}</p>
                      )}
                    </div>
                  </div>
                )}

                {profile?.plan && (
                  <div className="flex items-center gap-3">
                    <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-muted-foreground text-xs">Plano ativo</p>
                      <p className="font-medium">{profile.plan.name}</p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">Membro desde</p>
                    <p className="font-medium">{profile?.createdAt ? formatDate(profile.createdAt) : "—"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">Último acesso</p>
                    <p className="font-medium">{profile?.lastSignedIn ? formatDateTime(profile.lastSignedIn) : "—"}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Teams */}
          {profile?.teams && profile.teams.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  As suas equipas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {profile.teams.map((team) => (
                    <div key={team.id} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/50">
                      <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center">
                        <Users className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <span className="text-sm font-medium">{team.name}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column — Activity */}
        <div className="lg:col-span-2">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Atividade recente</CardTitle>
              <CardDescription>Últimas ações e eventos na sua organização</CardDescription>
            </CardHeader>
            <CardContent>
              {profile?.recentActivity && profile.recentActivity.length > 0 ? (
                <div className="space-y-1">
                  {profile.recentActivity.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-4 py-3 px-3 rounded-lg hover:bg-muted/30 transition-colors"
                    >
                      {getActivityIcon(item.type)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{item.description}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDateTime(item.date)}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0 capitalize">
                        {item.type === "token_credit" ? "Crédito" :
                         item.type === "token_debit" ? "Débito" :
                         item.type === "invitation" ? "Convite" : item.type}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Clock className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Sem atividade recente</p>
                  <p className="text-sm mt-1">As ações realizadas na plataforma aparecerão aqui</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
