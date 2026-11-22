import { describe, it, expect } from 'vitest';
import { TemplateEngine } from '../../src/domain/services/template-engine.js';

describe('Feature #34: Work Item Template Engine', () => {
  it('interpolates standard tokens into template string', () => {
    const template = '{{prefix}} | {{sprint}} | {{date}}';
    const context = {
      prefix: 'WorkOps',
      sprint: 'Sprint 48',
      date: '2026-11-21',
    };

    const result = TemplateEngine.interpolate(template, context);
    expect(result).toBe('WorkOps | Sprint 48 | 2026-11-21');
  });

  it('handles snake_case and camelCase token variations seamlessly', () => {
    const template = '{{prefix}}: {{member_name}} on {{activity}}';
    const context = {
      prefix: 'DevOps',
      memberName: 'Jane Doe',
      activity: 'Refactoring',
    };

    const result = TemplateEngine.interpolate(template, context);
    expect(result).toBe('DevOps: Jane Doe on Refactoring');
  });

  it('safely handles missing tokens using default fallback', () => {
    const template = '{{prefix}} - {{missingToken}} - {{sprint}}';
    const context = {
      prefix: 'WorkOps',
      sprint: 'Sprint 1',
    };

    const result = TemplateEngine.interpolate(template, context, { defaultFallback: 'N/A' });
    expect(result).toBe('WorkOps - N/A - Sprint 1');
  });

  it('validates template syntax and catches mismatched braces', () => {
    const invalidTemplate = '{{prefix}} | {{sprint';
    const validTemplate = '{{prefix}} | {{sprint}}';

    const invalidResult = TemplateEngine.validate(invalidTemplate);
    const validResult = TemplateEngine.validate(validTemplate);

    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThan(0);

    expect(validResult.isValid).toBe(true);
    expect(validResult.tokensFound).toEqual(['prefix', 'sprint']);
  });

  it('provides template preview with discovery of available tokens', () => {
    const template = '[Core] {{date}} - {{prefix}}';
    const preview = TemplateEngine.preview(template, { prefix: 'CustomTask', date: '2026-11-22' });

    expect(preview.isValid).toBe(true);
    expect(preview.rendered).toBe('[Core] 2026-11-22 - CustomTask');

    const available = TemplateEngine.getAvailableTokens();
    expect(available).toContain('prefix');
    expect(available).toContain('date');
    expect(available).toContain('sprint');
  });
});
