// React App Scaffold
// ══════════════════════════════════════════════════════════════════════════════

export const reactAppScaffold = {
  id: 'react-app',
  name: 'React Application',
  description: 'Vite-based React app with routing, state management basics, and Tailwind CSS',
  tags: ['react', 'node', 'typescript', 'fullstack'],
  stack: ['React', 'Vite', 'TypeScript', 'Tailwind CSS'],
  complexity: 'SIMPLE',

  files: [
    {
      path: 'package.json',
      type: 'config',
      template: `{
  "name": "{{PROJECT_NAME}}",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.0.0",
    "autoprefixer": "^10.0.0",
    "postcss": "^8.0.0",
    "tailwindcss": "^3.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}`,
    },
    {
      path: 'src/App.tsx',
      type: 'code',
      template: `import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}`,
    },
    {
      path: 'src/components/Layout.tsx',
      type: 'code',
      template: `import { ReactNode } from 'react';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <nav className="max-w-7xl mx-auto px-4 py-3">
          <h1 className="text-xl font-bold text-gray-900">{{PROJECT_NAME}}</h1>
        </nav>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}`,
    },
    {
      path: 'src/pages/Home.tsx',
      type: 'code',
      template: `export function Home() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Welcome</h2>
      <p className="text-gray-600">Your app is ready.</p>
    </div>
  );
}`,
    },
    {
      path: 'src/pages/NotFound.tsx',
      type: 'code',
      template: `export function NotFound() {
  return (
    <div className="text-center py-20">
      <h2 className="text-4xl font-bold text-gray-400">404</h2>
      <p className="mt-2 text-gray-500">Page not found</p>
    </div>
  );
}`,
    },
    {
      path: 'vite.config.ts',
      type: 'config',
      template: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});`,
    },
  ],

  postSetup: [
    'npm install',
    'npx tailwindcss init -p',
    'npm run dev',
  ],
};
