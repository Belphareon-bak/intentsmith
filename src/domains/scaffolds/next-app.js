// Next.js App Router Scaffold (v90)
// ══════════════════════════════════════════════════════════════════════════════

export const nextAppScaffold = {
  id: 'next-app',
  name: 'Next.js Application',
  description: 'Next.js 14 App Router with TypeScript, Tailwind CSS, and server components',
  tags: ['next', 'nextjs', 'react', 'typescript', 'fullstack'],
  stack: ['Next.js 14', 'React', 'TypeScript', 'Tailwind CSS'],
  complexity: 'SIMPLE',

  files: [
    {
      path: 'package.json',
      type: 'config',
      template: `{
  "name": "{{PROJECT_NAME}}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "autoprefixer": "^10.0.0",
    "postcss": "^8.0.0",
    "tailwindcss": "^3.0.0",
    "typescript": "^5.0.0"
  }
}`,
    },
    {
      path: 'src/app/layout.tsx',
      type: 'code',
      template: `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '{{PROJECT_NAME}}',
  description: 'Built with Next.js',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="cs">
      <body className="min-h-screen bg-gray-50 antialiased">
        <header className="bg-white shadow-sm">
          <nav className="max-w-7xl mx-auto px-4 py-3">
            <h1 className="text-xl font-bold text-gray-900">{{PROJECT_NAME}}</h1>
          </nav>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}`,
    },
    {
      path: 'src/app/page.tsx',
      type: 'code',
      template: `export default function Home() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Welcome</h2>
      <p className="text-gray-600">Your Next.js app is ready.</p>
    </div>
  );
}`,
    },
    {
      path: 'src/app/globals.css',
      type: 'config',
      template: `@tailwind base;
@tailwind components;
@tailwind utilities;`,
    },
    {
      path: 'next.config.js',
      type: 'config',
      template: `/** @type {import('next').NextConfig} */
const nextConfig = {};

module.exports = nextConfig;`,
    },
    {
      path: 'tailwind.config.ts',
      type: 'config',
      template: `import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;`,
    },
  ],

  postSetup: [
    'npm install',
    'npm run dev',
  ],
};
