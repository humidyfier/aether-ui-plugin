export * from './brief.schema';
export * from './ux.schema';
export * from './ui.schema';
export * from './edit-plan.schema';

import { validateBriefExtraction } from './brief.schema';
import { validateUXAlternatives } from './ux.schema';
import { validateUIConcepts } from './ui.schema';
import { validateScopedEditPlan } from './edit-plan.schema';

export type PipelineStageType = 'BRIEF_EXTRACTION' | 'UX_GENERATION' | 'UI_SYNTHESIS' | 'SCOPED_EDIT_PLAN';

export class PipelineSchemaValidator {
  public static validate(stage: PipelineStageType, rawJson: unknown) {
    switch (stage) {
      case 'BRIEF_EXTRACTION':
        return validateBriefExtraction(rawJson);
      case 'UX_GENERATION':
        return validateUXAlternatives(rawJson);
      case 'UI_SYNTHESIS':
        return validateUIConcepts(rawJson);
      case 'SCOPED_EDIT_PLAN':
        return validateScopedEditPlan(rawJson);
      default:
        throw new Error(`Unknown pipeline stage type: ${stage}`);
    }
  }
}
