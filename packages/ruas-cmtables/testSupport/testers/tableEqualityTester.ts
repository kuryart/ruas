/* eslint-disable @typescript-eslint/no-unsafe-assignment -- vitest Tester typings are imprecise for custom equality testers */
import { InternalTable } from "#core/models/table.svelte"

import * as Testers from "./testers"

export const TableEqualityTester = Testers.ofEquality({
  isInstance: (value: unknown) => value instanceof InternalTable,
  isEqual: (first, second) => first.equals(second),
})
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- re-enable after vitest Tester block */
