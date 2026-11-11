import { ProjectBrief } from '../../models/brief.model';
import { UXDirection } from '../../models/ux.model';
import { UIConcept } from '../../models/ui.model';
import { ScopedEditPlan } from '../schemas/edit-plan.schema';
import { EditTxRecord } from '../../edittx/models';
import { ContextAssemblyAuditReport } from '../context/progressive-assembler';

export type PipelineStageName =
  | 'BRIEF_EXTRACTION'
  | 'UX_GENERATION'
  | 'UI_SYNTHESIS'
  | 'EDIT_PLANNING'
  | 'EDIT_EXECUTION';

export interface StageAuditRecord {
  stage: PipelineStageName;
  status: 'PENDING' | 'SUCCESS' | 'SCHEMA_ERROR' | 'VALIDATION_FAILED' | 'ROLLED_BACK';
  timestamp: string;
  contextAudit?: ContextAssemblyAuditReport;
  rawResponse?: string;
  schemaValidationPassed: boolean;
  errors: string[];
}

export interface PipelineExecutionState {
  pipelineId: string;
  currentBrief?: ProjectBrief;
  uxDirections?: UXDirection[];
  selectedUxDirection?: UXDirection;
  uiConcepts?: UIConcept[];
  selectedUiConcept?: UIConcept;
  lastEditPlan?: ScopedEditPlan;
  lastEditTx?: EditTxRecord;
  history: StageAuditRecord[];
}
