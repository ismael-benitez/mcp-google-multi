import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildUploadRequest, resolveUploadSource, UPLOAD_RESPONSE_FIELDS } from '../src/tools/drive.js';

async function drain(body: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

describe('resolveUploadSource', () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const p of tmp.splice(0)) fs.rmSync(p, { recursive: true, force: true });
  });

  it('accepts inline UTF-8 text and reports the encoded byte size', async () => {
    const content = 'línea uno\nlínea dos\n';
    const src = resolveUploadSource({ filename: 'hal-upload-test.md', content });
    if (!src.ok) throw new Error(src.message);
    const bytes = Buffer.from(content, 'utf8');
    expect(src.size).toBe(bytes.length);
    expect((await drain(src.body)).equals(bytes)).toBe(true);
  });

  it('defaults the media type to text/markdown for .md names', () => {
    const src = resolveUploadSource({ filename: 'notes.md', content: '# x' });
    expect(src.ok && src.mimeType).toBe('text/markdown');
  });

  it('falls back to application/octet-stream for unknown inline names and honors an explicit mimeType', () => {
    const a = resolveUploadSource({ filename: 'blob', content: 'x' });
    expect(a.ok && a.mimeType).toBe('application/octet-stream');
    const b = resolveUploadSource({ filename: 'notes.md', content: 'x', mimeType: 'text/plain' });
    expect(b.ok && b.mimeType).toBe('text/plain');
  });

  it('decodes contentBase64 to the exact binary bytes', async () => {
    const raw = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);
    const src = resolveUploadSource({ filename: 'a.pdf', contentBase64: raw.toString('base64') });
    if (!src.ok) throw new Error(src.message);
    expect(src.mimeType).toBe('application/pdf');
    expect(src.size).toBe(raw.length);
    expect((await drain(src.body)).equals(raw)).toBe(true);
  });

  it('rejects malformed base64 instead of uploading garbage', () => {
    const src = resolveUploadSource({ filename: 'a.bin', contentBase64: 'not base64!!' });
    expect(src.ok).toBe(false);
    expect(!src.ok && src.error).toBe('invalid_argument');
  });

  it('still uploads from localPath, inferring the type from the path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gm-up-'));
    tmp.push(dir);
    const p = path.join(dir, 'report.md');
    fs.writeFileSync(p, 'hola');
    const src = resolveUploadSource({ filename: 'Report', localPath: p });
    if (!src.ok) throw new Error(src.message);
    expect(src.mimeType).toBe('text/markdown');
    expect(src.size).toBe(4);
    expect((await drain(src.body)).toString()).toBe('hola');
  });

  it.each([
    [{}],
    [{ content: 'a', contentBase64: 'YQ==' }],
    [{ content: 'a', localPath: '/tmp/x' }],
    [{ contentBase64: 'YQ==', localPath: '/tmp/x' }],
  ])('requires exactly one source: %j', (args) => {
    const src = resolveUploadSource({ filename: 'x.md', ...args });
    expect(src.ok).toBe(false);
    expect(!src.ok && src.error).toBe('invalid_argument');
  });

  it('accepts an empty inline file', () => {
    const src = resolveUploadSource({ filename: 'empty.md', content: '' });
    expect(src.ok && src.size).toBe(0);
  });

  it('never echoes the content in an error message', () => {
    const secret = 'IBAN-LIKE-SECRET-123';
    const src = resolveUploadSource({ filename: 'x.md', content: secret, contentBase64: 'YQ==' });
    expect(!src.ok && src.message).not.toContain(secret);
  });
});

describe('buildUploadRequest', () => {
  it('targets shared drives and asks for the full response field set', () => {
    const src = resolveUploadSource({ filename: 'hal.md', content: 'x' });
    if (!src.ok) throw new Error(src.message);
    const req = buildUploadRequest({ filename: 'hal.md', parentFolderId: 'FOLDER', source: src });
    expect(req.supportsAllDrives).toBe(true);
    expect(req.requestBody).toEqual({ name: 'hal.md', parents: ['FOLDER'] });
    expect(req.media.mimeType).toBe('text/markdown');
    expect(req.fields).toBe(UPLOAD_RESPONSE_FIELDS);
    for (const f of ['id', 'name', 'parents', 'mimeType', 'size', 'webViewLink']) {
      expect(UPLOAD_RESPONSE_FIELDS.split(',')).toContain(f);
    }
  });

  it('keeps convertTo semantics: resource type = target, media type = source', () => {
    const src = resolveUploadSource({ filename: 'hal.md', content: 'x' });
    if (!src.ok) throw new Error(src.message);
    const req = buildUploadRequest({
      filename: 'hal',
      source: src,
      convertTo: 'application/vnd.google-apps.document',
    });
    expect(req.requestBody).toEqual({ name: 'hal', mimeType: 'application/vnd.google-apps.document' });
    expect(req.media.mimeType).toBe('text/markdown');
  });
});
