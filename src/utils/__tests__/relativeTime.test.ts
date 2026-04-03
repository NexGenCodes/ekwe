import { getRelativeTime } from '../relativeTime';

describe('getRelativeTime', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-03T12:00:00Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('returns "Just now" for current time', () => {
    expect(getRelativeTime(Date.now())).toBe('Just now');
    expect(getRelativeTime(Date.now() - 30000)).toBe('Just now'); // 30s
  });

  it('returns minutes ago for < 1 hour', () => {
    expect(getRelativeTime(Date.now() - 60000)).toBe('1m ago');
    expect(getRelativeTime(Date.now() - 30 * 60000)).toBe('30m ago');
    expect(getRelativeTime(Date.now() - 59 * 60000)).toBe('59m ago');
  });

  it('returns hours ago for < 24 hours', () => {
    expect(getRelativeTime(Date.now() - 60 * 60000)).toBe('1h ago');
    expect(getRelativeTime(Date.now() - 12 * 3600000)).toBe('12h ago');
    expect(getRelativeTime(Date.now() - 23 * 3600000)).toBe('23h ago');
  });

  it('returns "Yesterday" for approx 24-48 hours', () => {
    expect(getRelativeTime(Date.now() - 25 * 3600000)).toBe('Yesterday');
    expect(getRelativeTime(Date.now() - 47 * 3600000)).toBe('Yesterday');
  });

  it('returns locale date string for > 48 hours', () => {
    const twoDaysAgo = Date.now() - 3 * 86400000;
    const expected = new Date(twoDaysAgo).toLocaleDateString();
    expect(getRelativeTime(twoDaysAgo)).toBe(expected);
  });
});
