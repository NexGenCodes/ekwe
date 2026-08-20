/**
 * Legal content — update ONLY this file when legal text changes.
 * The UI screens read from these constants and never need modification.
 */

export interface LegalSection {
  title: string;
  body: string;
}

export interface LegalDocument {
  title: string;
  lastUpdated: string;
  sections: LegalSection[];
}

export const LEGAL_CONTACT_EMAIL =
  process.env.EXPO_PUBLIC_CONTACT_EMAIL ?? "emmanuelztrd@gmail.com";

export const LEGAL_DOCUMENTS: Record<string, LegalDocument> = {
  privacy: {
    title: "Privacy Policy",
    lastUpdated: "May 16, 2026",
    sections: [
      {
        title: "Introduction",
        body: 'This privacy policy explains how Ekwe (the app) handles your data. Ekwe was created by Odugu Emmanuel Chinagorom and is offered as a free and paid service. The app is provided "as is," meaning we offer it without any guarantees beyond what\'s described here.',
      },
      {
        title: "What We Collect and Why",
        body: "When you download and use Ekwe, we collect:\n\n• Your device's IP address\n• Which screens you visit and for how long\n• Your device's operating system\n\nWe use this information to improve the app and fix issues. We do not sell your personal information.",
      },
      {
        title: "Location Data",
        body: "Ekwe may collect your approximate location (not precise GPS). We use this for:\n\n• Showing relevant content based on your region\n• Understanding usage patterns to improve the app\n• Occasionally sharing anonymized location data with service providers to help us improve\n\nYou can disable location access for Ekwe in your device settings at any time.",
      },
      {
        title: "Artificial Intelligence",
        body: "Ekwe uses AI to transcribe and translate your speech. Your audio may be processed by our AI service providers to deliver results. All AI processing follows this privacy policy and applicable laws. If you have questions, email us at emmanuelztrd@gmail.com.",
      },
      {
        title: "Communications",
        body: "We may email you with important updates about the app, required notices, or promotional offers. When you use Ekwe, we may ask for information like your name and email. We keep this information and use it as described in this policy.",
      },
      {
        title: "Third Parties We Work With",
        body: "Ekwe uses other companies to provide its service. Each has its own privacy policy:\n\n• Supabase (authentication & database)\n• PostHog (product analytics)\n• Flutterwave (payment processing)\n• Cloudflare Workers (backend API)\n• Apple (Sign In with Apple, App Store)\n• Google (Google Sign-In, Google Play Services)\n• Expo (development & build toolchain)\n• Sentry (crash reporting)\n• AI service providers (transcription & translation processing)\n\nWe may share your information:\n\n• If required by law (e.g., a court order)\n• To protect our rights, your safety, or the safety of others\n• To investigate fraud or respond to a government request\n• With trusted partners who have agreed to follow this privacy policy",
      },
      {
        title: "Your Choices",
        body: "You can stop all data collection by uninstalling Ekwe. Use your device's standard uninstall process or the app store. If you have an account, you can also request data deletion through the app's settings.",
      },
      {
        title: "Data Retention",
        body: "We keep your data for as long as you use Ekwe plus a reasonable time after. To request deletion of your data, email emmanuelztrd@gmail.com or use the Delete Account option in the app. We will respond within a reasonable time.",
      },
      {
        title: "Children's Privacy",
        body: "Ekwe is not intended for children under 13. We do not knowingly collect information from children under 13. If we discover a child under 13 has provided personal information, we will delete it immediately.\n\nIf you are a parent or guardian and believe your child has provided us with personal information, please contact us at emmanuelztrd@gmail.com.",
      },
      {
        title: "Security",
        body: "We take reasonable steps to protect your information using physical, electronic, and procedural safeguards. However, no system is completely secure, and we cannot guarantee absolute security.",
      },
      {
        title: "Changes to This Policy",
        body: "We may update this Privacy Policy. When we do, we'll update the date at the top of this page. If we make significant changes, we'll notify you through the app or by email. Continuing to use Ekwe after changes means you accept the updated policy.\n\nThis policy is effective as of 2026-05-16.",
      },
      {
        title: "Your Consent",
        body: "By using Ekwe and checking the consent box on the login screen, you agree to the processing of your information as described in this Privacy Policy.",
      },
      {
        title: "Contact Us",
        body: "If you have questions about this Privacy Policy or how we handle your data, email us at:\n\nemmanuelztrd@gmail.com",
      },
    ],
  },

  terms: {
    title: "Terms & Conditions",
    lastUpdated: "May 16, 2026",
    sections: [
      {
        title: "Introduction",
        body: "These terms apply to the Ekwe app, created by Odugu Emmanuel Chinagorom. By downloading or using Ekwe, you agree to these terms. Please read them carefully.",
      },
      {
        title: "What You Cannot Do",
        body: "You may not copy, modify, or reverse-engineer Ekwe or any part of it. You may not translate the app into other languages or create derivative versions. All trademarks, copyrights, and other intellectual property rights belong to Odugu Emmanuel Chinagorom.",
      },
      {
        title: "Changes to the Service",
        body: "We may update Ekwe, change features, or introduce fees at any time. We will clearly communicate any charges before they apply.",
      },
      {
        title: "Data Security & Your Device",
        body: "Ekwe stores and processes data you provide to deliver the service. You are responsible for keeping your phone secure. We strongly advise against jailbreaking or rooting your phone — this removes security protections, makes your device vulnerable to malware, and may cause Ekwe to malfunction or stop working.",
      },
      {
        title: "Third-Party Services",
        body: "Ekwe uses third-party services that have their own terms:\n\n• Supabase (authentication & database)\n• PostHog (product analytics)\n• Flutterwave (payment processing)\n• Cloudflare Workers (backend API)\n• Apple (Sign In with Apple, App Store)\n• Google (Google Sign-In, Google Play Services)\n• Expo (development & build toolchain)\n• Sentry (crash reporting)\n• AI service providers (transcription & translation processing)",
      },
      {
        title: "Internet & Data Charges",
        body: "Ekwe needs an internet connection (Wi-Fi or mobile data) for some features. We are not responsible if Ekwe doesn't work properly due to poor connectivity or exhausted data allowance.\n\nIf you use Ekwe on mobile data, standard carrier data charges apply. This includes roaming charges if you use Ekwe outside your home country. If you are not the bill payer, you confirm that you have permission from the bill payer.",
      },
      {
        title: "Device Battery & Functionality",
        body: "You are responsible for keeping your device charged. We are not responsible if you cannot use Ekwe because your battery ran out.\n\nWe work to keep Ekwe accurate and up to date, but we rely on third-party providers for some information. We are not liable for any loss resulting from your reliance on the app's functionality.",
      },
      {
        title: "Artificial Intelligence",
        body: "Ekwe uses AI for transcription and translation. By using the app, you acknowledge and agree that AI processes your data to deliver these features. All AI usage complies with applicable laws.",
      },
      {
        title: "Updates & Termination",
        body: "We may release updates to Ekwe. You may need to install these updates to continue using the app. We do not guarantee Ekwe will always be compatible with your device's operating system version.\n\nWe may stop providing Ekwe at any time without notice. If this happens, your right to use the app ends, and you should delete it from your device.",
      },
      {
        title: "Changes to These Terms",
        body: "We may update these terms. Check this page regularly for changes. We'll post updated terms here, and they take effect on the date posted.\n\nThese terms are effective as of 2026-05-16.",
      },
      {
        title: "Contact Us",
        body: "If you have questions about these terms, email us at:\n\nemmanuelztrd@gmail.com",
      },
    ],
  },
};
