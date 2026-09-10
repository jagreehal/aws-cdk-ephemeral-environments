/** Prefix shared by the stack and every resource it names. */
export const SERVICE_NAME = 'ephemeral';

/**
 * Single source of truth for names. Everything downstream takes this one string instead of
 * re-joining an env name and a prefix at each call site (which is how `dev-dev-vpc` happened).
 *
 * It doubles as the CloudFormation stack id, and deliberately *starts* with the env name so CI
 * can list and destroy ephemeral stacks by their `pr-` / `branch-` prefix.
 */
export function nameFor(envName: string): string {
  return `${envName}-${SERVICE_NAME}`;
}
