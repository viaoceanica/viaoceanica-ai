# Via Oceânica AI Platform — Deployment Runbook

**Version:** 1.0  
**Last Updated:** 2026-04-09  
**Authors:** Via Oceânica AI Team

---

## 1. Infrastructure Overview

The platform runs on a single VPS (77.42.95.216) with Docker Compose orchestrating 13 containers. All services communicate over a Docker bridge network.

| Resource | Specification |
|----------|--------------|
| VPS Provider | Contabo |
| OS | Ubuntu 22.04 LTS |
| CPU | 4 vCPU |
| RAM | 8 GB |
| Storage | 200 GB SSD |
| Docker | Docker Compose v2 |
| External Port | 8200 (HTTP via nginx) |
| Database Port | 5434 (PostgreSQL, external access) |

---

## 2. Service Inventory

| Service | Container Name | Internal Port | Health Check | Resource Limits |
|---------|---------------|---------------|-------------|-----------------|
| PostgreSQL | postgres-1 | 5432 | pg_isready | 1 CPU / 512M |
| Redis | redis-1 | 6379 | redis-cli ping | 0.5 CPU / 256M |
| Platform Core | platform-core-1 | 4000 | /health | 0.5 CPU / 256M |
| Gateway | gateway-1 | 3000 | /health | 0.5 CPU / 256M |
| AI Service | ai-service-1 | 4010 | /health | 1 CPU / 512M |
| Billing | billing-1 | 4020 | /health | 0.25 CPU / 128M |
| Shell (Frontend) | shell-1 | 3001 | wget / | 0.25 CPU / 64M |
| Qdrant | qdrant-1 | 6333 | TCP check | 0.5 CPU / 512M |
| Mod Contabilidade | mod-contabilidade-1 | 4003 | /health | 1 CPU / 1024M |
| Contab Frontend | contabilidade-frontend-1 | 3000 | wget /module/contabilidade | 0.25 CPU / 128M |
| Nginx | nginx-1 | 80 | — | 0.25 CPU / 64M |

---

## 3. Deployment Procedures

### 3.1 Full Deployment (All Services)

```bash
# SSH into VPS
ssh root@77.42.95.216

# Navigate to project
cd /opt/viaoceanica-ai

# Pull latest code (if using git)
git pull origin main

# Build all services
docker compose build --parallel

# Restart all services
docker compose up -d --remove-orphans

# Verify health
sleep 30
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
```

### 3.2 Single Service Deployment

```bash
# Build specific service
docker compose build --no-cache <service-name>

# Restart only that service
docker compose up -d <service-name>

# Verify
docker compose ps <service-name>
docker logs --tail=20 viaoceanica-ai-<service-name>-1
```

### 3.3 Frontend-Only Deployment (Shell)

```bash
# Shell requires full context build
docker compose build --no-cache shell
docker compose up -d shell

# Verify new bundle
docker exec viaoceanica-ai-shell-1 ls -la /usr/share/nginx/html/assets/
```

---

## 4. Database Operations

### 4.1 Backup

```bash
# Full database backup
docker exec viaoceanica-ai-postgres-1 pg_dump -U viaoceanica viaoceanica_platform > backup_$(date +%Y%m%d_%H%M%S).sql

# Contabilidade database backup
docker exec viaoceanica-ai-postgres-1 pg_dump -U viaoceanica viaoceanica_contabilidade > backup_contab_$(date +%Y%m%d_%H%M%S).sql
```

### 4.2 Restore

```bash
# Restore from backup (CAUTION: destructive)
cat backup_file.sql | docker exec -i viaoceanica-ai-postgres-1 psql -U viaoceanica viaoceanica_platform
```

### 4.3 Schema Migrations

```bash
# Execute SQL migration
docker exec viaoceanica-ai-postgres-1 psql -U viaoceanica -d viaoceanica_platform -f /path/to/migration.sql

# Or inline
docker exec viaoceanica-ai-postgres-1 psql -U viaoceanica -d viaoceanica_platform -c "ALTER TABLE ..."
```

---

## 5. Monitoring and Troubleshooting

### 5.1 Health Check Commands

```bash
# Check all container statuses
docker compose ps --format 'table {{.Name}}\t{{.Status}}'

# Check specific service health
curl -s http://localhost:4000/health | python3 -m json.tool  # platform-core
curl -s http://localhost:3000/health | python3 -m json.tool  # gateway
curl -s http://localhost:4010/ready | python3 -m json.tool   # ai-service

# Check from within Docker network
docker exec viaoceanica-ai-gateway-1 wget -qO- http://platform-core:4000/health
```

### 5.2 Log Analysis

```bash
# Follow logs for a specific service
docker logs -f --tail=50 viaoceanica-ai-platform-core-1

# Search for errors across all services
docker compose logs --tail=100 | grep -i error

# Check nginx access logs
docker exec viaoceanica-ai-nginx-1 cat /var/log/nginx/access.log | tail -50
```

### 5.3 Common Issues

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| 502 Bad Gateway | Backend service down | `docker compose restart <service>` |
| SMTP email not sending | Port 465 blocked, use 587 | Verify SMTP_PORT=587 in docker-compose |
| Container OOM killed | Memory limit exceeded | Increase memory limit in docker-compose |
| Database connection refused | PostgreSQL not ready | Wait for healthcheck or `docker compose restart postgres` |
| Frontend shows old version | Docker cache | `docker compose build --no-cache shell` |
| AI service returns 503 | API key not configured | Set AI_PROVIDER_API_KEY in docker-compose |

---

## 6. Rollback Procedures

### 6.1 Service Rollback

```bash
# List recent images
docker images | grep viaoceanica

# If previous image exists, tag and restart
docker tag viaoceanica-ai-<service>:previous viaoceanica-ai-<service>:latest
docker compose up -d <service>
```

### 6.2 Database Rollback

```bash
# Restore from backup (requires recent backup)
cat backup_YYYYMMDD_HHMMSS.sql | docker exec -i viaoceanica-ai-postgres-1 psql -U viaoceanica viaoceanica_platform
```

---

## 7. Environment Variables

All sensitive configuration is managed through the docker-compose.yml file. Critical variables that must be set:

| Variable | Service | Description |
|----------|---------|-------------|
| JWT_SECRET | common | Session signing secret |
| POSTGRES_PASSWORD | postgres | Database password |
| SMTP_PASS | platform-core | Email service password |
| AI_PROVIDER_API_KEY | ai-service | OpenAI API key |
| OPENAI_API_KEY | mod-contabilidade | OpenAI key for contabilidade |
| R2_ACCESS_KEY_ID | mod-contabilidade | Cloudflare R2 access key |
| R2_SECRET_ACCESS_KEY | mod-contabilidade | Cloudflare R2 secret key |

---

## 8. Scheduled Maintenance

### 8.1 Weekly Tasks

- Review container logs for errors
- Check disk usage: `df -h`
- Verify database backup exists

### 8.2 Monthly Tasks

- Update Docker images: `docker compose pull`
- Review AI usage summaries for cost optimization
- Check SSL certificate expiry (when configured)
- Prune unused Docker resources: `docker system prune -f`

---

## 9. Emergency Contacts

| Role | Contact |
|------|---------|
| Platform Admin | admin@viaoceanica.com |
| VPS Provider | Contabo Support |
| Domain/DNS | Cloudflare Dashboard |
