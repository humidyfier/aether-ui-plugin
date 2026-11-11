import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { Project } from 'ts-morph';
import { ShadowWorktree } from '../../sandbox/shadow-worktree';
import { ZeroDependencyFallback } from './zero-dependency-fallback';

export interface CommandExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  exec(cmd: string, args: string[], cwd: string): Promise<CommandExecutionResult>;
}

export class DefaultPnpmRunner implements CommandRunner {
  public exec(cmd: string, args: string[], cwd: string): Promise<CommandExecutionResult> {
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const executable = isWin ? 'cmd.exe' : cmd;
      const cmdArgs = isWin ? ['/c', cmd, ...args] : args;

      execFile(executable, cmdArgs, { cwd, timeout: 30000 }, (error, stdout, stderr) => {
        resolve({
          exitCode: error ? (error as any).code || 1 : 0,
          stdout: stdout || '',
          stderr: stderr || (error ? error.message : ''),
        });
      });
    });
  }
}

export interface DependencyInstallResult {
  success: boolean;
  attemptedPackages: string[];
  installedPackages: string[];
  failedPackages: string[];
  fallbackApplied: boolean;
  modifiedFiles: string[];
  errorMessage?: string;
  virtualStoreDir: string;
  requiresUserReview?: boolean;
  reviewOptions?: Array<'PROCEED_WITHOUT_PACKAGE' | 'RETRY_WITH_FLAGS' | 'ABORT_EDIT'>;
  unmappedIcons?: string[];
  smokeCheckPassed?: boolean;
}

export class CandidateDependencyInstaller {
  private candidateWorktree: ShadowWorktree;
  private commandRunner: CommandRunner;
  private static readonly LOCKFILE_NAMES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];

  constructor(
    candidateWorktree: ShadowWorktree,
    commandRunner: CommandRunner = new DefaultPnpmRunner()
  ) {
    this.candidateWorktree = candidateWorktree;
    this.commandRunner = commandRunner;
  }

  /**
   * Installs candidate dependencies in isolation using pnpm virtual store isolation.
   * If installation fails, rolls back package.json and lockfile together.
   * Restricts zero-dependency fallback strictly to allowlisted libraries with exact SVG mappings.
   */
  public async installPackages(
    packages: string[],
    isDev = false
  ): Promise<DependencyInstallResult> {
    const worktreePath = this.candidateWorktree.getWorktreePath();
    const virtualStoreDir = path.join(worktreePath, '.pnpm-virtual-store');

    // 1. Snapshot package.json AND active lockfiles together
    let originalPackageJson: string | null = null;
    if (this.candidateWorktree.existsFile('package.json')) {
      originalPackageJson = this.candidateWorktree.readFile('package.json');
    }

    const originalLockfiles: Record<string, string> = {};
    for (const lockfileName of CandidateDependencyInstaller.LOCKFILE_NAMES) {
      if (this.candidateWorktree.existsFile(lockfileName)) {
        originalLockfiles[lockfileName] = this.candidateWorktree.readFile(lockfileName);
      }
    }

    // 2. Prepare command with pnpm virtual store isolation flags
    const args = [
      'add',
      ...packages,
      isDev ? '-D' : '',
      `--virtual-store-dir=${virtualStoreDir}`,
      '--ignore-scripts', // Security invariant: never execute untrusted lifecycle scripts
    ].filter(Boolean);

    const execResult = await this.commandRunner.exec('pnpm', args, worktreePath);

    if (execResult.exitCode === 0) {
      this.candidateWorktree.refreshManifest();

      // 3. Post-install TypeScript compile smoke check
      const smokeCheckPassed = this.runSmokeCheck();

      return {
        success: smokeCheckPassed,
        attemptedPackages: packages,
        installedPackages: smokeCheckPassed ? packages : [],
        failedPackages: smokeCheckPassed ? [] : packages,
        fallbackApplied: false,
        modifiedFiles: ['package.json'],
        virtualStoreDir,
        smokeCheckPassed,
        errorMessage: smokeCheckPassed ? undefined : 'Post-install TypeScript diagnostics smoke check failed.',
      };
    }

    // ==========================================
    // INSTALLATION FAILED: ROLLBACK & CONTROLLED FALLBACK
    // ==========================================
    // 1. Rollback package.json AND lockfiles together
    this.rollbackPackageAndLockfiles(originalPackageJson, originalLockfiles);

    // 2. Scan candidate source files and evaluate fallback suitability
    const modifiedFiles: string[] = [];
    const unmappedIconsList: string[] = [];
    let fallbackForbidden = false;
    const candidateManifest = this.candidateWorktree.getCurrentManifest();

    for (const pkg of packages) {
      const cleanPkgName = pkg.replace(/@[^/]+$/, '');

      // Check if package is allowlisted
      if (!ZeroDependencyFallback.ALLOWLISTED_ICON_LIBRARIES.includes(cleanPkgName)) {
        fallbackForbidden = true;
        break;
      }

      for (const f of candidateManifest.files) {
        if (f.relativePath.endsWith('.tsx') || f.relativePath.endsWith('.jsx')) {
          const currentCode = this.candidateWorktree.readFile(f.relativePath);
          if (currentCode.includes(cleanPkgName)) {
            const fallbackResult = ZeroDependencyFallback.replaceFailedPackageWithInlineFallbacks(
              currentCode,
              cleanPkgName,
              f.relativePath
            );

            if (!fallbackResult.canFallback) {
              fallbackForbidden = true;
              if (fallbackResult.unmappedIcons) {
                unmappedIconsList.push(...fallbackResult.unmappedIcons);
              }
              break;
            }

            if (fallbackResult.replacementsCount > 0) {
              this.candidateWorktree.writeCandidateFile(
                f.relativePath,
                fallbackResult.transformedContent
              );
              modifiedFiles.push(f.relativePath);
            }
          }
        }
      }

      if (fallbackForbidden) {
        break;
      }
    }

    if (fallbackForbidden) {
      // Revert any partial file fallbacks
      this.candidateWorktree.refreshManifest();
      return {
        success: false,
        attemptedPackages: packages,
        installedPackages: [],
        failedPackages: packages,
        fallbackApplied: false,
        modifiedFiles: [],
        errorMessage: `Dependency installation failed for ${packages.join(', ')}. Automatic fallback forbidden for non-allowlisted packages or unmapped icons.`,
        virtualStoreDir,
        requiresUserReview: true,
        reviewOptions: ['PROCEED_WITHOUT_PACKAGE', 'RETRY_WITH_FLAGS', 'ABORT_EDIT'],
        unmappedIcons: unmappedIconsList,
      };
    }

    this.candidateWorktree.refreshManifest();

    return {
      success: false,
      attemptedPackages: packages,
      installedPackages: [],
      failedPackages: packages,
      fallbackApplied: modifiedFiles.length > 0,
      modifiedFiles,
      errorMessage: execResult.stderr || 'Dependency installation failed',
      virtualStoreDir,
    };
  }

  private rollbackPackageAndLockfiles(
    originalPackageJson: string | null,
    originalLockfiles: Record<string, string>
  ): void {
    if (originalPackageJson) {
      this.candidateWorktree.writeCandidateFile('package.json', originalPackageJson);
    }

    for (const lockfileName of CandidateDependencyInstaller.LOCKFILE_NAMES) {
      if (originalLockfiles[lockfileName]) {
        this.candidateWorktree.writeCandidateFile(lockfileName, originalLockfiles[lockfileName]);
      } else if (this.candidateWorktree.existsFile(lockfileName)) {
        this.candidateWorktree.deleteCandidateFile(lockfileName);
      }
    }
  }

  private runSmokeCheck(): boolean {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        jsx: 4 /* ts.JsxEmit.ReactJSX */,
        allowJs: true,
        target: 99 /* ts.ScriptTarget.ESNext */,
        module: 99 /* ts.ModuleKind.ESNext */,
        noEmit: true,
      },
    });
    const manifest = this.candidateWorktree.getCurrentManifest();

    for (const f of manifest.files) {
      if (f.relativePath.endsWith('.tsx') || f.relativePath.endsWith('.ts')) {
        project.createSourceFile(f.relativePath, this.candidateWorktree.readFile(f.relativePath));
      }
    }

    const ignoredCodes = new Set([2304, 2307, 2503, 2686, 2741, 2807, 7016, 7026]);

    for (const sf of project.getSourceFiles()) {
      const diags = sf.getPreEmitDiagnostics().filter((d) => {
        if (ignoredCodes.has(d.getCode())) return false;
        const msg = String(d.getMessageText());
        if (msg.includes('react/jsx-runtime') || msg.includes('JSX.IntrinsicElements')) return false;
        return d.getCategory() === 1;
      });
      if (diags.length > 0) {
        return false;
      }
    }

    return true;
  }
}
