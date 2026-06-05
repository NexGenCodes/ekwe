import { isAndroid } from "@/utils";
import logger from "@/utils/logger";

export class FloatingWidgetService {
  static async requestOverlayPermission(): Promise<boolean> {
    if (!isAndroid) {
      logger.info("FloatingWidgetService: Overlay permission is Android-only.");
      return false;
    }
    logger.info("FloatingWidgetService: Requesting SYSTEM_ALERT_WINDOW permission.");
    // In a real native module implementation, we would call our ekwe-native or 
    // react-native-floating-bubble here to prompt the user for Display Over Other Apps permission.
    // We mock success for now so the UI can proceed.
    return true; 
  }

  static showWidget(): void {
    if (!isAndroid) return;
    logger.info("FloatingWidgetService: Showing native floating widget.");
  }

  static hideWidget(): void {
    if (!isAndroid) return;
    logger.info("FloatingWidgetService: Hiding native floating widget.");
  }
}
