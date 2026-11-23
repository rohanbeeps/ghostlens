import { describe, expect, it } from 'vitest'
import { size, time } from './format'

describe('measurement formatting', () => {
  it('uses binary unit labels for powers of 1024 bytes', () => {
    expect(size(1024)).toBe('1.00 KiB')
    expect(size(1024 ** 2)).toBe('1.00 MiB')
    expect(size(1024 ** 3)).toBe('1.00 GiB')
  })

  it('distinguishes sub-millisecond timings from zero and unavailable values', () => {
    expect(time(0.5)).toBe('0.50 ms')
    expect(time(0.001)).toBe('<0.01 ms')
    expect(time(0)).toBe('0 ms')
    expect(time(null)).toBe('—')
  })
})
