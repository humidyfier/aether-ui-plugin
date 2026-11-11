import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PathGuard, PathSecurityError } from '../src/safety/security/path-guard';

describe('Module 5 Requirement 4: Context Security Boundary & Untrusted Data Protection', () => {
  const testBaseDir = path.resolve('.tmp_test_security');
  const allowedRoot = path.join(testBaseDir, 'project');
  const outsideDir = path.join(testBaseDir, 'outside');

  beforeEach(() => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
    fs.mkdirSync(allowedRoot, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    fs.writeFileSync(path.join(outsideDir, 'secret_passwords.txt'), 'SUPER_SECRET_123');
    fs.writeFileSync(path.join(allowedRoot, 'normal_file.txt'), 'Hello safe world');
  });

  afterEach(() => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
  });

  test('Rejects directory traversal attempts escaping allowed root', () => {
    const maliciousPaths = [
      '../outside/secret_passwords.txt',
      '../../outside/secret_passwords.txt',
      'src/../../secret_passwords.txt',
      '..\\outside\\secret_passwords.txt',
    ];

    for (const p of maliciousPaths) {
      assert.throws(
        () => {
          PathGuard.validatePath(p, allowedRoot);
        },
        PathSecurityError,
        `Expected PathSecurityError for traversal: ${p}`
      );
    }
  });

  test('Detects and blocks symlink escape attempts pointing outside allowed boundary', () => {
    const targetOutsideFile = path.join(outsideDir, 'secret_passwords.txt');
    const symlinkInside = path.join(allowedRoot, 'sneaky_symlink.txt');

    try {
      fs.symlinkSync(targetOutsideFile, symlinkInside, 'file');
    } catch {
      // Symlink creation might require privileges on Windows; if so, skip symlink test
      return;
    }

    assert.throws(
      () => {
        PathGuard.validatePath('sneaky_symlink.txt', allowedRoot);
      },
      PathSecurityError
    );
  });

  test('Blocks access to sensitive secret and credential files (.env, .ssh, .git, credentials.json)', () => {
    const sensitiveFiles = [
      '.env',
      '.env.production',
      '.env.local',
      'credentials.json',
      '.git/config',
      '.ssh/id_rsa',
      'secrets.yaml',
    ];

    for (const rel of sensitiveFiles) {
      const fullPath = path.join(allowedRoot, rel);
      assert.throws(
        () => {
          PathGuard.validatePath(fullPath, allowedRoot, { rejectSecrets: true });
        },
        PathSecurityError,
        `Expected PathSecurityError for secret: ${rel}`
      );
    }
  });

  test('Allows safe file reading and writing within valid project boundary', () => {
    const safeRel = 'src/components/Card.tsx';
    const content = 'export const Card = () => <div>Safe Card</div>;';

    PathGuard.safeWriteFile(path.join(allowedRoot, safeRel), content, allowedRoot);
    const read = PathGuard.safeReadFile(path.join(allowedRoot, safeRel), allowedRoot);

    assert.strictEqual(read, content);
  });
});
