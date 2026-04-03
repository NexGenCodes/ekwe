import {
  createThemeSlice,
  ResolvedTheme,
  ThemeActions,
  ThemeState,
} from '../themeSlice';

describe('Theme Slice', () => {
  let slice: ThemeState & ThemeActions;
  const set = jest.fn((fn) => {
    const newState = fn(slice);
    slice = { ...slice, ...newState };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    slice = createThemeSlice(set);
  });

  it('should initialize with light theme', () => {
    expect(slice.resolved).toBe(ResolvedTheme.Light);
  });

  it('should update theme', () => {
    slice.setResolved(ResolvedTheme.Dark);
    expect(slice.resolved).toBe(ResolvedTheme.Dark);
  });
});
