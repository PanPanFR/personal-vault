// Minimal ambient types for libsodium-wrappers-sumo (no @types package for
// the -sumo build). Kept as `any`-level on purpose: all crypto invariants
// (key/nonce lengths, base64url alphabet) are enforced at runtime + tests,
// not by the wrapper's loose typings.
declare module "libsodium-wrappers-sumo" {
  const sodium: any;
  export default sodium;
}
