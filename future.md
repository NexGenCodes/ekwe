# Future Setup Guide: Apple Sign-In

To get Apple Authentication fully operational on your local builds and production, you require an active, paid **Apple Developer Account**. 

Once you have your developer account ready, follow these specific steps to configure your Supabase backend to accept Apple Sign-In requests.

## Part A: Get your Apple Keys (Apple Developer Portal)

1. Go to your [Apple Developer Account](https://developer.apple.com/account/).
2. Navigate to **Certificates, Identifiers & Profiles > Identifiers**.
3. **Register an App ID**: 
   - Create an App ID with your exact bundle ID: `com.anonymous.ekwe`. 
   - Under Capabilities, check the box for **"Sign In with Apple"**.
4. **Register a Services ID**: 
   - Click the '+' to create a new identifier and choose **Services IDs**.
   - Create one (e.g. `com.anonymous.ekwe.services`).
   - Click on the newly created Services ID to configure it.
   - Check the box to enable "Sign In with Apple" and click the **Configure** button.
   - Link it to your primary App ID (`com.anonymous.ekwe`).
   - Under *Return URLs*, add your Supabase Auth callback URL: `https://<YOUR_SUPABASE_PROJECT_ID>.supabase.co/auth/v1/callback`
   - Save and Continue.
5. **Create a Private Key**: 
   - Go to the **Keys** side tab and click **+**.
   - Name it "Ekwe Apple Auth Key".
   - Check the "Sign in with Apple" box, click configure, and link it to your App ID.
   - Click Continue and **Register**.
   - **Download the `.p8` file**. Keep this safe! You can only download it once.
   - Note down the **Key ID** shown on the screen.
6. **Find your Team ID**:
   - Note your 10-character **Team ID** (found in the top right corner of the developer portal under your name, or under the App ID details).

---

## Part B: Connect to Supabase

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Navigate to **Authentication > Providers > Apple**.
3. Turn the switch to **Enable**.
4. **Services ID (Client ID)**: Paste the Services ID you created in Step 4 (e.g. `com.anonymous.ekwe.services`).
5. **Secret Key**: Open the `.p8` file you downloaded in any raw text editor (like VS Code), and copy/paste its *entire* contents here (including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` wrapper lines).
6. **Team ID**: Paste the 10-character Team ID you noted down.
7. **Key ID**: Paste the Key ID from step 5.
8. Click **Save**.

---

## Part C: Final Clean-up

Once Supabase is configured, you don't need any environment variables for Apple Sign-in within React Native because the `expo-apple-authentication` native module talks directly to iOS locally. 

However, you *must* rebuild your iOS application if you are migrating out of Expo Go to test the native Apple SDK boundaries:
```bash
npx expo run:ios
# or
eas build --profile development --platform ios
```

---

## Future Setup Guide: Naira Payments (Paystack / Flutterwave)

To properly service the Nigerian market and support localized payment methods such as Bank Transfers, USSD, OPay, and Verve without violating Apple and Google App Store regulations, Ekwe employs a **Web-Based Checkout Strategy** (The "Netflix/Spotify Method").

### Why this architecture?
Apple and Google's policies strictly prohibit using third-party payment gateways (like Paystack) inside a mobile app for *digital goods or subscriptions*. If added natively, the app will be rejected during review. By removing payment UI from the mobile app entirely and shifting it to the web, we remain fully compliant, save on the 15-30% App Store transaction fees, and serve massive audiences that lack standard Visa/Mastercards.

### Implementation Architecture

1. **Mobile Experience (Frictionless Compliance)**:
   - The Ekwe mobile app must contain **zero** "Pay Now" or "Upgrade" buttons. 
   - Non-premium users encountering a paywalled feature will see a generic prompt: *"To access unlimited features, please manage your subscription on our website (ekwe.app)."*
2. **Web App Checkout (Paystack Integration)**:
   - The user navigates to the web application, signs in using Supabase Auth (which shares state with the mobile app), and selects a premium subscription tier.
   - The web app processes the payment using Paystack or Flutterwave.
3. **Cloudflare Worker & Webhook Sync**:
   - Paystack sends a secure webhook to the `ekwe-proxy` Cloudflare Worker confirming the transaction success.
   - The Worker validates the webhook signature and updates the user's `role` or `subscription_status` on the Supabase `users` table to `premium`.
4. **Mobile Auto-Unlock**:
   - The mobile application listens to changes in the Supabase user profile.
   - As soon as the database detects the `premium` change, the paywall drops from the mobile UI, unlocking the application instantly.
