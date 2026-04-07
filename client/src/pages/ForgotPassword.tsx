import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LOGO_URL } from "@/const";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Placeholder - será implementado quando houver serviço de email
    setSent(true);
    toast.info("Funcionalidade em desenvolvimento");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/">
            <img src={LOGO_URL} alt="Via Oceânica" className="h-8 invert dark:invert-0" />
          </Link>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-semibold">Recuperar password</CardTitle>
            <CardDescription>
              {sent ? "Verifique o seu email" : "Introduza o email associado à sua conta"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="text-center space-y-4">
                <p className="text-sm text-muted-foreground">
                  Se o email estiver registado, receberá instruções para redefinir a password.
                </p>
                <Link href="/login">
                  <Button variant="outline" className="w-full">
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Voltar ao login
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="empresa@exemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full">
                  Enviar instruções
                </Button>
                <div className="text-center">
                  <Link href="/login" className="text-sm text-primary hover:underline">
                    <ArrowLeft className="h-3 w-3 inline mr-1" />
                    Voltar ao login
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
