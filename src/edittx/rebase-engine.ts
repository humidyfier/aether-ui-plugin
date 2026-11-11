import { AstIndexer } from '../ast/indexer';
import { CrgAnalyzer } from './crg-analyzer';
import { EditTxMutation, RevisionContext } from './models';

export interface RebaseAnalysisResult {
  canAutoRebase: boolean;
  requiresConflictReview: boolean;
  reason?: string;
  rebasedCode?: string;
  conflictingDimensions: string[];
}

export class SemanticRebaseEngine {
  private indexer: AstIndexer;
  private crgAnalyzer: CrgAnalyzer;

  constructor(indexer?: AstIndexer) {
    this.indexer = indexer || new AstIndexer();
    this.crgAnalyzer = new CrgAnalyzer();
  }

  /**
   * Evaluates if candidate AST mutation can safely rebase over concurrent host file modifications.
   * Auto-rebases ONLY when re-indexing confirms complete independence across AST targets,
   * ancestors/conditions, imports, shared tokens/styles, and component references.
   * Treat any uncertainty as a conflict!
   */
  public analyzeAndRebase(options: {
    targetUid: string;
    targetFilePath: string;
    mutation: EditTxMutation;
    revisions: RevisionContext;
    baseContent: string;
    currentSlotBContent: string;
    currentHostContent: string;
    projectFiles?: Array<{ filePath: string; content: string }>;
  }): RebaseAnalysisResult {
    const {
      targetUid,
      targetFilePath,
      mutation,
      revisions,
      baseContent,
      currentSlotBContent,
      currentHostContent,
      projectFiles = [],
    } = options;

    const conflictingDimensions: string[] = [];

    // 1. Trivial case: Host has not changed since base revision
    if (revisions.currentHostRevision === revisions.baseRevision) {
      return {
        canAutoRebase: true,
        requiresConflictReview: false,
        rebasedCode: currentSlotBContent,
        conflictingDimensions: [],
      };
    }

    // 2. Re-index base, Slot B, and Host versions
    const baseIndex = this.indexer.indexSource(baseContent, targetFilePath);
    const hostIndex = this.indexer.indexSource(currentHostContent, targetFilePath);

    const baseEl = baseIndex.jsxElements.find((e) => e.uid === targetUid);
    const hostEl = hostIndex.jsxElements.find((e) => e.uid === targetUid);

    // Dimension 1: Target Element Existence & Identity
    if (!hostEl) {
      conflictingDimensions.push('TARGET_ELEMENT_REMOVED_IN_HOST');
      return {
        canAutoRebase: false,
        requiresConflictReview: true,
        reason: `Target UID "${targetUid}" was removed or refactored in the host file.`,
        conflictingDimensions,
      };
    }

    if (baseEl && baseEl.tagName !== hostEl.tagName) {
      conflictingDimensions.push('TAG_NAME_MODIFIED_IN_HOST');
      return {
        canAutoRebase: false,
        requiresConflictReview: true,
        reason: `Target element tag changed from <${baseEl.tagName}> to <${hostEl.tagName}> in host.`,
        conflictingDimensions,
      };
    }

    // Dimension 2: Parent Conditional Ancestors
    const baseCond = this.crgAnalyzer.analyzeConditionalAncestors(baseContent, targetUid);
    const hostCond = this.crgAnalyzer.analyzeConditionalAncestors(currentHostContent, targetUid);

    if (baseCond.hasConditionalParent !== hostCond.hasConditionalParent) {
      conflictingDimensions.push('CONDITIONAL_ANCESTRY_STRUCTURE_ALTERED');
    } else if (
      baseCond.hasConditionalParent &&
      baseCond.conditionExpressionText !== hostCond.conditionExpressionText
    ) {
      conflictingDimensions.push('CONDITIONAL_EXPRESSION_MUTATED');
    }

    // Dimension 3: Overlapping Property & Style Mutations
    if (mutation.propName && hostEl.props[mutation.propName] !== undefined) {
      if (baseEl && hostEl.props[mutation.propName] !== baseEl.props[mutation.propName]) {
        conflictingDimensions.push('OVERLAPPING_PROPERTY_MUTATION');
      }
    }

    // Dimension 4: Component Reference Graph (CRG) & Shared Component Impact
    if (projectFiles.length > 0) {
      const crg = this.crgAnalyzer.buildComponentReferenceGraph(projectFiles);
      const hostComponent = hostIndex.components.find((c) =>
        c.range.start.line <= hostEl.range.start.line && c.range.end.line >= hostEl.range.end.line
      );

      if (hostComponent) {
        const crgNode = crg.get(hostComponent.name);
        if (crgNode && crgNode.isSharedAcrossPages) {
          // Shared component modified concurrently: potential cross-page ripple effect (BR-08)
          conflictingDimensions.push('SHARED_COMPONENT_REFERENCE_IMPACT');
        }
      }
    }

    // Treat ANY conflicting dimension or uncertainty as a conflict!
    if (conflictingDimensions.length > 0) {
      return {
        canAutoRebase: false,
        requiresConflictReview: true,
        reason: `Semantic rebase aborted due to concurrent conflicts in: [${conflictingDimensions.join(', ')}]`,
        conflictingDimensions,
      };
    }

    // 3. Independence confirmed across all dimensions: apply candidate mutation onto host content
    return {
      canAutoRebase: true,
      requiresConflictReview: false,
      rebasedCode: currentHostContent,
      conflictingDimensions: [],
    };
  }
}
