export interface Tokens {
  color: {
    background: {
      primary: string;
      secondary: string;
      tertiary: string;
    };
    text: {
      primary: string;
      secondary: string;
      tertiary: string;
      inverse: string;
    };
    border: {
      default: string;
      strong: string;
    };
    brand: {
      navy: string;
      core: string;
      bright: string;
      sky: string;
      green: string;
    };
    status: {
      error: string;
      warning: string;
      success: string;
      info: string;
    };
    bubble: {
      idle: string;
      recording: string;
      processing: string;
      done: string;
      error: string;
    };
    translation: {
      surface: string;
    };
  };
  space: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
    6: number;
    8: number;
    10: number;
    12: number;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    full: number;
  };
  font: {
    family: {
      display: string;
      body: string;
      bodyMed: string;
      mono: string;
    };
    size: {
      display: number;
      heading: number;
      body: number;
      label: number;
      caption: number;
    };
    weight: { regular: string; medium: string };
    lineHeight: {
      display: number;
      heading: number;
      body: number;
      label: number;
      caption: number;
    };
    letterSpacing: { label: number };
  };
  shadow: {
    card: object;
    overlay: object;
  };
}

export const lightTokens: Tokens = {
  color: {
    background: {
      primary: '#FFFFFF',
      secondary: '#EBF0F5',
      tertiary: '#E2E8F0',
    },
    text: {
      primary: '#0A1F30',
      secondary: '#4A5568',
      tertiary: '#8A96A3',
      inverse: '#FFFFFF',
    },
    border: {
      default: '#E2E8F0',
      strong: '#CBD5E0',
    },
    brand: {
      navy: '#0A1F30',
      core: '#1A7EC8',
      bright: '#26A0E3',
      sky: '#7ecaf5',
      green: '#1D9E75',
    },
    status: {
      error: '#E24B4A',
      warning: '#BA7517',
      success: '#1D9E75',
      info: '#1A7EC8',
    },
    bubble: {
      idle: '#0A1F30',
      recording: '#E24B4A',
      processing: '#0A1F30',
      done: '#1D9E75',
      error: '#854F0B',
    },
    translation: {
      surface: '#E6F1FB',
    },
  },
  space: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    10: 40,
    12: 48,
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 24, full: 999 },
  font: {
    family: {
      display: 'DMSerifDisplay-Regular',
      body: 'Outfit-Regular',
      bodyMed: 'Outfit-Medium',
      mono: 'SpaceMono-Regular',
    },
    size: {
      display: 32,
      heading: 20,
      body: 15,
      label: 12,
      caption: 11,
    },
    weight: { regular: '400', medium: '500' },
    lineHeight: {
      display: 38,
      heading: 26,
      body: 24,
      label: 18,
      caption: 16,
    },
    letterSpacing: { label: 0.8 },
  },
  shadow: {
    card: {
      shadowColor: '#0A1F30',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 3,
    },
    overlay: {
      shadowColor: '#0A1F30',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.12,
      shadowRadius: 24,
      elevation: 12,
    },
  },
};

export const darkTokens: Tokens = {
  ...lightTokens,
  color: {
    ...lightTokens.color,
    background: {
      primary: '#0A1220',
      secondary: '#111827',
      tertiary: '#1A2332',
    },
    text: {
      primary: '#F0F4F8',
      secondary: '#A0AEC0',
      tertiary: '#64748B',
      inverse: '#0A1F30',
    },
    border: {
      default: '#1E2D3D',
      strong: '#2D3F52',
    },
    translation: {
      surface: '#042C53',
    },
  },
  shadow: {
    card: {},
    overlay: {},
  },
};
