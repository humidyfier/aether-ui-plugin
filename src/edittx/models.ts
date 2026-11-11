import { VersionManifest } from '../models/checkpoint.model';
import { HmrHandshakeResult } from '../bridge/handshake.model';
import { ViewportProbeIssue, AccessibilityIssue } from '../audit/audit.model';

export type EditTier =
  | 'TIER_1_DETERMINISTIC'
  | 'TIER_2_SCOPED_SUBTREE'
  | 'TIER_3_PROPOSED_DIFF';

export type PropertyGroup =
  | 'spacing'      // padding, margin, gap
  | 'color'        // color, backgroundColor, fill, stroke
  | 'typography'   // fontSize, fontWeight, fontFamily, lineHeight, textAlign
  | 'layout'       // display, flex, grid, position, width, height
  | 'content'      // text, children, labels
  | 'custom';

export type EditScope =
  | 'ELEMENT'
  | 'COMPONENT'
  | 'SHARED_COMPONENT'
  | 'FILE'
  | 'PROJECT';

export type EditTxStatus =
  | 'PREPARED'
  | 'APPLYING'
  | 'VALIDATING'
  | 'COMMITTED'
  | 'REJECTED'
  | 'ROLLED_BACK'
  | 'CONFLICT';

export interface RevisionContext {
  baseRevision: string;        // Exact source Merkle root read when transaction was created
  currentSlotBRevision: string;// Current Slot B Merkle root at execution time
  currentHostRevision: string; // Current Host project Merkle root at execution time
}

export interface UserLockRecord {
  id: string;
  targetUid: string;
  propertyGroup: PropertyGroup;
  propertyKey?: string;        // Specific property like 'padding' or 'className'
  semanticValue: string;       // Normalized semantic value
  source: 'user_direct_edit' | 'user_explicit_lock' | 'prompt_constraint';
  lockedAt: string;
  lastAuditedAt: string;
}

export interface ProposedDiffResult {
  tier: 'TIER_3_PROPOSED_DIFF';
  txId: string;
  targetUid: string;
  filePath: string;
  scope: EditScope;
  unifiedDiff: string;
  affectedComponents: string[];
  affectedPages: string[];
  requiresClarification: boolean;
  clarificationMessage: string;
  userConfirmationRequired: true;
}

export type ValidationEvidenceStatus = 'PASSED' | 'FAILED' | 'UNVERIFIED';

export interface StructuredValidationEvidence {
  status: ValidationEvidenceStatus;
  method: 'STATIC_AST_HEURISTIC' | 'SYNTHETIC_METRIC_PROBE' | 'RUNTIME_BROWSER_MEASUREMENT' | 'TS_COMPILER_DIAGNOSTICS';
  checked_scope: string[];
  unverified_limits: string[];
  failures: string[];
}

export interface EditTxValidationResult {
  passed: boolean;
  tier: EditTier;
  tsDiagnostics?: {
    hasErrors: boolean;
    errorCount: number;
    diagnostics: Array<{ message: string; line?: number; code?: number }>;
  };
  hmrHandshake?: HmrHandshakeResult;
  viewportIssues?: ViewportProbeIssue[];
  accessibilityIssues?: AccessibilityIssue[];
  lockViolations?: Array<{ propertyGroup: PropertyGroup; message: string }>;
  structuredEvidence?: Record<string, StructuredValidationEvidence>;
  errors: string[];
}

export interface EditTxMutation {
  type: 'UPDATE_PROP' | 'MERGE_CLASSNAMES' | 'UPDATE_STYLE' | 'UPDATE_TEXT' | 'REPLACE_SUBTREE';
  targetUid: string;
  propertyGroup: PropertyGroup;
  propName?: string;
  propValue?: string;
  classesToAdd?: string;
  classesToRemove?: string;
  newSubtreeJsx?: string;
  newText?: string;
}

export interface EditTxRecord {
  id: string;
  tier: EditTier;
  targetUid: string;
  filePath: string;
  scope: EditScope;
  propertyGroups: PropertyGroup[];
  revisions: RevisionContext;
  mutations: EditTxMutation[];
  exactDiff: string;
  validation: EditTxValidationResult;
  status: EditTxStatus;
  proposedDiff?: ProposedDiffResult;
  createdAt: string;
  completedAt?: string;
  error?: string;
}
