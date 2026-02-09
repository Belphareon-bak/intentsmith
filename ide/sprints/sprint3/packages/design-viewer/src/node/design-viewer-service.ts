/**
 * @c3/design-viewer — Backend Service
 *
 * Loads design documents from filesystem (NEVER from chat).
 * Watches for file changes and notifies frontend.
 * Parses markdown into outline sections for navigation.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger, Emitter } from '@theia/core';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as chokidar from 'chokidar';
import {
  C3DesignViewer,
  C3DesignViewerClient,
  DesignDocument,
  DesignMetadata,
  OutlineSection,
} from '../common/design-viewer-protocol';

@injectable()
export class C3DesignViewerService implements C3DesignViewer {

  @inject(ILogger)
  protected readonly logger!: ILogger;

  private client: C3DesignViewerClient | undefined;
  private watcher: chokidar.FSWatcher | null = null;
  private projectPath: string = '';

  setClient(client: C3DesignViewerClient): void {
    this.client = client;
  }

  // ─── Public API ────────────────────────────────────────

  async loadDesign(projectPath: string): Promise<DesignDocument> {
    this.projectPath = projectPath;

    const [architecture, sprints, metadata] = await Promise.all([
      this.readDesignFile(projectPath, 'design/architecture.md'),
      this.readDesignFile(projectPath, 'design/sprints.md'),
      this.readMetadata(projectPath),
    ]);

    const outline = this.buildOutline(architecture, sprints);
    const lastModified = await this.getLastModified(projectPath);

    return { architecture, sprints, metadata, outline, lastModified };
  }

  async watchDesign(projectPath: string): Promise<void> {
    this.projectPath = projectPath;
    await this.unwatchDesign();

    const designDir = path.join(projectPath, 'design');
    const projectJson = path.join(projectPath, 'project.json');

    if (!await fs.pathExists(designDir)) {
      this.logger.info('Design directory does not exist yet, skipping watch');
      return;
    }

    this.watcher = chokidar.watch(
      [path.join(designDir, '*.md'), projectJson],
      { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300 } },
    );

    this.watcher.on('change', async () => {
      this.logger.info('Design files changed, reloading...');
      try {
        const doc = await this.loadDesign(projectPath);
        this.client?.onDesignChanged(doc);
      } catch (err: any) {
        this.logger.error(`Failed to reload design: ${err.message}`);
      }
    });

    this.logger.info(`Watching design files in ${designDir}`);
  }

  async unwatchDesign(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  async hasDesign(projectPath: string): Promise<boolean> {
    const archPath = path.join(projectPath, 'design', 'architecture.md');
    return fs.pathExists(archPath);
  }

  // ─── File Reading ──────────────────────────────────────

  private async readDesignFile(projectPath: string, relativePath: string): Promise<string | null> {
    const fullPath = path.join(projectPath, relativePath);
    try {
      return await fs.readFile(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  private async readMetadata(projectPath: string): Promise<DesignMetadata | null> {
    const projectJson = path.join(projectPath, 'project.json');
    try {
      const data = await fs.readJson(projectJson);
      return {
        stack: data.context?.stack || {},
        decisions: data.context?.decisions || [],
        currentSprint: data.context?.current_sprint || 0,
        totalSprints: data.context?.total_sprints || 0,
        designTurns: data.context?.design_turns || 0,
        projectName: data.name || 'Untitled',
        phase: data.phase || 'idle',
      };
    } catch {
      return null;
    }
  }

  private async getLastModified(projectPath: string): Promise<string> {
    const archPath = path.join(projectPath, 'design', 'architecture.md');
    try {
      const stat = await fs.stat(archPath);
      return stat.mtime.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  // ─── Outline Parsing ──────────────────────────────────

  /**
   * Parse markdown headers into hierarchical outline.
   * Used for sidebar navigation in Design Viewer.
   */
  private buildOutline(architecture: string | null, sprints: string | null): OutlineSection[] {
    const sections: OutlineSection[] = [];

    if (architecture) {
      sections.push(...this.parseMarkdownOutline(architecture, 'architecture'));
    }
    if (sprints) {
      sections.push(...this.parseMarkdownOutline(sprints, 'sprints'));
    }

    return this.nestSections(sections);
  }

  private parseMarkdownOutline(
    content: string,
    source: 'architecture' | 'sprints',
  ): OutlineSection[] {
    const lines = content.split('\n');
    const sections: OutlineSection[] = [];

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,4})\s+(.+)/);
      if (match) {
        const level = match[1].length;
        const title = match[2].trim();
        const id = this.slugify(title) + '-' + i;

        // Find end of section (next header of same or higher level, or EOF)
        let lineEnd = lines.length - 1;
        for (let j = i + 1; j < lines.length; j++) {
          const nextMatch = lines[j].match(/^(#{1,4})\s/);
          if (nextMatch && nextMatch[1].length <= level) {
            lineEnd = j - 1;
            break;
          }
        }

        sections.push({
          id, title, level, lineStart: i, lineEnd, source,
          children: [],
        });
      }
    }

    return sections;
  }

  /**
   * Convert flat section list into nested tree.
   */
  private nestSections(flat: OutlineSection[]): OutlineSection[] {
    const root: OutlineSection[] = [];
    const stack: OutlineSection[] = [];

    for (const section of flat) {
      while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(section);
      } else {
        stack[stack.length - 1].children.push(section);
      }

      stack.push(section);
    }

    return root;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9čšžřťďňůúýáéíó]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
