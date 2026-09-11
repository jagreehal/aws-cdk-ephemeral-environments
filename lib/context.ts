import type { Node } from 'constructs';

/**
 * Read a numeric `--context` value.
 *
 * Everything the CLI passes as context arrives as a string, so `--context desiredCount=3` would
 * otherwise reach a `number` prop as `'3'` and land in the template as a string. Returns undefined
 * when unset so the prop's own default applies.
 */
export function numberContext(node: Node, key: string): number | undefined {
  const raw = node.tryGetContext(key);

  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(`Context '${key}' must be a number, got '${raw}'.`);
  }

  return value;
}
