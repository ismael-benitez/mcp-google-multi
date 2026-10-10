import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../src/registry.js';
import { parseAlwaysExpose } from '../src/always-expose.js';
import type { Policy } from '../src/write-control.js';

const SAFE: Policy = { profile: 'safe-writes', readOnly: false, allow: [], deny: [] };

function fakeServer() {
  let listHandler: (() => Promise<{ tools: { name: string }[] }>) | undefined;
  const server = {
    registerTool: () => 'ok',
    sendToolListChanged: vi.fn(),
    server: {
      setRequestHandler: (_s: unknown, h: () => Promise<{ tools: { name: string }[] }>) => {
        listHandler = h;
      },
    },
  };
  return { server, list: async () => (await listHandler!()).tools.map((t) => t.name) };
}

function buildFixture() {
  const { server, list } = fakeServer();
  const reg = new ToolRegistry(server as never, SAFE);
  const shape = { account: z.string() };
  for (const n of ['drive_search', 'drive_list', 'drive_upload', 'drive_trash', 'drive_untrash', 'drive_share', 'gmail_send']) {
    reg.registerTool(n, { description: n, inputSchema: shape }, () => {});
  }
  reg.registerMeta('drive_discover', { description: 'd', inputSchema: {} }, () => {});
  return { reg, server, list };
}

describe('parseAlwaysExpose', () => {
  it('is empty when unset or blank', () => {
    expect(parseAlwaysExpose({})).toEqual([]);
    expect(parseAlwaysExpose({ GOOGLE_ALWAYS_EXPOSE: '  ' })).toEqual([]);
  });

  it('splits a CSV, trims and de-duplicates', () => {
    expect(parseAlwaysExpose({ GOOGLE_ALWAYS_EXPOSE: ' drive_search, drive_upload ,drive_search,' })).toEqual([
      'drive_search',
      'drive_upload',
    ]);
  });
});

describe('ToolRegistry.exposeAlways', () => {
  it('lists the named tools from boot without any discover call, and nothing else', async () => {
    const { reg, server, list } = buildFixture();
    const unknown = reg.exposeAlways(['drive_search', 'drive_list', 'drive_upload', 'drive_trash', 'drive_untrash']);
    reg.installListHandler();

    expect(unknown).toEqual([]);
    const names = await list();
    expect(names).toEqual(
      expect.arrayContaining(['drive_discover', 'drive_search', 'drive_list', 'drive_upload', 'drive_trash', 'drive_untrash']),
    );
    expect(names).not.toContain('drive_share');
    expect(names).not.toContain('gmail_send');
    // pinning is static: it must not fire tools/list_changed (Cowork ignores it anyway)
    expect(server.sendToolListChanged).not.toHaveBeenCalled();
  });

  it('keeps discovery mode working for the rest of the service', async () => {
    const { reg, list } = buildFixture();
    reg.exposeAlways(['drive_upload']);
    reg.installListHandler();
    expect(await list()).not.toContain('drive_share');
    reg.reveal('drive');
    expect(await list()).toContain('drive_share');
  });

  it('returns unknown names so the caller can warn, without exposing anything for them', async () => {
    const { reg, list } = buildFixture();
    expect(reg.exposeAlways(['drive_upload', 'drive_nope'])).toEqual(['drive_nope']);
    reg.installListHandler();
    expect(await list()).not.toContain('drive_nope');
  });

  it('does not count pinned tools as hidden', () => {
    const { reg } = buildFixture();
    const before = reg.visibleCount();
    reg.exposeAlways(['drive_upload', 'drive_search']);
    const after = reg.visibleCount();
    expect(after.hidden).toBe(before.hidden - 2);
    expect(after.revealed).toBe(before.revealed + 2);
  });
});
