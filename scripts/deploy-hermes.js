const fs = require('fs');
const path = require('path');

const srcDir = 'G:/My Drive/Projects/Aether UI';
const targetDirs = [
  'C:/Users/BENIFA/AppData/Local/hermes/profiles/test-aether/plugins/aether-ui',
  'C:/Users/BENIFA/AppData/Local/hermes/plugins/aether-ui',
];
const desktopTarget = 'C:/Users/BENIFA/AppData/Local/hermes/desktop-plugins/aether-ui/plugin.js';

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    if (fs.statSync(s).isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

for (const target of targetDirs) {
  console.log('Deploying to:', target);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  // Copy dist
  copyDirRecursive(path.join(srcDir, 'dist'), path.join(target, 'dist'));
  // Copy manifest files
  for (const file of ['mcp.json', 'package.json', 'plugin.json', 'SKILL.md']) {
    const srcFile = path.join(srcDir, file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(target, file));
      console.log(`  Copied ${file}`);
    }
  }

  // Copy skills/aether-ui/SKILL.md into plugin skills directory
  const pluginSkillsDir = path.join(target, 'skills', 'aether-ui');
  if (!fs.existsSync(pluginSkillsDir)) {
    fs.mkdirSync(pluginSkillsDir, { recursive: true });
  }
  fs.copyFileSync(path.join(srcDir, 'skills', 'aether-ui', 'SKILL.md'), path.join(pluginSkillsDir, 'SKILL.md'));
  console.log(`  Copied skills/aether-ui/SKILL.md`);

  // Copy node_modules if missing
  const targetNodeModules = path.join(target, 'node_modules');
  if (!fs.existsSync(targetNodeModules)) {
    console.log(`  Copying node_modules to ${targetNodeModules}...`);
    copyDirRecursive(path.join(srcDir, 'node_modules'), targetNodeModules);
    console.log(`  Copied node_modules`);
  }
}

// Deploy desktop plugin
const desktopDir = path.dirname(desktopTarget);
if (!fs.existsSync(desktopDir)) {
  fs.mkdirSync(desktopDir, { recursive: true });
}
fs.copyFileSync(path.join(srcDir, 'desktop/plugin.js'), desktopTarget);
console.log('Deployed desktop plugin to:', desktopTarget);

// Deploy to global and profile skills locations
const globalSkillsDirs = [
  'C:/Users/BENIFA/AppData/Local/hermes/skills/aether-ui',
  'C:/Users/BENIFA/AppData/Local/hermes/profiles/test-aether/skills/aether-ui',
];
for (const sDir of globalSkillsDirs) {
  if (!fs.existsSync(sDir)) {
    fs.mkdirSync(sDir, { recursive: true });
  }
  fs.copyFileSync(path.join(srcDir, 'skills', 'aether-ui', 'SKILL.md'), path.join(sDir, 'SKILL.md'));
  console.log('Deployed skill to:', path.join(sDir, 'SKILL.md'));
}

console.log('Deployment complete!');
