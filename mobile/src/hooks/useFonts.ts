import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";
import { SpaceMono_400Regular } from "@expo-google-fonts/space-mono";
import { useFonts } from "expo-font";

export const useAppFonts = (): boolean => {
  const [fontsLoaded] = useFonts({
    "Outfit-Regular": Outfit_400Regular,
    "Outfit-Medium": Outfit_500Medium,
    "Outfit-Bold": Outfit_700Bold,
    "SpaceMono-Regular": SpaceMono_400Regular,
  });

  return fontsLoaded;
};
