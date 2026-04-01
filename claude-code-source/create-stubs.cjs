#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const stubs = [
  // Server related
  'src/server/serverLog.js',
  'src/server/lockfile.js',
  'src/server/connectHeadless.js',

  // Proactive
  'src/proactive/index.js',

  // Services
  'src/services/compact/cachedMCConfig.js',
  'src/services/compact/snipProjection.js',
  'src/services/skillSearch/featureCheck.js',
  'src/services/skillSearch/prefetch.js',
  'src/services/sessionTranscript/sessionTranscript.js',

  // Tools
  'src/tools/DiscoverSkillsTool/prompt.js',
  'src/tools/SendUserFileTool/prompt.js',

  // Skills
  'src/skills/mcpSkills.js',

  // Commands
  'src/commands/proactive.js',
  'src/commands/assistant/index.js',
  'src/commands/remoteControlServer/index.js',
  'src/commands/force-snip.js',
  'src/commands/workflows/index.js',
];

const baseDir = '/Users/caoziyu/projects/demo/AgentsComparison/repos/cloud-code/claude-code-source';

stubs.forEach(stub => {
  const fullPath = path.join(baseDir, stub);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullPath, 'export default {};\n');
  console.log('Created:', stub);
});

// Create @ant/computer-use-swift stub
const swiftDir = path.join(baseDir, 'node_modules/@ant/computer-use-swift');
if (!fs.existsSync(swiftDir)) {
  fs.mkdirSync(swiftDir, { recursive: true });
}
fs.writeFileSync(path.join(swiftDir, 'package.json'), JSON.stringify({
  name: '@ant/computer-use-swift',
  version: '1.0.0',
  main: 'index.js',
  type: 'module'
}, null, 2));
fs.writeFileSync(path.join(swiftDir, 'index.js'), 'export default {};\n');
console.log('Created: @ant/computer-use-swift stub');
