import { lightTokens, darkTokens } from '../tokens';

describe('Design Tokens', () => {
  it('should have primary colors defined', () => {
    expect(lightTokens.color.background.primary).toBe('#FFFFFF');
    expect(darkTokens.color.background.primary).toBe('#0A1220');
  });

  it('should have common space and radius tokens', () => {
    expect(lightTokens.space[1]).toBe(4);
    expect(darkTokens.space[1]).toBe(4);
    expect(lightTokens.radius.full).toBe(999);
  });

  it('should have consistent font families', () => {
    expect(lightTokens.font.family.display).toBe('DMSerifDisplay-Regular');
    expect(darkTokens.font.family.display).toBe('DMSerifDisplay-Regular');
  });
});
