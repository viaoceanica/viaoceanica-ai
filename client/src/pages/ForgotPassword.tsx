import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LOGO_URL } from "@/const";
import { ArrowLeft, Loader2, Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), origin: window.location.origin }),
      });

      const json = await res.json();

      if (!res.ok) {
        const msg = json?.error?.message || "Erro ao processar pedido";
        setError(msg);
        toast.error(msg);
      } else {
        setSent(true);
        toast.success("Instruções enviadas para o seu email");
      }
    } catch (err) {
      const msg = "Erro de ligação. Tente novamente.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
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
            <div className="flex justify-center mb-3">
              {sent ? (
                <div className="h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                </div>
              ) : (
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Mail className="h-6 w-6 text-primary" />
                </div>
              )}
            </div>
            <CardTitle className="text-2xl font-semibold">
              {sent ? "Verifique o seu email" : "Recuperar password"}
            </CardTitle>
            <CardDescription>
              {sent
                ? "Enviámos instruções para redefinir a sua password"
                : "Introduza o email associado à sua conta"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="space-y-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800">
                  <p>
                    Se o email <strong>{email}</strong> estiver registado, receberá um link para
                    redefinir a sua password. O link expira em 30 minutos.
                  </p>
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  Não recebeu o email? Verifique a pasta de spam ou{" "}
                  <button
                    onClick={() => { setSent(false); setError(""); }}
                    className="text-primary hover:underline font-medium"
                  >
                    tente novamente
                  </button>
                </p>
                <Link href="/login">
                  <Button variant="outline" className="w-full mt-2">
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
                    disabled={loading}
                    autoFocus
                  />
                </div>
                {error && (
                  <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      A enviar...
                    </>
                  ) : (
                    "Enviar instruções"
                  )}
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
