/**
 * Tools Index
 * 
 * Načítá všechny dostupné nástroje.
 */

import { toolRegistry } from "./registry.js";

// Import all tool modules (side-effect: they register themselves)
import "./fs-tools.js";
import "./shell-tools.js";
import "./web-tools.js";
import "./code-tools.js";
import "./git-tools.js";
import "./system-tools.js";
import "./project-tools.js";

// Export registry
export { toolRegistry, registerTool, executeTool } from "./registry.js";

// Summary
const categories = toolRegistry.getCategories();
const totalTools = toolRegistry.list().length;

console.log(`\n🔧 Tools loaded: ${totalTools} tools in ${categories.length} categories`);
console.log(`   Categories: ${categories.join(", ")}\n`);

export default toolRegistry;
