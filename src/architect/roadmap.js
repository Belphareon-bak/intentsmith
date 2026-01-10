// C.3 Architect Mode - Roadmap Management
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

const ARCHITECT_DIR = '.c3-architect';
const ROADMAP_DIR = 'roadmap';
const MAIN_FILE = 'main.md';

/**
 * Roadmap Manager class
 */
export class RoadmapManager {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.roadmapDir = path.join(projectRoot, ARCHITECT_DIR, ROADMAP_DIR);
    this.mainPath = path.join(this.roadmapDir, MAIN_FILE);
  }

  /**
   * Initialize roadmap with project name
   */
  async init(projectName) {
    await fs.mkdir(this.roadmapDir, { recursive: true });

    // Check if main.md exists
    try {
      await fs.access(this.mainPath);
      logger.info('Architect', 'Roadmap exists');
    } catch {
      // Create initial main.md
      const content = this.createMainTemplate(projectName);
      await fs.writeFile(this.mainPath, content);
      logger.info('Architect', 'Created roadmap/main.md');
    }
  }

  /**
   * Create main.md template
   */
  createMainTemplate(projectName) {
    return `# Roadmap: ${projectName}

## Stav
Hotovo: 0/0 | WIP: 0 | Blocked: 0

## Struktura

<!-- Bloky budou přidány během plánování -->
`;
  }

  /**
   * Load main.md content
   */
  async loadMain() {
    try {
      return await fs.readFile(this.mainPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Save main.md content
   */
  async saveMain(content) {
    await fs.writeFile(this.mainPath, content);
  }

  /**
   * Parse roadmap structure from main.md
   */
  async parseStructure() {
    const content = await this.loadMain();
    if (!content) return { blocks: [], stats: { total: 0, done: 0, wip: 0, blocked: 0 } };

    const blocks = [];
    const lines = content.split('\n');
    
    let currentBlock = null;
    let currentSubblock = null;
    
    for (const line of lines) {
      // Top-level block: - [x] 01-name or - [ ] 01-name
      const blockMatch = line.match(/^- \[(x| )\] (\d+-[\w-]+)(.*)$/);
      if (blockMatch) {
        currentBlock = {
          done: blockMatch[1] === 'x',
          id: blockMatch[2],
          meta: blockMatch[3].trim(),
          subblocks: [],
          exitCriteria: [],
        };
        blocks.push(currentBlock);
        currentSubblock = null;
        continue;
      }

      // Subblock: - [x] 01-subname (indented)
      const subMatch = line.match(/^  - \[(x| )\] (\d+-[\w-]+)(.*)$/);
      if (subMatch && currentBlock) {
        currentSubblock = {
          done: subMatch[1] === 'x',
          id: subMatch[2],
          meta: subMatch[3].trim(),
          subblocks: [],
        };
        currentBlock.subblocks.push(currentSubblock);
        continue;
      }

      // Sub-subblock (3rd level)
      const subSubMatch = line.match(/^    - \[(x| )\] (\d+-[\w-]+)(.*)$/);
      if (subSubMatch && currentSubblock) {
        currentSubblock.subblocks.push({
          done: subSubMatch[1] === 'x',
          id: subSubMatch[2],
          meta: subSubMatch[3].trim(),
        });
        continue;
      }

      // Exit criteria
      const criteriaMatch = line.match(/^  - Hotovo když:/);
      if (criteriaMatch && currentBlock) {
        // Next lines until empty or new block are criteria
        continue;
      }

      // Individual criterion
      const criterionMatch = line.match(/^    - (.+)$/);
      if (criterionMatch && currentBlock && !currentSubblock) {
        currentBlock.exitCriteria.push(criterionMatch[1]);
      }
    }

    // Calculate stats
    const stats = this.calculateStats(blocks);

    return { blocks, stats };
  }

  /**
   * Calculate stats from blocks
   */
  calculateStats(blocks) {
    let total = 0;
    let done = 0;

    const countBlock = (block) => {
      total++;
      if (block.done) done++;
      if (block.subblocks) {
        block.subblocks.forEach(countBlock);
      }
    };

    blocks.forEach(countBlock);

    return {
      total,
      done,
      wip: total > done ? 1 : 0, // Simplified
      blocked: 0,
    };
  }

  /**
   * Add a new block to roadmap
   */
  async addBlock(id, goal, exitCriteria = []) {
    const content = await this.loadMain();
    
    // Find insertion point (before closing or at end)
    const blockEntry = `
- [ ] ${id}
  - Cíl: ${goal}
  - Hotovo když:
${exitCriteria.map(c => `    - ${c}`).join('\n')}
`;

    const newContent = content + blockEntry;
    await this.saveMain(newContent);
    
    // Create folder for block
    const blockDir = path.join(this.roadmapDir, id);
    await fs.mkdir(blockDir, { recursive: true });
    
    // Create definition file
    const defPath = path.join(blockDir, `${id.replace(/^\d+-/, '')}.md`);
    await fs.writeFile(defPath, `# ${id}\n\n## Cíl\n${goal}\n\n## Definice\n\n<!-- Detailní popis -->\n`);
    
    logger.info('Architect', 'Block added', { id });
    return { id, goal, exitCriteria };
  }

  /**
   * Add subblock to existing block
   */
  async addSubblock(parentId, id, goal = '') {
    const content = await this.loadMain();
    
    // Find parent block and add subblock
    const lines = content.split('\n');
    const newLines = [];
    let foundParent = false;
    let insertIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      newLines.push(lines[i]);
      
      // Find parent block
      if (lines[i].includes(`] ${parentId}`)) {
        foundParent = true;
      }
      
      // Find insertion point (after last subblock or after exit criteria)
      if (foundParent && insertIndex === -1) {
        // Check if next line is a new top-level block or empty
        const nextLine = lines[i + 1] || '';
        if (nextLine.match(/^- \[/) || (nextLine.trim() === '' && !lines[i].match(/^  /))) {
          insertIndex = newLines.length;
          newLines.push(`  - [ ] ${id}`);
          foundParent = false;
        }
      }
    }

    await this.saveMain(newLines.join('\n'));
    
    // Create folder
    const parentDir = path.join(this.roadmapDir, parentId);
    const subDir = path.join(parentDir, id);
    await fs.mkdir(subDir, { recursive: true });
    
    // Create definition file
    const defPath = path.join(subDir, `${id.replace(/^\d+-/, '')}.md`);
    await fs.writeFile(defPath, `# ${id}\n\n## Definice\n\n${goal}\n`);
    
    logger.info('Architect', 'Subblock added', { parentId, id });
  }

  /**
   * Mark block as complete with timestamp
   */
  async markComplete(blockPath, timestamp = new Date().toISOString()) {
    const content = await this.loadMain();
    const blockId = blockPath.split('/').pop();
    
    // Replace [ ] with [x] and add timestamp
    const pattern = new RegExp(`(- )\\[ \\]( ${blockId})(.*)$`, 'm');
    const shortTimestamp = timestamp.substring(0, 16).replace('T', ' ');
    
    let newContent = content.replace(pattern, `$1[x]$2 (→ ${shortTimestamp})$3`);
    
    // Update stats line
    const { stats } = await this.parseStructure();
    const statsLine = `Hotovo: ${stats.done + 1}/${stats.total} | WIP: ${Math.max(0, stats.wip - 1)} | Blocked: ${stats.blocked}`;
    newContent = newContent.replace(/Hotovo: \d+\/\d+ \| WIP: \d+ \| Blocked: \d+/, statsLine);
    
    await this.saveMain(newContent);
    logger.info('Architect', 'Block marked complete', { blockPath, timestamp: shortTimestamp });
  }

  /**
   * Load block definition
   */
  async loadDefinition(blockPath) {
    // blockPath like "01-left-sidebar/02-navigation"
    const parts = blockPath.split('/');
    const fileName = parts[parts.length - 1].replace(/^\d+-/, '') + '.md';
    const defPath = path.join(this.roadmapDir, blockPath, fileName);
    
    try {
      return await fs.readFile(defPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Save block definition
   */
  async saveDefinition(blockPath, content) {
    const parts = blockPath.split('/');
    const fileName = parts[parts.length - 1].replace(/^\d+-/, '') + '.md';
    const defPath = path.join(this.roadmapDir, blockPath, fileName);
    
    await fs.mkdir(path.dirname(defPath), { recursive: true });
    await fs.writeFile(defPath, content);
    logger.info('Architect', 'Definition saved', { blockPath });
  }

  /**
   * Get all definitions for context
   */
  async getAllDefinitions() {
    const definitions = {};
    
    const scanDir = async (dir, prefix = '') => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            await scanDir(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
          } else if (entry.name.endsWith('.md') && entry.name !== 'main.md') {
            const content = await fs.readFile(path.join(dir, entry.name), 'utf-8');
            definitions[prefix || 'root'] = content;
          }
        }
      } catch {
        // Directory doesn't exist
      }
    };

    await scanDir(this.roadmapDir);
    return definitions;
  }
}

export default RoadmapManager;
