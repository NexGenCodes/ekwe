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

export const LEGAL_DOCUMENTS: Record<string, LegalDocument> = {
  privacy: {
    title: 'Privacy Policy',
    lastUpdated: 'May 16, 2026',
    sections: [
      {
        title: 'Introduction',
        body: 'This privacy policy applies to the Ekwe app (hereby referred to as "Application") for mobile devices that was created by Odugu Emmanuel Chinagorom (hereby referred to as "Service Provider") as a Freemium service. This service is intended for use "AS IS".',
      },
      {
        title: 'Information Collection and Use',
        body: "The Application collects information when you download and use it. This information may include:\n\n• Your device's Internet Protocol address (e.g. IP address)\n• The pages of the Application that you visit, the time and date of your visit, and the time spent on those pages\n• The time spent on the Application\n• The operating system you use on your mobile device",
      },
      {
        title: 'Location Data',
        body: "The Application collects your device's location, which helps the Service Provider determine your approximate geographical location and make use of in the following ways:\n\n• Geolocation Services: The Service Provider utilizes location data to provide features such as personalized content, relevant recommendations, and location-based services.\n• Analytics and Improvements: Aggregated and anonymized location data helps the Service Provider to analyze user behavior, identify trends, and improve the overall performance and functionality of the Application.\n• Third-Party Services: Periodically, the Service Provider may transmit anonymized location data to external services. These services assist them in enhancing the Application and optimizing their offerings.",
      },
      {
        title: 'Artificial Intelligence',
        body: 'The Application uses Artificial Intelligence (AI) technologies to enhance user experience and provide certain features. The AI components may process user data to deliver personalized content, recommendations, or automated functionalities. All AI processing is performed in accordance with this privacy policy and applicable laws. If you have questions about the AI features or data processing, please contact the Service Provider.',
      },
      {
        title: 'Communications',
        body: 'The Service Provider may use the information you provided to contact you from time to time to provide you with important information, required notices and marketing promotions.\n\nFor a better experience, while using the Application, the Service Provider may require you to provide certain personally identifiable information. The information that the Service Provider requests will be retained by them and used as described in this privacy policy.',
      },
      {
        title: 'Third Party Access',
        body: 'Only aggregated, anonymized data is periodically transmitted to external services to aid the Service Provider in improving the Application and their service.\n\nThe Application utilizes third-party services that have their own Privacy Policy about handling data:\n\n• Google Play Services\n• AdMob\n• Google Analytics for Firebase\n• Expo\n\nThe Service Provider may disclose your information:\n\n• As required by law, such as to comply with a subpoena or similar legal process\n• When they believe in good faith that disclosure is necessary to protect their rights, your safety or the safety of others, investigate fraud, or respond to a government request\n• With trusted service providers who work on their behalf and have agreed to adhere to the rules set forth in this privacy statement',
      },
      {
        title: 'Opt-Out Rights',
        body: 'You can stop all collection of information by the Application easily by uninstalling it. You may use the standard uninstall processes as may be available as part of your mobile device or via the mobile application marketplace or network.',
      },
      {
        title: 'Data Retention Policy',
        body: "The Service Provider will retain User Provided data for as long as you use the Application and for a reasonable time thereafter. If you'd like them to delete User Provided Data that you have provided via the Application, please contact them at emmanuelztrd@gmail.com and they will respond in a reasonable time.",
      },
      {
        title: "Children's Privacy",
        body: 'The Service Provider does not use the Application to knowingly solicit data from or market to children under the age of 13.\n\nThe Application does not address anyone under the age of 13. The Service Provider does not knowingly collect personally identifiable information from children under 13 years of age. In the case the Service Provider discover that a child under 13 has provided personal information, the Service Provider will immediately delete this from their servers.\n\nIf you are a parent or guardian and you are aware that your child has provided us with personal information, please contact the Service Provider at emmanuelztrd@gmail.com so that they will be able to take the necessary actions.',
      },
      {
        title: 'Security',
        body: 'The Service Provider is concerned about safeguarding the confidentiality of your information. The Service Provider provides physical, electronic, and procedural safeguards to protect information the Service Provider processes and maintains.',
      },
      {
        title: 'Changes to This Policy',
        body: 'This Privacy Policy may be updated from time to time for any reason. The Service Provider will notify you of any changes to the Privacy Policy by updating this page with the new Privacy Policy. You are advised to consult this Privacy Policy regularly for any changes, as continued use is deemed approval of all changes.\n\nThis privacy policy is effective as of 2026-05-16.',
      },
      {
        title: 'Your Consent',
        body: 'By using the Application, you are consenting to the processing of your information as set forth in this Privacy Policy now and as amended by us.',
      },
      {
        title: 'Contact Us',
        body: 'If you have any questions regarding privacy while using the Application, or have questions about the practices, please contact the Service Provider via email at:\n\nemmanuelztrd@gmail.com',
      },
    ],
  },

  terms: {
    title: 'Terms & Conditions',
    lastUpdated: 'May 16, 2026',
    sections: [
      {
        title: 'Introduction',
        body: 'These terms and conditions apply to the ekwe app (hereby referred to as "Application") for mobile devices that was created by odugu emmanuel chinagorom (hereby referred to as "Service Provider") as a Freemium service.\n\nUpon downloading or utilizing the Application, you are automatically agreeing to the following terms. It is strongly advised that you thoroughly read and understand these terms prior to using the Application.',
      },
      {
        title: 'Intellectual Property',
        body: 'Unauthorized copying, modification of the Application, any part of the Application, or our trademarks is strictly prohibited. Any attempts to extract the source code of the Application, translate the Application into other languages, or create derivative versions are not permitted. All trademarks, copyrights, database rights, and other intellectual property rights related to the Application remain the property of the Service Provider.',
      },
      {
        title: 'Service Modifications',
        body: 'The Service Provider is dedicated to ensuring that the Application is as beneficial and efficient as possible. As such, they reserve the right to modify the Application or charge for their services at any time and for any reason. The Service Provider assures you that any charges for the Application or its services will be clearly communicated to you.',
      },
      {
        title: 'Data Security & Device Integrity',
        body: "The Application stores and processes personal data that you have provided to the Service Provider in order to provide the Service. It is your responsibility to maintain the security of your phone and access to the Application. The Service Provider strongly advise against jailbreaking or rooting your phone, which involves removing software restrictions and limitations imposed by the official operating system of your device. Such actions could expose your phone to malware, viruses, malicious programs, compromise your phone's security features, and may result in the Application not functioning correctly or at all.",
      },
      {
        title: 'Third-Party Services',
        body: 'Please note that the Application utilizes third-party services that have their own Terms and Conditions. Below are the links to the Terms and Conditions of the third-party service providers used by the Application:\n\n• Google Play Services\n• AdMob\n• Google Analytics for Firebase\n• Expo',
      },
      {
        title: 'Internet Connectivity & Carrier Charges',
        body: "Please be aware that the Service Provider does not assume responsibility for certain aspects. Some functions of the Application require an active internet connection, which can be Wi-Fi or provided by your mobile network provider. The Service Provider cannot be held responsible if the Application does not function at full capacity due to lack of access to Wi-Fi or if you have exhausted your data allowance.\n\nIf you are using the application outside of a Wi-Fi area, please be aware that your mobile network provider's agreement terms still apply. Consequently, you may incur charges from your mobile provider for data usage during the connection to the application, or other third-party charges. By using the application, you accept responsibility for any such charges, including roaming data charges if you use the application outside of your home territory (i.e., region or country) without disabling data roaming. If you are not the bill payer for the device on which you are using the application, they assume that you have obtained permission from the bill payer.",
      },
      {
        title: 'Device Battery & Functionality',
        body: "Similarly, the Service Provider cannot always assume responsibility for your usage of the application. For instance, it is your responsibility to ensure that your device remains charged. If your device runs out of battery and you are unable to access the Service, the Service Provider cannot be held responsible.\n\nIn terms of the Service Provider's responsibility for your use of the application, it is important to note that while they strive to ensure that it is updated and accurate at all times, they do rely on third parties to provide information to them so that they can make it available to you. The Service Provider accepts no liability for any loss, direct or indirect, that you experience as a result of relying entirely on this functionality of the application.",
      },
      {
        title: 'Artificial Intelligence',
        body: 'The Application incorporates Artificial Intelligence (AI) technologies to provide certain features or services. By using the Application, you acknowledge and agree that AI may be used to process data and deliver functionalities. The Service Provider ensures that all AI usage complies with applicable laws and is designed to benefit the user experience.',
      },
      {
        title: 'App Updates & Termination',
        body: 'The Service Provider may wish to update the application at some point. The application is currently available as per the requirements for the operating system (and for any additional systems they decide to extend the availability of the application to) may change, and you will need to download the updates if you want to continue using the application. The Service Provider does not guarantee that it will always update the application so that it is relevant to you and/or compatible with the particular operating system version installed on your device. However, you agree to always accept updates to the application when offered to you.\n\nThe Service Provider may also wish to cease providing the application and may terminate its use at any time without providing termination notice to you. Unless they inform you otherwise, upon any termination, (a) the rights and licenses granted to you in these terms will end; (b) you must cease using the application, and (if necessary) delete it from your device.',
      },
      {
        title: 'Changes to These Terms and Conditions',
        body: 'The Service Provider may periodically update their Terms and Conditions. Therefore, you are advised to review this page regularly for any changes. The Service Provider will notify you of any changes by posting the new Terms and Conditions on this page.\n\nThese terms and conditions are effective as of 2026-05-16.',
      },
      {
        title: 'Contact Us',
        body: 'If you have any questions or suggestions about the Terms and Conditions, please do not hesitate to contact the Service Provider at emmanuelztrd@gmail.com.',
      },
    ],
  },
};
