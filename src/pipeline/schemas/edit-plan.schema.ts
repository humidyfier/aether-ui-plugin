import { EditScope, EditTier, EditTxMutation, PropertyGroup } from '../../edittx/models';
import { SchemaValidationOutcome } from './brief.schema';

export interface ScopedEditPlan {
  targetUid: string;
  filePath: string;
  scope: EditScope;
  propertyGroups: PropertyGroup[];
  expectedTier: EditTier;
  rationale: string;
  mutations: EditTxMutation[];
  userNotes?: string;
}

export const SCOPED_EDIT_PLAN_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'ScopedEditPlan',
  type: 'object',
  required: ['targetUid', 'filePath', 'scope', 'propertyGroups', 'mutations', 'rationale'],
  properties: {
    targetUid: { type: 'string', minLength: 1 },
    filePath: { type: 'string', minLength: 1 },
    scope: { type: 'string', enum: ['ELEMENT', 'COMPONENT', 'SHARED_COMPONENT', 'FILE', 'PROJECT'] },
    propertyGroups: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', enum: ['spacing', 'color', 'typography', 'layout', 'content', 'custom'] },
    },
    expectedTier: { type: 'string', enum: ['TIER_1_DETERMINISTIC', 'TIER_2_SCOPED_SUBTREE', 'TIER_3_PROPOSED_DIFF'] },
    rationale: { type: 'string', minLength: 5 },
    mutations: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['type', 'targetUid', 'propertyGroup'],
        properties: {
          type: {
            type: 'string',
            enum: ['UPDATE_PROP', 'MERGE_CLASSNAMES', 'UPDATE_STYLE', 'UPDATE_TEXT', 'REPLACE_SUBTREE'],
          },
          targetUid: { type: 'string' },
          propertyGroup: { type: 'string' },
          propName: { type: 'string' },
          propValue: { type: 'string' },
          classesToAdd: { type: 'string' },
          classesToRemove: { type: 'string' },
          newText: { type: 'string' },
          newSubtreeJsx: { type: 'string' },
        },
      },
    },
  },
};

export function validateScopedEditPlan(raw: unknown): SchemaValidationOutcome<ScopedEditPlan> {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Scoped edit plan must be a JSON object'] };
  }

  const obj = raw as Record<string, any>;

  if (typeof obj.targetUid !== 'string' || obj.targetUid.trim().length === 0) {
    errors.push('Missing or empty "targetUid"');
  }

  if (typeof obj.filePath !== 'string' || obj.filePath.trim().length === 0) {
    errors.push('Missing or empty "filePath"');
  }

  const validScopes: EditScope[] = ['ELEMENT', 'COMPONENT', 'SHARED_COMPONENT', 'FILE', 'PROJECT'];
  if (!validScopes.includes(obj.scope)) {
    errors.push(`Invalid scope "${obj.scope}". Must be one of: [${validScopes.join(', ')}]`);
  }

  if (!Array.isArray(obj.propertyGroups) || obj.propertyGroups.length === 0) {
    errors.push('"propertyGroups" must be a non-empty array');
  }

  if (typeof obj.rationale !== 'string' || obj.rationale.trim().length < 5) {
    errors.push('"rationale" must be a string with at least 5 characters');
  }

  if (!Array.isArray(obj.mutations) || obj.mutations.length === 0) {
    errors.push('"mutations" must be a non-empty array with at least one EditTxMutation');
  } else {
    obj.mutations.forEach((m: any, i: number) => {
      if (!m || typeof m !== 'object') {
        errors.push(`mutations[${i}] must be an object`);
        return;
      }
      const validTypes = ['UPDATE_PROP', 'MERGE_CLASSNAMES', 'UPDATE_STYLE', 'UPDATE_TEXT', 'REPLACE_SUBTREE'];
      if (!validTypes.includes(m.type)) {
        errors.push(`mutations[${i}].type is invalid. Must be one of: [${validTypes.join(', ')}]`);
      }
      if (m.targetUid !== obj.targetUid) {
        errors.push(`mutations[${i}].targetUid "${m.targetUid}" does not match plan targetUid "${obj.targetUid}"`);
      }
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: obj as ScopedEditPlan,
  };
}
