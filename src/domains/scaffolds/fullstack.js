// Fullstack Scaffold
// ══════════════════════════════════════════════════════════════════════════════

export const fullstackScaffold = {
  id: 'fullstack',
  name: 'Fullstack — Express + React',
  description: 'Monorepo fullstack with Express API backend, React frontend, and shared types',
  tags: ['fullstack', 'express', 'react', 'node', 'typescript', 'api'],
  stack: ['Node.js', 'Express', 'React', 'Vite', 'TypeScript'],
  complexity: 'MEDIUM',

  files: [
    {
      path: 'package.json',
      type: 'config',
      template: `{
  "name": "{{PROJECT_NAME}}",
  "version": "1.0.0",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "concurrently \\"npm run dev:api\\" \\"npm run dev:web\\"",
    "dev:api": "npm --workspace=packages/api run dev",
    "dev:web": "npm --workspace=packages/web run dev",
    "build": "npm run build --workspaces",
    "test": "npm test --workspaces"
  },
  "devDependencies": {
    "concurrently": "^8.0.0",
    "typescript": "^5.0.0"
  }
}`,
    },
    {
      path: 'packages/api/package.json',
      type: 'config',
      template: `{
  "name": "@{{PROJECT_NAME}}/api",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.js",
    "start": "node src/server.js",
    "test": "node --test tests/"
  },
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.5"
  }
}`,
    },
    {
      path: 'packages/api/src/server.js',
      type: 'code',
      template: `import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/items', (req, res) => {
  res.json({ items: [] });
});

app.listen(3000, () => console.log('API running on :3000'));`,
    },
    {
      path: 'packages/web/package.json',
      type: 'config',
      template: `{
  "name": "@{{PROJECT_NAME}}/web",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^5.0.0"
  }
}`,
    },
    {
      path: 'packages/web/src/App.jsx',
      type: 'code',
      template: `import { useState, useEffect } from 'react';

export default function App() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch('http://localhost:3000/api/health')
      .then(r => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'error' }));
  }, []);

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>{{PROJECT_NAME}}</h1>
      <p>API status: {health ? health.status : 'loading...'}</p>
    </div>
  );
}`,
    },
    {
      path: 'packages/shared/types.d.ts',
      type: 'config',
      template: `// Shared types between API and Web
export interface Item {
  id: string;
  name: string;
  createdAt: string;
}

export interface ApiResponse<T> {
  data: T;
  error?: string;
}`,
    },
  ],

  postSetup: [
    'npm install',
    'npm run dev',
  ],
};
