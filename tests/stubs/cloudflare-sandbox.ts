// Test stub for `@cloudflare/sandbox`.
//
// The real package pulls in `@cloudflare/containers`, whose dist uses extensionless
// ESM imports that Vitest's Node resolver can't load — so importing it in tests
// blows up at resolution time. Tests never need the real container SDK: they
// replace `getSandbox` via `vi.mock('@cloudflare/sandbox', ...)`. This alias
// (see tests/vitest.config.ts) makes the specifier resolve to this lightweight
// module instead. The throwing default is a safety net for any test that forgets
// to install its own mock.

export function getSandbox(): never {
  throw new Error('getSandbox() stub — mock "@cloudflare/sandbox" in your test.');
}
