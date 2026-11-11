import { Project, SyntaxKind, Node, SourceFile, JsxOpeningElement, JsxSelfClosingElement } from 'ts-morph';
import { twMerge } from 'tailwind-merge';
import { EditTxMutation } from './models';

export class AstSurgeon {
  private project: Project;

  constructor() {
    this.project = new Project({ useInMemoryFileSystem: true });
  }

  /**
   * Applies an atomic AST surgery mutation to a specific target JSX element in the code.
   */
  public applyMutation(code: string, mutation: EditTxMutation, filePath = 'App.tsx'): string {
    const sourceFile = this.project.createSourceFile(filePath, code, { overwrite: true });

    const targetElement = this.findJsxElementByUid(sourceFile, mutation.targetUid);
    if (!targetElement) {
      throw new Error(`Target element with UID "${mutation.targetUid}" not found in AST.`);
    }

    switch (mutation.type) {
      case 'MERGE_CLASSNAMES':
        this.mergeClasses(targetElement, mutation.classesToAdd, mutation.classesToRemove);
        break;

      case 'UPDATE_PROP':
        if (mutation.propName) {
          this.updateAttribute(targetElement, mutation.propName, mutation.propValue || '');
        }
        break;

      case 'UPDATE_STYLE':
        if (mutation.propName && mutation.propValue !== undefined) {
          this.updateInlineStyle(targetElement, mutation.propName, mutation.propValue);
        }
        break;

      case 'UPDATE_TEXT':
        if (mutation.newText !== undefined) {
          this.updateJsxText(targetElement, mutation.newText);
        }
        break;

      case 'REPLACE_SUBTREE':
        if (mutation.newSubtreeJsx !== undefined) {
          this.replaceSubtree(targetElement, mutation.newSubtreeJsx);
        }
        break;

      default:
        throw new Error(`Unsupported mutation type: ${(mutation as any).type}`);
    }

    return sourceFile.getFullText();
  }

  private findJsxElementByUid(
    sourceFile: SourceFile,
    targetUid: string
  ): JsxOpeningElement | JsxSelfClosingElement | null {
    const elements: (JsxOpeningElement | JsxSelfClosingElement)[] = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];

    for (const el of elements) {
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

  private mergeClasses(
    element: JsxOpeningElement | JsxSelfClosingElement,
    classesToAdd = '',
    classesToRemove = ''
  ): void {
    const classAttr = element.getAttribute('className') || element.getAttribute('class');
    let existingClasses = '';

    if (classAttr && Node.isJsxAttribute(classAttr)) {
      const init = classAttr.getInitializer();
      if (init) {
        existingClasses = init.getText().replace(/^["']|["']$/g, '');
      }
    }

    // Filter out classes to remove
    let classTokens = existingClasses.split(/\s+/).filter(Boolean);
    if (classesToRemove) {
      const removeSet = new Set(classesToRemove.split(/\s+/).filter(Boolean));
      classTokens = classTokens.filter((c) => !removeSet.has(c));
    }

    // Merge with tailwind-merge to resolve utility conflicts deterministically
    const merged = twMerge(classTokens.join(' '), classesToAdd).trim();

    if (classAttr && Node.isJsxAttribute(classAttr)) {
      classAttr.setInitializer(`"${merged}"`);
    } else {
      element.addAttribute({
        name: 'className',
        initializer: `"${merged}"`,
      });
    }
  }

  private updateAttribute(
    element: JsxOpeningElement | JsxSelfClosingElement,
    propName: string,
    propValue: string
  ): void {
    const existing = element.getAttribute(propName);
    if (existing && Node.isJsxAttribute(existing)) {
      existing.setInitializer(`"${propValue}"`);
    } else {
      element.addAttribute({
        name: propName,
        initializer: `"${propValue}"`,
      });
    }
  }

  private updateInlineStyle(
    element: JsxOpeningElement | JsxSelfClosingElement,
    styleProp: string,
    styleValue: string
  ): void {
    const styleAttr = element.getAttribute('style');

    if (styleAttr && Node.isJsxAttribute(styleAttr)) {
      const init = styleAttr.getInitializer();
      if (init && Node.isJsxExpression(init)) {
        const exp = init.getExpression();
        if (exp && Node.isObjectLiteralExpression(exp)) {
          const prop = exp.getProperty(styleProp);
          if (prop && Node.isPropertyAssignment(prop)) {
            prop.setInitializer(`'${styleValue}'`);
            return;
          } else {
            exp.addPropertyAssignment({
              name: styleProp,
              initializer: `'${styleValue}'`,
            });
            return;
          }
        }
      }
    }

    // If style prop doesn't exist, create it: style={{ [styleProp]: 'value' }}
    element.addAttribute({
      name: 'style',
      initializer: `{{ ${styleProp}: '${styleValue}' }}`,
    });
  }

  private updateJsxText(
    element: JsxOpeningElement | JsxSelfClosingElement,
    newText: string
  ): void {
    const parent = element.getParent();
    if (parent && Node.isJsxElement(parent)) {
      parent.setBodyText(newText);
    }
  }

  private replaceSubtree(
    element: JsxOpeningElement | JsxSelfClosingElement,
    newSubtreeJsx: string
  ): void {
    const parent = element.getParent();
    if (parent && Node.isJsxElement(parent)) {
      parent.setBodyText(newSubtreeJsx);
    } else {
      element.replaceWithText(newSubtreeJsx);
    }
  }
}
