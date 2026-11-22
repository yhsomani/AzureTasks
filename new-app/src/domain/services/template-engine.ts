/**
 * Work Item Template Engine with Token Interpolation
 * Supports dynamic title and field generation with safe fallbacks and validation
 */

export interface TemplateContext {
  prefix?: string;
  sprint?: string;
  date?: string;
  memberName?: string;
  member_name?: string;
  activity?: string;
  title?: string;
  lead_name?: string;
  leadName?: string;
  workItemType?: string;
  work_item_type?: string;
  [key: string]: string | undefined;
}

export interface TemplateOptions {
  defaultFallback?: string;
  strict?: boolean;
}

export interface TemplateValidationResult {
  isValid: boolean;
  errors: string[];
  tokensFound: string[];
}

export interface TemplatePreviewResult {
  rendered: string;
  isValid: boolean;
  tokensFound: string[];
}

export class TemplateEngine {
  private static readonly STANDARD_TOKENS = [
    'prefix',
    'sprint',
    'date',
    'memberName',
    'member_name',
    'activity',
    'title',
    'lead_name',
    'leadName',
    'work_item_type',
    'workItemType',
  ];

  /**
   * Return catalog of standard tokens supported by the engine
   */
  static getAvailableTokens(): string[] {
    return [
      'prefix',
      'sprint',
      'date',
      'memberName',
      'member_name',
      'activity',
      'title',
      'lead_name',
      'work_item_type',
    ];
  }

  /**
   * Normalize token key to handle snake_case, camelCase, and case-insensitivity
   */
  private static normalizeTokenKey(key: string): string {
    return key.replace(/[-_](\w)/g, (_, c) => c.toUpperCase()).toLowerCase();
  }

  /**
   * Interpolate template string with values from context
   */
  static interpolate(
    template: string,
    context: TemplateContext = {},
    options: TemplateOptions = {}
  ): string {
    if (!template || typeof template !== 'string') {
      return '';
    }

    const fallback = options.defaultFallback ?? '';

    // Build lookup map with normalized keys
    const normalizedLookup: Record<string, string> = {};
    for (const [k, v] of Object.entries(context)) {
      if (v !== undefined && v !== null) {
        normalizedLookup[this.normalizeTokenKey(k)] = String(v);
        // Also keep exact match
        normalizedLookup[k] = String(v);
      }
    }

    // Replace {{token}} or {{ token }}
    return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, tokenName) => {
      // 1. Direct match
      if (normalizedLookup[tokenName] !== undefined) {
        return normalizedLookup[tokenName];
      }
      // 2. Normalized match
      const normKey = this.normalizeTokenKey(tokenName);
      if (normalizedLookup[normKey] !== undefined) {
        return normalizedLookup[normKey];
      }
      // 3. Fallback
      if (options.strict) {
        throw new Error(`Missing required template token: ${tokenName}`);
      }
      return fallback;
    });
  }

  /**
   * Validate template syntax and check for malformed braces or tokens
   */
  static validate(template: string): TemplateValidationResult {
    const errors: string[] = [];
    const tokensFound: string[] = [];

    if (typeof template !== 'string') {
      return { isValid: false, errors: ['Template must be a string'], tokensFound: [] };
    }

    // Check for unbalanced braces
    const openMatches = template.match(/\{\{/g) || [];
    const closeMatches = template.match(/\}\}/g) || [];
    if (openMatches.length !== closeMatches.length) {
      errors.push(`Mismatched double braces: ${openMatches.length} opening vs ${closeMatches.length} closing`);
    }

    // Extract valid token patterns
    const regex = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(template)) !== null) {
      tokensFound.push(match[1]);
    }

    return {
      isValid: errors.length === 0,
      errors,
      tokensFound,
    };
  }

  /**
   * Render a preview of a template with default or custom sample data
   */
  static preview(template: string, sampleContext: Partial<TemplateContext> = {}): TemplatePreviewResult {
    const validation = this.validate(template);
    const defaults: TemplateContext = {
      prefix: 'WorkOps',
      sprint: 'Sprint 48',
      date: new Date().toISOString().slice(0, 10),
      memberName: 'Dev User',
      activity: 'Development',
      title: 'Sample Task Title',
      lead_name: 'Lead User',
      work_item_type: 'Task',
      ...sampleContext,
    };

    const rendered = this.interpolate(template, defaults);
    return {
      rendered,
      isValid: validation.isValid,
      tokensFound: validation.tokensFound,
    };
  }
}
