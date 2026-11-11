import { randomUUID } from 'node:crypto';
import {
  LifecycleState,
  StateTransitionEvent,
  TransitionGuardContext,
  TransitionValidationResult,
} from '../models/state.model';
import { TransitionRules } from './transitions';

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly fromState: LifecycleState,
    public readonly toState: LifecycleState,
    public readonly validation: TransitionValidationResult
  ) {
    super(
      `[STATE INVARIANT ERROR] Cannot transition from "${fromState}" to "${toState}": ${validation.reason || 'Unknown constraint failure'}`
    );
    this.name = 'InvalidStateTransitionError';
  }
}

export type StateListener = (event: StateTransitionEvent, context: TransitionGuardContext) => void;

export class AetherStateMachine {
  private currentState: LifecycleState;
  private context: TransitionGuardContext;
  private history: StateTransitionEvent[] = [];
  private listeners: StateListener[] = [];

  constructor(initialState: LifecycleState = 'Idle', initialContext?: Partial<TransitionGuardContext>) {
    this.currentState = initialState;
    this.context = {
      currentState: initialState,
      hasBrief: false,
      isBriefReady: false,
      hasActivePreview: false,
      hasPendingEdit: false,
      isApprovedForImplementation: false,
      ...initialContext,
    };
  }

  public getState(): LifecycleState {
    return this.currentState;
  }

  public getContext(): Readonly<TransitionGuardContext> {
    return { ...this.context };
  }

  public getHistory(): ReadonlyArray<StateTransitionEvent> {
    return [...this.history];
  }

  public updateContext(partialContext: Partial<TransitionGuardContext>): void {
    this.context = {
      ...this.context,
      ...partialContext,
      currentState: this.currentState,
    };
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Attempts to transition to the target state. Throws InvalidStateTransitionError on violation.
   */
  public transition(
    toState: LifecycleState,
    action: string,
    actor: 'user' | 'agent' | 'system' = 'user',
    payload?: Record<string, unknown>,
    checkpointId?: string
  ): StateTransitionEvent {
    const fromState = this.currentState;
    const validation = TransitionRules.validateTransition(fromState, toState, this.context);

    if (!validation.allowed) {
      throw new InvalidStateTransitionError(fromState, toState, validation);
    }

    const event: StateTransitionEvent = {
      id: randomUUID(),
      fromState,
      toState,
      action,
      payload,
      timestamp: new Date().toISOString(),
      actor,
      checkpointId: checkpointId || this.context.lastCheckpointId,
    };

    this.currentState = toState;
    this.context.currentState = toState;
    this.history.push(event);

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(event, this.context);
      } catch (err) {
        console.error('State listener error:', err);
      }
    }

    return event;
  }

  /**
   * Resets machine to Idle or specified state with reset context.
   */
  public reset(state: LifecycleState = 'Idle'): void {
    this.currentState = state;
    this.context = {
      currentState: state,
      hasBrief: false,
      isBriefReady: false,
      hasActivePreview: false,
      hasPendingEdit: false,
      isApprovedForImplementation: false,
    };
  }
}
