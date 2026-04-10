/**
 * Module Scaffold ZIP Generator
 *
 * Generates a complete scaffold ZIP for a new module based on the
 * module configuration (slug, name, mountType, backendLanguage, etc.)
 */
import archiver from "archiver";
import { PassThrough } from "stream";

export type ScaffoldConfig = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  mountType: string; // "iframe" | "internal" | "api_only"
  backendLanguage: string; // "python" | "nodejs"
  databaseMode: string; // "shared" | "separate"
  capabilities: string[];
  port: number;
};

function slugToUnderscore(slug: string): string {
  return slug.replace(/-/g, "_");
}

function slugToUpperEnv(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_");
}

// ─── Python Backend Templates ─────────────────────────────────────

function pythonMain(cfg: ScaffoldConfig): string {
  return `"""
${cfg.name} — Backend Service
Via Oceânica AI Platform Module
"""
from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("${cfg.slug}")

PORT = int(os.getenv("MOD_${slugToUpperEnv(cfg.slug)}_PORT", "${cfg.port}"))
DATABASE_URL = os.getenv("DATABASE_URL", "")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"[${cfg.slug}] Starting on port {PORT}")
    # Startup: connect DB, init resources
    yield
    # Shutdown: cleanup
    logger.info(f"[${cfg.slug}] Shutting down")

app = FastAPI(
    title="${cfg.name}",
    description="${cfg.description || ""}",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Platform Headers Middleware ────────────────────────────────────
@app.middleware("http")
async def extract_platform_headers(request: Request, call_next):
    """Extract x-viao-* headers injected by the gateway."""
    request.state.tenant_id = request.headers.get("x-viao-tenant-id")
    request.state.user_id = request.headers.get("x-viao-user-id")
    request.state.user_role = request.headers.get("x-viao-user-role")
    request.state.module_key = request.headers.get("x-viao-module-key")
    response = await call_next(request)
    return response

# ─── Health Endpoints ───────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "${cfg.slug}", "version": "1.0.0"}

@app.get("/ready")
async def ready():
    # TODO: Check database connectivity
    return {"status": "ready", "dependencies": {"database": "ok"}}

# ─── API Routes ─────────────────────────────────────────────────────
@app.get("/api/v1/status")
async def status(request: Request):
    return {
        "success": True,
        "data": {
            "module": "${cfg.slug}",
            "tenant_id": request.state.tenant_id,
            "message": "${cfg.name} está operacional"
        }
    }

# TODO: Add your module-specific routes here
# Example:
# @app.get("/api/v1/items")
# async def list_items(request: Request):
#     tenant_id = request.state.tenant_id
#     return {"success": True, "data": []}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
`;
}

function pythonRequirements(cfg: ScaffoldConfig): string {
  const deps = [
    "fastapi>=0.104.0",
    "uvicorn[standard]>=0.24.0",
    "python-dotenv>=1.0.0",
  ];
  if (cfg.capabilities.includes("ai")) deps.push("openai>=1.3.0", "httpx>=0.25.0");
  if (cfg.capabilities.includes("storage")) deps.push("boto3>=1.29.0");
  if (cfg.capabilities.includes("email")) deps.push("aiosmtplib>=2.0.0");
  // Database
  deps.push("asyncpg>=0.29.0", "sqlalchemy[asyncio]>=2.0.0");
  return deps.join("\n") + "\n";
}

function pythonDockerfile(cfg: ScaffoldConfig): string {
  return `FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE ${cfg.port}

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${cfg.port}"]
`;
}

// ─── Node.js Backend Templates ────────────────────────────────────

function nodejsMain(cfg: ScaffoldConfig): string {
  return `/**
 * ${cfg.name} — Backend Service
 * Via Oceânica AI Platform Module
 */
import express from "express";
import cors from "cors";

const PORT = parseInt(process.env.MOD_${slugToUpperEnv(cfg.slug)}_PORT || "${cfg.port}");
const DATABASE_URL = process.env.DATABASE_URL || "";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Platform Headers Middleware ────────────────────────────────────
app.use((req, _res, next) => {
  (req as any).tenantId = req.headers["x-viao-tenant-id"];
  (req as any).userId = req.headers["x-viao-user-id"];
  (req as any).userRole = req.headers["x-viao-user-role"];
  (req as any).moduleKey = req.headers["x-viao-module-key"];
  next();
});

// ─── Health Endpoints ───────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "${cfg.slug}", version: "1.0.0" });
});

app.get("/ready", (_req, res) => {
  // TODO: Check database connectivity
  res.json({ status: "ready", dependencies: { database: "ok" } });
});

// ─── API Routes ─────────────────────────────────────────────────────
app.get("/api/v1/status", (req, res) => {
  res.json({
    success: true,
    data: {
      module: "${cfg.slug}",
      tenant_id: (req as any).tenantId,
      message: "${cfg.name} está operacional"
    }
  });
});

// TODO: Add your module-specific routes here

app.listen(PORT, () => {
  console.log(\`[${cfg.slug}] Running on http://localhost:\${PORT}\`);
});
`;
}

function nodejsPackageJson(cfg: ScaffoldConfig): string {
  const deps: Record<string, string> = {
    express: "^4.18.2",
    cors: "^2.8.5",
    tsx: "^4.7.0",
  };
  if (cfg.capabilities.includes("ai")) deps["openai"] = "^4.20.0";
  if (cfg.capabilities.includes("storage")) deps["@aws-sdk/client-s3"] = "^3.450.0";

  return JSON.stringify({
    name: `mod-${cfg.slug}`,
    version: "1.0.0",
    description: cfg.description || cfg.name,
    type: "module",
    scripts: {
      dev: `tsx watch src/index.ts`,
      start: `tsx src/index.ts`,
    },
    dependencies: deps,
  }, null, 2) + "\n";
}

function nodejsDockerfile(cfg: ScaffoldConfig): string {
  return `FROM node:20-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile || npm install

COPY . .

EXPOSE ${cfg.port}

CMD ["npm", "start"]
`;
}

// ─── Frontend Templates (for iframe mount) ────────────────────────

function frontendNextConfig(cfg: ScaffoldConfig): string {
  return `/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/module/${cfg.slug}",
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: \`\${process.env.SERVER_API_BASE_URL || "http://mod-${cfg.slug}:${cfg.port}"}/api/:path*\`,
      },
    ];
  },
};

module.exports = nextConfig;
`;
}

function frontendPackageJson(cfg: ScaffoldConfig): string {
  return JSON.stringify({
    name: `${cfg.slug}-frontend`,
    version: "1.0.0",
    private: true,
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start -p 3000",
    },
    dependencies: {
      next: "^14.0.0",
      react: "^18.2.0",
      "react-dom": "^18.2.0",
    },
    devDependencies: {
      typescript: "^5.3.0",
      "@types/react": "^18.2.0",
      "@types/node": "^20.10.0",
    },
  }, null, 2) + "\n";
}

function frontendPage(cfg: ScaffoldConfig): string {
  return `"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    fetch("/module/${cfg.slug}/api/v1/status")
      .then(r => r.json())
      .then(setStatus)
      .catch(console.error);
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>${cfg.name}</h1>
      <p>${cfg.description || "Módulo da plataforma Via Oceânica"}</p>
      {status && (
        <pre style={{ background: "#f4f4f4", padding: "1rem", borderRadius: "8px" }}>
          {JSON.stringify(status, null, 2)}
        </pre>
      )}
    </main>
  );
}
`;
}

function frontendLayout(cfg: ScaffoldConfig): string {
  return `export const metadata = {
  title: "${cfg.name}",
  description: "${cfg.description || ""}",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}
`;
}

function frontendDockerfile(cfg: ScaffoldConfig): string {
  return `FROM node:20-slim AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile || npm install
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
`;
}

// ─── Manifest ─────────────────────────────────────────────────────

function moduleManifest(cfg: ScaffoldConfig): string {
  return JSON.stringify({
    module_key: cfg.slug,
    name: cfg.name,
    version: "1.0.0",
    description: cfg.description || "",
    route: `/module/${cfg.slug}`,
    frontend_mount_type: cfg.mountType,
    backend_service_url: `http://mod-${cfg.slug}:${cfg.port}`,
    health_endpoint: "/health",
    readiness_endpoint: "/ready",
    status: "active",
    icon: cfg.icon,
    capabilities: cfg.capabilities,
    min_plan: null,
    tenant_restricted: false,
  }, null, 2) + "\n";
}

// ─── README ───────────────────────────────────────────────────────

function readmeContent(cfg: ScaffoldConfig): string {
  const keyUpper = slugToUpperEnv(cfg.slug);
  return `# ${cfg.name}

${cfg.description || "Módulo da plataforma Via Oceânica AI."}

## Estrutura

\`\`\`
modules/${cfg.slug}/
├── module-manifest.json    # Manifesto do módulo
├── Dockerfile              # Build do backend
├── ${cfg.backendLanguage === "python" ? "main.py" : "src/index.ts"}
├── ${cfg.backendLanguage === "python" ? "requirements.txt" : "package.json"}
${cfg.mountType === "iframe" ? `├── frontend/\n│   ├── Dockerfile\n│   ├── next.config.js\n│   ├── package.json\n│   └── app/\n│       ├── page.tsx\n│       └── layout.tsx` : ""}
└── README.md
\`\`\`

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| \`MOD_${keyUpper}_PORT\` | Porta do backend (default: ${cfg.port}) |
| \`DATABASE_URL\` | Connection string da base de dados |

## Desenvolvimento Local

\`\`\`bash
# Backend
cd modules/${cfg.slug}
${cfg.backendLanguage === "python" ? "pip install -r requirements.txt\nuvicorn main:app --reload --port " + cfg.port : "npm install\nnpm run dev"}
${cfg.mountType === "iframe" ? `\n# Frontend\ncd frontend\nnpm install\nnpm run dev` : ""}
\`\`\`

## Docker

\`\`\`bash
docker compose build mod-${cfg.slug}
${cfg.mountType === "iframe" ? `docker compose build ${cfg.slug}-frontend` : ""}
docker compose up -d
\`\`\`

## Endpoints

- \`GET /health\` — Health check
- \`GET /ready\` — Readiness check
- \`GET /api/v1/status\` — Status do módulo

## Headers da Plataforma

O gateway injeta os seguintes headers em cada request:

| Header | Descrição |
|--------|-----------|
| \`x-viao-tenant-id\` | ID da empresa/tenant |
| \`x-viao-user-id\` | ID do utilizador |
| \`x-viao-user-role\` | Papel do utilizador |
| \`x-viao-module-key\` | Chave do módulo |
`;
}

// ─── Docker Compose Snippet ───────────────────────────────────────

function dockerComposeSnippet(cfg: ScaffoldConfig): string {
  const keyUpper = slugToUpperEnv(cfg.slug);
  const slugUnder = slugToUnderscore(cfg.slug);
  const dbUrl = cfg.databaseMode === "separate"
    ? `postgresql://viaoceanica:\${POSTGRES_PASSWORD:-viao_db_2024_secure}@postgres:5432/viaoceanica_${slugUnder}`
    : `postgresql://viaoceanica:\${POSTGRES_PASSWORD:-viao_db_2024_secure}@postgres:5432/viaoceanica_platform`;

  let yaml = `# ─── Add to docker-compose.yml ──────────────────────────────────

  mod-${cfg.slug}:
    build:
      context: ./modules/${cfg.slug}
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      <<: *common-env
      MOD_${keyUpper}_PORT: "${cfg.port}"
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
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:${cfg.port}/health"]
      interval: 15s
      timeout: 5s
      retries: 3`;

  if (cfg.mountType === "iframe") {
    yaml += `

  ${cfg.slug}-frontend:
    build:
      context: ./modules/${cfg.slug}/frontend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      SERVER_API_BASE_URL: http://mod-${cfg.slug}:${cfg.port}
    depends_on:
      - mod-${cfg.slug}
    deploy:
      resources:
        limits:
          cpus: "0.25"
          memory: 128M`;
  }

  yaml += `

# ─── Add to gateway environment: ──────────────────────────────────
# MOD_${keyUpper}_URL: http://mod-${cfg.slug}:${cfg.port}
`;

  return yaml;
}

// ─── Nginx Snippet ────────────────────────────────────────────────

function nginxSnippet(cfg: ScaffoldConfig): string {
  if (cfg.mountType !== "iframe") {
    return `# Módulos com montagem "${cfg.mountType}" não necessitam de configuração nginx adicional.\n`;
  }
  const slugUnder = slugToUnderscore(cfg.slug);
  return `# ─── Add to nginx.conf ──────────────────────────────────────────

upstream ${slugUnder}_frontend {
    server ${cfg.slug}-frontend:3000;
}

# Add inside server block, BEFORE the catch-all location /

location /module/${cfg.slug} {
    proxy_pass http://${slugUnder}_frontend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
`;
}

// ─── Main Generator ───────────────────────────────────────────────

export async function generateScaffoldZip(cfg: ScaffoldConfig): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const buffers: Buffer[] = [];
    const passthrough = new PassThrough();

    passthrough.on("data", (chunk: Buffer) => buffers.push(chunk));
    passthrough.on("end", () => resolve(Buffer.concat(buffers)));
    passthrough.on("error", reject);
    archive.on("error", reject);

    archive.pipe(passthrough);

    const base = `modules/${cfg.slug}`;

    // Module manifest
    archive.append(moduleManifest(cfg), { name: `${base}/module-manifest.json` });

    // README
    archive.append(readmeContent(cfg), { name: `${base}/README.md` });

    // Backend
    if (cfg.backendLanguage === "python") {
      archive.append(pythonMain(cfg), { name: `${base}/main.py` });
      archive.append(pythonRequirements(cfg), { name: `${base}/requirements.txt` });
      archive.append(pythonDockerfile(cfg), { name: `${base}/Dockerfile` });
    } else {
      archive.append(nodejsMain(cfg), { name: `${base}/src/index.ts` });
      archive.append(nodejsPackageJson(cfg), { name: `${base}/package.json` });
      archive.append(`{}`, { name: `${base}/tsconfig.json` });
      archive.append(nodejsDockerfile(cfg), { name: `${base}/Dockerfile` });
    }

    // Frontend (only for iframe mount)
    if (cfg.mountType === "iframe") {
      archive.append(frontendNextConfig(cfg), { name: `${base}/frontend/next.config.js` });
      archive.append(frontendPackageJson(cfg), { name: `${base}/frontend/package.json` });
      archive.append(frontendPage(cfg), { name: `${base}/frontend/app/page.tsx` });
      archive.append(frontendLayout(cfg), { name: `${base}/frontend/app/layout.tsx` });
      archive.append(frontendDockerfile(cfg), { name: `${base}/frontend/Dockerfile` });
    }

    // Docker compose snippet
    archive.append(dockerComposeSnippet(cfg), { name: `${base}/deploy/docker-compose-snippet.yml` });

    // Nginx snippet
    archive.append(nginxSnippet(cfg), { name: `${base}/deploy/nginx-snippet.conf` });

    // .env example
    const envExample = `MOD_${slugToUpperEnv(cfg.slug)}_PORT=${cfg.port}\nDATABASE_URL=postgresql://viaoceanica:password@localhost:5432/viaoceanica_platform\n`;
    archive.append(envExample, { name: `${base}/.env.example` });

    archive.finalize();
  });
}
