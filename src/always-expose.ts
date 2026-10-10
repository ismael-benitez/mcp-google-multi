// Clients that never refresh on tools/list_changed (e.g. Claude Cowork) can't see discovered tools — see docs/features.md.
export function parseAlwaysExpose(env: NodeJS.ProcessEnv = process.env): string[] {
  const names = (env.GOOGLE_ALWAYS_EXPOSE ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set(names)];
}
