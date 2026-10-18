import { describe, expect, it } from 'vitest';

import { demoHref, readDemoHandoff } from './demo-handoff';

describe('demoHref', () => {
  it('leaves empty values out and returns the bare path when nothing is left', () => {
    expect(demoHref({ package: '', model: null, branches: undefined })).toBe('/book-demo/');
  });

  it('encodes the values it keeps', () => {
    expect(demoHref({ package: 'Managed Operations', branches: 2 })).toBe(
      '/book-demo/?package=Managed+Operations&branches=2',
    );
  });
});

describe('readDemoHandoff', () => {
  it('ignores a package or model that is not on the allow-list', () => {
    const result = readDemoHandoff('?package=Enterprise&model=Free', 'pkr');

    expect(result.packageName).toBeNull();
    expect(result.pricingModel).toBeNull();
  });

  it('accepts known names', () => {
    const result = readDemoHandoff('?package=Growth&model=Flexible', 'pkr');

    expect(result).toMatchObject({ packageName: 'Growth', pricingModel: 'Flexible' });
  });

  it('reads the price for the visitor currency only', () => {
    const search = '?price_pkr=PKR+9,000&price_usd=%2432';

    expect(readDemoHandoff(search, 'pkr').summary).toEqual(['Starting price shown: PKR 9,000']);
    expect(readDemoHandoff(search, 'usd').summary).toEqual(['Starting price shown: $32']);
  });

  it('drops negative, fractional-garbage and non-numeric counts instead of trusting a URL', () => {
    const { summary } = readDemoHandoff('?branches=-3&extra_tills=abc&extra_users=2.6', 'pkr');

    expect(summary).toEqual(['Extra users per branch: 3']);
  });

  it('rejects an unknown billing value', () => {
    expect(readDemoHandoff('?billing=weekly', 'pkr').summary).toEqual([]);
  });

  it('returns an empty handoff for an empty query string', () => {
    expect(readDemoHandoff('', 'pkr')).toEqual({
      pricingModel: null,
      packageName: null,
      summary: [],
    });
  });
});
