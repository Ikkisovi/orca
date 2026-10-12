import { describe, expect, it } from 'vitest'
import { formatTokens } from './usage-formatters'

describe('token units', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1_000, '1K'],
    [999_949, '999.9K'],
    [999_950, '1M'],
    [1_000_000, '1M'],
    [999_950_000, '1B'],
    [1_000_000_000, '1B'],
    [15_681_100_000, '15.7B'],
    [999_950_000_000, '1T'],
    [1_000_000_000_000, '1T'],
    [2_500_000_000_000, '2.5T']
  ])('formats %s as %s', (value, expected) => {
    expect(formatTokens(value)).toBe(expected)
  })
})
