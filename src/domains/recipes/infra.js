// Infrastructure Recipes
// ══════════════════════════════════════════════════════════════════════════════

export const infraRecipes = [
  // ─── Docker Setup ─────────────────────────────────────────────────────────
  {
    id: 'docker-node',
    name: 'Docker — Node.js Application',
    description: 'Containerize a Node.js app with multi-stage build',
    tags: ['docker', 'node', 'express'],
    complexity: 'SIMPLE',
    steps: [
      {
        id: 1,
        type: 'file',
        action: 'Create Dockerfile',
        detail: 'Multi-stage: build stage (node:20-alpine) + production stage',
        template: `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app .
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]`,
      },
      {
        id: 2,
        type: 'file',
        action: 'Create .dockerignore',
        detail: 'Exclude node_modules, .git, tests, docs',
        template: `node_modules
.git
.gitignore
*.md
tests/
coverage/
.env`,
      },
      {
        id: 3,
        type: 'file',
        action: 'Create docker-compose.yml',
        detail: 'App service + optional DB',
        template: `version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    restart: unless-stopped`,
      },
    ],
  },

  // ─── Docker + PostgreSQL ──────────────────────────────────────────────────
  {
    id: 'docker-postgres',
    name: 'Docker Compose — Node.js + PostgreSQL',
    description: 'Full stack with Node.js app and PostgreSQL database',
    tags: ['docker', 'node', 'postgres', 'api'],
    complexity: 'MEDIUM',
    steps: [
      {
        id: 1,
        type: 'file',
        action: 'Create docker-compose.yml with app + db',
        template: `version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/appdb
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d appdb"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:`,
      },
      {
        id: 2,
        type: 'file',
        action: 'Create init.sql',
        detail: 'Database initialization script',
        template: `-- Initial schema
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);`,
      },
    ],
  },

  // ─── Nginx Reverse Proxy ──────────────────────────────────────────────────
  {
    id: 'nginx-proxy',
    name: 'Nginx — Reverse Proxy',
    description: 'Nginx reverse proxy with SSL termination',
    tags: ['nginx', 'docker', 'api'],
    complexity: 'MEDIUM',
    steps: [
      {
        id: 1,
        type: 'file',
        action: 'Create nginx.conf',
        template: `upstream app {
    server app:3000;
}

server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        access_log off;
        return 200 'ok';
        add_header Content-Type text/plain;
    }
}`,
      },
      {
        id: 2,
        type: 'config',
        action: 'Add nginx service to docker-compose',
        detail: 'Nginx service with port 80/443 exposed',
      },
    ],
  },

  // ─── Kubernetes Deployment ────────────────────────────────────────────────
  {
    id: 'k8s-deploy',
    name: 'Kubernetes — Basic Deployment',
    description: 'K8s Deployment + Service + ConfigMap',
    tags: ['kubernetes', 'docker'],
    complexity: 'MEDIUM',
    steps: [
      {
        id: 1,
        type: 'file',
        action: 'Create k8s/deployment.yaml',
        template: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
  labels:
    app: app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: app
  template:
    metadata:
      labels:
        app: app
    spec:
      containers:
        - name: app
          image: app:latest
          ports:
            - containerPort: 3000
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10`,
      },
      {
        id: 2,
        type: 'file',
        action: 'Create k8s/service.yaml',
        template: `apiVersion: v1
kind: Service
metadata:
  name: app-service
spec:
  type: ClusterIP
  selector:
    app: app
  ports:
    - port: 80
      targetPort: 3000`,
      },
    ],
  },
];
