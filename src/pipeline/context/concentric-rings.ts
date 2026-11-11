import { Project, SyntaxKind, Node, SourceFile, JsxOpeningElement, JsxSelfClosingElement } from 'ts-morph';
import { CrgAnalyzer } from '../../edittx/crg-analyzer';
import { UIConcept } from '../../models/ui.model';

export interface RingContextItem {
  ring: number; // 0 to 4
  name: string;
  category: 'target_node' | 'ancestor_chain' | 'design_tokens' | 'siblings_and_calls' | 'library_contracts';
  content: string;
}

export class ConcentricRingsExtractor {
  private project: Project;
  private crgAnalyzer: CrgAnalyzer;

  constructor() {
    this.project = new Project({ useInMemoryFileSystem: true });
    this.crgAnalyzer = new CrgAnalyzer();
  }

  /**
   * Extracts all 5 concentric rings for a given target element and project environment.
   */
  public extractRings(options: {
    targetUid: string;
    filePath: string;
    sourceCode: string;
    uiConcept?: UIConcept;
    tailwindConfigSnippet?: string;
    projectFiles?: Array<{ filePath: string; content: string }>;
  }): RingContextItem[] {
    const {
      targetUid,
      filePath,
      sourceCode,
      uiConcept,
      tailwindConfigSnippet,
      projectFiles = [],
    } = options;

    const items: RingContextItem[] = [];
    const sourceFile = this.project.createSourceFile(filePath, sourceCode, { overwrite: true });

    // ----------------------------------------------------
    // Ring 0: Target Node (Immediate element AST & props)
    // ----------------------------------------------------
    const targetOpening = this.findJsxElementByUid(sourceFile, targetUid);
    const targetElement = targetOpening && Node.isJsxOpeningElement(targetOpening)
      ? targetOpening.getParentIfKind(SyntaxKind.JsxElement) || targetOpening
      : targetOpening;

    if (targetElement && targetOpening) {
      items.push({
        ring: 0,
        name: `Target Element <${targetOpening.getTagNameNode().getText()}> [${targetUid}]`,
        category: 'target_node',
        content: targetElement.getText(),
      });
    }

    // ----------------------------------------------------
    // Ring 1: Layout Ancestor Chain (Enclosing flex/grid/parent/condition)
    // ----------------------------------------------------
    if (targetElement) {
      const ancestorChain: string[] = [];
      let current: Node | undefined = targetElement.getParent();

      while (current && !Node.isSourceFile(current)) {
        if (
          Node.isJsxElement(current) ||
          Node.isBinaryExpression(current) ||
          Node.isConditionalExpression(current) ||
          Node.isFunctionDeclaration(current) ||
          Node.isVariableDeclaration(current)
        ) {
          const summary = Node.isJsxElement(current)
            ? current.getOpeningElement().getText()
            : Node.isBinaryExpression(current) || Node.isConditionalExpression(current)
            ? `Condition: ${current.getText().slice(0, 80)}...`
            : `Component Declaration: ${current.getText().slice(0, 100)}...`;
          ancestorChain.push(summary);
        }
        current = current.getParent();
      }

      if (ancestorChain.length > 0) {
        items.push({
          ring: 1,
          name: 'Layout Ancestor Chain & Conditions',
          category: 'ancestor_chain',
          content: ancestorChain.reverse().join('\n  └── '),
        });
      }
    }

    // ----------------------------------------------------
    // Ring 2: Design Tokens & Tailwind Config
    // ----------------------------------------------------
    const tokenParts: string[] = [];
    if (uiConcept) {
      tokenParts.push(`UI Concept: "${uiConcept.name}" (${uiConcept.styleApproach})`);
      tokenParts.push(`Primary Colors: ${JSON.stringify(uiConcept.palette, null, 2)}`);
      tokenParts.push(`Typography Scale: ${JSON.stringify(uiConcept.typography.scale, null, 2)}`);
      tokenParts.push(`Density Mode: ${uiConcept.density.mode} (Unit: ${uiConcept.density.spacingUnit}px)`);
    }
    if (tailwindConfigSnippet) {
      tokenParts.push(`Tailwind / Theme Tokens:\n${tailwindConfigSnippet}`);
    }

    if (tokenParts.length > 0) {
      items.push({
        ring: 2,
        name: 'Design Tokens & Tailwind Theme Configuration',
        category: 'design_tokens',
        content: tokenParts.join('\n\n'),
      });
    }

    // ----------------------------------------------------
    // Ring 3: Sibling & Call Sites (CRG instantiations)
    // ----------------------------------------------------
    if (targetElement) {
      const parent = targetElement.getParent();
      const siblingNodes: string[] = [];

      if (parent) {
        for (const child of parent.getChildren()) {
          if (
            (Node.isJsxElement(child) || Node.isJsxSelfClosingElement(child)) &&
            child !== targetElement &&
            child !== (Node.isJsxElement(targetElement.getParent()) ? targetElement.getParent() : null)
          ) {
            siblingNodes.push(child.getText().slice(0, 120));
          }
        }
      }

      let siblingContent = siblingNodes.length > 0
        ? `Siblings:\n${siblingNodes.join('\n')}`
        : 'No direct JSX siblings.';

      if (projectFiles.length > 0) {
        const crg = this.crgAnalyzer.buildComponentReferenceGraph(projectFiles);
        const crgEntries = Array.from(crg.values()).filter((c) => c.importedBy.length > 0);
        if (crgEntries.length > 0) {
          siblingContent += `\nCall Sites & CRG Imports:\n${crgEntries
            .map((e) => `- ${e.componentName} (imported by: ${e.importedBy.join(', ')})`)
            .join('\n')}`;
        }
      }

      items.push({
        ring: 3,
        name: 'Sibling Elements & Component Call Sites',
        category: 'siblings_and_calls',
        content: siblingContent,
      });
    }

    // ----------------------------------------------------
    // Ring 4: Library Contracts & Icons
    // ----------------------------------------------------
    const importDecls = sourceFile.getImportDeclarations();
    const libraryContracts: string[] = [];

    for (const imp of importDecls) {
      const mod = imp.getModuleSpecifierValue();
      if (!mod.startsWith('.')) {
        libraryContracts.push(imp.getText());
      }
    }

    if (libraryContracts.length > 0) {
      items.push({
        ring: 4,
        name: 'External Library Contracts & Icon Imports',
        category: 'library_contracts',
        content: libraryContracts.join('\n'),
      });
    }

    return items;
  }

  private findJsxElementByUid(sourceFile: SourceFile, targetUid: string): JsxOpeningElement | JsxSelfClosingElement | null {
    const jsxOpens = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];

    for (const el of jsxOpens) {
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
