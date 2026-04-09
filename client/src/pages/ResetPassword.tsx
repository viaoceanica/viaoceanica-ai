import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LOGO_URL } from "@/const";
import { ArrowLeft, Loader2, ShieldCheck, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

type TokenStatus = "checking" | "valid" | "invalid" | "expired";

export default function ResetPassword() {
  const [location, setLocation] = useLocation();
  // Extract token from /reset-password/:token
  const token = location.replace("/reset-password/", "") || "";

  const [tokenStatus, setTokenStatus] = useState<TokenStatus>("checking");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Verify token on mount
  useEffect(() => {
    if (!token) {
      setTokenStatus("invalid");
      return;
    }

    const verifyToken = async () => {
      try {
        const res = await fetch(`/api/auth/verify-reset-token?token=${encodeURIComponent(token)}`, {
          credentials: "include",
        });
        const json = await res.json();
        if (json?.success && json?.data?.valid) {
          setTokenStatus("valid");
        } else {
          setTokenStatus("expired");
        }
      } catch {
        setTokenStatus("invalid");
      }
    };

    verifyToken();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 6) {
      setError("A password deve ter pelo menos 6 caracteres");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("As passwords não coincidem");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      const json = await res.json();

      if (!res.ok) {
        const msg = json?.error?.message || "Erro ao redefinir password";
        setError(msg);
        toast.error(msg);
      } else {
        setSuccess(true);
        toast.success("Password atualizada com sucesso!");
      }
    } catch (err) {
      const msg = "Erro de ligação. Tente novamente.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Loading state while checking token
  if (tokenStatus === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">A verificar link de recuperação...</p>
        </div>
      </div>
    );
  }

  // Invalid or expired token
  if (tokenStatus === "invalid" || tokenStatus === "expired") {
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
                <div className="h-12 w-12 rounded-full bg-red-50 flex items-center justify-center">
                  <XCircle className="h-6 w-6 text-red-500" />
                </div>
              </div>
              <CardTitle className="text-2xl font-semibold">Link inválido</CardTitle>
              <CardDescription>
                {tokenStatus === "expired"
                  ? "Este link de recuperação expirou. Solicite um novo."
                  : "Este link de recuperação é inválido ou já foi utilizado."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/forgot-password">
                <Button className="w-full">Solicitar novo link</Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Voltar ao login
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
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
                <div className="h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                </div>
              </div>
              <CardTitle className="text-2xl font-semibold">Password atualizada</CardTitle>
              <CardDescription>
                A sua password foi redefinida com sucesso. Já pode iniciar sessão.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/login">
                <Button className="w-full">
                  Iniciar sessão
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Reset form
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
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl font-semibold">Nova password</CardTitle>
            <CardDescription>
              Introduza a sua nova password
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nova password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={loading}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirmar password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Repita a nova password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={loading}
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
                    A redefinir...
                  </>
                ) : (
                  "Redefinir password"
                )}
              </Button>
              <div className="text-center">
                <Link href="/login" className="text-sm text-primary hover:underline">
                  <ArrowLeft className="h-3 w-3 inline mr-1" />
                  Voltar ao login
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
