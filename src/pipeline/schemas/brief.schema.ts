import { ProjectBrief } from '../../models/brief.model';

export const BRIEF_EXTRACTION_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'ProjectBriefExtraction',
  type: 'object',
  required: [
    'name',
    'productContext',
    'targetAudience',
    'primaryTasks',
    'pagesAndContent',
    'uxPreferences',
    'visualPreferences',
    'implementationConstraints',
    'practicalConstraints',
  ],
  properties: {
    name: { type: 'string', minLength: 1 },
    productContext: { type: 'string', minLength: 10 },
    targetAudience: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string' },
          skillLevel: { type: 'string' },
          accessibilityNeeds: { type: 'array', items: { type: 'string' } },
          devices: { type: 'array', items: { type: 'string' } },
          locale: { type: 'string' },
        },
      },
    },
    primaryTasks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'goal'],
        properties: {
          id: { type: 'string' },
          goal: { type: 'string' },
          frequency: { type: 'string' },
          urgency: { type: 'string' },
          successCriteria: { type: 'string' },
        },
      },
    },
    pagesAndContent: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'route', 'purpose'],
        properties: {
          id: { type: 'string' },
          route: { type: 'string' },
          purpose: { type: 'string' },
          keyData: { type: 'array', items: { type: 'string' } },
          relationships: { type: 'array', items: { type: 'string' } },
          priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        },
      },
    },
    uxPreferences: {
      type: 'object',
      properties: {
        navigationPattern: { type: 'string' },
        onboarding: { type: 'string' },
        density: { type: 'string', enum: ['compact', 'comfortable', 'spacious'] },
        workflows: { type: 'array', items: { type: 'string' } },
        emptyStates: { type: 'string' },
        errorHandling: { type: 'string' },
      },
    },
    visualPreferences: {
      type: 'object',
      properties: {
        moodWords: { type: 'array', items: { type: 'string' } },
        styles: { type: 'array', items: { type: 'string' } },
        references: { type: 'array', items: { type: 'string' } },
        brandColors: { type: 'array', items: { type: 'string' } },
        typography: { type: 'string' },
        avoidList: { type: 'array', items: { type: 'string' } },
      },
    },
    implementationConstraints: {
      type: 'object',
      properties: {
        framework: { type: 'string' },
        existingProject: { type: 'boolean' },
        libraries: { type: 'array', items: { type: 'string' } },
        tokens: { type: 'string' },
        responsiveTargets: { type: 'array', items: { type: 'string' } },
      },
    },
    practicalConstraints: {
      type: 'object',
      properties: {
        deadline: { type: 'string' },
        contentReadiness: { type: 'string', enum: ['ready', 'draft', 'unspecified'] },
        localization: { type: 'array', items: { type: 'string' } },
        performanceBudgets: { type: 'string' },
      },
    },
    assumptions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'statement', 'confidence', 'validated'],
        properties: {
          id: { type: 'string' },
          statement: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          validated: { type: 'boolean' },
          source: { type: 'string' },
        },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'question', 'impact', 'answered'],
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          defaultAnswer: { type: 'string' },
          userAnswer: { type: 'string' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] },
          answered: { type: 'boolean' },
        },
      },
    },
  },
};

export interface SchemaValidationOutcome<T> {
  valid: boolean;
  errors: string[];
  data?: T;
}

export function validateBriefExtraction(raw: unknown): SchemaValidationOutcome<Partial<ProjectBrief>> {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Brief output must be a JSON object'] };
  }

  const obj = raw as Record<string, any>;

  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    errors.push('Missing or empty "name" string');
  }

  if (typeof obj.productContext !== 'string' || obj.productContext.trim().length < 10) {
    errors.push('"productContext" must be a string with at least 10 characters');
  }

  if (!Array.isArray(obj.targetAudience) || obj.targetAudience.length === 0) {
    errors.push('"targetAudience" must be a non-empty array');
  } else {
    obj.targetAudience.forEach((aud: any, i: number) => {
      if (!aud || typeof aud.role !== 'string') {
        errors.push(`targetAudience[${i}] must have a "role" string`);
      }
    });
  }

  if (!Array.isArray(obj.primaryTasks) || obj.primaryTasks.length === 0) {
    errors.push('"primaryTasks" must be a non-empty array');
  } else {
    obj.primaryTasks.forEach((t: any, i: number) => {
      if (!t || typeof t.goal !== 'string') {
        errors.push(`primaryTasks[${i}] must have a "goal" string`);
      }
    });
  }

  if (!Array.isArray(obj.pagesAndContent) || obj.pagesAndContent.length === 0) {
    errors.push('"pagesAndContent" must be a non-empty array');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: obj as Partial<ProjectBrief>,
  };
}
