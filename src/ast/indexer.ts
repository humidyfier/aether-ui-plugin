import {
  Project,
  SyntaxKind,
  FunctionDeclaration,
  ArrowFunction,
  ClassDeclaration,
  JsxOpeningElement,
  JsxSelfClosingElement,
  Node,
} from 'ts-morph';
import {
  AstComponentSymbol,
  AstJsxElementSymbol,
  FileIndexResult,
  SourceRange,
} from '../models/ast.model';
import { sha256 } from '../merkle/merkle-tree';
import { QuarantineRegistry } from './quarantine';
import { AETHER_UID_ATTR, UidInjector } from './uid-injector';

export class AstIndexer {
  private project: Project;
  private quarantineRegistry: QuarantineRegistry;

  constructor(quarantineRegistry?: QuarantineRegistry) {
    this.project = new Project({ useInMemoryFileSystem: true });
    this.quarantineRegistry = quarantineRegistry || new QuarantineRegistry();
  }

  public getQuarantineRegistry(): QuarantineRegistry {
    return this.quarantineRegistry;
  }

  private getNodeRange(node: Node, sourceText: string): SourceRange {
    const start = node.getStart();
    const end = node.getEnd();

    // Compute line and column (1-based)
    const linesBeforeStart = sourceText.slice(0, start).split('\n');
    const startLine = linesBeforeStart.length;
    const startCol = linesBeforeStart[linesBeforeStart.length - 1].length + 1;

    const linesBeforeEnd = sourceText.slice(0, end).split('\n');
    const endLine = linesBeforeEnd.length;
    const endCol = linesBeforeEnd[linesBeforeEnd.length - 1].length + 1;

    return {
      start: { line: startLine, column: startCol, offset: start },
      end: { line: endLine, column: endCol, offset: end },
    };
  }

  private findEnclosingComponentName(node: Node): string {
    let current: Node | undefined = node.getParent();
    while (current) {
      if (Node.isFunctionDeclaration(current)) {
        return current.getName() || 'AnonymousFunction';
      }
      if (Node.isClassDeclaration(current)) {
        return current.getName() || 'AnonymousClass';
      }
      if (Node.isVariableDeclaration(current)) {
        return current.getName();
      }
      current = current.getParent();
    }
    return 'TopLevel';
  }

  /**
   * Parses and indexes a React/TypeScript source code string.
   */
  public indexSource(code: string, filePath = 'App.tsx'): FileIndexResult {
    const sourceFile = this.project.createSourceFile(filePath, code, { overwrite: true });
    const fullText = sourceFile.getFullText();
    const fileSha256 = sha256(fullText);

    // 1. Extract component declarations
    const components: AstComponentSymbol[] = [];

    // Functions
    const functionDecls = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
    for (const fn of functionDecls) {
      const name = fn.getName();
      if (name && /^[A-Z]/.test(name)) {
        const jsxCount = fn.getDescendantsOfKind(SyntaxKind.JsxElement).length +
          fn.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length;
        if (jsxCount > 0) {
          components.push({
            name,
            filePath,
            kind: 'function',
            isExported: fn.isExported(),
            isDefaultExport: fn.isDefaultExport(),
            range: this.getNodeRange(fn, fullText),
            jsxElementsCount: jsxCount,
            hooksUsed: this.extractHooks(fn),
            propNames: this.extractPropNames(fn),
          });
        }
      }
    }

    // Arrow Functions in Variable Statements
    const varDecls = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
    for (const v of varDecls) {
      const name = v.getName();
      if (/^[A-Z]/.test(name)) {
        const initializer = v.getInitializer();
        if (initializer && Node.isArrowFunction(initializer)) {
          const jsxCount = initializer.getDescendantsOfKind(SyntaxKind.JsxElement).length +
            initializer.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length;
          if (jsxCount > 0) {
            const varStmt = v.getVariableStatement();
            components.push({
              name,
              filePath,
              kind: 'arrow',
              isExported: varStmt ? varStmt.isExported() : false,
              isDefaultExport: varStmt ? varStmt.isDefaultExport() : false,
              range: this.getNodeRange(v, fullText),
              jsxElementsCount: jsxCount,
              hooksUsed: this.extractHooks(initializer),
              propNames: this.extractPropNames(initializer),
            });
          }
        }
      }
    }

    // Class Components
    const classDecls = sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration);
    for (const cls of classDecls) {
      const name = cls.getName();
      if (name && /^[A-Z]/.test(name)) {
        const jsxCount = cls.getDescendantsOfKind(SyntaxKind.JsxElement).length +
          cls.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length;
        if (jsxCount > 0) {
          components.push({
            name,
            filePath,
            kind: 'class',
            isExported: cls.isExported(),
            isDefaultExport: cls.isDefaultExport(),
            range: this.getNodeRange(cls, fullText),
            jsxElementsCount: jsxCount,
            hooksUsed: [],
            propNames: [],
          });
        }
      }
    }

    // 2. Extract JSX Elements and detect duplicates
    const jsxOpening = sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement);
    const jsxSelfClosing = sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
    const rawElements: (JsxOpeningElement | JsxSelfClosingElement)[] = [
      ...jsxOpening,
      ...jsxSelfClosing,
    ].sort((a, b) => a.getStart() - b.getStart());

    const observedUidsInFile = new Map<string, {
      filePath: string;
      tagName: string;
      componentScopeName: string;
      range: SourceRange;
    }[]>();

    const jsxElements: AstJsxElementSymbol[] = [];

    rawElements.forEach((el, idx) => {
      const tagName = el.getTagNameNode().getText();
      const isComponent = /^[A-Z]/.test(tagName);
      const componentScopeName = this.findEnclosingComponentName(el);
      const range = this.getNodeRange(el, fullText);

      // Props extraction
      const props: Record<string, string> = {};
      const attributes = el.getAttributes();
      let uid = '';

      for (const attr of attributes) {
        if (Node.isJsxAttribute(attr)) {
          const attrName = attr.getNameNode().getText();
          const init = attr.getInitializer();
          const val = init ? init.getText().replace(/^["']|["']$/g, '') : 'true';
          props[attrName] = val;
          if (attrName === AETHER_UID_ATTR) {
            uid = val;
          }
        }
      }

      // If no UID is present, provide candidate dev UID
      if (!uid) {
        uid = UidInjector.generateUid(filePath, tagName, idx + 1);
      }

      const occurrence = {
        filePath,
        tagName,
        componentScopeName,
        range,
      };

      // Register with quarantine registry (enforcing Ambiguous Duplicate Quarantine rule with zero auto-resolution)
      this.quarantineRegistry.registerOccurrence(uid, occurrence);

      // Find parent UID
      let parentUid: string | undefined;
      let parentNode: Node | undefined = el.getParent();
      while (parentNode) {
        if (Node.isJsxElement(parentNode)) {
          const parentOpen = parentNode.getOpeningElement();
          const pAttr = parentOpen.getAttribute(AETHER_UID_ATTR);
          if (pAttr && Node.isJsxAttribute(pAttr)) {
            const init = pAttr.getInitializer();
            if (init) parentUid = init.getText().replace(/^["']|["']$/g, '');
          }
          break;
        }
        parentNode = parentNode.getParent();
      }

      jsxElements.push({
        uid,
        tagName,
        isComponent,
        filePath,
        componentScopeName,
        range,
        props,
        hasChildren: Node.isJsxOpeningElement(el) && Boolean(el.getParent()?.getChildren().length),
        parentUid,
      });
    });

    return {
      filePath,
      fileSha256,
      components,
      jsxElements,
      totalElements: jsxElements.length,
      indexedAt: new Date().toISOString(),
    };
  }

  private extractHooks(node: Node): string[] {
    const callExprs = node.getDescendantsOfKind(SyntaxKind.CallExpression);
    const hooks: string[] = [];
    for (const call of callExprs) {
      const exprText = call.getExpression().getText();
      if (/^use[A-Z]/.test(exprText) && !hooks.includes(exprText)) {
        hooks.push(exprText);
      }
    }
    return hooks;
  }

  private extractPropNames(node: FunctionDeclaration | ArrowFunction): string[] {
    const params = node.getParameters();
    if (params.length === 0) return [];
    const firstParam = params[0];
    const nameNode = firstParam.getNameNode();

    if (Node.isObjectBindingPattern(nameNode)) {
      return nameNode.getElements().map((el) => el.getName());
    }

    return [firstParam.getName()];
  }
}
