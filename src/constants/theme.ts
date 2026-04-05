export const palette = {
  light: {
    background: '#FFFFFF',
    foreground: '#09090B',
    card: '#F4F4F5',
    primary: '#1D4ED8',
    accent: '#D97706',
    destructive: '#EF4444',
    border: '#E4E4E7',
    muted: '#71717A',
    primaryAccent: '#1D4ED8',
    onPrimary: '#FFFFFF',
    success: '#059669',
    warning: '#B45309',
    error: '#BE123C',
    info: '#1A7EC8',
    'bubble.idle': '#1D4ED8',
    'bubble.recording': '#EF4444',
    'bubble.processing': '#D97706',
    'bubble.done': '#059669',
    'bubble.error': '#BE123C',
  },
  dark: {
    background: '#09090B',
    foreground: '#FAFAFA',
    card: '#18181B',
    primary: '#1D4ED8',
    accent: '#FBBF24',
    destructive: '#EF4444',
    border: '#27272A',
    muted: '#52525B',
    primaryAccent: '#1D4ED8',
    onPrimary: '#FFFFFF',
    success: '#34D399',
    warning: '#F59E0B',
    error: '#FB7185',
    info: '#38BDF8',
    'bubble.idle': '#1D4ED8',
    'bubble.recording': '#EF4444',
    'bubble.processing': '#FBBF24',
    'bubble.done': '#34D399',
    'bubble.error': '#FB7185',
  },
};

export type ColorKey = keyof typeof palette.light;

export const getColor = (color: ColorKey, isDark: boolean): string => {
  return isDark ? palette.dark[color] : palette.light[color];
};
