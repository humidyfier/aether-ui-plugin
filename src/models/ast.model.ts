/**
 * AST Indexer Data Models
 * Supports symbol extraction from React/TypeScript files,
 * data-aether-uid tracking, and Ambiguous Duplicate Quarantine registry.
 */

export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export interface AstJsxElementSymbol {
  uid: string;
  tagName: string;
  isComponent: boolean; // true if PascalCase (React Component), false if lowercase (DOM element)
  filePath: string;
  componentScopeName: string; // enclosing function/class component name
  range: SourceRange;
  props: Record<string, string>;
  hasChildren: boolean;
  parentUid?: string;
}

export interface AstComponentSymbol {
  name: string;
  filePath: string;
  kind: 'function' | 'arrow' | 'class';
  isExported: boolean;
  isDefaultExport: boolean;
  range: SourceRange;
  jsxElementsCount: number;
  hooksUsed: string[];
  propNames: string[];
}

export interface FileIndexResult {
  filePath: string;
  fileSha256: string;
  components: AstComponentSymbol[];
  jsxElements: AstJsxElementSymbol[];
  totalElements: number;
  indexedAt: string;
}

export type QuarantineStatus = 'ACTIVE' | 'RESOLVED';

export interface QuarantinedDuplicateRecord {
  uid: string;
  status: QuarantineStatus;
  detectedAt: string;
  occurrences: {
    filePath: string;
    tagName: string;
    componentScopeName: string;
    range: SourceRange;
  }[];
  reason: string;
}

export interface IndexerStats {
  filesIndexed: number;
  componentsIndexed: number;
  elementsIndexed: number;
  quarantinedDuplicates: number;
}
