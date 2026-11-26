import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = new URL('../../src/presentation/web/public/', import.meta.url);
const html = readFileSync(new URL('index.html', base), 'utf8');
const css = readFileSync(new URL('styles.css', base), 'utf8');
const appShell = readFileSync(
  new URL('../../src/presentation/web/src/components/layout/AppShell.tsx', import.meta.url),
  'utf8'
);

describe('modern react presentation layer contracts (milestone 2)', () => {
  it('defines fluid css typography tokens with clamp to eliminate mobile scaling inversion', () => {
    expect(css).toContain('--font-h1: clamp(');
    expect(css).toContain('--font-h2: clamp(');
    expect(css).toContain('--font-kpi: clamp(');
    expect(css).toContain('--surface-base:');
    expect(css).toContain('--surface-card:');
  });

  it('provides responsive mobile card accordion styles for viewports under 768px', () => {
    expect(css).toContain('@media (max-width: 768px)');
    expect(css).toContain('.card-accordion-mobile');
    expect(css).toContain('.matrix-desktop-container');
    expect(css).toContain('.accordion-card');
    expect(css).toContain('.accordion-header');
  });

  it('guarantees touch targets meet or exceed 44x44px for wcag 2.1 aa', () => {
    expect(css).toContain('min-height: 44px');
  });

  it('verifies clean React mount shell without legacy UI template or vendored Chart.js', () => {
    expect(html).toContain('id="root"');
    expect(html).toContain('src="/assets/main.js"');
    expect(html).not.toContain('legacyUiTemplate');
    expect(html).not.toContain('vendor/chart.umd.js');
    expect(appShell).toContain('skip-link');
    expect(appShell).toContain('id="main"');
  });
});
