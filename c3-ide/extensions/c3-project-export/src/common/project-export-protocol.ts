/**
 * @c3/project-export — Protocol (common)
 *
 * Export:
 *   C3: Exportovat projekt → zip:
 *   mobilni-aplikace-export-2026-02-09.zip
 *   ├── project.json
 *   ├── design/
 *   │   ├── architecture.md
 *   │   └── sprints.md
 *   ├── src/                    ← source code
 *   ├── chat/
 *   │   └── conversation.jsonl  ← chat history
 *   └── agent-log/
 *       └── events.jsonl        ← agent log (optional)
 *
 * Import:
 *   C3: Importovat projekt → select zip/folder
 *   → Validate project.json → Rehydrate
 *   → "Projekt 'Mobilní aplikace' načten (fáze: DESIGN, krok 12)"
 */

export const C3ProjectExportPath = '/services/c3-project-export';
export const C3ProjectExport = Symbol('C3ProjectExport');

// ─── Export ──────────────────────────────────────────────

export interface ExportOptions {
  projectPath: string;
  /** Include chat history (conversation.jsonl) */
  includeChat: boolean;
  /** Include agent log (events.jsonl) */
  includeAgentLog: boolean;
  /** Include source code */
  includeSrc: boolean;
  /** Include .c3/ internal data */
  includeInternal: boolean;
  /** Output directory for zip */
  outputDir: string;
}

export interface ExportResult {
  success: boolean;
  zipPath?: string;
  fileName?: string;
  sizeBytes?: number;
  fileCount?: number;
  error?: string;
}

// ─── Import ──────────────────────────────────────────────

export interface ImportOptions {
  /** Path to zip file or unpacked directory */
  sourcePath: string;
  /** Target workspace directory */
  targetDir: string;
}

export interface ImportValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  projectName?: string;
  phase?: string;
  fileCount?: number;
}

export interface ImportResult {
  success: boolean;
  projectPath?: string;
  projectName?: string;
  phase?: string;
  error?: string;
}

// ─── Archive Manifest ────────────────────────────────────

export interface ArchiveManifest {
  version: number;
  exportedAt: string;
  ideVersion: string;
  projectName: string;
  phase: string;
  files: ArchiveFileEntry[];
}

export interface ArchiveFileEntry {
  path: string;
  sizeBytes: number;
  category: 'project' | 'design' | 'src' | 'chat' | 'agent-log' | 'internal';
}

// ─── Service ─────────────────────────────────────────────

export interface C3ProjectExport {
  exportProject(options: ExportOptions): Promise<ExportResult>;
  importProject(options: ImportOptions): Promise<ImportResult>;
  validateImport(sourcePath: string): Promise<ImportValidation>;
}
