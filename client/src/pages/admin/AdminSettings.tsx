import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Shield, Key, LogOut } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function AdminSettings() {
  const [, setLocation] = useLocation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const changePasswordMut = trpc.admin.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Password alterada com sucesso");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("A nova password deve ter pelo menos 8 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As passwords não coincidem");
      return;
    }
    await changePasswordMut.mutateAsync({
      currentPassword,
      newPassword,
    });
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
      toast.success("Sessão de administrador terminada");
      setLocation("/admin-login");
    } catch {
      toast.error("Erro ao terminar sessão");
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Definições</h1>
        <p className="text-muted-foreground mt-1">Configurações do painel de administração</p>
      </div>

      {/* Change password */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Alterar Password</CardTitle>
          </div>
          <CardDescription>Altere a password de acesso ao painel de administração</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current">Password atual</Label>
              <Input
                id="current"
                type="password"
                placeholder="••••••••"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new">Nova password</Label>
              <Input
                id="new"
                type="password"
                placeholder="••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">Mínimo 8 caracteres</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirmar nova password</Label>
              <Input
                id="confirm"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={changePasswordMut.isPending}>
              Alterar password
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Admin info */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Informações</CardTitle>
          </div>
          <CardDescription>Informações sobre a sessão de administrador</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Tipo de acesso:</span>
              <p className="font-medium">Administrador da plataforma</p>
            </div>
            <div>
              <span className="text-muted-foreground">Autenticação:</span>
              <p className="font-medium">Credenciais locais</p>
            </div>
          </div>
          <div className="pt-4 border-t border-border/50">
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Terminar sessão de administrador
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
