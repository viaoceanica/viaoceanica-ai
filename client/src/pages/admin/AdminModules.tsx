import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import {
  Puzzle, Plus, Pencil, Trash2, UtensilsCrossed, Mail, Receipt, Brain,
  Globe, Package, Copy, Check, ChevronDown, ChevronUp, Server, Monitor,
  FileCode, Database, Settings, CheckCircle2, Circle, ClipboardList,
  Layers, BarChart3, ShieldCheck, Bell, CreditCard, Briefcase,
  FileText, Users, Zap, Wrench, BookOpen, Camera, Music, Map, Calendar,
  MessageSquare, ShoppingCart, Truck, Heart, Star
} from "lucide-react";
import { useState, useMemo, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Icon Registry ──────────────────────────────────────────────────
const iconMap: Record<string, React.ElementType> = {
  UtensilsCrossed, Mail, Receipt, Brain, Globe, Package, Puzzle,
  Layers, BarChart3, ShieldCheck, Bell, CreditCard, Briefcase,
  FileText, Users, Zap, Wrench, BookOpen, Camera, Music, Map, Calendar,
  MessageSquare, ShoppingCart, Truck, Heart, Star, Server, Monitor,
  FileCode, Database, Settings, Copy, Check,
};

const availableIcons = [
  { value: "Puzzle", label: "Puzzle (Genérico)" },
  { value: "UtensilsCrossed", label: "Restauração" },
  { value: "Mail", label: "Email" },
  { value: "Receipt", label: "Faturação/Contabilidade" },
  { value: "Brain", label: "AI/Inteligência" },
  { value: "Globe", label: "Web" },
  { value: "Package", label: "Pacote" },
  { value: "Layers", label: "Camadas" },
  { value: "BarChart3", label: "Gráficos/Analytics" },
  { value: "ShieldCheck", label: "Segurança" },
  { value: "Bell", label: "Notificações" },
  { value: "CreditCard", label: "Pagamentos" },
  { value: "Briefcase", label: "Negócios" },
  { value: "FileText", label: "Documentos" },
  { value: "Users", label: "Utilizadores" },
  { value: "Zap", label: "Automação" },
  { value: "Wrench", label: "Ferramentas" },
  { value: "BookOpen", label: "Formação" },
  { value: "Camera", label: "Média" },
  { value: "Music", label: "Áudio" },
  { value: "Map", label: "Mapas" },
  { value: "Calendar", label: "Calendário" },
  { value: "MessageSquare", label: "Chat/Mensagens" },
  { value: "ShoppingCart", label: "E-commerce" },
  { value: "Truck", label: "Logística" },
  { value: "Heart", label: "Saúde" },
  { value: "Star", label: "Favoritos" },
];

const mountTypes = [
  { value: "iframe", label: "iframe — Frontend separado (Next.js, etc.)" },
  { value: "internal", label: "internal — Dentro do shell SPA (React)" },
  { value: "api_only", label: "api_only — Só backend, sem frontend" },
];

const backendLanguages = [
  { value: "nodejs", label: "Node.js / TypeScript" },
  { value: "python", label: "Python / FastAPI" },
];

const databaseModes = [
  { value: "shared", label: "Partilhada (viaoceanica_platform)" },
  { value: "separate", label: "Separada (viaoceanica_<module_key>)" },
];

const capabilityOptions = [
  { value: "ai", label: "AI (LLM, visão, etc.)" },
  { value: "storage", label: "Armazenamento (S3/R2)" },
  { value: "notifications", label: "Notificações" },
  { value: "email", label: "Email" },
  { value: "payments", label: "Pagamentos" },
  { value: "analytics", label: "Analytics" },
];

// ─── Helpers ────────────────────────────────────────────────────────

/** Convert a Portuguese module name to a kebab-case module_key */
function nameToSlug(name: string): string {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // remove special chars
    .trim()
    .replace(/\s+/g, "-") // spaces to hyphens
    .replace(/-+/g, "-"); // collapse multiple hyphens
}

/** Determine the next available port based on existing modules */
function getNextPort(modules: any[]): number {
  const usedPorts = modules
    .map(m => {
      const match = m.backendUrl?.match(/:(\d+)/);
      return match ? parseInt(match[1]) : null;
    })
    .filter((p): p is number => p !== null);
  // Known reserved ports: 3000 (gateway/shell), 3001 (shell), 4000 (platform-core), 4010 (ai), 4020 (billing)
  const allUsed = new Set([...usedPorts, 3000, 3001, 4000, 4010, 4020]);
  let port = 4001;
  while (allUsed.has(port)) port++;
  return port;
}

// ─── Types ──────────────────────────────────────────────────────────

type ModuleForm = {
  name: string;
  slug: string;
  description: string;
  icon: string;
  mountType: string;
  backendLanguage: string;
  databaseMode: string;
  capabilities: string[];
  backendUrl: string;
  frontendUrl: string;
  status: string;
  port: number;
};

const defaultForm: ModuleForm = {
  name: "",
  slug: "",
  description: "",
  icon: "Puzzle",
  mountType: "iframe",
  backendLanguage: "python",
  databaseMode: "shared",
  capabilities: [],
  backendUrl: "",
  frontendUrl: "",
  status: "active",
  port: 4004,
};

// ─── Clipboard Helper ───────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

// ─── Generated Config Components ────────────────────────────────────

function ManifestPreview({ form }: { form: ModuleForm }) {
  const manifest = JSON.stringify({
    module_key: form.slug,
    name: form.name,
    version: "1.0.0",
    description: form.description,
    route: `/module/${form.slug}`,
    frontend_mount_type: form.mountType,
    backend_service_url: form.backendUrl,
    health_endpoint: "/health",
    readiness_endpoint: "/ready",
    status: form.status,
    icon: form.icon,
    capabilities: form.capabilities,
    min_plan: null,
    tenant_restricted: false,
  }, null, 2);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">module-manifest.json</Label>
        <CopyButton text={manifest} />
      </div>
      <pre className="bg-muted/50 rounded-lg p-3 text-xs overflow-x-auto max-h-60 overflow-y-auto font-mono">{manifest}</pre>
    </div>
  );
}

function DockerComposePreview({ form }: { form: ModuleForm }) {
  const keyUpper = form.slug.toUpperCase().replace(/-/g, "_");
  const dbUrl = form.databaseMode === "separate"
    ? `postgresql://viaoceanica:\${POSTGRES_PASSWORD:-viao_db_2024_secure}@postgres:5432/viaoceanica_${form.slug.replace(/-/g, "_")}`
    : `postgresql://viaoceanica:\${POSTGRES_PASSWORD:-viao_db_2024_secure}@postgres:5432/viaoceanica_platform`;

  let yaml = `  # ─── Module: ${form.name} ──────────────────────────────────────
  mod-${form.slug}:
    build:
      context: ./modules/${form.slug}
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      <<: *common-env
      MOD_${keyUpper}_PORT: "${form.port}"
      DATABASE_URL: ${dbUrl}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:${form.port}/health"]
      interval: 15s
      timeout: 5s
      retries: 3`;

  if (form.mountType === "iframe") {
    yaml += `

  # ─── Module: ${form.name} (Frontend) ──────────────────────────
  ${form.slug}-frontend:
    build:
      context: ./modules/${form.slug}/frontend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      SERVER_API_BASE_URL: http://mod-${form.slug}:${form.port}
    depends_on:
      - mod-${form.slug}
    deploy:
      resources:
        limits:
          cpus: "0.25"
          memory: 128M
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1:3000/module/${form.slug}"]
      interval: 15s
      timeout: 5s
      retries: 3`;
  }

  // Gateway env var
  yaml += `

  # ─── Add to gateway service environment: ──────────────────────
  # MOD_${keyUpper}_URL: http://mod-${form.slug}:${form.port}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">docker-compose.yml</Label>
        <CopyButton text={yaml} />
      </div>
      <pre className="bg-muted/50 rounded-lg p-3 text-xs overflow-x-auto max-h-60 overflow-y-auto font-mono">{yaml}</pre>
    </div>
  );
}

function NginxPreview({ form }: { form: ModuleForm }) {
  if (form.mountType !== "iframe") {
    return (
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">nginx.conf</Label>
        <p className="text-xs text-muted-foreground italic">Módulos com montagem &quot;{form.mountType}&quot; não necessitam de configuração nginx adicional.</p>
      </div>
    );
  }

  const slugUnder = form.slug.replace(/-/g, "_");
  const nginx = `    # Upstream for ${form.name}
    upstream ${slugUnder}_frontend {
        server ${form.slug}-frontend:3000;
    }

    # ... add inside server block, BEFORE the catch-all location / ...

        # Module: ${form.name} frontend (iframe)
        location /module/${form.slug} {
            proxy_pass http://${slugUnder}_frontend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">nginx.conf</Label>
        <CopyButton text={nginx} />
      </div>
      <pre className="bg-muted/50 rounded-lg p-3 text-xs overflow-x-auto max-h-60 overflow-y-auto font-mono">{nginx}</pre>
    </div>
  );
}

function RegistrySQL({ form }: { form: ModuleForm }) {
  const sql = `INSERT INTO module_registry (module_key, name, description, version, route, frontend_mount_type, backend_service_url, health_endpoint, readiness_endpoint, icon, status, capabilities, tenant_restricted)
VALUES
  ('${form.slug}', '${form.name}', '${form.description || ""}', '1.0.0', '/module/${form.slug}', '${form.mountType}', '${form.backendUrl}', '/health', '/ready', '${form.icon}', '${form.status}', '${JSON.stringify(form.capabilities)}', false)
ON CONFLICT (module_key) DO NOTHING;`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">deploy/init-db.sql (Registo no módulo registry)</Label>
        <CopyButton text={sql} />
      </div>
      <pre className="bg-muted/50 rounded-lg p-3 text-xs overflow-x-auto max-h-60 overflow-y-auto font-mono">{sql}</pre>
    </div>
  );
}

function ShellIntegrationPreview({ form }: { form: ModuleForm }) {
  let code = `// ─── ModulePage.tsx ─────────────────────────────────────────────
// Add to imports:
import { ${form.icon} } from "lucide-react";

// Add to iconMap:
const iconMap = {
  // ... existing entries ...
  "${form.slug}": ${form.icon},
};

// Add to nameMap:
const nameMap = {
  // ... existing entries ...
  "${form.slug}": "${form.name}",
};`;

  if (form.mountType === "iframe") {
    code += `

// Add to iframeModules:
const iframeModules = {
  // ... existing entries ...
  "${form.slug}": "/module/${form.slug}/",
};`;
  }

  code += `

// ─── DashboardLayout.tsx ────────────────────────────────────────
// Add to imports:
import { ${form.icon} } from "lucide-react";

// Add to moduleIconMap:
const moduleIconMap = {
  // ... existing entries ...
  ${form.icon},
};`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">Shell Frontend (ModulePage.tsx + DashboardLayout.tsx)</Label>
        <CopyButton text={code} />
      </div>
      <pre className="bg-muted/50 rounded-lg p-3 text-xs overflow-x-auto max-h-60 overflow-y-auto font-mono">{code}</pre>
    </div>
  );
}

// ─── Integration Checklist ──────────────────────────────────────────

function IntegrationChecklist({ form }: { form: ModuleForm }) {
  const isIframe = form.mountType === "iframe";
  const isSeparateDb = form.databaseMode === "separate";

  const sections = [
    {
      title: "Código do Módulo",
      items: [
        { text: `Criar diretório modules/${form.slug}/`, always: true },
        { text: "Criar module-manifest.json", always: true },
        { text: "Implementar backend com /health, /ready, e /api/v1/*", always: true },
        { text: "Implementar middleware x-viao-* headers", always: true },
        { text: "Seguir formato de resposta: { success, data/error }", always: true },
        { text: "Criar Dockerfile para backend", always: true },
        { text: "Criar frontend com basePath, rewrites, e postMessage listener", always: false, condition: isIframe },
        { text: "Criar Dockerfile para frontend", always: false, condition: isIframe },
      ],
    },
    {
      title: "Base de Dados",
      items: [
        { text: `Criar init script deploy/init-${form.slug.replace(/-/g, "-")}-db.sh`, always: false, condition: isSeparateDb },
        { text: "Montar init script nos volumes do postgres", always: false, condition: isSeparateDb },
        { text: "Criar tabelas/migrações da base de dados", always: true },
      ],
    },
    {
      title: "Docker Compose",
      items: [
        { text: `Adicionar serviço mod-${form.slug} com porta ${form.port}`, always: true },
        { text: `Adicionar serviço ${form.slug}-frontend`, always: false, condition: isIframe },
        { text: `Adicionar MOD_${form.slug.toUpperCase().replace(/-/g, "_")}_URL ao gateway`, always: true },
        { text: `Adicionar DATABASE_URL com base de dados viaoceanica_${form.slug.replace(/-/g, "_")}`, always: false, condition: isSeparateDb },
      ],
    },
    {
      title: "Nginx",
      items: [
        { text: `Adicionar upstream ${form.slug.replace(/-/g, "_")}_frontend`, always: false, condition: isIframe },
        { text: `Adicionar location /module/${form.slug} ANTES do catch-all`, always: false, condition: isIframe },
      ],
    },
    {
      title: "Shell Frontend",
      items: [
        { text: `Importar ${form.icon} em ModulePage.tsx`, always: true },
        { text: `Adicionar "${form.slug}" ao iconMap em ModulePage.tsx`, always: true },
        { text: `Adicionar "${form.slug}" ao nameMap em ModulePage.tsx`, always: true },
        { text: `Adicionar "${form.slug}" ao iframeModules em ModulePage.tsx`, always: false, condition: isIframe },
        { text: `Importar ${form.icon} em DashboardLayout.tsx`, always: true },
        { text: `Adicionar ${form.icon} ao moduleIconMap em DashboardLayout.tsx`, always: true },
      ],
    },
    {
      title: "Registo & Deploy",
      items: [
        { text: "Adicionar INSERT ao deploy/init-db.sql (ou registar via API)", always: true },
        { text: "Ativar módulo para tenant(s) alvo", always: true },
        { text: `docker compose build mod-${form.slug}`, always: true },
        { text: `docker compose build ${form.slug}-frontend`, always: false, condition: isIframe },
        { text: "docker compose up -d", always: true },
        { text: "Verificar /health endpoint", always: true },
        { text: "Verificar módulo aparece no sidebar", always: true },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {sections.map((section) => {
        const visibleItems = section.items.filter(i => i.always || i.condition);
        if (visibleItems.length === 0) return null;
        return (
          <div key={section.title}>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{section.title}</h4>
            <div className="space-y-1.5">
              {visibleItems.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <Circle className="h-3 w-3 mt-0.5 text-muted-foreground/50 shrink-0" />
                  <span className="text-foreground/80">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export default function AdminModules() {
  const utils = trpc.useUtils();
  const { data: modules, isLoading } = trpc.admin.allModules.useQuery();

  const createMut = trpc.admin.createModule.useMutation({
    onSuccess: () => { utils.admin.allModules.invalidate(); toast.success("Módulo criado com sucesso"); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.admin.updateModule.useMutation({
    onSuccess: () => { utils.admin.allModules.invalidate(); toast.success("Módulo atualizado"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.admin.deleteModule.useMutation({
    onSuccess: () => { utils.admin.allModules.invalidate(); toast.success("Módulo eliminado"); },
    onError: (e) => toast.error(e.message),
  });

  const [formDialog, setFormDialog] = useState<{ open: boolean; editId: number | null }>({ open: false, editId: null });
  const [form, setForm] = useState<ModuleForm>(defaultForm);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; moduleId: number; moduleName: string }>({ open: false, moduleId: 0, moduleName: "" });
  const [detailDialog, setDetailDialog] = useState<{ open: boolean; module: any | null }>({ open: false, module: null });
  const [configExpanded, setConfigExpanded] = useState(false);

  const nextPort = useMemo(() => getNextPort(modules || []), [modules]);

  // Auto-generate slug and URLs when name changes (only for new modules)
  const updateFromName = useCallback((name: string) => {
    if (formDialog.editId) {
      setForm(p => ({ ...p, name }));
      return;
    }
    const slug = nameToSlug(name);
    const port = nextPort;
    setForm(p => ({
      ...p,
      name,
      slug,
      port,
      backendUrl: slug ? `http://mod-${slug}:${port}` : "",
      frontendUrl: p.mountType === "iframe" && slug ? `http://${slug}-frontend:3000` : "",
    }));
  }, [formDialog.editId, nextPort]);

  // Update frontend URL when mount type changes
  const updateMountType = useCallback((mountType: string) => {
    setForm(p => ({
      ...p,
      mountType,
      frontendUrl: mountType === "iframe" && p.slug ? `http://${p.slug}-frontend:3000` : "",
    }));
  }, []);

  const openCreate = () => {
    setForm({ ...defaultForm, port: nextPort });
    setConfigExpanded(false);
    setFormDialog({ open: true, editId: null });
  };

  const openEdit = (mod: any) => {
    const portMatch = mod.backendUrl?.match(/:(\d+)/);
    setForm({
      name: mod.name || "",
      slug: mod.slug || "",
      description: mod.description || "",
      icon: mod.icon || "Puzzle",
      mountType: mod.mountType || "iframe",
      backendLanguage: "python",
      databaseMode: "shared",
      capabilities: [],
      backendUrl: mod.backendUrl || "",
      frontendUrl: mod.frontendUrl || "",
      status: mod.status || "active",
      port: portMatch ? parseInt(portMatch[1]) : nextPort,
    });
    setConfigExpanded(false);
    setFormDialog({ open: true, editId: mod.id });
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Nome é obrigatório"); return; }
    if (!form.slug.trim()) { toast.error("Slug é obrigatório"); return; }

    const payload = {
      slug: form.slug,
      name: form.name,
      description: form.description,
      icon: form.icon,
      mountType: form.mountType,
      backendUrl: form.backendUrl,
      frontendUrl: form.frontendUrl,
      status: form.status,
    };

    if (formDialog.editId) {
      await updateMut.mutateAsync({ id: formDialog.editId, ...payload });
    } else {
      await createMut.mutateAsync(payload);
    }
    setFormDialog({ open: false, editId: null });
  };

  const openDetail = (mod: any) => {
    const portMatch = mod.backendUrl?.match(/:(\d+)/);
    setDetailDialog({
      open: true,
      module: {
        ...mod,
        port: portMatch ? parseInt(portMatch[1]) : 4004,
        backendLanguage: "python",
        databaseMode: "shared",
        capabilities: [],
      },
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Módulos</h1>
          <p className="text-muted-foreground mt-1">Gerir módulos da plataforma — criar, editar, e ver configuração de integração</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Novo Módulo
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-44 w-full rounded-xl" />)}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {modules?.map((mod: any) => {
            const Icon = iconMap[mod.icon || ""] || Puzzle;
            return (
              <Card key={mod.id} className="border-border/50 hover:border-border transition-colors">
                <CardHeader className="flex flex-row items-start gap-3 pb-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{mod.name}</CardTitle>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Ver configuração" onClick={() => openDetail(mod)}>
                          <ClipboardList className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(mod)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteDialog({ open: true, moduleId: mod.id, moduleName: mod.name })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <CardDescription className="mt-1">{mod.description || "Sem descrição"}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={mod.status === "active" ? "default" : "secondary"} className="text-xs">
                      {mod.status === "active" ? "Ativo" : mod.status === "maintenance" ? "Manutenção" : "Inativo"}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-mono">{mod.slug}</Badge>
                    <Badge variant="outline" className="text-xs">{mod.mountType || "iframe"}</Badge>
                  </div>
                  {(mod.backendUrl || mod.frontendUrl) && (
                    <div className="mt-3 space-y-1">
                      {mod.backendUrl && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Server className="h-3 w-3 shrink-0" />
                          <span className="font-mono truncate">{mod.backendUrl}</span>
                        </div>
                      )}
                      {mod.frontendUrl && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Monitor className="h-3 w-3 shrink-0" />
                          <span className="font-mono truncate">{mod.frontendUrl}</span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {(!modules || modules.length === 0) && (
            <div className="col-span-2 text-center py-16 text-muted-foreground">
              <Puzzle className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">Nenhum módulo registado</p>
              <p className="text-sm mt-1">Crie o primeiro módulo para começar</p>
              <Button variant="outline" className="mt-6" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" /> Criar primeiro módulo
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ─── Create / Edit Dialog ──────────────────────────────────── */}
      <Dialog open={formDialog.open} onOpenChange={(open) => setFormDialog(p => ({ ...p, open }))}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {formDialog.editId ? "Editar Módulo" : "Novo Módulo"}
            </DialogTitle>
            <DialogDescription>
              {formDialog.editId
                ? "Atualizar as definições do módulo"
                : "O nome do módulo gera automaticamente o module_key, URLs, e toda a configuração de integração conforme a especificação da plataforma."}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="config" className="mt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="config">Configuração</TabsTrigger>
              <TabsTrigger value="integration">Integração</TabsTrigger>
            </TabsList>

            {/* ─── Config Tab ──────────────────────────────────────── */}
            <TabsContent value="config" className="space-y-5 mt-4">
              {/* Name → auto-generates slug */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Nome do Módulo *</Label>
                <Input
                  placeholder="Ex: Contabilidade, Gestão de Projetos, CRM..."
                  value={form.name}
                  onChange={(e) => updateFromName(e.target.value)}
                  className="text-base"
                />
                {form.slug && !formDialog.editId && (
                  <p className="text-xs text-muted-foreground">
                    module_key: <span className="font-mono font-medium text-foreground">{form.slug}</span>
                  </p>
                )}
              </div>

              {/* Slug (editable but auto-filled) */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm">Slug / module_key *</Label>
                  <Input
                    placeholder="contabilidade"
                    value={form.slug}
                    onChange={(e) => setForm(p => ({ ...p, slug: e.target.value }))}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">Kebab-case, sem acentos. Usado em URLs e Docker.</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Porta do Backend</Label>
                  <Input
                    type="number"
                    value={form.port}
                    onChange={(e) => {
                      const port = parseInt(e.target.value) || 4004;
                      setForm(p => ({
                        ...p,
                        port,
                        backendUrl: p.slug ? `http://mod-${p.slug}:${port}` : p.backendUrl,
                      }));
                    }}
                  />
                  <p className="text-xs text-muted-foreground">Próxima porta disponível: {nextPort}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Descrição</Label>
                <Textarea
                  placeholder="Descrição do módulo em português..."
                  value={form.description}
                  onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm">Ícone</Label>
                  <Select value={form.icon} onValueChange={(v) => setForm(p => ({ ...p, icon: v }))}>
                    <SelectTrigger>
                      <div className="flex items-center gap-2">
                        {(() => { const I = iconMap[form.icon] || Puzzle; return <I className="h-4 w-4" />; })()}
                        <SelectValue />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {availableIcons.map(i => {
                        const I = iconMap[i.value] || Puzzle;
                        return (
                          <SelectItem key={i.value} value={i.value}>
                            <div className="flex items-center gap-2">
                              <I className="h-4 w-4" />
                              <span>{i.label}</span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Tipo de Montagem</Label>
                  <Select value={form.mountType} onValueChange={updateMountType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {mountTypes.map(m => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm">Linguagem Backend</Label>
                  <Select value={form.backendLanguage} onValueChange={(v) => setForm(p => ({ ...p, backendLanguage: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {backendLanguages.map(l => (
                        <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Base de Dados</Label>
                  <Select value={form.databaseMode} onValueChange={(v) => setForm(p => ({ ...p, databaseMode: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {databaseModes.map(d => (
                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Capabilities */}
              <div className="space-y-2">
                <Label className="text-sm">Capacidades</Label>
                <div className="flex flex-wrap gap-2">
                  {capabilityOptions.map(cap => (
                    <Button
                      key={cap.value}
                      type="button"
                      variant={form.capabilities.includes(cap.value) ? "default" : "outline"}
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setForm(p => ({
                          ...p,
                          capabilities: p.capabilities.includes(cap.value)
                            ? p.capabilities.filter(c => c !== cap.value)
                            : [...p.capabilities, cap.value],
                        }));
                      }}
                    >
                      {cap.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Generated URLs (read-only preview) */}
              <div className="space-y-3 rounded-lg border border-border/50 p-4 bg-muted/20">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">URLs Geradas</h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Label className="text-xs w-20 shrink-0">Backend:</Label>
                    <Input value={form.backendUrl} onChange={(e) => setForm(p => ({ ...p, backendUrl: e.target.value }))} className="font-mono text-xs h-8" />
                  </div>
                  {form.mountType === "iframe" && (
                    <div className="flex items-center gap-2">
                      <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <Label className="text-xs w-20 shrink-0">Frontend:</Label>
                      <Input value={form.frontendUrl} onChange={(e) => setForm(p => ({ ...p, frontendUrl: e.target.value }))} className="font-mono text-xs h-8" />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Label className="text-xs w-20 shrink-0">Rota:</Label>
                    <span className="font-mono text-xs text-foreground/80">/module/{form.slug}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Estado</Label>
                <Select value={form.status} onValueChange={(v) => setForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="maintenance">Manutenção</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            {/* ─── Integration Tab ─────────────────────────────────── */}
            <TabsContent value="integration" className="space-y-5 mt-4">
              {!form.slug ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileCode className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>Preencha o nome do módulo para ver a configuração de integração</p>
                </div>
              ) : (
                <>
                  <ManifestPreview form={form} />
                  <DockerComposePreview form={form} />
                  <NginxPreview form={form} />
                  <RegistrySQL form={form} />
                  <ShellIntegrationPreview form={form} />

                  <div className="rounded-lg border border-border/50 p-4">
                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      Checklist de Integração
                    </h4>
                    <IntegrationChecklist form={form} />
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setFormDialog(p => ({ ...p, open: false }))}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {createMut.isPending || updateMut.isPending ? "A guardar..." : formDialog.editId ? "Guardar" : "Criar Módulo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Detail / Config View Dialog ───────────────────────────── */}
      <Dialog open={detailDialog.open} onOpenChange={(open) => setDetailDialog(p => ({ ...p, open }))}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              {(() => { const I = iconMap[detailDialog.module?.icon || ""] || Puzzle; return <I className="h-5 w-5" />; })()}
              {detailDialog.module?.name} — Configuração
            </DialogTitle>
            <DialogDescription>
              Configuração gerada e checklist de integração para este módulo
            </DialogDescription>
          </DialogHeader>
          {detailDialog.module && (
            <div className="space-y-5 mt-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="font-mono">{detailDialog.module.slug}</Badge>
                <Badge>{detailDialog.module.mountType}</Badge>
                <Badge variant={detailDialog.module.status === "active" ? "default" : "secondary"}>
                  {detailDialog.module.status}
                </Badge>
              </div>
              <ManifestPreview form={detailDialog.module} />
              <DockerComposePreview form={detailDialog.module} />
              <NginxPreview form={detailDialog.module} />
              <RegistrySQL form={detailDialog.module} />
              <ShellIntegrationPreview form={detailDialog.module} />
              <div className="rounded-lg border border-border/50 p-4">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Checklist de Integração
                </h4>
                <IntegrationChecklist form={detailDialog.module} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialog(p => ({ ...p, open: false }))}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirmation ───────────────────────────────────── */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog(p => ({ ...p, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar módulo</DialogTitle>
            <DialogDescription>
              Tem a certeza que deseja eliminar <strong>{deleteDialog.moduleName}</strong>? Esta ação remove o módulo do registo da plataforma. Os ficheiros no VPS não são afetados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(p => ({ ...p, open: false }))}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await deleteMut.mutateAsync({ id: deleteDialog.moduleId });
                setDeleteDialog(p => ({ ...p, open: false }));
              }}
              disabled={deleteMut.isPending}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
