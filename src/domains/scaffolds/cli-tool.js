// Node.js CLI Tool Scaffold (v90)
// ══════════════════════════════════════════════════════════════════════════════

export const cliToolScaffold = {
  id: 'cli-tool',
  name: 'Node.js CLI Tool',
  description: 'Command-line tool with Commander.js, ESM, and structured commands',
  tags: ['node', 'cli', 'tool', 'command'],
  stack: ['Node.js', 'Commander.js', 'ESM'],
  complexity: 'SIMPLE',

  files: [
    {
      path: 'package.json',
      type: 'config',
      template: `{
  "name": "{{PROJECT_NAME}}",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "{{PROJECT_NAME}}": "./src/index.js"
  },
  "scripts": {
    "start": "node src/index.js",
    "build": "echo 'No build step required'",
    "test": "node --test"
  },
  "dependencies": {
    "commander": "^12.0.0"
  }
}`,
    },
    {
      path: 'src/index.js',
      type: 'code',
      template: `#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';

const program = new Command();

program
  .name('{{PROJECT_NAME}}')
  .description('CLI tool')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize a new project')
  .option('-n, --name <name>', 'Project name', 'my-project')
  .action(initCommand);

program.parse();`,
    },
    {
      path: 'src/commands/init.js',
      type: 'code',
      template: `import { loadConfig, saveConfig } from '../utils/config.js';

export function initCommand(options) {
  const name = options.name || 'my-project';
  console.log(\`Initializing project: \${name}\`);

  const config = loadConfig();
  config.name = name;
  config.createdAt = new Date().toISOString();
  saveConfig(config);

  console.log('Project initialized successfully.');
}`,
    },
    {
      path: 'src/utils/config.js',
      type: 'code',
      template: `import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const CONFIG_FILE = join(process.cwd(), '.{{PROJECT_NAME}}rc.json');

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveConfig(config) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\\n');
}`,
    },
  ],

  postSetup: [
    'npm install',
    'npm link',
  ],
};
