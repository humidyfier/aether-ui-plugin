/**
 * State Machine Data Models
 * Enforces strict lifecycle state transitions matching the PRD specification:
 * Idle -> Gathering Brief -> Generating UX -> UX Review -> Generating UI -> UI Review ->
 * Preview Ready -> Applying Edit -> Implementation Approval -> Building -> Build Success / Build Failure
 */

export type LifecycleState =
  | 'Idle'
  | 'Gathering Brief'
  | 'Generating UX'
  | 'UX Review'
  | 'Searching References'
  | 'Generating UI'
  | 'UI Review'
  | 'Preview Ready'
  | 'Applying Edit'
  | 'Implementation Approval'
  | 'Building'
  | 'Build Success'
  | 'Build Failure'
  | 'Conflict';

export interface StateTransitionEvent {
  id: string;
  fromState: LifecycleState;
  toState: LifecycleState;
  action: string;
  payload?: Record<string, unknown>;
  timestamp: string;
  actor: 'user' | 'agent' | 'system';
  checkpointId?: string;
}

export interface TransitionGuardContext {
  currentState: LifecycleState;
  briefId?: string;
  hasBrief: boolean;
  isBriefReady: boolean;
  selectedUxDirectionId?: string;
  selectedUiConceptId?: string;
  hasActivePreview: boolean;
  hasPendingEdit: boolean;
  isApprovedForImplementation: boolean;
  lastCheckpointId?: string;
  metadata?: Record<string, unknown>;
}

export interface TransitionValidationResult {
  allowed: boolean;
  reason?: string;
  requiredAction?: string;
}
