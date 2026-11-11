/**
 * FR-02 & FR-03: UXDirection Data Model
 * Enforces 2-3 distinct UX alternatives per brief, user/task fit, page structure,
 * interaction flows, trade-offs, strengths, assumptions, and user selection/revision.
 */

export interface PageNode {
  pageId: string;
  name: string;
  route: string;
  hierarchyLevel: number;
  components: string[];
  keyDataBindings?: string[];
}

export interface FlowStep {
  step: number;
  title: string;
  userAction: string;
  systemResponse: string;
  screenTransition?: {
    fromRoute: string;
    toRoute: string;
  };
}

export interface UXDirection {
  id: string;
  briefId: string;
  title: string;
  approach: string; // e.g., 'week-first' | 'recipe-first' | 'task-first'
  userTaskFit: string;
  pageStructure: PageNode[];
  interactionFlow: FlowStep[];
  strengths: string[];
  tradeOffs: string[];
  assumptions: string[];
  recommendationRationale?: string;
  isRecommended?: boolean;
  isSelected: boolean;
  userNotes?: string;
  combinedFromIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UXReviewDecision {
  briefId: string;
  selectedDirectionId: string;
  decisionType: 'selected' | 'revised' | 'combined';
  rationale: string;
  timestamp: string;
}
