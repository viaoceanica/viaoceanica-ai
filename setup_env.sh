#!/bin/bash
# Generate .env for Via Oceânica AI on VPS
JWT_SECRET="viao-prod-$(openssl rand -hex 16)"
POSTGRES_PASSWORD="viao_db_$(openssl rand -hex 8)"

cat > /opt/viaoceanica-ai/.env << EOF
NODE_ENV=production
JWT_SECRET=${JWT_SECRET}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
COOKIE_NAME=viao_session
AI_PROVIDER_API_KEY=
AI_PROVIDER_BASE_URL=https://api.openai.com/v1
EOF

echo "Environment file created at /opt/viaoceanica-ai/.env"
cat /opt/viaoceanica-ai/.env
