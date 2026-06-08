/* eslint-disable @typescript-eslint/no-unsafe-assignment -- vitest Tester typings are imprecise for custom equality testers */
import { Text } from "@codemirror/state"

import * as Testers from "./testers"

export const TextEqualityTester = Testers.ofEquality({
  isInstance: (value: unknown) => value instanceof Text,
  isEqual: (first, second) => first.eq(second),
})
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- re-enable after vitest Tester block */
