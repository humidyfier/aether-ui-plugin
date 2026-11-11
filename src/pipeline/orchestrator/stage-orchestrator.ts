import { randomUUID } from 'node:crypto';
import { StateLedger } from '../../ledger/ledger';
import { EditTransactionManager, ExecuteTxOptions } from '../../edittx/transaction-manager';
import { PipelineSchemaValidator } from '../schemas';
import { ScopedEditPlan } from '../schemas/edit-plan.schema';
import { ProgressiveContextAssembler } from '../context/progressive-assembler';
import { PipelineExecutionState, StageAuditRecord } from './pipeline-models';
import { ProjectBrief } from '../../models/brief.model';
import { UXDirection } from '../../models/ux.model';
import { UIConcept } from '../../models/ui.model';
import { EditTxRecord } from '../../edittx/models';

export class MultiStagePipelineOrchestrator {
  private ledger: StateLedger;
  private editTxManager: EditTransactionManager;
  private pca: ProgressiveContextAssembler;
  private state: PipelineExecutionState;

  constructor(options: {
    ledger: StateLedger;
    editTxManager: EditTransactionManager;
    pca?: ProgressiveContextAssembler;
  }) {
    this.ledger = options.ledger;
    this.editTxManager = options.editTxManager;
    this.pca = options.pca || new ProgressiveContextAssembler();

    this.state = {
      pipelineId: randomUUID(),
      history: [],
    };
  }

  public getState(): Readonly<PipelineExecutionState> {
    return { ...this.state };
  }

  public getContextAssembler(): ProgressiveContextAssembler {
    return this.pca;
  }

  /**
   * Stage 1: Ingests model response for Brief Extraction and validates against schema.
   */
  public processBriefResponse(rawModelJson: unknown): { success: boolean; brief?: ProjectBrief; errors: string[] } {
    const validation = PipelineSchemaValidator.validate('BRIEF_EXTRACTION', rawModelJson);

    if (!validation.valid || !validation.data) {
      this.recordAudit('BRIEF_EXTRACTION', 'SCHEMA_ERROR', false, validation.errors, JSON.stringify(rawModelJson));
      return { success: false, errors: validation.errors };
    }

    const savedBrief = this.ledger.saveBrief(validation.data as any);
    this.state.currentBrief = savedBrief;
    this.recordAudit('BRIEF_EXTRACTION', 'SUCCESS', true, []);

    // Transition state machine
    try {
      this.ledger.transitionState('Gathering Brief', 'Ingested validated project brief from model');
    } catch {
      // ignore transition error if already in stage
    }

    return { success: true, brief: savedBrief, errors: [] };
  }

  /**
   * Stage 2: Ingests model response for UX Alternative Generation and validates 2-3 directions.
   */
  public processUXResponse(briefId: string, rawModelJson: unknown): { success: boolean; directions?: UXDirection[]; errors: string[] } {
    const validation = PipelineSchemaValidator.validate('UX_GENERATION', rawModelJson);

    if (!validation.valid || !validation.data) {
      this.recordAudit('UX_GENERATION', 'SCHEMA_ERROR', false, validation.errors, JSON.stringify(rawModelJson));
      return { success: false, errors: validation.errors };
    }

    const savedDirections = this.ledger.saveUXAlternatives(briefId, validation.data as any);
    this.state.uxDirections = savedDirections;
    this.recordAudit('UX_GENERATION', 'SUCCESS', true, []);

    try {
      this.ledger.transitionState('UX Review', 'Ingested 2-3 UX alternatives from model');
    } catch {
      // ignore
    }

    return { success: true, directions: savedDirections, errors: [] };
  }

  /**
   * Stage 3: Ingests model response for UI Concept Synthesis and validates 2-3 concepts.
   */
  public processUIResponse(briefId: string, uxDirectionId: string, rawModelJson: unknown): { success: boolean; concepts?: UIConcept[]; errors: string[] } {
    const validation = PipelineSchemaValidator.validate('UI_SYNTHESIS', rawModelJson);

    if (!validation.valid || !validation.data) {
      this.recordAudit('UI_SYNTHESIS', 'SCHEMA_ERROR', false, validation.errors, JSON.stringify(rawModelJson));
      return { success: false, errors: validation.errors };
    }

    const savedConcepts = this.ledger.saveUIConcepts(briefId, uxDirectionId, validation.data as any);
    this.state.uiConcepts = savedConcepts;
    this.recordAudit('UI_SYNTHESIS', 'SUCCESS', true, []);

    try {
      this.ledger.transitionState('UI Review', 'Ingested 2-3 UI concepts from model');
    } catch {
      // ignore
    }

    return { success: true, concepts: savedConcepts, errors: [] };
  }

  /**
   * Stage 4: Validates Scoped Edit Plan schema and routes execution through Module 3 EditTx engine.
   * Invariant: A schema-valid response is NOT authorization to apply it:
   * it must pass EditTx validation gates and tiered checks!
   */
  public async processEditPlanAndExecute(
    rawPlanJson: unknown,
    baseRevision: string,
    executionOverrides: Partial<ExecuteTxOptions> = {}
  ): Promise<{ success: boolean; plan?: ScopedEditPlan; txRecord?: EditTxRecord; errors: string[] }> {
    // 1. Schema Validation Gate
    const schemaValidation = PipelineSchemaValidator.validate('SCOPED_EDIT_PLAN', rawPlanJson);

    if (!schemaValidation.valid || !schemaValidation.data) {
      this.recordAudit('EDIT_PLANNING', 'SCHEMA_ERROR', false, schemaValidation.errors, JSON.stringify(rawPlanJson));
      return { success: false, errors: schemaValidation.errors };
    }

    const plan = schemaValidation.data as ScopedEditPlan;
    this.state.lastEditPlan = plan;
    this.recordAudit('EDIT_PLANNING', 'SUCCESS', true, []);

    // 2. EditTx Execution Gate (Module 3 Engine)
    const txRecord = await this.editTxManager.executeTransaction({
      targetUid: plan.targetUid,
      filePath: plan.filePath,
      mutations: plan.mutations,
      scope: plan.scope,
      baseRevision,
      ...executionOverrides,
    });

    this.state.lastEditTx = txRecord;

    if (txRecord.status === 'COMMITTED') {
      this.recordAudit('EDIT_EXECUTION', 'SUCCESS', true, []);
      return { success: true, plan, txRecord, errors: [] };
    } else if (txRecord.status === 'PREPARED' && txRecord.tier === 'TIER_3_PROPOSED_DIFF') {
      // Tier 3 Reviewable Diff (stopped for clarification/review)
      this.recordAudit('EDIT_EXECUTION', 'PENDING', true, []);
      return { success: true, plan, txRecord, errors: [] };
    } else {
      const errs = txRecord.validation.errors.length > 0 ? txRecord.validation.errors : [txRecord.error || 'EditTx failed'];
      this.recordAudit('EDIT_EXECUTION', txRecord.status === 'ROLLED_BACK' ? 'ROLLED_BACK' : 'VALIDATION_FAILED', true, errs);
      return { success: false, plan, txRecord, errors: errs };
    }
  }

  private recordAudit(
    stage: StageAuditRecord['stage'],
    status: StageAuditRecord['status'],
    schemaValidationPassed: boolean,
    errors: string[],
    rawResponse?: string
  ): void {
    this.state.history.push({
      stage,
      status,
      timestamp: new Date().toISOString(),
      schemaValidationPassed,
      errors,
      rawResponse,
    });
  }
}
