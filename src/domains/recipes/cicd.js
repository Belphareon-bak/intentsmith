// CI/CD Recipes
// ══════════════════════════════════════════════════════════════════════════════

export const cicdRecipes = [
  // ─── GitHub Actions — Node.js ─────────────────────────────────────────────
  {
    id: 'gh-actions-node',
    name: 'GitHub Actions — Node.js CI',
    description: 'CI pipeline: lint, test, build, optional deploy',
    tags: ['cicd', 'node', 'testing'],
    complexity: 'SIMPLE',
    steps: [
      {
        id: 1,
        type: 'file',
        action: 'Create .github/workflows/ci.yml',
        template: `name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build --if-present`,
      },
    ],
  },

  // ─── GitHub Actions — Docker Build + Push ─────────────────────────────────
  {
    id: 'gh-actions-docker',
    name: 'GitHub Actions — Docker Build & Push',
    description: 'Build Docker image and push to registry on tag',
    tags: ['cicd', 'docker'],
    complexity: 'MEDIUM',
    steps: [
      {
        id: 1,
        type: 'file',
        action: 'Create .github/workflows/docker.yml',
        template: `name: Docker Build
on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ghcr.io/\${{ github.repository }}:\${{ github.ref_name }}
          cache-from: type=gha
          cache-to: type=gha,mode=max`,
      },
    ],
  },

  // ─── Pre-commit Hooks ─────────────────────────────────────────────────────
  {
    id: 'precommit-hooks',
    name: 'Pre-commit — Lint + Format',
    description: 'Git hooks for linting and formatting before commit',
    tags: ['cicd', 'testing'],
    complexity: 'SIMPLE',
    steps: [
      {
        id: 1,
        type: 'shell',
        action: 'Install husky + lint-staged',
        detail: 'npm install -D husky lint-staged && npx husky init',
      },
      {
        id: 2,
        type: 'file',
        action: 'Configure lint-staged in package.json',
        template: `{
  "lint-staged": {
    "*.{js,ts,jsx,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yml}": ["prettier --write"]
  }
}`,
      },
      {
        id: 3,
        type: 'file',
        action: 'Create .husky/pre-commit',
        template: `npx lint-staged`,
      },
    ],
  },
];
