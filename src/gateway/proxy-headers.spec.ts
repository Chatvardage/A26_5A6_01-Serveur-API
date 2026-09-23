import { firstHeader } from './proxy-headers';

describe('firstHeader', () => {
  it.each([
    ['a single value', 'a, b', 'a, b'],
    ['the first entry of an array', ['a', 'b'], 'a'],
    ['undefined when absent', undefined, undefined],
  ])(
    'returns %s',
    (_caseName, value: string | string[] | undefined, expected) => {
      expect(firstHeader(value)).toBe(expected);
    },
  );
});
