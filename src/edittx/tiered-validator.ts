import { Project } from 'ts-morph';
import { FiberBridgeServer } from '../bridge/fiber-bridge-server';
import { ViewportProbe } from '../audit/viewport-probe';
import { AccessibilityChecker } from '../audit/accessibility-checker';
import { EditTier, EditTxMutation, EditTxValidationResult, ProposedDiffResult, EditScope } from './models';
import { CrgAnalyzer } from './crg-analyzer';

export class TieredValidator {
  private project: Project;
  private viewportProbe: ViewportProbe;
  private a11yChecker: AccessibilityChecker;
  private crgAnalyzer: CrgAnalyzer;

  constructor() {
    this.project = new Project({ useInMemoryFileSystem: true });
    this.viewportProbe = new ViewportProbe();
    this.a11yChecker = new AccessibilityChecker();
    this.crgAnalyzer = new CrgAnalyzer();
  }

  /**
   * Classifies an incoming edit into Tier 1, Tier 2, or Tier 3.
   */
  public classifyTier(mutation: EditTxMutation, scope: EditScope, isSharedComponent = false): EditTier {
    if (scope === 'PROJECT' || scope === 'SHARED_COMPONENT' || isSharedComponent) {
      return 'TIER_3_PROPOSED_DIFF';
    }

    if (mutation.type === 'REPLACE_SUBTREE') {
      return 'TIER_2_SCOPED_SUBTREE';
    }

    if (
      mutation.type === 'MERGE_CLASSNAMES' ||
      mutation.type === 'UPDATE_STYLE' ||
      mutation.type === 'UPDATE_PROP' ||
      mutation.type === 'UPDATE_TEXT'
    ) {
      return 'TIER_1_DETERMINISTIC';
    }

    return 'TIER_2_SCOPED_SUBTREE';
  }

  /**
   * Runs the appropriate validation checks according to the transaction tier.
   */
  public async validateCandidate(options: {
    tier: EditTier;
    txId: string;
    filePath: string;
    candidateCode: string;
    targetUid: string;
    bridgeServer?: FiberBridgeServer;
    awaitHmrAck?: boolean;
    elementLayoutMetrics?: Array<{
      uid: string;
      tagName: string;
      width: number;
      height: number;
      scrollWidth?: number;
      clientWidth?: number;
      isInteractive?: boolean;
    }>;
    styleNodeInspections?: Array<{
      uid?: string;
      tagName: string;
      color?: string;
      backgroundColor?: string;
      hasAnimation?: boolean;
      hasReducedMotionQuery?: boolean;
    }>;
  }): Promise<EditTxValidationResult> {
    const {
      tier,
      txId,
      filePath,
      candidateCode,
      targetUid,
      bridgeServer,
      awaitHmrAck = false,
      elementLayoutMetrics = [],
      styleNodeInspections = [],
    } = options;

    const errors: string[] = [];

    // 1. AST Parsing & Diagnostics check
    const sourceFile = this.project.createSourceFile(filePath, candidateCode, { overwrite: true });

    let tsDiagnosticsResult: EditTxValidationResult['tsDiagnostics'];

    if (tier === 'TIER_2_SCOPED_SUBTREE' || tier === 'TIER_3_PROPOSED_DIFF') {
      // Full TypeScript diagnostics for Tier 2/3
      const diagnostics = sourceFile.getPreEmitDiagnostics();
      const errorDiags = diagnostics.filter((d) => d.getCategory() === 1 /* DiagnosticCategory.Error */);

      tsDiagnosticsResult = {
        hasErrors: errorDiags.length > 0,
        errorCount: errorDiags.length,
        diagnostics: errorDiags.map((d) => ({
          message: d.getMessageText().toString(),
          line: d.getLineNumber(),
          code: d.getCode(),
        })),
      };

      if (errorDiags.length > 0) {
        errors.push(`TypeScript pre-emit diagnostic errors: ${errorDiags.length} error(s) detected.`);
      }
    } else {
      // Tier 1 Fast Path: basic syntax error check
      const syntaxErrors = sourceFile.getPreEmitDiagnostics().filter((d) => d.getCode() < 2000);
      tsDiagnosticsResult = {
        hasErrors: syntaxErrors.length > 0,
        errorCount: syntaxErrors.length,
        diagnostics: syntaxErrors.map((d) => ({
          message: d.getMessageText().toString(),
          line: d.getLineNumber(),
          code: d.getCode(),
        })),
      };

      if (syntaxErrors.length > 0) {
        errors.push(`Syntax error in Tier 1 candidate code: ${syntaxErrors[0].getMessageText()}`);
      }
    }

    // 2. Fiber Bridge HMR ACK (if bridge is active and requested)
    let hmrResult: any = undefined;
    if (bridgeServer && awaitHmrAck) {
      hmrResult = await bridgeServer.waitForHmrAck(txId, 1500);
      if (!hmrResult.verified) {
        errors.push(`Vite Fiber Bridge HMR ACK failed: ${hmrResult.error || 'DOM verification failed'}`);
      }
    }

    // 3. Viewport Probe (Tier 2/3)
    let viewportIssues: any[] = [];
    if (tier === 'TIER_2_SCOPED_SUBTREE' && elementLayoutMetrics.length > 0) {
      const probeRes = this.viewportProbe.probeAllViewports({
        mobile: elementLayoutMetrics,
        tablet: elementLayoutMetrics,
        desktop: elementLayoutMetrics,
      });

      viewportIssues = [...probeRes.mobile, ...probeRes.tablet, ...probeRes.desktop];
      const criticalViewportIssues = viewportIssues.filter((i) => i.severity === 'CRITICAL');
      if (criticalViewportIssues.length > 0) {
        errors.push(`Viewport Probe critical violation: ${criticalViewportIssues[0].message}`);
      }
    }

    // 4. Accessibility Checker (Tier 2/3)
    let a11yIssues: any[] = [];
    if (tier === 'TIER_2_SCOPED_SUBTREE' && styleNodeInspections.length > 0) {
      a11yIssues = this.a11yChecker.auditElements(styleNodeInspections);
      const criticalA11yIssues = a11yIssues.filter((i) => i.severity === 'CRITICAL');
      if (criticalA11yIssues.length > 0) {
        errors.push(`Accessibility critical violation: ${criticalA11yIssues[0].message}`);
      }
    }

    const passed = errors.length === 0;

    const structuredEvidence: Record<string, import('./models').StructuredValidationEvidence> = {
      typescript: {
        status: tsDiagnosticsResult?.hasErrors ? 'FAILED' : (tier === 'TIER_1_DETERMINISTIC' ? 'PASSED' : (tsDiagnosticsResult ? 'PASSED' : 'UNVERIFIED')),
        method: 'TS_COMPILER_DIAGNOSTICS',
        checked_scope: [filePath],
        unverified_limits: ['Diagnostics evaluated in-memory on ts-morph AST; full workspace typecheck requires build step'],
        failures: tsDiagnosticsResult?.diagnostics.map((d) => d.message) || [],
      },
      viewport: {
        status: viewportIssues.length > 0 ? 'FAILED' : (elementLayoutMetrics.length > 0 ? 'PASSED' : 'UNVERIFIED'),
        method: 'SYNTHETIC_METRIC_PROBE',
        checked_scope: elementLayoutMetrics.map((e) => e.uid),
        unverified_limits: ['Evaluates synthetic/provided ElementLayoutMetric; true visual overflow requires headless browser DOM rendering'],
        failures: viewportIssues.map((v) => v.message),
      },
      accessibility: {
        status: a11yIssues.length > 0 ? 'FAILED' : (styleNodeInspections.length > 0 ? 'PASSED' : 'UNVERIFIED'),
        method: 'STATIC_AST_HEURISTIC',
        checked_scope: styleNodeInspections.map((s) => s.uid || s.tagName),
        unverified_limits: ['Evaluates contrast ratios and reduced-motion AST rules; does not run full axe-core browser audit'],
        failures: a11yIssues.map((a) => a.message),
      },
    };

    return {
      passed,
      tier,
      tsDiagnostics: tsDiagnosticsResult,
      hmrHandshake: hmrResult,
      viewportIssues: viewportIssues.length > 0 ? viewportIssues : undefined,
      accessibilityIssues: a11yIssues.length > 0 ? a11yIssues : undefined,
      structuredEvidence,
      errors,
    };
  }

  /**
   * Generates a Tier 3 Proposed Diff result for user review without applying to candidate worktree.
   */
  public generateProposedDiff(
    txId: string,
    targetUid: string,
    filePath: string,
    originalCode: string,
    proposedCode: string,
    scope: EditScope,
    affectedComponents: string[] = [],
    affectedPages: string[] = []
  ): ProposedDiffResult {
    const unifiedDiff = this.computeUnifiedDiff(originalCode, proposedCode, filePath);

    return {
      tier: 'TIER_3_PROPOSED_DIFF',
      txId,
      targetUid,
      filePath,
      scope,
      unifiedDiff,
      affectedComponents,
      affectedPages,
      requiresClarification: true,
      clarificationMessage: `Tier 3 change impacts ${scope} scope (${affectedComponents.join(', ')}). Review proposed diff before committing to candidate sandbox.`,
      userConfirmationRequired: true,
    };
  }

  private computeUnifiedDiff(original: string, updated: string, filename: string): string {
    const origLines = original.split('\n');
    const updatedLines = updated.split('\n');

    let diffText = `--- a/${filename}\n+++ b/${filename}\n@@ -1,${origLines.length} +1,${updatedLines.length} @@\n`;

    for (let i = 0; i < Math.max(origLines.length, updatedLines.length); i++) {
      const o = origLines[i];
      const u = updatedLines[i];

      if (o !== u) {
        if (o !== undefined) diffText += `-${o}\n`;
        if (u !== undefined) diffText += `+${u}\n`;
      } else {
        diffText += ` ${o}\n`;
      }
    }

    return diffText;
  }
}
