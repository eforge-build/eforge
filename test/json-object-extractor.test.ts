import { describe, expect, it } from 'vitest';
import { findJsonObjectText } from '@eforge-build/engine/validation/json-object-extractor';

describe('findJsonObjectText', () => {
  it('prefers the first balanced object in a fenced json block', () => {
    const text = [
      'Here is the object:',
      '```json',
      '{"version":1,"criteria":[]}',
      '```',
      '{"ignored":true}',
    ].join('\n');

    expect(findJsonObjectText(text)).toBe('{"version":1,"criteria":[]}');
  });

  it('extracts from unlabeled fenced blocks before prose text', () => {
    const text = [
      'Preamble {"ignored":true}',
      '```',
      '{"selected":{"nested":true}}',
      '```',
    ].join('\n');

    expect(findJsonObjectText(text)).toBe('{"selected":{"nested":true}}');
  });

  it('prefers fenced json blocks with whitespace before the info string', () => {
    const text = [
      'Preamble {"ignored":true}',
      '``` json',
      '{"selected":true}',
      '```',
    ].join('\n');

    expect(findJsonObjectText(text)).toBe('{"selected":true}');
  });

  it('ignores braces and escaped quotes inside strings while balancing', () => {
    const text = 'Result: {"text":"brace } and escaped quote \\\" stay in string","nested":{"ok":true}} trailing';

    expect(findJsonObjectText(text)).toBe('{"text":"brace } and escaped quote \\\" stay in string","nested":{"ok":true}}');
  });

  it('extracts the first balanced prose object when there are no eligible fenced blocks', () => {
    const text = 'The valid object is {"selected":true}. Ignore {"later":true}.';

    expect(findJsonObjectText(text)).toBe('{"selected":true}');
  });

  it('returns undefined when no balanced object exists', () => {
    expect(findJsonObjectText('I do not see acceptance criteria.')).toBeUndefined();
    expect(findJsonObjectText('Partial {"version":1')).toBeUndefined();
  });
});
