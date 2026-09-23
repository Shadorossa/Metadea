import { describe, expect, it } from 'vitest';
import { buildVariablesBlock, composeThemeCss, isSafeVariableValue, normalizeVariableName, sanitizeVariables } from './variables-block';

describe('normalizeVariableName', () => {
  it('prefixes bare token names and keeps prefixed ones', () => {
    expect(normalizeVariableName('accent')).toBe('--accent');
    expect(normalizeVariableName('--accent')).toBe('--accent');
    expect(normalizeVariableName('  bg-card ')).toBe('--bg-card');
  });
});

describe('isSafeVariableValue', () => {
  it('accepts ordinary token values', () => {
    for (const v of ['#c084fc', 'rgba(1, 2, 3, 0.4)', '192 132 252', '8px', 'cubic-bezier(0.25, 0, 0.15, 1)', 'var(--accent)']) {
      expect(isSafeVariableValue(v), v).toBe(true);
    }
  });

  it('rejects anything that could close the declaration or smuggle a resource', () => {
    for (const v of ['', '   ', 'red; color: blue', 'a}b{', '<script>', 'url(http://x)', 'URL(x)', 'expression(1)', 'JavaScript:1', '@import "x"', '\\75rl(x)', 'x'.repeat(513)]) {
      expect(isSafeVariableValue(v), JSON.stringify(v)).toBe(false);
    }
  });
});

describe('buildVariablesBlock', () => {
  it('emits a sorted :root block', () => {
    const block = buildVariablesBlock({ 'text-main': '#fff', '--accent': ' #abc ' });
    expect(block).toBe(':root {\n  --accent: #abc;\n  --text-main: #fff;\n}');
  });

  it('skips invalid names and values instead of escaping them', () => {
    const block = buildVariablesBlock({ 'bad name': '#fff', '--ok': '1px', '--evil': 'red; background: url(x)' });
    expect(block).toBe(':root {\n  --ok: 1px;\n}');
    expect(sanitizeVariables({ '--x': 42 as unknown as string })).toEqual([]);
  });

  it('returns an empty string when nothing survives', () => {
    expect(buildVariablesBlock({})).toBe('');
    expect(buildVariablesBlock({ '--x': '{}' })).toBe('');
  });

  it('honours a custom selector', () => {
    expect(buildVariablesBlock({ accent: 'red' }, 'html[data-ui-theme="x"]')).toBe('html[data-ui-theme="x"] {\n  --accent: red;\n}');
  });
});

describe('composeThemeCss', () => {
  it('puts the token block before the theme CSS', () => {
    const css = composeThemeCss({ variables: { accent: 'red' }, css: '  a { color: var(--accent) }\n' });
    expect(css).toBe(':root {\n  --accent: red;\n}\n\na { color: var(--accent) }');
  });

  it('omits empty parts', () => {
    expect(composeThemeCss({ variables: {}, css: 'a{}' })).toBe('a{}');
    expect(composeThemeCss({ variables: { accent: 'red' }, css: '' })).toBe(':root {\n  --accent: red;\n}');
    expect(composeThemeCss({ variables: {}, css: '' })).toBe('');
  });
});
