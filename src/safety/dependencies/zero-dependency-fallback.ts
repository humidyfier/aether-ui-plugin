import { Project } from 'ts-morph';

export interface FallbackReplacementResult {
  filePath: string;
  originalImport: string;
  replacementsCount: number;
  transformedContent: string;
  canFallback: boolean;
  unmappedIcons: string[];
  reason?: string;
}

export class ZeroDependencyFallback {
  public static readonly ALLOWLISTED_ICON_LIBRARIES = ['lucide-react'];

  private static readonly INLINE_ICON_FALLBACKS: Record<string, string> = {
    Search: `const Search = (props: React.SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);`,
    Bell: `const Bell = (props: React.SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);`,
    User: `const User = (props: React.SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);`,
    Check: `const Check = (props: React.SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);`,
    X: `const X = (props: React.SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);`,
    ChevronDown: `const ChevronDown = (props: React.SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);`,
  };

  /**
   * Evaluates and applies fallback ONLY if the library is explicitly allowlisted
   * AND every single imported icon has an exact, verified local SVG mapping.
   * Does NOT substitute code silently for unsupported icons or non-icon packages.
   */
  public static replaceFailedPackageWithInlineFallbacks(
    sourceCode: string,
    failedPackageName: string,
    filePath = 'Component.tsx'
  ): FallbackReplacementResult {
    // 1. Strict Allowlist Gate
    if (!this.ALLOWLISTED_ICON_LIBRARIES.includes(failedPackageName)) {
      return {
        filePath,
        originalImport: '',
        replacementsCount: 0,
        transformedContent: sourceCode,
        canFallback: false,
        unmappedIcons: [],
        reason: `Package "${failedPackageName}" is not an allowlisted icon library. Silent code substitution is strictly forbidden.`,
      };
    }

    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(filePath, sourceCode, { overwrite: true });

    let originalImport = '';
    const namedImportsList: string[] = [];
    let matchedImportDecl: any = null;

    for (const imp of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = imp.getModuleSpecifierValue();
      if (moduleSpecifier === failedPackageName || moduleSpecifier.startsWith(`${failedPackageName}/`)) {
        originalImport = imp.getText();
        matchedImportDecl = imp;
        for (const named of imp.getNamedImports()) {
          namedImportsList.push(named.getName());
        }
      }
    }

    if (!matchedImportDecl || namedImportsList.length === 0) {
      return {
        filePath,
        originalImport: '',
        replacementsCount: 0,
        transformedContent: sourceCode,
        canFallback: false,
        unmappedIcons: [],
        reason: 'No matching icon imports found in source code.',
      };
    }

    // 2. Exact Local Mapping Verification Gate
    const unmappedIcons = namedImportsList.filter((name) => !this.INLINE_ICON_FALLBACKS[name]);

    if (unmappedIcons.length > 0) {
      // Forbidden from silent substitution
      return {
        filePath,
        originalImport,
        replacementsCount: 0,
        transformedContent: sourceCode,
        canFallback: false,
        unmappedIcons,
        reason: `Icons lack exact local SVG mappings: ${unmappedIcons.join(', ')}. Silent code substitution aborted.`,
      };
    }

    // 3. All icons verified: perform replacement
    const inlineDeclarations = namedImportsList.map((name) => this.INLINE_ICON_FALLBACKS[name]);
    matchedImportDecl.remove();

    const existing = sourceFile.getFullText();
    const fallbacksBlock =
      `\n// --- [AETHER ZERO-DEPENDENCY FALLBACK: ${failedPackageName}] ---\n` +
      inlineDeclarations.join('\n\n') +
      `\n// ----------------------------------------------------------------\n`;

    return {
      filePath,
      originalImport,
      replacementsCount: namedImportsList.length,
      transformedContent: fallbacksBlock + existing,
      canFallback: true,
      unmappedIcons: [],
    };
  }
}
