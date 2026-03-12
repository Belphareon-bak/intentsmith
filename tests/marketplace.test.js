// Marketplace tests — v123
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, assertThrows, summary } from './harness.js';
import Database from 'better-sqlite3';
import { MarketplaceClient } from '../src/marketplace/marketplace-client.js';
import { PackageInstaller, parseSemver, semverGte, semverNewer, parseDependencySpec } from '../src/marketplace/package-installer.js';
import { _enrichCatalog } from '../src/routes/marketplace.js';

// ─── Test DB helper ─────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE marketplace_packages (
      id TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('skill','expertise','specialist')),
      name TEXT, version TEXT, author TEXT, description TEXT,
      tags TEXT, dependencies TEXT, download_url TEXT, sha256 TEXT, catalog_data TEXT,
      installed_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, type)
    );
    CREATE INDEX idx_mp_type ON marketplace_packages(type);
    CREATE TABLE marketplace_catalog_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      catalog_json TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now')),
      etag TEXT
    );
  `);
  return db;
}

// ─── Mock catalog ───────────────────────────────────────────────────────────

const MOCK_CATALOG = {
  schema: 1,
  version: 1,
  updated: '2026-03-12T00:00:00Z',
  packages: {
    skills: [
      { id: 'code-review', name: 'Code Review', version: '1.0.0', downloadUrl: 'https://example.com/cr.json', sha256: 'abc', tags: ['code'] },
      { id: 'doc-gen', name: 'Doc Generator', version: '2.1.0', downloadUrl: 'https://example.com/dg.json', sha256: 'def', tags: ['docs'] },
    ],
    expertises: [
      { id: 'devops', name: 'DevOps', version: '1.0.0', downloadUrl: 'https://example.com/devops.json', sha256: 'ghi', tags: ['ops'] },
    ],
    specialists: [
      { id: 'translator', name: 'Translator', version: '1.0.0', downloadUrl: 'https://example.com/tr.tar.gz', sha256: 'jkl', engine: '>=121.0.0', tags: ['i18n'] },
    ],
  },
};

// ─── Mock client ────────────────────────────────────────────────────────────

class MockMarketplaceClient {
  constructor() {
    this.downloadCalls = [];
    this.extractCalls = [];
    this.shouldFail = false;
  }
  async getCatalog() { return MOCK_CATALOG; }
  async downloadPackage(entry, targetDir) {
    if (this.shouldFail) throw new Error('Download failed');
    this.downloadCalls.push({ entry, targetDir });
    // Create actual file on disk so fs.rename works in _installSkill
    const { mkdirSync, writeFileSync } = await import('fs');
    mkdirSync(targetDir, { recursive: true });
    const p = `${targetDir}/${entry.id}.pkg`;
    writeFileSync(p, JSON.stringify({ id: entry.id, name: entry.name, version: entry.version }));
    return { path: p, verified: true };
  }
  async extractArchive(archivePath, targetDir) {
    this.extractCalls.push({ archivePath, targetDir });
    return targetDir;
  }
}

// ─── Mock registries ────────────────────────────────────────────────────────

class MockSkillRegistry {
  constructor() { this.reloadCount = 0; }
  reload() { this.reloadCount++; return { loaded: 1, errors: [] }; }
}

class MockExpertiseRegistry {
  constructor() { this.custom = new Map(); }
  addCustom(config) { this.custom.set(config.id, config); }
  removeCustom(id) { return this.custom.delete(id); }
}

class MockSpecialistLoader {
  constructor() { this.enabled = new Set(); this.discoverCount = 0; }
  async discoverAll() { this.discoverCount++; }
  async installPending() {}
  async enable(id) { this.enabled.add(id); }
  async disable(id) { this.enabled.delete(id); }
}

// ══════════════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════════════

// ─── Semver helpers ─────────────────────────────────────────────────────────

suite('Semver helpers');

test('parseSemver handles basic version', () => {
  const [major, minor, patch] = parseSemver('1.2.3');
  assertEqual(major, 1);
  assertEqual(minor, 2);
  assertEqual(patch, 3);
});

test('parseSemver strips prefix', () => {
  const [major] = parseSemver('>=121.0.0');
  assertEqual(major, 121);
});

test('semverGte: 1.2.0 >= 1.1.0', () => {
  assert(semverGte('1.2.0', '1.1.0'));
});

test('semverGte: 1.0.0 >= 1.0.0 (equal)', () => {
  assert(semverGte('1.0.0', '1.0.0'));
});

test('semverGte: 1.0.0 < 1.1.0', () => {
  assert(!semverGte('1.0.0', '1.1.0'));
});

test('semverGte: 1.10.0 >= 1.2.0 (multi-digit)', () => {
  assert(semverGte('1.10.0', '1.2.0'));
});

test('semverNewer: 2.0.0 > 1.0.0', () => {
  assert(semverNewer('2.0.0', '1.0.0'));
});

test('semverNewer: 1.0.0 = 1.0.0 (not newer)', () => {
  assert(!semverNewer('1.0.0', '1.0.0'));
});

// ─── Dependency spec parser ─────────────────────────────────────────────────

suite('Dependency spec parser');

test('parse skill:code-review>=1.0.0', () => {
  const r = parseDependencySpec('skill:code-review>=1.0.0');
  assertEqual(r.type, 'skill');
  assertEqual(r.id, 'code-review');
  assertEqual(r.versionSpec, '>=1.0.0');
});

test('parse expertise:security (no version)', () => {
  const r = parseDependencySpec('expertise:security');
  assertEqual(r.type, 'expertise');
  assertEqual(r.id, 'security');
  assertEqual(r.versionSpec, null);
});

test('parse invalid spec returns null', () => {
  assertEqual(parseDependencySpec('invalid'), null);
  assertEqual(parseDependencySpec(''), null);
});

// ─── MarketplaceClient — cache ──────────────────────────────────────────────

suite('MarketplaceClient — cache');

test('_getCachedCatalog returns null when empty', () => {
  const db = createTestDb();
  const client = new MarketplaceClient(db, { catalogUrl: 'http://test' });
  assertEqual(client._getCachedCatalog(), null);
  db.close();
});

test('_setCachedCatalog + _getCachedCatalog round-trip', () => {
  const db = createTestDb();
  const client = new MarketplaceClient(db, { catalogUrl: 'http://test' });
  client._setCachedCatalog({ test: true }, 'etag-1');
  const cached = client._getCachedCatalog();
  assert(cached !== null);
  assertEqual(cached.catalog.test, true);
  assertEqual(cached.etag, 'etag-1');
  db.close();
});

test('_isCacheStale: recent cache is not stale', () => {
  const db = createTestDb();
  const client = new MarketplaceClient(db, { catalogUrl: 'http://test' });
  const now = new Date().toISOString().replace('Z', '');
  assert(!client._isCacheStale(now));
  db.close();
});

test('_isCacheStale: old cache is stale', () => {
  const db = createTestDb();
  const client = new MarketplaceClient(db, { catalogUrl: 'http://test' });
  const old = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().replace('Z', '');
  assert(client._isCacheStale(old));
  db.close();
});

test('_isCacheStale: null is stale', () => {
  const db = createTestDb();
  const client = new MarketplaceClient(db, { catalogUrl: 'http://test' });
  assert(client._isCacheStale(null));
  db.close();
});

// ─── MarketplaceClient — schema validation ──────────────────────────────────

suite('MarketplaceClient — schema validation');

test('valid catalog passes', () => {
  const db = createTestDb();
  const client = new MarketplaceClient(db, { catalogUrl: 'http://test' });
  client._validateCatalogSchema(MOCK_CATALOG); // should not throw
  db.close();
});

test('missing packages field throws', () => {
  const db = createTestDb();
  const client = new MarketplaceClient(db, { catalogUrl: 'http://test' });
  assertThrows(() => client._validateCatalogSchema({ version: 1 }));
  db.close();
});

test('non-array packages.skills throws', () => {
  const db = createTestDb();
  const client = new MarketplaceClient(db, { catalogUrl: 'http://test' });
  assertThrows(() => client._validateCatalogSchema({ packages: { skills: 'bad' } }));
  db.close();
});

test('entry missing id throws', () => {
  const db = createTestDb();
  const client = new MarketplaceClient(db, { catalogUrl: 'http://test' });
  assertThrows(() => client._validateCatalogSchema({
    packages: { skills: [{ version: '1', downloadUrl: 'x' }], expertises: [], specialists: [] },
  }));
  db.close();
});

// ─── PackageInstaller — basic operations ────────────────────────────────────

suite('PackageInstaller — basic operations');

test('isInstalled returns false initially', () => {
  const db = createTestDb();
  const installer = new PackageInstaller(db, { client: new MockMarketplaceClient() });
  assert(!installer.isInstalled('skill', 'code-review'));
  db.close();
});

test('getInstalled returns empty initially', () => {
  const db = createTestDb();
  const installer = new PackageInstaller(db, { client: new MockMarketplaceClient() });
  assertEqual(installer.getInstalled().length, 0);
  db.close();
});

test('getInstalledVersion returns null for unknown', () => {
  const db = createTestDb();
  const installer = new PackageInstaller(db, { client: new MockMarketplaceClient() });
  assertEqual(installer.getInstalledVersion('skill', 'xyz'), null);
  db.close();
});

await testAsync('install skill records in DB', async () => {
  const db = createTestDb();
  const mockClient = new MockMarketplaceClient();
  const mockRegistry = new MockSkillRegistry();
  const installer = new PackageInstaller(db, {
    client: mockClient,
    skillRegistry: mockRegistry,
    projectRoot: '/tmp/test-marketplace',
  });

  const result = await installer.install('skill', MOCK_CATALOG.packages.skills[0]);
  assert(result.ok);
  assertEqual(result.id, 'code-review');
  assert(installer.isInstalled('skill', 'code-review'));
  assertEqual(installer.getInstalledVersion('skill', 'code-review'), '1.0.0');
  assertEqual(mockRegistry.reloadCount, 1);
  assertEqual(mockClient.downloadCalls.length, 1);
  db.close();
});

await testAsync('install expertise calls addCustom', async () => {
  const db = createTestDb();
  const mockClient = new MockMarketplaceClient();
  // Override download to write a JSON file
  mockClient.downloadPackage = async (entry, dir) => {
    const { mkdirSync, writeFileSync } = await import('fs');
    mkdirSync(dir, { recursive: true });
    const p = `${dir}/${entry.id}.json`;
    writeFileSync(p, JSON.stringify({ id: entry.id, name: entry.name }));
    return { path: p, verified: true };
  };
  const mockRegistry = new MockExpertiseRegistry();
  const installer = new PackageInstaller(db, {
    client: mockClient,
    expertiseRegistry: mockRegistry,
    projectRoot: '/tmp/test-marketplace',
  });

  await installer.install('expertise', MOCK_CATALOG.packages.expertises[0]);
  assert(installer.isInstalled('expertise', 'devops'));
  assert(mockRegistry.custom.has('devops'));
  db.close();
});

await testAsync('idempotent install (same version)', async () => {
  const db = createTestDb();
  const mockClient = new MockMarketplaceClient();
  const installer = new PackageInstaller(db, {
    client: mockClient,
    skillRegistry: new MockSkillRegistry(),
    projectRoot: '/tmp/test-marketplace',
  });

  await installer.install('skill', MOCK_CATALOG.packages.skills[0]);
  const r2 = await installer.install('skill', MOCK_CATALOG.packages.skills[0]);
  assert(r2.alreadyInstalled);
  // download should only be called once
  assertEqual(mockClient.downloadCalls.length, 1);
  db.close();
});

await testAsync('uninstall removes from DB', async () => {
  const db = createTestDb();
  const mockClient = new MockMarketplaceClient();
  const installer = new PackageInstaller(db, {
    client: mockClient,
    skillRegistry: new MockSkillRegistry(),
    projectRoot: '/tmp/test-marketplace',
  });

  await installer.install('skill', MOCK_CATALOG.packages.skills[0]);
  assert(installer.isInstalled('skill', 'code-review'));
  await installer.uninstall('skill', 'code-review');
  assert(!installer.isInstalled('skill', 'code-review'));
  db.close();
});

await testAsync('uninstall not-installed throws', async () => {
  const db = createTestDb();
  const installer = new PackageInstaller(db, { client: new MockMarketplaceClient() });
  try {
    await installer.uninstall('skill', 'nonexistent');
    assert(false, 'should have thrown');
  } catch (err) {
    assert(err.message.includes('Not installed'));
  }
  db.close();
});

await testAsync('install specialist calls loader', async () => {
  const db = createTestDb();
  const mockClient = new MockMarketplaceClient();
  const mockLoader = new MockSpecialistLoader();
  const installer = new PackageInstaller(db, {
    client: mockClient,
    specialistLoader: mockLoader,
    projectRoot: '/tmp/test-marketplace',
  });

  // Mock extract to create a manifest file
  const { mkdirSync, writeFileSync } = await import('fs');
  mockClient.extractArchive = async (_archive, dir) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/specialist.json`, '{"id":"translator","version":"1.0.0"}');
    return dir;
  };

  await installer.install('specialist', MOCK_CATALOG.packages.specialists[0]);
  assert(installer.isInstalled('specialist', 'translator'));
  assert(mockLoader.discoverCount >= 1, 'discoverAll should be called');
  assert(mockLoader.enabled.has('translator'), 'specialist should be enabled');
  db.close();
});

// ─── PackageInstaller — rollback on failure ─────────────────────────────────

suite('PackageInstaller — rollback');

await testAsync('specialist install failure triggers rollback', async () => {
  const db = createTestDb();
  const mockClient = new MockMarketplaceClient();
  mockClient.extractArchive = async () => { throw new Error('Extract failed'); };
  const installer = new PackageInstaller(db, {
    client: mockClient,
    specialistLoader: new MockSpecialistLoader(),
    projectRoot: '/tmp/test-marketplace-rollback',
  });

  try {
    await installer.install('specialist', MOCK_CATALOG.packages.specialists[0]);
    assert(false, 'should have thrown');
  } catch (err) {
    assert(err.message.includes('Extract failed'));
  }
  // DB should not have a record
  assert(!installer.isInstalled('specialist', 'translator'));
  db.close();
});

// ─── PackageInstaller — dependency resolution ───────────────────────────────

suite('PackageInstaller — dependency resolution');

test('resolveDependencies: no deps returns empty', () => {
  const db = createTestDb();
  const installer = new PackageInstaller(db, { client: new MockMarketplaceClient() });
  const deps = installer.resolveDependencies({ id: 'test', dependencies: [] }, MOCK_CATALOG);
  assertEqual(deps.length, 0);
  db.close();
});

test('resolveDependencies: single dep', () => {
  const db = createTestDb();
  const installer = new PackageInstaller(db, { client: new MockMarketplaceClient() });
  const entry = { id: 'my-specialist', dependencies: ['skill:code-review>=1.0.0'] };
  const deps = installer.resolveDependencies(entry, MOCK_CATALOG);
  assertEqual(deps.length, 1);
  assertEqual(deps[0].type, 'skill');
  assertEqual(deps[0].id, 'code-review');
  db.close();
});

test('resolveDependencies: already installed dep is skipped', () => {
  const db = createTestDb();
  // Pre-insert installed package
  db.prepare('INSERT INTO marketplace_packages (id, type, name, version, download_url) VALUES (?, ?, ?, ?, ?)').run(
    'code-review', 'skill', 'Code Review', '1.0.0', 'https://x'
  );
  const installer = new PackageInstaller(db, { client: new MockMarketplaceClient() });
  const entry = { id: 'my-specialist', dependencies: ['skill:code-review>=1.0.0'] };
  const deps = installer.resolveDependencies(entry, MOCK_CATALOG);
  assertEqual(deps.length, 0);
  db.close();
});

test('resolveDependencies: circular dependency throws', () => {
  const db = createTestDb();
  const installer = new PackageInstaller(db, { client: new MockMarketplaceClient() });
  const circularCatalog = {
    packages: {
      skills: [
        { id: 'a', version: '1.0.0', downloadUrl: 'x', dependencies: ['skill:b>=1.0.0'] },
        { id: 'b', version: '1.0.0', downloadUrl: 'x', dependencies: ['skill:a>=1.0.0'] },
      ],
      expertises: [],
      specialists: [],
    },
  };
  const entry = { id: 'top', dependencies: ['skill:a>=1.0.0'] };
  assertThrows(() => installer.resolveDependencies(entry, circularCatalog));
  db.close();
});

// ─── PackageInstaller — uninstall protection ────────────────────────────────

suite('PackageInstaller — uninstall protection');

test('checkDependents finds dependents', () => {
  const db = createTestDb();
  db.prepare('INSERT INTO marketplace_packages (id, type, name, version, download_url, dependencies) VALUES (?, ?, ?, ?, ?, ?)').run(
    'my-specialist', 'specialist', 'My Spec', '1.0.0', 'https://x',
    JSON.stringify(['skill:code-review>=1.0.0'])
  );
  const installer = new PackageInstaller(db, { client: new MockMarketplaceClient() });
  const deps = installer.checkDependents('skill', 'code-review');
  assertEqual(deps.length, 1);
  assertEqual(deps[0], 'specialist:my-specialist');
  db.close();
});

test('checkDependents returns empty when no dependents', () => {
  const db = createTestDb();
  const installer = new PackageInstaller(db, { client: new MockMarketplaceClient() });
  const deps = installer.checkDependents('skill', 'unknown');
  assertEqual(deps.length, 0);
  db.close();
});

await testAsync('uninstall blocked by dependents', async () => {
  const db = createTestDb();
  db.prepare('INSERT INTO marketplace_packages (id, type, name, version, download_url) VALUES (?, ?, ?, ?, ?)').run(
    'code-review', 'skill', 'Code Review', '1.0.0', 'https://x'
  );
  db.prepare('INSERT INTO marketplace_packages (id, type, name, version, download_url, dependencies) VALUES (?, ?, ?, ?, ?, ?)').run(
    'my-specialist', 'specialist', 'My Spec', '1.0.0', 'https://x',
    JSON.stringify(['skill:code-review>=1.0.0'])
  );
  const installer = new PackageInstaller(db, {
    client: new MockMarketplaceClient(),
    skillRegistry: new MockSkillRegistry(),
  });
  try {
    await installer.uninstall('skill', 'code-review');
    assert(false, 'should have thrown');
  } catch (err) {
    assert(err.message.includes('Cannot uninstall'));
    assert(err.message.includes('my-specialist'));
  }
  db.close();
});

// ─── Catalog enrichment ─────────────────────────────────────────────────────

suite('Catalog enrichment');

test('enrichCatalog marks installed packages', () => {
  const installed = [
    { id: 'code-review', type: 'skill', version: '1.0.0' },
  ];
  const enriched = _enrichCatalog(MOCK_CATALOG, installed);
  const cr = enriched.packages.skills.find(s => s.id === 'code-review');
  assert(cr.installed);
  assertEqual(cr.installedVersion, '1.0.0');
  assert(!cr.updateAvailable);
  // doc-gen should not be installed
  const dg = enriched.packages.skills.find(s => s.id === 'doc-gen');
  assert(!dg.installed);
});

test('enrichCatalog detects update available (semver)', () => {
  const installed = [
    { id: 'doc-gen', type: 'skill', version: '1.0.0' },
  ];
  const enriched = _enrichCatalog(MOCK_CATALOG, installed);
  const dg = enriched.packages.skills.find(s => s.id === 'doc-gen');
  assert(dg.installed);
  assert(dg.updateAvailable, '2.1.0 should be newer than 1.0.0');
});

test('enrichCatalog pagination', () => {
  const installed = [];
  const enriched = _enrichCatalog(MOCK_CATALOG, installed, { page: 1, limit: 1, typeFilter: 'skills' });
  assert(enriched.pagination);
  assertEqual(enriched.pagination.items.length, 1);
  assertEqual(enriched.pagination.total, 2);
  assertEqual(enriched.pagination.totalPages, 2);
});

test('enrichCatalog handles empty catalog', () => {
  const enriched = _enrichCatalog({ packages: {} }, []);
  assertEqual(enriched.packages.skills.length, 0);
  assertEqual(enriched.packages.expertises.length, 0);
  assertEqual(enriched.packages.specialists.length, 0);
});

// ─── PackageInstaller — update ──────────────────────────────────────────────

suite('PackageInstaller — update');

await testAsync('update changes version', async () => {
  const db = createTestDb();
  const mockClient = new MockMarketplaceClient();
  const mockRegistry = new MockSkillRegistry();
  const installer = new PackageInstaller(db, {
    client: mockClient,
    skillRegistry: mockRegistry,
    projectRoot: '/tmp/test-marketplace-update',
  });

  // Install v1
  await installer.install('skill', { ...MOCK_CATALOG.packages.skills[0], version: '1.0.0' });
  assertEqual(installer.getInstalledVersion('skill', 'code-review'), '1.0.0');

  // Update to v2
  const r = await installer.update('skill', 'code-review', { ...MOCK_CATALOG.packages.skills[0], version: '2.0.0' });
  assert(r.ok);
  assertEqual(r.version, '2.0.0');
  assertEqual(r.previousVersion, '1.0.0');
  assertEqual(installer.getInstalledVersion('skill', 'code-review'), '2.0.0');
  db.close();
});

// ─── PackageInstaller — install with dependencies ───────────────────────────

suite('PackageInstaller — install with dependencies');

await testAsync('installWithDependencies installs deps first', async () => {
  const db = createTestDb();
  const mockClient = new MockMarketplaceClient();
  const mockRegistry = new MockSkillRegistry();
  const installer = new PackageInstaller(db, {
    client: mockClient,
    skillRegistry: mockRegistry,
    expertiseRegistry: new MockExpertiseRegistry(),
    projectRoot: '/tmp/test-marketplace-deps',
  });

  // Override download for expertise to write a JSON file
  const origDownload = mockClient.downloadPackage.bind(mockClient);
  mockClient.downloadPackage = async (entry, dir) => {
    const { mkdirSync, writeFileSync } = await import('fs');
    mkdirSync(dir, { recursive: true });
    if (entry.id === 'devops') {
      const p = `${dir}/${entry.id}.json`;
      writeFileSync(p, JSON.stringify({ id: 'devops', name: 'DevOps' }));
      return { path: p, verified: true };
    }
    return origDownload(entry, dir);
  };

  const entry = {
    id: 'my-skill',
    version: '1.0.0',
    downloadUrl: 'https://example.com/ms.json',
    dependencies: ['expertise:devops>=1.0.0'],
  };

  const extendedCatalog = {
    ...MOCK_CATALOG,
    packages: {
      ...MOCK_CATALOG.packages,
      skills: [...MOCK_CATALOG.packages.skills, entry],
    },
  };

  const result = await installer.install('skill', entry, extendedCatalog);
  assert(result.ok);
  assert(result.deps.includes('expertise:devops'), 'dep should be listed');
  assert(installer.isInstalled('expertise', 'devops'), 'dependency should be installed');
  assert(installer.isInstalled('skill', 'my-skill'), 'main package should be installed');
  db.close();
});

// ─── getInstalled with type filter ──────────────────────────────────────────

suite('PackageInstaller — query');

test('getInstalled with type filter', () => {
  const db = createTestDb();
  db.prepare('INSERT INTO marketplace_packages (id, type, name, version, download_url) VALUES (?, ?, ?, ?, ?)').run(
    'a', 'skill', 'A', '1.0', 'x'
  );
  db.prepare('INSERT INTO marketplace_packages (id, type, name, version, download_url) VALUES (?, ?, ?, ?, ?)').run(
    'b', 'expertise', 'B', '1.0', 'x'
  );
  const installer = new PackageInstaller(db, { client: new MockMarketplaceClient() });
  assertEqual(installer.getInstalled().length, 2);
  assertEqual(installer.getInstalled('skill').length, 1);
  assertEqual(installer.getInstalled('expertise').length, 1);
  assertEqual(installer.getInstalled('specialist').length, 0);
  db.close();
});

// ══════════════════════════════════════════════════════════════════════════════

summary();
