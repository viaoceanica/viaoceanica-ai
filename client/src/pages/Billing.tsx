import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation } from "@/hooks/useApi";
import { toast } from "sonner";
import {
  Receipt,
  CreditCard,
  Building2,
  FileText,
  Save,
  Loader2,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Download,
} from "lucide-react";
import { useState, useEffect } from "react";

interface BillingProfile {
  id: number;
  companyId: number;
  legalName: string | null;
  nif: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  preferredPaymentMethod: string | null;
  billingCycle: string | null;
  notes: string | null;
}

interface BillingData {
  profile: BillingProfile | null;
  company: { id: number; name: string; email: string | null; phone: string | null } | null;
  plan: { id: number; name: string; monthlyPrice: number; yearlyPrice: number } | null;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  status: string;
  billingCycle: string;
  periodStart: string | null;
  periodEnd: string | null;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  planName: string | null;
  paidAt: string | null;
  dueDate: string | null;
  createdAt: string;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ElementType }> = {
  draft: { label: "Rascunho", variant: "secondary", icon: FileText },
  pending: { label: "Pendente", variant: "outline", icon: Clock },
  paid: { label: "Pago", variant: "default", icon: CheckCircle2 },
  overdue: { label: "Em atraso", variant: "destructive", icon: AlertCircle },
  cancelled: { label: "Cancelado", variant: "secondary", icon: XCircle },
};

const paymentMethodLabels: Record<string, string> = {
  bank_transfer: "Transferência Bancária",
  credit_card: "Cartão de Crédito",
  mbway: "MB WAY",
  multibanco: "Multibanco",
  paypal: "PayPal",
  other: "Outro",
};

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Billing() {
  const { data: billingData, isLoading: profileLoading, refetch: refetchProfile } = useQuery<BillingData>("/api/platform/tenants/billing/profile");
  const { data: invoicesData, isLoading: invoicesLoading } = useQuery<Invoice[]>("/api/platform/tenants/billing/invoices");

  const updateProfile = useMutation<any, any>("/api/platform/tenants/billing/profile", "PUT", {
    onSuccess: () => {
      toast.success("Perfil de faturação atualizado com sucesso");
      refetchProfile();
    },
    onError: (err) => {
      toast.error("Erro ao atualizar perfil: " + err.message);
    },
  });

  // Form state
  const [form, setForm] = useState({
    legalName: "",
    nif: "",
    address: "",
    postalCode: "",
    city: "",
    country: "Portugal",
    email: "",
    phone: "",
    preferredPaymentMethod: "bank_transfer",
    billingCycle: "monthly",
  });

  // Populate form when data loads
  useEffect(() => {
    if (billingData) {
      const p = billingData.profile;
      const c = billingData.company;
      setForm({
        legalName: p?.legalName || c?.name || "",
        nif: p?.nif || "",
        address: p?.address || "",
        postalCode: p?.postalCode || "",
        city: p?.city || "",
        country: p?.country || "Portugal",
        email: p?.email || c?.email || "",
        phone: p?.phone || c?.phone || "",
        preferredPaymentMethod: p?.preferredPaymentMethod || "bank_transfer",
        billingCycle: p?.billingCycle || "monthly",
      });
    }
  }, [billingData]);

  const handleSave = async () => {
    await updateProfile.mutateAsync(form);
  };

  const invoices = invoicesData || [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Faturação</h1>
        <p className="text-muted-foreground mt-1">Gerir dados de faturação e consultar faturas</p>
      </div>

      {/* Current Plan Summary */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-lg">Plano Atual</CardTitle>
            <CardDescription>Resumo da subscrição ativa</CardDescription>
          </div>
          <Receipt className="h-5 w-5 text-primary" />
        </CardHeader>
        <CardContent>
          {profileLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <div>
                <div className="text-2xl font-bold">{billingData?.plan?.name || "Sem plano"}</div>
                {billingData?.plan && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {form.billingCycle === "yearly"
                      ? `${formatCurrency(billingData.plan.yearlyPrice)}/ano`
                      : `${formatCurrency(billingData.plan.monthlyPrice)}/mês`}
                  </p>
                )}
              </div>
              {billingData?.plan && billingData.plan.monthlyPrice === 0 && (
                <Badge variant="secondary">Gratuito</Badge>
              )}
              {billingData?.plan && billingData.plan.monthlyPrice > 0 && (
                <Badge variant="default">Ativo</Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing Profile Form */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Dados de Faturação</CardTitle>
              <CardDescription>Informações fiscais para emissão de faturas</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {profileLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="legalName">Nome / Razão Social</Label>
                  <Input
                    id="legalName"
                    value={form.legalName}
                    onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
                    placeholder="Nome legal da empresa"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nif">NIF / NIPC</Label>
                  <Input
                    id="nif"
                    value={form.nif}
                    onChange={(e) => setForm((f) => ({ ...f, nif: e.target.value }))}
                    placeholder="123456789"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="address">Morada</Label>
                  <Input
                    id="address"
                    value={form.address}
                    onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                    placeholder="Rua, número, andar"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="postalCode">Código Postal</Label>
                  <Input
                    id="postalCode"
                    value={form.postalCode}
                    onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                    placeholder="1000-001"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">Cidade</Label>
                  <Input
                    id="city"
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    placeholder="Lisboa"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email de Faturação</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="faturacao@empresa.pt"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefone</Label>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+351 912 345 678"
                  />
                </div>
              </div>

              <Separator />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Método de Pagamento Preferido</Label>
                  <Select
                    value={form.preferredPaymentMethod}
                    onValueChange={(v) => setForm((f) => ({ ...f, preferredPaymentMethod: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Transferência Bancária</SelectItem>
                      <SelectItem value="credit_card">Cartão de Crédito</SelectItem>
                      <SelectItem value="mbway">MB WAY</SelectItem>
                      <SelectItem value="multibanco">Multibanco</SelectItem>
                      <SelectItem value="paypal">PayPal</SelectItem>
                      <SelectItem value="other">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ciclo de Faturação</Label>
                  <Select
                    value={form.billingCycle}
                    onValueChange={(v) => setForm((f) => ({ ...f, billingCycle: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Mensal</SelectItem>
                      <SelectItem value="yearly">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={updateProfile.isPending}>
                  {updateProfile.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Guardar Alterações
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Faturas</CardTitle>
              <CardDescription>Histórico de faturas emitidas</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {invoicesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">Sem faturas</p>
              <p className="text-sm mt-1">As faturas aparecerão aqui quando forem emitidas</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N.º Fatura</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Vencimento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => {
                  const cfg = statusConfig[inv.status] || statusConfig.draft;
                  const StatusIcon = cfg.icon;
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm">{inv.invoiceNumber}</TableCell>
                      <TableCell className="text-sm">
                        {inv.periodStart && inv.periodEnd
                          ? `${formatDate(inv.periodStart)} — ${formatDate(inv.periodEnd)}`
                          : formatDate(inv.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">{inv.planName || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={cfg.variant} className="gap-1">
                          <StatusIcon className="h-3 w-3" />
                          {cfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(inv.total)}</TableCell>
                      <TableCell className="text-sm">{formatDate(inv.dueDate)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
