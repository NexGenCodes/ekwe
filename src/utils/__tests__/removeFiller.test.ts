import { removeFillerWords } from '../removeFiller';

describe('removeFillerWords', () => {
  const fillers = ['um', 'uh', 'like', 'you know'];

  it('should remove a single filler word', () => {
    const text = 'Hey, um, what is up?';
    const result = removeFillerWords(text, fillers);
    expect(result).toBe('Hey, what is up?');
  });

  it('should remove multiple filler words', () => {
    const text = 'Uh, like, you know, what I mean?';
    const result = removeFillerWords(text, fillers);
    expect(result).toBe('what I mean?');
  });

  it('should handle case insensitivity', () => {
    const text = 'UM, like, what was that?';
    const result = removeFillerWords(text, fillers);
    expect(result).toBe('what was that?');
  });

  it('should handle multiple occurrences', () => {
    const text = 'um, hey um, where um';
    const result = removeFillerWords(text, fillers);
    expect(result).toBe('hey where');
  });

  it('should collapse extra spaces', () => {
    const text = 'hello     world';
    const result = removeFillerWords(text, []);
    expect(result).toBe('hello world');
  });

  it('should not remove words that are parts of other words', () => {
    const text = 'Plump like plums';
    const result = removeFillerWords(text, fillers);
    expect(result).toBe('Plump plums');
    // "Plump" has "um", but it should NOT be removed because of the \b regex.
  });
});
