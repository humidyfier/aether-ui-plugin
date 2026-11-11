import * as path from 'node:path';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export class PathSecurityError extends Error {
  constructor(message: string) {
    super(`[PATH SECURITY VIOLATION] ${message}`);
    this.name = 'PathSecurityError';
  }
}

export interface PathValidationOptions {
  allowNonExistent?: boolean;
  rejectHidden?: boolean;
  rejectSecrets?: boolean;
}

export class PathGuard {
  private static readonly SECRET_PATTERNS = [
    /\.env(\..+)?$/i,
    /\.git(\/|\\|$)/i,
    /\.ssh(\/|\\|$)/i,
    /id_rsa/i,
    /id_ed25519/i,
    /credentials(\.json)?$/i,
    /secrets?\.ya?ml$/i,
    /\.npmrc$/i,
    /\.netrc$/i,
  ];

  /**
   * Asserts that a path stays strictly confined inside the allowed root directory.
   * Resolves canonical paths to detect symlink escapes and directory traversal.
   */
  public static validatePath(
    targetPath: string,
    allowedRootDir: string,
    options: PathValidationOptions = {}
  ): string {
    const { allowNonExistent = true, rejectHidden = true, rejectSecrets = true } = options;

    const resolvedRoot = path.resolve(allowedRootDir);
    const normalizedTarget = path.normalize(targetPath);

    // 1. Basic path traversal check
    if (normalizedTarget.includes('..')) {
      const resolvedTarget = path.resolve(resolvedRoot, normalizedTarget);
      if (!resolvedTarget.startsWith(resolvedRoot)) {
        throw new PathSecurityError(
          `Directory traversal attempt detected: "${targetPath}" resolves outside allowed root "${resolvedRoot}"`
        );
      }
    }

    const absoluteTarget = path.isAbsolute(normalizedTarget)
      ? path.resolve(normalizedTarget)
      : path.resolve(resolvedRoot, normalizedTarget);

    // 2. Boundary containment check
    if (!absoluteTarget.startsWith(resolvedRoot)) {
      throw new PathSecurityError(
        `Path "${targetPath}" resolves to "${absoluteTarget}", which is outside allowed boundary "${resolvedRoot}"`
      );
    }

    // 3. Symlink escape check (canonical realpath verification)
    if (fs.existsSync(absoluteTarget)) {
      const canonicalTarget = fs.realpathSync(absoluteTarget);
      let canonicalRoot = resolvedRoot;
      if (fs.existsSync(resolvedRoot)) {
        canonicalRoot = fs.realpathSync(resolvedRoot);
      }

      if (!canonicalTarget.startsWith(canonicalRoot)) {
        throw new PathSecurityError(
          `Symlink escape detected: "${targetPath}" points to canonical location "${canonicalTarget}", outside "${canonicalRoot}"`
        );
      }
    } else if (!allowNonExistent) {
      throw new PathSecurityError(`Path does not exist: "${absoluteTarget}"`);
    }

    // 4. Secret & sensitive file pattern detection
    if (rejectSecrets) {
      const rel = path.relative(resolvedRoot, absoluteTarget);
      for (const pattern of PathGuard.SECRET_PATTERNS) {
        if (pattern.test(rel) || pattern.test(path.basename(absoluteTarget))) {
          throw new PathSecurityError(
            `Access to sensitive / secret credential path is strictly forbidden: "${rel}"`
          );
        }
      }
    }

    // 5. Hidden dotfile check (excluding standard root config files if within safe set)
    if (rejectHidden) {
      const base = path.basename(absoluteTarget);
      if (base.startsWith('.') && base !== '.aether') {
        throw new PathSecurityError(
          `Access to hidden dotfile "${base}" is restricted.`
        );
      }
    }

    return absoluteTarget;
  }

  /**
   * Safe read checking path security first.
   */
  public static safeReadFile(filePath: string, allowedRootDir: string): string {
    const validated = PathGuard.validatePath(filePath, allowedRootDir, {
      allowNonExistent: false,
      rejectSecrets: true,
      rejectHidden: false,
    });
    return fs.readFileSync(validated, 'utf8');
  }

  /**
   * Write-time path containment & staged atomic write.
   *
   * Platform Note: On POSIX systems, `O_NOFOLLOW` / `openat2` provides kernel-level symlink protection.
   * On Windows / Node.js, `lstatSync` + canonical `realpath` verification + parent directory containment
   * + atomic temporary write & rename in the same directory provides the safest portable write-time containment.
   */
  public static safeWriteFile(
    filePath: string,
    content: string | Buffer,
    allowedRootDir: string
  ): void {
    const validated = PathGuard.validatePath(filePath, allowedRootDir, {
      allowNonExistent: true,
      rejectSecrets: true,
      rejectHidden: false,
    });

    const parentDir = path.dirname(validated);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Verify parent directory canonical path remains within root
    const canonicalParent = fs.realpathSync(parentDir);
    const canonicalRoot = fs.existsSync(allowedRootDir)
      ? fs.realpathSync(allowedRootDir)
      : path.resolve(allowedRootDir);

    if (!canonicalParent.startsWith(canonicalRoot)) {
      throw new PathSecurityError(
        `Parent directory "${parentDir}" canonical path "${canonicalParent}" escaped root "${canonicalRoot}"`
      );
    }

    // Check if target destination exists and is a symlink (never follow symlink on write)
    if (fs.existsSync(validated)) {
      const lstat = fs.lstatSync(validated);
      if (lstat.isSymbolicLink()) {
        throw new PathSecurityError(
          `Destination "${validated}" is a symlink. Writing through symlinks is strictly forbidden.`
        );
      }
    }

    // Write-time staged atomic write
    const tempFile = path.join(parentDir, `.aether_write_tmp_${randomUUID()}`);
    try {
      fs.writeFileSync(tempFile, content);

      // Verify temp file canonical path before rename
      const canonicalTemp = fs.realpathSync(tempFile);
      if (!canonicalTemp.startsWith(canonicalRoot)) {
        throw new PathSecurityError(
          `Staged temp file "${tempFile}" canonical path "${canonicalTemp}" escaped root "${canonicalRoot}"`
        );
      }

      // Re-verify destination immediately prior to rename (mitigating TOCTOU window)
      if (fs.existsSync(validated)) {
        const lstatAfter = fs.lstatSync(validated);
        if (lstatAfter.isSymbolicLink()) {
          throw new PathSecurityError(
            `Destination "${validated}" became a symlink during staged write (TOCTOU attempt blocked).`
          );
        }
      }

      fs.renameSync(tempFile, validated);
    } catch (err) {
      if (fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {
          // ignore cleanup error
        }
      }
      throw err;
    }
  }
}
