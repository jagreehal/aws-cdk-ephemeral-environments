import { describe, expect, test } from 'vitest';
import { App } from 'aws-cdk-lib';
import { numberContext } from '../lib/context';

function nodeWith(context: Record<string, unknown>) {
  return new App({ context }).node;
}

describe('numberContext', () => {
  test('converts the strings the CLI passes into numbers', () => {
    // `--context desiredCount=3` arrives as '3'; a `number` prop would take it and emit a string.
    expect(numberContext(nodeWith({ desiredCount: '3' }), 'desiredCount')).toBe(3);
    expect(numberContext(nodeWith({ desiredCount: 3 }), 'desiredCount')).toBe(3);
  });

  test('returns undefined when unset, so the prop default applies', () => {
    expect(numberContext(nodeWith({}), 'desiredCount')).toBeUndefined();
    expect(numberContext(nodeWith({ desiredCount: '' }), 'desiredCount')).toBeUndefined();
  });

  test('rejects a value that is not a number', () => {
    expect(() => numberContext(nodeWith({ desiredCount: 'lots' }), 'desiredCount')).toThrow(
      "Context 'desiredCount' must be a number, got 'lots'.",
    );
  });
});
