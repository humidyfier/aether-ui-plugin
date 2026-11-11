import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ShadowWorktree } from '../src/sandbox/shadow-worktree';
import {
  CandidateDependencyInstaller,
  CommandRunner,
  CommandExecutionResult,
} from '../src/safety/dependencies/dependency-installer';
import { ZeroDependencyFallback } from '../src/safety/dependencies/zero-dependency-fallback';

describe('Module 5 Requirement 2: Isolated Dependency Installer & Fallback (pnpm virtual store)', () => {
  const testBaseDir = path.resolve('.tmp_test_dependencies');
  const hostDir = path.join(testBaseDir, 'host');
  const sandboxDir = path.join(testBaseDir, 'sandbox');
  let worktree: ShadowWorktree;

  beforeEach(() => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
    fs.mkdirSync(hostDir, { recursive: true });
    worktree = new ShadowWorktree(hostDir, sandboxDir, 'slot-b-candidate');
    worktree.populateSyntheticScaffold();
  });

  afterEach(() => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
  });

  test('[MOCK RUNNER] Successful dependency install passes pnpm virtual store flags', async () => {
    let capturedCmd = '';
    let capturedArgs: string[] = [];
    let capturedCwd = '';

    const mockRunner: CommandRunner = {
      async exec(cmd: string, args: string[], cwd: string): Promise<CommandExecutionResult> {
        capturedCmd = cmd;
        capturedArgs = args;
        capturedCwd = cwd;
        return { exitCode: 0, stdout: 'Packages added', stderr: '' };
      },
    };

    const installer = new CandidateDependencyInstaller(worktree, mockRunner);
    const result = await installer.installPackages(['lucide-react@^0.300.0']);

    assert.strictEqual(result.success, true);
    assert.strictEqual(capturedCmd, 'pnpm');
    assert.ok(capturedArgs.includes('add'));
    assert.ok(capturedArgs.includes('lucide-react@^0.300.0'));
    assert.ok(capturedArgs.some((a) => a.startsWith('--virtual-store-dir=')));
    assert.ok(capturedArgs.includes('--ignore-scripts'));
    assert.strictEqual(capturedCwd, worktree.getWorktreePath());
  });

  test('[MOCK RUNNER] Install failure rolls back package.json and triggers ZeroDependencyFallback', async () => {
    // 1. Initial valid package.json
    const initialPkg = JSON.stringify({ name: 'test-app', dependencies: { react: '^18.0.0' } }, null, 2);
    worktree.writeCandidateFile('package.json', initialPkg);

    // 2. Component attempting to import lucide-react Search and Bell icons
    const componentCode = `import React from 'react';
import { Search, Bell } from 'lucide-react';

export const Header = () => (
  <header>
    <Search className="w-4 h-4" />
    <Bell className="w-4 h-4" />
  </header>
);`;
    worktree.writeCandidateFile('src/Header.tsx', componentCode);

    // Mock runner simulating package installation failure (e.g., registry offline / peer conflict)
    const failingRunner: CommandRunner = {
      async exec(): Promise<CommandExecutionResult> {
        return { exitCode: 1, stdout: '', stderr: 'ERR_PNPM_FETCH_404: Package not found' };
      },
    };

    const installer = new CandidateDependencyInstaller(worktree, failingRunner);
    const result = await installer.installPackages(['lucide-react']);

    // Assert overall install result failed gracefully
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.fallbackApplied, true);
    assert.ok(result.modifiedFiles.includes('src/Header.tsx'));

    // Assert package.json was safely rolled back
    const rolledBackPkg = worktree.readFile('package.json');
    assert.strictEqual(rolledBackPkg, initialPkg);

    // Assert Header.tsx was rewritten to replace failed imports with inline SVG fallbacks
    const updatedHeader = worktree.readFile('src/Header.tsx');
    assert.strictEqual(updatedHeader.includes("from 'lucide-react'"), false);
    assert.ok(updatedHeader.includes('AETHER ZERO-DEPENDENCY FALLBACK'));
    assert.ok(updatedHeader.includes('const Search = (props: React.SVGProps<SVGSVGElement>) => ('));
    assert.ok(updatedHeader.includes('const Bell = (props: React.SVGProps<SVGSVGElement>) => ('));
  });

  test('[UNIT TEST] ZeroDependencyFallback generates valid inline SVG replacement for icons', () => {
    const input = `import { Search, Check, X } from 'lucide-react';
export const Test = () => <div><Search /><Check /><X /></div>;`;

    const result = ZeroDependencyFallback.replaceFailedPackageWithInlineFallbacks(input, 'lucide-react');
    assert.strictEqual(result.replacementsCount, 3);
    assert.strictEqual(result.transformedContent.includes("from 'lucide-react'"), false);
    assert.ok(result.transformedContent.includes('circle cx="11" cy="11" r="8"'));
    assert.ok(result.transformedContent.includes('polyline points="20 6 9 17 4 12"'));
  });
});
