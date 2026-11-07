import { siteConfig } from "../data/siteConfig";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";

export default function Privacy() {
  const a = siteConfig.app.name;
  return (
    <>
      <Nav
        links={[
          { to: "/", label: "Home" },
          { to: "/terms", label: "Terms" },
          { to: "/changelog", label: "Changelog" },
        ]}
      />
      <main className="legal">
        <div className="container">
          <h1>Privacy Policy</h1>
          <p className="legal-date">
            Last updated: {siteConfig.legal.lastUpdated}
          </p>
          <div className="legal-wrap">
            <div className="legal-content">
              <h2>1. Introduction</h2>
              <p>
                {a} ("we", "us", or "our") is committed to protecting your
                privacy. This Privacy Policy explains how we handle information
                when you use our mobile application and iOS share extension (the
                "App").
              </p>
              <h2>2. Information We Collect</h2>
              <p>
                We collect minimal information to provide and improve the App:
              </p>
              <ul>
                <li>
                  <strong>Audio data:</strong> Voice notes you record or import
                  are processed in real-time to generate translations. Audio is
                  processed on-device or through third-party AI services only
                  for the purpose of translation and is not stored on our
                  servers.
                </li>
                <li>
                  <strong>Usage analytics:</strong> We may collect anonymous
                  usage data (e.g., feature usage, crash reports) through
                  third-party analytics tools to improve the App.
                </li>
                <li>
                  <strong>Device information:</strong> Basic device metadata
                  (e.g., device model, OS version) may be collected for
                  analytics and crash reporting purposes.
                </li>
              </ul>
              <h2>3. How We Use Your Information</h2>
              <ul>
                <li>To provide real-time voice translation services</li>
                <li>To improve the App's performance and features</li>
                <li>To diagnose and fix technical issues</li>
                <li>
                  To understand usage patterns and optimize the user experience
                </li>
              </ul>
              <h2>4. Data Storage</h2>
              <p>
                All your translations and voice notes are stored locally on your
                device. We do not upload your audio or translation data to our
                servers. You may delete your data at any time by clearing the
                App's data or using the in-app history delete feature.
              </p>
              <h2>5. Third-Party Services</h2>
              <p>The App may use the following third-party services:</p>
              <ul>
                <li>
                  <strong>AI translation providers:</strong> Audio data may be
                  sent to third-party AI services (e.g., speech-to-text and
                  translation APIs) solely for the purpose of generating
                  translations. These services are governed by their own privacy
                  policies.
                </li>
                <li>
                  <strong>Analytics:</strong> We use anonymous analytics tools
                  to understand how the App is used.
                </li>
                <li>
                  <strong>Error monitoring:</strong> Crash reports may be sent
                  to error monitoring services to help us fix bugs.
                </li>
              </ul>
              <h2>6. Data Security</h2>
              <p>
                We implement industry-standard security measures to protect your
                data. However, no method of transmission over the Internet or
                electronic storage is 100% secure, and we cannot guarantee
                absolute security.
              </p>
              <h2>7. Children's Privacy</h2>
              <p>
                The App is not intended for children under the age of 13. We do
                not knowingly collect personal information from children under
                13.
              </p>
              <h2>8. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. We will
                notify you of any changes by posting the new Privacy Policy in
                the App and updating the "Last updated" date above.
              </p>
              <h2>9. Contact Us</h2>
              <p>
                If you have any questions about this Privacy Policy, please
                contact us at{" "}
                <a href={`mailto:${siteConfig.contact.email}`}>
                  {siteConfig.contact.email}
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
