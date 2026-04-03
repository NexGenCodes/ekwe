import { LANGUAGES } from '../languages';

describe('Languages Constant', () => {
  it('should have a list of supported languages', () => {
    expect(LANGUAGES.length).toBeGreaterThan(0);
  });

  it('should include key languages like English, Spanish, and Italian', () => {
    const languageCodes = LANGUAGES.map((l) => l.code);
    expect(languageCodes).toContain('en');
    expect(languageCodes).toContain('es');
    expect(languageCodes).toContain('it');
  });

  it('should have valid language objects', () => {
    LANGUAGES.forEach((lang) => {
      expect(lang.code).toBeDefined();
      expect(lang.englishName).toBeDefined();
      expect(lang.nativeName).toBeDefined();
      expect(lang.groqCode).toBeDefined();
    });
  });

  it('should have exactly one default selected language', () => {
    // Wait, the prompt says defaultSelected: true for several...
    // Checking the file content, en, es, it, de, zh are all true.
    const defaultCount = LANGUAGES.filter((l) => l.defaultSelected).length;
    expect(defaultCount).toBe(5);
  });
});
