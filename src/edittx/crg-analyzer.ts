import { Project, SyntaxKind, Node, SourceFile } from 'ts-morph';
import { AstJsxElementSymbol } from '../models/ast.model';
import { AstIndexer } from '../ast/indexer';

export interface ConditionalAncestorInfo {
  hasConditionalParent: boolean;
  conditionKind?: 'binary_and' | 'ternary' | 'if_branch';
  conditionExpressionText?: string;
}

export interface ComponentReferenceNode {
  componentName: string;
  filePath: string;
  importedBy: string[]; // filePaths
  instantiatedIn: {
    filePath: string;
    line: number;
  }[];
  isSharedAcrossPages: boolean;
}

export class CrgAnalyzer {
  private project: Project;

  constructor() {
    this.project = new Project({ useInMemoryFileSystem: true });
  }

  /**
   * Evaluates if a target element in the AST has conditional parent ancestors
   * (e.g. `isOpen && <Target />` or `isLoggedIn ? <Target /> : null`).
   */
  public analyzeConditionalAncestors(code: string, targetUid: string): ConditionalAncestorInfo {
    const sourceFile = this.project.createSourceFile('crg_temp.tsx', code, { overwrite: true });

    const targetElement = this.findJsxElementByUid(sourceFile, targetUid);
    if (!targetElement) {
      return { hasConditionalParent: false };
    }

    let current: Node | undefined = targetElement.getParent();

    while (current && !Node.isSourceFile(current)) {
      // 1. Check Binary logical expression: `foo && <Target />`
      if (Node.isBinaryExpression(current)) {
        const op = current.getOperatorToken().getKind();
        if (op === SyntaxKind.AmpersandAmpersandToken || op === SyntaxKind.BarBarToken) {
          return {
            hasConditionalParent: true,
            conditionKind: 'binary_and',
            conditionExpressionText: current.getLeft().getText(),
          };
        }
      }

      // 2. Check ConditionalExpression (ternary): `cond ? <Target /> : <Other />`
      if (Node.isConditionalExpression(current)) {
        return {
          hasConditionalParent: true,
          conditionKind: 'ternary',
          conditionExpressionText: current.getCondition().getText(),
        };
      }

      // 3. Check IfStatement enclosing the JSX
      if (Node.isIfStatement(current)) {
        return {
          hasConditionalParent: true,
          conditionKind: 'if_branch',
          conditionExpressionText: current.getExpression().getText(),
        };
      }

      current = current.getParent();
    }

    return { hasConditionalParent: false };
  }

  /**
   * Constructs the Component Reference Graph (CRG) across all files in the project.
   */
  public buildComponentReferenceGraph(
    files: Array<{ filePath: string; content: string }>
  ): Map<string, ComponentReferenceNode> {
    const crg = new Map<string, ComponentReferenceNode>();

    // 1. Load files into project
    for (const f of files) {
      this.project.createSourceFile(f.filePath, f.content, { overwrite: true });
    }

    const sourceFiles = this.project.getSourceFiles();

    // 2. Identify all component definitions
    for (const sf of sourceFiles) {
      const filePath = sf.getFilePath().replace(/\\/g, '/');

      // Functions
      for (const fn of sf.getFunctions()) {
        const name = fn.getName();
        if (name && /^[A-Z]/.test(name)) {
          crg.set(name, {
            componentName: name,
            filePath,
            importedBy: [],
            instantiatedIn: [],
            isSharedAcrossPages: false,
          });
        }
      }

      // Variables
      for (const varDecl of sf.getVariableDeclarations()) {
        const name = varDecl.getName();
        if (/^[A-Z]/.test(name)) {
          crg.set(name, {
            componentName: name,
            filePath,
            importedBy: [],
            instantiatedIn: [],
            isSharedAcrossPages: false,
          });
        }
      }
    }

    // 3. Trace imports and JSX instantiations
    for (const sf of sourceFiles) {
      const currentFilePath = sf.getFilePath().replace(/\\/g, '/');

      // Check imports
      for (const imp of sf.getImportDeclarations()) {
        for (const named of imp.getNamedImports()) {
          const importName = named.getName();
          const node = crg.get(importName);
          if (node && node.filePath !== currentFilePath && !node.importedBy.includes(currentFilePath)) {
            node.importedBy.push(currentFilePath);
          }
        }
      }

      // Check JSX element instantiations
      const jsxOpens = [
        ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
        ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
      ];

      for (const jsx of jsxOpens) {
        const tagName = jsx.getTagNameNode().getText();
        const node = crg.get(tagName);
        if (node) {
          node.instantiatedIn.push({
            filePath: currentFilePath,
            line: jsx.getStartLineNumber(),
          });
        }
      }
    }

    // 4. Mark shared components (instantiated across multiple different files)
    for (const node of crg.values()) {
      const uniqueFiles = new Set(node.instantiatedIn.map((i) => i.filePath));
      node.isSharedAcrossPages = uniqueFiles.size > 1;
    }

    return crg;
  }

  private findJsxElementByUid(sourceFile: SourceFile, targetUid: string): Node | null {
    const jsxElements = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];

    for (const el of jsxElements) {
      const attr = el.getAttribute('data-aether-uid');
      if (attr && Node.isJsxAttribute(attr)) {
        const init = attr.getInitializer();
        if (init && init.getText().replace(/^["']|["']$/g, '') === targetUid) {
          return el;
        }
      }
    }

    return null;
  }
}
