import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { ManifestEngine } from '../merkle/manifest';
import { VersionManifest } from '../models/checkpoint.model';
import { CandidateWriteResult, ShadowWorktreeConfig } from './models';

export function resolveDefaultSandboxDir(baseHostDir: string): string {
  if (process.env.AETHER_USE_LOCAL_TMP === '1') {
    const hash = crypto.createHash('sha256').update(path.resolve(baseHostDir)).digest('hex').slice(0, 12);
    return path.join(os.tmpdir(), 'aether-sandbox', hash);
  }
  return path.join(baseHostDir, '.aether', 'sandbox');
}

export class HostMutationForbiddenError extends Error {
  constructor(attemptedPath: string) {
    super(
      `[CRITICAL INVARIANT VIOLATION] Direct host file mutation forbidden! Attempted write to "${attemptedPath}". All pre-approval mutations must stay confined inside .aether/sandbox/ (FR-16, FR-19).`
    );
    this.name = 'HostMutationForbiddenError';
  }
}

export class ShadowWorktree {
  private baseHostDir: string;
  private sandboxRootDir: string;
  private worktreePath: string;
  private currentManifest: VersionManifest;

  constructor(
    baseHostDir: string,
    sandboxRootDir = resolveDefaultSandboxDir(baseHostDir),
    worktreeName = 'candidate'
  ) {
    this.baseHostDir = path.resolve(baseHostDir);
    this.sandboxRootDir = path.resolve(sandboxRootDir);
    this.worktreePath = path.join(this.sandboxRootDir, worktreeName);

    this.ensureDirectoryExists(this.sandboxRootDir);
    this.ensureDirectoryExists(this.worktreePath);
    this.currentManifest = ManifestEngine.buildManifestFromDirectory(this.worktreePath);
  }

  public getWorktreePath(): string {
    return this.worktreePath;
  }

  public getSandboxRootDir(): string {
    return this.sandboxRootDir;
  }

  public getCurrentManifest(): VersionManifest {
    return this.currentManifest;
  }

  public getMerkleRoot(): string {
    return this.currentManifest.merkleRoot;
  }

  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Asserts that a target file path is safely located inside the shadow worktree
   * and NOT in the host directory, enforcing FR-16 & FR-19 invariants.
   */
  public assertPathIsWithinSandbox(targetPath: string): void {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedWorktree = path.resolve(this.worktreePath);

    if (!resolvedTarget.startsWith(resolvedWorktree)) {
      throw new HostMutationForbiddenError(targetPath);
    }
  }

  /**
   * Synchronizes / mirrors a subset of host project files into the shadow worktree.
   */
  public mirrorFromHost(subpaths: string[] = ['src', 'public', 'package.json', 'index.html']): void {
    for (const rel of subpaths) {
      const srcPath = path.join(this.baseHostDir, rel);
      const destPath = path.join(this.worktreePath, rel);

      if (fs.existsSync(srcPath)) {
        const stats = fs.statSync(srcPath);
        if (stats.isDirectory()) {
          this.copyDirRecursive(srcPath, destPath);
        } else {
          this.ensureDirectoryExists(path.dirname(destPath));
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }

    this.refreshManifest();
  }

  /**
   * Populates a synthetic/standalone Vite React app into the shadow worktree if host files are absent.
   */
  public populateSyntheticScaffold(): void {
    const pkgJson = {
      name: 'aether-sandbox-preview',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: { dev: 'vite' },
    };

    const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aether UI Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

    const mainTsx = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;

    const appTsx = `import React, { useState } from 'react';

export default function App() {
  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Aether UI Preview Canvas</h1>
      <p>Candidate worktree initialized.</p>
    </div>
  );
}`;

    this.writeFileDirect('package.json', JSON.stringify(pkgJson, null, 2));
    this.writeFileDirect('index.html', indexHtml);
    this.writeFileDirect('src/main.tsx', mainTsx);
    this.writeFileDirect('src/App.tsx', appTsx);
    this.refreshManifest();
  }

  /**
   * Safely writes candidate AST transformations to the shadow worktree.
   * Host project files remain untouched.
   */
  public writeCandidateFile(relativePath: string, content: string | Buffer): CandidateWriteResult {
    const destPath = path.join(this.worktreePath, relativePath);
    this.assertPathIsWithinSandbox(destPath);

    const merkleRootBefore = this.currentManifest.merkleRoot;
    let previousSha256: string | undefined;

    if (fs.existsSync(destPath)) {
      const prevInfo = ManifestEngine.hashFile(destPath);
      previousSha256 = prevInfo.sha256;
    }

    this.ensureDirectoryExists(path.dirname(destPath));
    fs.writeFileSync(destPath, content);

    const fileInfo = ManifestEngine.hashFile(destPath);
    this.refreshManifest();

    return {
      filePath: relativePath.replace(/\\/g, '/'),
      byteSize: fileInfo.byteSize,
      sha256: fileInfo.sha256,
      previousSha256,
      merkleRootBefore,
      merkleRootAfter: this.currentManifest.merkleRoot,
      timestamp: new Date().toISOString(),
    };
  }

  public readFile(relativePath: string): string {
    const destPath = path.join(this.worktreePath, relativePath);
    this.assertPathIsWithinSandbox(destPath);
    if (!fs.existsSync(destPath)) {
      throw new Error(`File "${relativePath}" does not exist in worktree "${this.worktreePath}"`);
    }
    return fs.readFileSync(destPath, 'utf8');
  }

  public existsFile(relativePath: string): boolean {
    const destPath = path.join(this.worktreePath, relativePath);
    return fs.existsSync(destPath);
  }

  public deleteCandidateFile(relativePath: string): boolean {
    const destPath = path.join(this.worktreePath, relativePath);
    this.assertPathIsWithinSandbox(destPath);
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
      this.refreshManifest();
      return true;
    }
    return false;
  }

  public refreshManifest(): VersionManifest {
    this.currentManifest = ManifestEngine.buildManifestFromDirectory(this.worktreePath);
    return this.currentManifest;
  }

  public reset(): void {
    if (fs.existsSync(this.worktreePath)) {
      fs.rmSync(this.worktreePath, { recursive: true, force: true });
    }
    this.ensureDirectoryExists(this.worktreePath);
    this.refreshManifest();
  }

  private writeFileDirect(relativePath: string, content: string): void {
    const fullPath = path.join(this.worktreePath, relativePath);
    this.ensureDirectoryExists(path.dirname(fullPath));
    fs.writeFileSync(fullPath, content, 'utf8');
  }

  private copyDirRecursive(src: string, dest: string): void {
    this.ensureDirectoryExists(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.aether') {
        continue;
      }
      const srcItem = path.join(src, entry.name);
      const destItem = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirRecursive(srcItem, destItem);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcItem, destItem);
      }
    }
  }
}
