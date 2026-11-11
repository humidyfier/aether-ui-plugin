import { UIConcept } from '../../models/ui.model';
import { SchemaValidationOutcome } from './brief.schema';

export const UI_SYNTHESIS_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'UIConceptsSynthesis',
  type: 'object',
  required: ['concepts'],
  properties: {
    concepts: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'object',
        required: [
          'name',
          'styleApproach',
          'typography',
          'palette',
          'density',
          'designTokens',
          'componentStyles',
          'responsiveRules',
        ],
        properties: {
          name: { type: 'string' },
          styleApproach: { type: 'string' },
          typography: {
            type: 'object',
            required: ['fontFamilySans', 'fontFamilyMono', 'scale', 'weights'],
            properties: {
              fontFamilySans: { type: 'string' },
              fontFamilyMono: { type: 'string' },
              scale: { type: 'object' },
              weights: { type: 'object' },
            },
          },
          palette: {
            type: 'object',
            required: ['primary', 'secondary', 'background', 'surface', 'textPrimary', 'border'],
            properties: {
              primary: { type: 'string' },
              secondary: { type: 'string' },
              background: { type: 'string' },
              surface: { type: 'string' },
              textPrimary: { type: 'string' },
              border: { type: 'string' },
            },
          },
          density: {
            type: 'object',
            required: ['mode', 'spacingUnit'],
            properties: {
              mode: { type: 'string', enum: ['compact', 'comfortable', 'spacious'] },
              spacingUnit: { type: 'number' },
            },
          },
          designTokens: { type: 'object' },
          componentStyles: { type: 'array' },
          responsiveRules: { type: 'array' },
          sampleScreens: { type: 'array' },
          attributedReferences: { type: 'array' },
        },
      },
    },
  },
};

export function validateUIConcepts(raw: unknown): SchemaValidationOutcome<UIConcept[]> {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['UI synthesis output must be a JSON object with a "concepts" array'] };
  }

  const obj = raw as Record<string, any>;
  const concepts = obj.concepts;

  if (!Array.isArray(concepts)) {
    return { valid: false, errors: ['Missing "concepts" array in UI synthesis output'] };
  }

  // Invariant: PRD FR-06 requires 2-3 visual concepts
  if (concepts.length < 2 || concepts.length > 3) {
    errors.push(`PRD Invariant: Must provide 2 to 3 UI concepts (provided ${concepts.length})`);
  }

  concepts.forEach((concept: any, i: number) => {
    if (!concept || typeof concept !== 'object') {
      errors.push(`concepts[${i}] must be an object`);
      return;
    }

    if (typeof concept.name !== 'string' || concept.name.trim().length === 0) {
      errors.push(`concepts[${i}].name must be a non-empty string`);
    }

    if (typeof concept.styleApproach !== 'string' || concept.styleApproach.trim().length === 0) {
      errors.push(`concepts[${i}].styleApproach must be a non-empty string`);
    }

    if (!concept.palette || typeof concept.palette !== 'object') {
      errors.push(`concepts[${i}].palette must be an object with primary, background, surface, textPrimary`);
    } else {
      if (!concept.palette.primary) errors.push(`concepts[${i}].palette.primary is required`);
      if (!concept.palette.background) errors.push(`concepts[${i}].palette.background is required`);
    }

    if (!concept.typography || typeof concept.typography !== 'object') {
      errors.push(`concepts[${i}].typography must be an object`);
    }

    if (!concept.density || typeof concept.density !== 'object') {
      errors.push(`concepts[${i}].density must be an object with mode and spacingUnit`);
    }
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: concepts as UIConcept[],
  };
}
