import { describe, expect, it } from 'vitest';

import { parseRemovedPaths } from '@ext/host/parse-removed-paths';

describe('parseRemovedPaths', () => {
  it('extracts a single rm target', () => {
    expect(parseRemovedPaths('rm src/foo.ts')).toEqual(['src/foo.ts']);
  });

  it('skips flags and keeps multiple targets', () => {
    expect(parseRemovedPaths('rm -rf a.ts b.ts')).toEqual(['a.ts', 'b.ts']);
  });

  it('handles unlink', () => {
    expect(parseRemovedPaths('unlink notes.txt')).toEqual(['notes.txt']);
  });

  it('resolves rm paths relative to a leading cd', () => {
    expect(parseRemovedPaths('cd src && rm old.ts')).toEqual(['src/old.ts']);
    expect(parseRemovedPaths('cd a/b && rm ../c.ts')).toEqual(['a/c.ts']);
  });

  it('strips surrounding quotes', () => {
    expect(parseRemovedPaths('rm "my file.txt"')).toEqual(['my file.txt']);
  });

  it('ignores arguments that need shell expansion', () => {
    expect(parseRemovedPaths('rm *.log')).toEqual([]);
    expect(parseRemovedPaths('rm $TMP/x')).toEqual([]);
    expect(parseRemovedPaths('rm ~/x.ts')).toEqual([]);
  });

  it('ignores non-removal commands', () => {
    expect(parseRemovedPaths('ls -la')).toEqual([]);
    expect(parseRemovedPaths('echo rm not-a-deletion')).toEqual([]);
  });

  it('handles absolute rm binary paths', () => {
    expect(parseRemovedPaths('/bin/rm a.ts')).toEqual(['a.ts']);
  });
});
