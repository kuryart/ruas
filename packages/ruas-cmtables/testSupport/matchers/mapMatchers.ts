/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/strict-boolean-expressions -- vitest MatcherState typings are imprecise for custom matchers */
import type { MatchersObject, MatcherState } from "@vitest/expect"

/**
 * Matchers for {@link Map}s.
 */
export const MapMatchers: MatchersObject = {
  /**
   * Matches an {@link actual} {@link Map} that contains exactly the given {@link key}-{@link value} pair.
   */
  toContainExactlyEntry(
    this: MatcherState,
    actual: Map<unknown, unknown>,
    key: unknown,
    value: unknown,
  ) {
    const expected = new Map([[key, value]])

    return {
      pass: this.equals(expected, actual, [this.utils.iterableEquality], true),
      message: () =>
        `Expected Map to ${this.isNot ? "not " : ""}contain exactly the given (key, value) pair`,
      expected: this.utils.stringify(expected),
      actual: this.utils.stringify(actual),
    }
  },
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/strict-boolean-expressions -- re-enable after vitest MatcherState block */
