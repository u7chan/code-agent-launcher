import { describe, expect, it } from 'bun:test';
import { parseRunArgv } from './run.js';

describe('parseRunArgv', () => {
  it('takes level before -- and prompt after --', () => {
    expect(parseRunArgv(['node', 'ocgo', 'run', 'mid', '--', 'hello'])).toEqual({
      positionalLevel: 'mid',
      extraArgs: ['hello'],
    });
  });

  it('does not treat post-- prompt as level when only --model is set', () => {
    expect(parseRunArgv(['node', 'ocgo', 'run', '--model', 'qwen3.7-plus', '--', 'hello'])).toEqual(
      {
        positionalLevel: undefined,
        extraArgs: ['hello'],
      },
    );
  });

  it('supports level via -l before --', () => {
    expect(parseRunArgv(['node', 'ocgo', 'run', '-l', 'high', '--', 'hello'])).toEqual({
      positionalLevel: undefined,
      extraArgs: ['hello'],
    });
  });

  it('keeps extra positionals before -- as extraArgs', () => {
    expect(parseRunArgv(['node', 'ocgo', 'run', 'mid', 'extra', '--', 'hello'])).toEqual({
      positionalLevel: 'mid',
      extraArgs: ['extra', 'hello'],
    });
  });

  it('works without -- separator', () => {
    expect(parseRunArgv(['node', 'ocgo', 'run', 'mid', 'hello'])).toEqual({
      positionalLevel: 'mid',
      extraArgs: ['hello'],
    });
  });
});
