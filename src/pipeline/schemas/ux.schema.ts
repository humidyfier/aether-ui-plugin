import { UXDirection } from '../../models/ux.model';
import { SchemaValidationOutcome } from './brief.schema';

export const UX_GENERATION_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'UXAlternativesGeneration',
  type: 'object',
  required: ['directions'],
  properties: {
    directions: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'object',
        required: [
          'title',
          'approach',
          'userTaskFit',
          'pageStructure',
          'interactionFlow',
          'strengths',
          'tradeOffs',
          'assumptions',
        ],
        properties: {
          title: { type: 'string' },
          approach: { type: 'string' },
          userTaskFit: { type: 'string' },
          pageStructure: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['pageId', 'name', 'route', 'hierarchyLevel', 'components'],
              properties: {
                pageId: { type: 'string' },
                name: { type: 'string' },
                route: { type: 'string' },
                hierarchyLevel: { type: 'number' },
                components: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          interactionFlow: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['step', 'title', 'userAction', 'systemResponse'],
              properties: {
                step: { type: 'number' },
                title: { type: 'string' },
                userAction: { type: 'string' },
                systemResponse: { type: 'string' },
              },
            },
          },
          strengths: { type: 'array', minItems: 1, items: { type: 'string' } },
          tradeOffs: { type: 'array', minItems: 1, items: { type: 'string' } },
          assumptions: { type: 'array', items: { type: 'string' } },
          recommendationRationale: { type: 'string' },
        },
      },
    },
  },
};

export function validateUXAlternatives(raw: unknown): SchemaValidationOutcome<UXDirection[]> {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['UX generation output must be a JSON object with a "directions" array'] };
  }

  const obj = raw as Record<string, any>;
  const directions = obj.directions;

  if (!Array.isArray(directions)) {
    return { valid: false, errors: ['Missing "directions" array in UX generation output'] };
  }

  // Invariant: PRD FR-02 requires 2-3 distinct directions
  if (directions.length < 2 || directions.length > 3) {
    errors.push(`PRD Invariant: Must provide 2 to 3 UX directions (provided ${directions.length})`);
  }

  directions.forEach((dir: any, i: number) => {
    if (!dir || typeof dir !== 'object') {
      errors.push(`directions[${i}] must be an object`);
      return;
    }

    if (typeof dir.title !== 'string' || dir.title.trim().length === 0) {
      errors.push(`directions[${i}].title must be a non-empty string`);
    }

    if (typeof dir.approach !== 'string' || dir.approach.trim().length === 0) {
      errors.push(`directions[${i}].approach must be a non-empty string`);
    }

    if (typeof dir.userTaskFit !== 'string' || dir.userTaskFit.trim().length === 0) {
      errors.push(`directions[${i}].userTaskFit must be a non-empty string`);
    }

    if (!Array.isArray(dir.pageStructure) || dir.pageStructure.length === 0) {
      errors.push(`directions[${i}].pageStructure must be a non-empty array`);
    }

    if (!Array.isArray(dir.interactionFlow) || dir.interactionFlow.length === 0) {
      errors.push(`directions[${i}].interactionFlow must be a non-empty array`);
    }

    if (!Array.isArray(dir.strengths) || dir.strengths.length === 0) {
      errors.push(`directions[${i}].strengths must be a non-empty array`);
    }

    if (!Array.isArray(dir.tradeOffs) || dir.tradeOffs.length === 0) {
      errors.push(`directions[${i}].tradeOffs must be a non-empty array`);
    }
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: directions as UXDirection[],
  };
}
