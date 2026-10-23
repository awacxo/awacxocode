// awacxocode built-in base config, loaded beneath every other config source
// (see fork/patches.ts "defaults-load"). The provider, its models and the default model
// come from the gateway's /.well-known/opencode manifest once the user logs in; this only
// holds what must apply before login.
export const AwacxoDefaults = {
  // Only our gateway provider is usable (also hides upstream's free models before login).
  enabled_providers: ["awacxocode"],
  // Upstream's updater and share service point at opencode.ai.
  update: "disable",
  share: "disabled",
}
