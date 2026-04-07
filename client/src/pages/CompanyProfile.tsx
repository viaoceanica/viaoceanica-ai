import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Building2, Save, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

export default function CompanyProfile() {
  const { data: company, isLoading, refetch } = trpc.company.get.useQuery();
  const { data: plan } = trpc.plans.current.useQuery();
  const { data: allPlans } = trpc.plans.list.useQuery();
  const update = trpc.company.update.useMutation({
    onSuccess: () => { refetch(); toast.success("Dados atualizados"); },
    onError: (e) => toast.error(e.message),
  });

  const [form, setForm] = useState({
    name: "",
    sector: "",
    email: "",
    phone: "",
    address: "",
    website: "",
  });

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name || "",
        sector: company.sector || "",
        email: company.email || "",
        phone: company.phone || "",
        address: company.address || "",
        website: company.website || "",
      });
    }
  }, [company]);

  const handleSave = () => {
    update.mutate(form);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Empresa</h1>
        <p className="text-muted-foreground mt-1">Perfil e informações da empresa</p>
      </div>

      {/* Company info */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Dados da empresa
          </CardTitle>
          <CardDescription>Atualize as informações da sua organização</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome da empresa</Label>
                <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Sector</Label>
                <Input value={form.sector} onChange={(e) => setForm(p => ({ ...p, sector: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Morada</Label>
                <Input value={form.address} onChange={(e) => setForm(p => ({ ...p, address: e.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Website</Label>
                <Input value={form.website} onChange={(e) => setForm(p => ({ ...p, website: e.target.value }))} />
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button onClick={handleSave} disabled={update.isPending}>
                  <Save className="h-4 w-4 mr-1" />
                  Guardar alterações
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plans */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Planos de subscrição</CardTitle>
          <CardDescription>Escolha o plano que melhor se adapta à sua empresa</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {allPlans?.filter(p => p.isActive).map((p) => {
              const isCurrent = plan?.id === p.id;
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-5 transition-all ${isCurrent ? "border-primary ring-1 ring-primary/20 bg-primary/[0.02]" : "border-border/50 hover:border-border"}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">{p.name}</h3>
                    {isCurrent && (
                      <Badge className="text-xs">
                        <Check className="h-3 w-3 mr-1" />
                        Ativo
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">{p.description}</p>
                  <div className="space-y-1 text-sm">
                    <p><span className="font-medium">{p.tokensPerMonth.toLocaleString("pt-PT")}</span> tokens/mês</p>
                    <p>Até <span className="font-medium">{p.maxMembers >= 999 ? "ilimitados" : p.maxMembers}</span> membros</p>
                    <p className="text-lg font-bold mt-3">
                      {p.price === 0 ? "Gratuito" : `${(p.price / 100).toFixed(0)}€/mês`}
                    </p>
                  </div>
                  {!isCurrent && (
                    <Button variant="outline" size="sm" className="w-full mt-4" onClick={() => toast.info("Para alterar o plano, contacte o administrador da plataforma. O upgrade será aplicado de imediato.")}>
                      Selecionar
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
