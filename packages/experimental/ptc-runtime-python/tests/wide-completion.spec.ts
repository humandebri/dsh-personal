/** Memory-limit regression run plainly beside the instrumented host suite. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { PythonPtcRuntime } from '../src/index.ts'

it('checks and encodes a wide completion value in O(depth), not O(width)', async () => {
  // A wide flat list serializes to ~2 bytes per element but the pre-fix walk
  // enqueued one traversal tuple per element (_check_done_value) and one stack
  // entry plus a separator marker per element (_encode_json_plain) — ~56 bytes
  // per element, ~28x the serialized size. A value the byte meter admits could
  // therefore OOM on the checker's or encoder's own bookkeeping, the inversion
  // the load gate exists to prevent (the gate reserves 12x, not 28x). Both now
  // walk with an O(depth) cursor that pulls one child at a time, so the only
  // width-proportional allocation is the output string the meter bounded.
  //
  // Config: maxValueBytes 20 MiB against 384 MiB (20*12 = 240 MiB < 320 MiB
  // budgetable, so it loads). `[0] * 6_000_000` is ~12 MB of JSON, under the
  // 20 MiB budget, so it must round-trip. Pre-fix the ~400 MB of per-element
  // frames plus the interpreter exceeded 384 MiB and returned MemoryError as an
  // exception. Linux-only RLIMIT_AS repro; on macOS the value round-trips
  // either way, but the fixture stays within the address space so it is honest.
  //
  // Keep the memory limit, input width, and 60s runtime deadline intact. CI
  // runs this resource-shape probe without V8 instrumentation; the remaining
  // runtime suite owns complete coverage of the same host completion path.
  const ctx = new Context()
  try {
    await ctx.plugin(PythonPtcRuntime, { maxValueBytes: 20 * 1024 * 1024, addressSpaceMb: 384, maxWallMs: 60_000 })
    const runtime = ctx.ptcRuntime
    const result = await runtime.run(runtime.resolve({ program: 'return [0] * 6_000_000', bindings: [] }))
    expect(result.error).toBeUndefined()
    expect(Array.isArray(result.value)).toBe(true)
    expect(result.value).toHaveLength(6_000_000)
  } finally {
    await ctx.fiber.dispose()
  }
}, 90_000)
