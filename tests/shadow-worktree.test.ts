import { test, describe, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  ShadowWorktree,
  HostMutationForbiddenError,
} from '../src/index';

describe('Module 2 Requirement 1: Shadow Worktree Sandbox Isolation', () => {
  const testHostDir = path.join(process.cwd(), '.tmp_test_host_dir');
  const testSandboxDir = path.join(testHostDir, '.aether', 'sandbox');

  afterEach(() => {
    if (fs.existsSync(testHostDir)) {
      fs.rmSync(testHostDir, { recursive: true, force: true });
    }
  });

  test('Creates isolated worktree inside .aether/sandbox/ and builds manifest', () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const worktree = new ShadowWorktree(testHostDir, testSandboxDir, 'candidate');

    assert.ok(worktree.getWorktreePath().includes(path.join('.aether', 'sandbox', 'candidate')));
    assert.strictEqual(fs.existsSync(worktree.getWorktreePath()), true);
    assert.ok(worktree.getMerkleRoot());
  });

  test('Host Isolation Invariant: Throws HostMutationForbiddenError on attempted write outside sandbox', () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const worktree = new ShadowWorktree(testHostDir, testSandboxDir, 'candidate');

    // Attempting to write directly to host root
    assert.throws(
      () => {
        worktree.assertPathIsWithinSandbox(path.join(testHostDir, 'src', 'App.tsx'));
      },
      (err: any) => {
        assert.ok(err instanceof HostMutationForbiddenError);
        assert.ok(err.message.includes('Direct host file mutation forbidden'));
        return true;
      }
    );
  });

  test('Candidate write updates sandbox file and computes new Merkle root without touching host', () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const worktree = new ShadowWorktree(testHostDir, testSandboxDir, 'candidate');

    const writeRes = worktree.writeCandidateFile('src/Button.tsx', 'export const Button = () => <button>Click</button>;');

    assert.strictEqual(writeRes.filePath, 'src/Button.tsx');
    assert.ok(writeRes.sha256);
    assert.notStrictEqual(writeRes.merkleRootBefore, writeRes.merkleRootAfter);

    // Verify sandbox has file
    assert.strictEqual(worktree.existsFile('src/Button.tsx'), true);
    assert.strictEqual(worktree.readFile('src/Button.tsx').includes('export const Button'), true);

    // Verify host root does NOT have the file
    assert.strictEqual(fs.existsSync(path.join(testHostDir, 'src', 'Button.tsx')), false);
  });

  test('Populates synthetic Vite React scaffold', () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const worktree = new ShadowWorktree(testHostDir, testSandboxDir, 'candidate');

    worktree.populateSyntheticScaffold();

    assert.strictEqual(worktree.existsFile('package.json'), true);
    assert.strictEqual(worktree.existsFile('index.html'), true);
    assert.strictEqual(worktree.existsFile('src/main.tsx'), true);
    assert.strictEqual(worktree.existsFile('src/App.tsx'), true);
    assert.ok(worktree.getCurrentManifest().files.length >= 4);
  });
});
