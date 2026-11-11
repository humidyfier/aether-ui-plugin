import { LifecycleState, TransitionGuardContext, TransitionValidationResult } from '../models/state.model';

export const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  Idle: ['Gathering Brief'],
  'Gathering Brief': ['Generating UX', 'UX Review', 'Idle'],
  'Generating UX': ['UX Review', 'Gathering Brief'],
  'UX Review': ['Generating UX', 'Generating UI', 'UI Review', 'Searching References', 'Gathering Brief'],
  'Searching References': ['UI Review', 'UX Review'],
  'Generating UI': ['UI Review', 'UX Review'],
  'UI Review': ['Generating UI', 'Preview Ready', 'UX Review', 'Searching References'],
  'Preview Ready': ['Applying Edit', 'Implementation Approval', 'UI Review', 'UX Review', 'Conflict'],
  'Applying Edit': ['Preview Ready', 'Conflict'],
  'Implementation Approval': ['Building', 'Preview Ready'],
  Building: ['Build Success', 'Build Failure'],
  'Build Success': ['Preview Ready', 'Idle'],
  'Build Failure': ['Implementation Approval', 'Preview Ready', 'Building'],
  Conflict: ['Preview Ready', 'Gathering Brief'],
};

export class TransitionRules {
  /**
   * Validates whether a requested transition is allowable under strict PRD invariants.
   */
  public static validateTransition(
    fromState: LifecycleState,
    toState: LifecycleState,
    context: TransitionGuardContext
  ): TransitionValidationResult {
    // 1. Structural graph validity
    const allowedTargets = VALID_TRANSITIONS[fromState];
    if (!allowedTargets || !allowedTargets.includes(toState)) {
      return {
        allowed: false,
        reason: `Illegal state transition from "${fromState}" to "${toState}". Allowed next states: [${(allowedTargets || []).join(', ')}]`,
      };
    }

    // 2. Guard conditions for specific stages
    switch (toState) {
      case 'UX Review':
      case 'Generating UX': {
        if (!context.hasBrief) {
          return {
            allowed: false,
            reason: 'Cannot transition to UX phase without an existing ProjectBrief.',
            requiredAction: 'Create a ProjectBrief first.',
          };
        }
        if (!context.isBriefReady) {
          return {
            allowed: false,
            reason: 'ProjectBrief readiness gate not passed (missing core product context or primary audience/task).',
            requiredAction: 'Complete the minimum required fields in the ProjectBrief.',
          };
        }
        break;
      }

      case 'UI Review':
      case 'Generating UI': {
        if (!context.selectedUxDirectionId) {
          return {
            allowed: false,
            reason: 'Cannot transition to UI phase without selecting a UXDirection (BR-02: UX before UI).',
            requiredAction: 'Select or approve a UXDirection first.',
          };
        }
        break;
      }

      case 'Preview Ready': {
        // If coming from UI Review, must have selected a UIConcept
        if (fromState === 'UI Review' && !context.selectedUiConceptId) {
          return {
            allowed: false,
            reason: 'Cannot transition to Preview Ready without choosing a UIConcept.',
            requiredAction: 'Select a UIConcept to preview.',
          };
        }
        break;
      }

      case 'Applying Edit': {
        if (fromState !== 'Preview Ready') {
          return {
            allowed: false,
            reason: 'Edits can only be initiated when the system is in "Preview Ready".',
          };
        }
        break;
      }

      case 'Implementation Approval': {
        if (fromState !== 'Preview Ready') {
          return {
            allowed: false,
            reason: 'Implementation approval can only be requested from "Preview Ready".',
          };
        }
        break;
      }

      case 'Building': {
        if (fromState !== 'Implementation Approval' && fromState !== 'Build Failure') {
          return {
            allowed: false,
            reason: 'Building requires explicit Implementation Approval (FR-19 & BR-09).',
            requiredAction: 'Obtain user approval before triggering the build.',
          };
        }
        if (fromState === 'Implementation Approval' && !context.isApprovedForImplementation) {
          return {
            allowed: false,
            reason: 'Implementation approval flag is false. User must explicitly confirm changes.',
            requiredAction: 'Confirm implementation changes.',
          };
        }
        break;
      }
    }

    return { allowed: true };
  }
}
