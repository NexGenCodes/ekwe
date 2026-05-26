import { useFonts, Outfit_400Regular, Outfit_700Bold, Merriweather_400Regular, Merriweather_700Bold, SpaceMono_400Regular } from '@expo-google-fonts';

export const useAppFonts = () => {
  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_700Bold,
    Merriweather_400Regular,
    Merriweather_700Bold,
    SpaceMono_400Regular,
  });

  return fontsLoaded;
};