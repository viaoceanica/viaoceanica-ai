import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation } from "@/hooks/useApi";
import { Key, User } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function SettingsPage() {
  const { user } = useAuth();
  const changePassword = useMutation<{ currentPassword: string; newPassword: string }>("/api/auth/change-password", "POST", {
    onSuccess: () => { toast.success("Password alterada com sucesso"); setPassForm({ current: "", new: "", confirm: "" }); },
    onError: (e) => toast.error(e.message),
  });

  const [passForm, setPassForm] = useState({ current: "", new: "", confirm: "" });

  const handleChangePassword = () => {
    if (passForm.new !== passForm.confirm) {
      toast.error("As passwords não coincidem");
      return;
    }
    if (passForm.new.length < 6) {
      toast.error("A password deve ter pelo menos 6 caracteres");
      return;
    }
    changePassword.mutateAsync({ currentPassword: passForm.current, newPassword: passForm.new });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Definições</h1>
        <p className="text-muted-foreground mt-1">Gerir a sua conta pessoal</p>
      </div>

      {/* Profile info */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Perfil
          </CardTitle>
          <CardDescription>Informações da sua conta</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={user?.name || ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email || ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>Papel na empresa</Label>
              <Input value={user?.companyRole === "owner" ? "Proprietário" : user?.companyRole === "admin" ? "Administrador" : "Membro"} disabled />
            </div>
            <div className="space-y-2">
              <Label>Conta desde</Label>
              <Input value={user?.createdAt ? new Date(user.createdAt).toLocaleDateString("pt-PT") : "—"} disabled />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            Alterar password
          </CardTitle>
          <CardDescription>Atualize a sua password de acesso</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-md space-y-4">
            <div className="space-y-2">
              <Label>Password atual</Label>
              <Input
                type="password"
                value={passForm.current}
                onChange={(e) => setPassForm(p => ({ ...p, current: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Nova password</Label>
              <Input
                type="password"
                value={passForm.new}
                onChange={(e) => setPassForm(p => ({ ...p, new: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Confirmar nova password</Label>
              <Input
                type="password"
                value={passForm.confirm}
                onChange={(e) => setPassForm(p => ({ ...p, confirm: e.target.value }))}
              />
            </div>
            <Button onClick={handleChangePassword} disabled={changePassword.isPending}>
              Alterar password
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
