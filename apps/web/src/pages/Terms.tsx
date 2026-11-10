import { siteConfig } from "../data/siteConfig";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";

export default function Terms() {
  const a = siteConfig.app.name;
  const c = siteConfig.legal.companyName;
  const e = siteConfig.contact.email;
  return (
    <>
      <Nav
        links={[
          { to: "/", label: "Home" },
          { to: "/privacy", label: "Privacy" },
          { to: "/changelog", label: "Changelog" },
        ]}
      />
      <main className="legal">
        <div className="container">
          <h1>Terms of Service</h1>
          <p className="legal-date">
            Last updated: {siteConfig.legal.lastUpdated}
          </p>
          <div className="legal-wrap">
            <div className="legal-content">
              <h2>1. Acceptance of Terms</h2>
              <p>
                By downloading, installing, or using {a} (the "App"), you agree
                to be bound by these Terms of Service ("Terms"). If you do not
                agree to these Terms, do not use the App.
              </p>
              <h2>2. Description of Service</h2>
              <p>
                {a} provides AI-powered voice translation services. The App
                allows you to record or import voice notes and receive
                translations in multiple languages. The App may offer both
                online and offline translation capabilities.
              </p>
              <h2>3. User Responsibilities</h2>
              <ul>
                <li>
                  You are responsible for the audio content you record or import
                  into the App.
                </li>
                <li>
                  You agree not to use the App for any unlawful or unauthorized
                  purpose.
                </li>
                <li>
                  You agree not to attempt to reverse engineer, decompile, or
                  disassemble the App.
                </li>
                <li>
                  You are responsible for maintaining the security of your
                  device.
                </li>
              </ul>
              <h2>4. Intellectual Property</h2>
              <p>
                The App and its original content, features, and functionality
                are owned by {c} and are protected by international copyright,
                trademark, patent, trade secret, and other intellectual property
                laws.
              </p>
              <h2>5. Translation Accuracy</h2>
              <p>
                While we strive to provide accurate translations, the App uses
                AI-powered translation which may not always be 100% accurate.
                Translations should be used as a reference only and should not
                be relied upon for critical communications, legal, medical, or
                financial decisions.
              </p>
              <h2>6. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by applicable law, {c} shall not
                be liable for any indirect, incidental, special, consequential,
                or punitive damages, or any loss of profits or revenues, whether
                incurred directly or indirectly, or any loss of data, use,
                goodwill, or other intangible losses resulting from your use of
                the App.
              </p>
              <h2>7. Disclaimer of Warranties</h2>
              <p>
                The App is provided "as is" and "as available" without
                warranties of any kind, whether express or implied, including
                but not limited to implied warranties of merchantability,
                fitness for a particular purpose, and non-infringement.
              </p>
              <h2>8. Modifications</h2>
              <p>
                We reserve the right to modify or discontinue the App at any
                time without notice. We may also revise these Terms from time to
                time. Continued use of the App after any such changes
                constitutes your consent to the updated Terms.
              </p>
              <h2>9. Subscriptions &amp; Billing</h2>
              <p>
                {a} offers optional Premium subscriptions ("Premium") that
                unlock additional features and higher usage limits. By
                subscribing, you agree to the following:
              </p>
              <ul>
                <li>
                  <strong>Billing:</strong> Subscription fees are charged at the
                  time of purchase through our payment provider, Flutterwave.
                  Prices are displayed in your local currency where available.
                </li>
                <li>
                  <strong>Auto-Renewal:</strong> Subscriptions automatically
                  renew at the end of each billing period (monthly or annual)
                  unless cancelled before the renewal date.
                </li>
                <li>
                  <strong>Cancellation:</strong> You may cancel your
                  subscription at any time by contacting support at{" "}
                  <a href={`mailto:${e}`}>{e}</a>. Cancellation takes effect at
                  the end of the current billing period; you retain Premium
                  access until then.
                </li>
                <li>
                  <strong>Refunds:</strong> Payments are generally
                  non-refundable. If you believe you were charged in error,
                  contact us within 14 days of the charge and we will review
                  your case.
                </li>
                <li>
                  <strong>Price Changes:</strong> We may change subscription
                  pricing at any time. Existing subscribers will be notified at
                  least 30 days before any price increase takes effect on their
                  next renewal.
                </li>
                <li>
                  <strong>Free Tier:</strong> The App remains usable without a
                  subscription, subject to the free-tier limits described in the
                  App.
                </li>
              </ul>
              <h2>10. Termination</h2>
              <p>
                We may terminate or suspend your access to the App at any time,
                without prior notice or liability, for any reason, including
                breach of these Terms.
              </p>
              <h2>11. Governing Law</h2>
              <p>
                These Terms shall be governed by and construed in accordance
                with applicable laws, without regard to conflict of law
                principles.
              </p>
              <h2>12. Contact Us</h2>
              <p>
                If you have any questions about these Terms, please contact us
                at <a href={`mailto:${e}`}>{e}</a>.
              </p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
