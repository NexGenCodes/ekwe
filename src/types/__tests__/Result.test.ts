import { ok, err } from '../Result';

describe('Result Utilities', () => {
  it('should create an ok result', () => {
    const value = { data: 'test' };
    const result = ok(value);
    expect(result).toEqual({ ok: true, value });
  });

  it('should create an error result', () => {
    const error = 'Something went wrong';
    const result = err(error);
    expect(result).toEqual({ ok: false, error });
  });
});
