/**
 * FR-01: ProjectBrief Data Model
 * Captures product context, target audience, primary tasks, pages/content,
 * UX preferences, visual preferences, constraints, uncertainties/assumptions, and questions.
 */

export interface AudienceProfile {
  role: string;
  skillLevel?: 'novice' | 'intermediate' | 'expert' | string;
  accessibilityNeeds?: string[];
  devices?: ('desktop' | 'mobile' | 'tablet' | string)[];
  locale?: string;
}

export interface PrimaryTask {
  id: string;
  goal: string;
  frequency?: 'daily' | 'weekly' | 'occasional' | string;
  urgency?: 'low' | 'medium' | 'high' | string;
  successCriteria?: string;
}

export interface PageDefinition {
  id: string;
  route: string;
  purpose: string;
  keyData?: string[];
  relationships?: string[];
  priority?: 'critical' | 'high' | 'medium' | 'low';
}

export interface UXPreferences {
  navigationPattern?: 'sidebar' | 'topbar' | 'bottom-nav' | 'tabs' | 'breadcrumbs' | string;
  onboarding?: 'guided-tour' | 'checklist' | 'minimal' | 'none' | string;
  density?: 'compact' | 'comfortable' | 'spacious';
  workflows?: string[];
  emptyStates?: string;
  errorHandling?: string;
}

export interface VisualPreferences {
  moodWords?: string[];
  styles?: string[];
  references?: string[];
  brandColors?: string[];
  typography?: string;
  avoidList?: string[];
}

export interface ImplementationConstraints {
  framework?: 'react' | 'vue' | 'svelte' | 'next' | string;
  existingProject?: boolean;
  libraries?: string[];
  tokens?: string;
  responsiveTargets?: ('mobile' | 'tablet' | 'desktop')[];
}

export interface PracticalConstraints {
  deadline?: string;
  contentReadiness?: 'ready' | 'draft' | 'unspecified';
  localization?: string[];
  performanceBudgets?: string;
}

export interface Assumption {
  id: string;
  statement: string;
  confidence: 'high' | 'medium' | 'low';
  validated: boolean;
  source?: string;
}

export interface Question {
  id: string;
  question: string;
  defaultAnswer?: string;
  userAnswer?: string;
  impact: 'high' | 'medium' | 'low';
  answered: boolean;
}

export interface ReadinessGateResult {
  isReady: boolean;
  hasProductPurpose: boolean;
  hasAudienceOrTask: boolean;
  missingFields: string[];
  rationale: string;
}

export interface ProjectBrief {
  id: string;
  name: string;
  productContext: string;
  targetAudience: AudienceProfile[];
  primaryTasks: PrimaryTask[];
  pagesAndContent: PageDefinition[];
  uxPreferences: UXPreferences;
  visualPreferences: VisualPreferences;
  implementationConstraints: ImplementationConstraints;
  practicalConstraints: PracticalConstraints;
  assumptions: Assumption[];
  questions: Question[];
  readiness: ReadinessGateResult;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function evaluateBriefReadiness(brief: Partial<ProjectBrief>): ReadinessGateResult {
  const missing: string[] = [];
  const hasProductPurpose = Boolean(brief.productContext && brief.productContext.trim().length > 10);
  const hasAudience = Boolean(brief.targetAudience && brief.targetAudience.length > 0);
  const hasTasks = Boolean(brief.primaryTasks && brief.primaryTasks.length > 0);
  const hasAudienceOrTask = hasAudience || hasTasks;

  if (!hasProductPurpose) {
    missing.push('productContext (meaningful product purpose is required)');
  }
  if (!hasAudienceOrTask) {
    missing.push('targetAudience or primaryTasks (at least one audience or task profile required)');
  }

  const isReady = hasProductPurpose && hasAudienceOrTask;

  return {
    isReady,
    hasProductPurpose,
    hasAudienceOrTask,
    missingFields: missing,
    rationale: isReady
      ? 'Readiness gate passed: Core product purpose and audience/task context are established.'
      : `Readiness gate incomplete: Missing required context [${missing.join(', ')}]. Lower-confidence recommendations or assumptions needed if continuing.`,
  };
}
