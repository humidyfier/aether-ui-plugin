import { Project, SyntaxKind, JsxOpeningElement, JsxSelfClosingElement } from 'ts-morph';
import { sha256 } from '../merkle/merkle-tree';

export const AETHER_UID_ATTR = 'data-aether-uid';

export interface InjectionResult {
  transformedCode: string;
  injectedCount: number;
  uids: string[];
}

export class UidInjector {
  /**
   * Generates a deterministic UID based on file path, tag name, and node index.
   */
  public static generateUid(filePath: string, tagName: string, index: number): string {
    const fileHash = sha256(filePath.replace(/\\/g, '/')).slice(0, 8);
    return `aether-${fileHash}-${tagName.toLowerCase()}-${index}`;
  }

  /**
   * Injects dev-time `data-aether-uid` attributes into all JSX elements.
   * If an element already has a data-aether-uid, it is preserved or reported.
   */
  public static injectDevUids(code: string, filePath = 'anonymous.tsx'): InjectionResult {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(filePath, code);

    const jsxOpeningElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement);
    const jsxSelfClosingElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);

    const allElements: (JsxOpeningElement | JsxSelfClosingElement)[] = [
      ...jsxOpeningElements,
      ...jsxSelfClosingElements,
    ].sort((a, b) => a.getStart() - b.getStart());

    const uids: string[] = [];
    let injectedCount = 0;

    allElements.forEach((element, index) => {
      const tagName = element.getTagNameNode().getText();
      const existingAttribute = element.getAttribute(AETHER_UID_ATTR);

      if (existingAttribute) {
        // Element already has attribute
        const val = existingAttribute.getText();
        const cleanVal = val.replace(/^data-aether-uid=["']?/, '').replace(/["']$/, '');
        uids.push(cleanVal);
      } else {
        const uid = UidInjector.generateUid(filePath, tagName, index + 1);
        element.addAttribute({
          name: AETHER_UID_ATTR,
          initializer: `"${uid}"`,
        });
        uids.push(uid);
        injectedCount++;
      }
    });

    return {
      transformedCode: sourceFile.getFullText(),
      injectedCount,
      uids,
    };
  }

  /**
   * Strips ALL dev-time `data-aether-uid` attributes from code for zero production DOM leak.
   */
  public static stripDevUids(code: string, filePath = 'anonymous.tsx'): string {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(filePath, code);

    const jsxOpeningElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement);
    const jsxSelfClosingElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);

    const allElements: (JsxOpeningElement | JsxSelfClosingElement)[] = [
      ...jsxOpeningElements,
      ...jsxSelfClosingElements,
    ];

    for (const element of allElements) {
      const attr = element.getAttribute(AETHER_UID_ATTR);
      if (attr) {
        attr.remove();
      }
    }

    return sourceFile.getFullText();
  }

  /**
   * Rigorous AST-level verification asserting that ZERO data-aether-uid attributes exist.
   * Throws Error if any production leak is detected.
   */
  public static verifyZeroProductionLeak(code: string, filePath = 'anonymous.tsx'): boolean {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(filePath, code);

    const jsxOpeningElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement);
    const jsxSelfClosingElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);

    for (const el of [...jsxOpeningElements, ...jsxSelfClosingElements]) {
      if (el.getAttribute(AETHER_UID_ATTR)) {
        throw new Error(
          `[CRITICAL INVARIANT VIOLATION] Production DOM leak detected! Element <${el.getTagNameNode().getText()}> retains ${AETHER_UID_ATTR}`
        );
      }
    }

    if (code.includes('data-aether-uid=')) {
      throw new Error(
        `[CRITICAL INVARIANT VIOLATION] Raw code string contains ${AETHER_UID_ATTR} attribute assignment!`
      );
    }

    return true;
  }
}
