// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { barChart, lineChart } from './chart.js';

const attrs = (svg) => [...svg.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.value));

describe('barChart', () => {
  it('draws one bar per bucket, the tallest filling the plot, labelled for screen readers', () => {
    const svg = barChart([{ label: '0', n: 0 }, { label: '1', n: 10 }, { label: '2', n: 5 }], { label: 'Energy curve' });
    const rects = svg.querySelectorAll('rect');
    expect(rects).toHaveLength(3);
    expect(Number(rects[0].getAttribute('height'))).toBe(0);
    expect(Number(rects[1].getAttribute('height'))).toBe(2 * Number(rects[2].getAttribute('height')));
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Energy curve');
    expect(svg.textContent).toContain('10');
  });
  it('an all-zero chart has no NaN anywhere', () => {
    const svg = barChart([{ label: '0', n: 0 }], { label: 'x' });
    expect(attrs(svg).some((v) => v.includes('NaN'))).toBe(false);
  });
});

describe('lineChart', () => {
  const pts = [{ x: 1, y: 69, max: 80 }, { x: 2, y: 67, max: 80 }, { x: 3, y: 0, max: 80 }];
  it('draws the value and ceiling lines through every point', () => {
    const svg = lineChart(pts, { label: 'HP by floor', marks: [{ x: 2, label: 'Act 2' }] });
    const value = svg.querySelector('path.value').getAttribute('d');
    expect(value.match(/[ML]/g)).toHaveLength(3);
    expect(svg.querySelector('path.max')).not.toBeNull();
    expect(svg.textContent).toContain('Act 2');
  });
  it('one point, or none, draws without NaN', () => {
    expect(attrs(lineChart([pts[0]], { label: 'x' })).some((v) => v.includes('NaN'))).toBe(false);
    expect(lineChart([], { label: 'x' }).querySelector('path')).toBeNull();
  });
});
