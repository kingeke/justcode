import { describe, expect, it } from 'vitest';

import { looksBinary, stageFiles } from '@ext/webview/attachment-files';

// Control-character samples built via escapes so no invisible bytes live in
// this source file.
const NUL = String.fromCharCode(0);
const CONTROLS = String.fromCharCode(1, 2, 3, 4, 5, 6);
const REPLACEMENT = String.fromCharCode(0xfffd).repeat(4);

describe('looksBinary', () => {
  it('accepts ordinary source text, including tabs and CRLF', () => {
    expect(looksBinary('const x = 1;\n\tif (x) {\r\n}\n')).toBe(false);
    expect(looksBinary('')).toBe(false);
    expect(looksBinary('unicode ok: héllo — ✓')).toBe(false);
  });

  it('flags NUL bytes and control-character-heavy content', () => {
    expect(looksBinary(`PK${NUL}${NUL}binary`)).toBe(true);
    expect(looksBinary(`${CONTROLS}abc`)).toBe(true);
    // Decode-failure replacement characters mean the bytes were not text.
    expect(looksBinary(`${REPLACEMENT} data`)).toBe(true);
  });
});

describe('stageFiles', () => {
  it('routes images to image chips and text files to attachments', async () => {
    const staged = await stageFiles([
      new File(['fake-png-bytes'], 'shot.png', { type: 'image/png' }),
      new File(['<html></html>'], 'index.html', { type: 'text/html' }),
    ]);

    expect(staged.images).toHaveLength(1);
    expect(staged.images[0]?.mediaType).toBe('image/png');
    expect(staged.files).toHaveLength(1);
    expect(staged.files[0]?.name).toBe('index.html');
    expect(staged.files[0]?.content).toBe('<html></html>');
    expect(staged.rejected).toEqual([]);
  });

  it('attaches binary files as base64 payloads — anything attaches', async () => {
    const binaryBytes = `PK${NUL}${NUL}${CONTROLS}`;
    const staged = await stageFiles([
      new File([binaryBytes], 'passport.pdf', { type: 'application/pdf' }),
      // Multi-megabyte text attaches fine too — context spend is the user's call.
      new File(['x'.repeat(2 * 1024 * 1024)], 'huge.txt', {
        type: 'text/plain',
      }),
      new File(['plain ok'], 'notes.txt', { type: 'text/plain' }),
    ]);

    expect(staged.rejected).toEqual([]);
    expect(staged.files.map((f) => f.name)).toEqual([
      'passport.pdf',
      'huge.txt',
      'notes.txt',
    ]);
    const pdf = staged.files[0]!;
    expect(pdf.encoding).toBe('base64');
    expect(pdf.mediaType).toBe('application/pdf');
    // Round-trips: the base64 payload decodes back to the original bytes.
    expect(atob(pdf.content)).toBe(binaryBytes);
    // Text files stay inline with no encoding marker.
    expect(staged.files[1]?.encoding).toBeUndefined();
  });

  it('attaches files with no declared MIME type as text when they are text', async () => {
    const staged = await stageFiles([
      new File(['#!/bin/sh\necho hi\n'], 'script', { type: '' }),
    ]);

    expect(staged.files).toHaveLength(1);
    expect(staged.files[0]?.name).toBe('script');
    expect(staged.rejected).toEqual([]);
  });
});
