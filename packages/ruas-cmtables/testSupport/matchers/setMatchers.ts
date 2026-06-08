/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/strict-boolean-expressions -- vitest MatcherState typings are imprecise for custom matchers */
import type { MatchersObject, MatcherState } from "@vitest/expect"

/**
 * Matchers for {@link Set}s.
 */
export const SetMatchers: MatchersObject = {
  /**
   * Matches an {@link actual} {@link Set} that contains exactly the given {@link item}.
   */
  toContainExactlyItem(this: MatcherState, actual: Set<unknown>, item: unknown) {
    const expected = new Set([item])

    return {
      pass: this.equals(expected, actual, [this.utils.iterableEquality], true),
      message: () => `Expected Set to ${this.isNot ? "not " : ""}contain exactly the given item`,
      expected: this.utils.stringify(expected),
      actual: this.utils.stringify(actual),
    }
  },
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/strict-boolean-expressions -- re-enable after vitest MatcherState block */
