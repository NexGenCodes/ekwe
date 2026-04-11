import { ClerkProvider as ClerkProviderComponent } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import React from 'react';

const tokenCache = {
  async getToken(key: string) {
    try {
      const item = await SecureStore.getItemAsync(key);
      if (item) {
        console.log(`${key} was used 🔐 \n`);
      } else {
        console.log('No values stored under key: ' + key);
      }
      return item;
    } catch (error) {
      console.error('SecureStore get item error: ', error);
      await SecureStore.deleteItemAsync(key);
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      return SecureStore.setItemAsync(key, value);
    } catch (err) {}
  },
};

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

if (!publishableKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env. development.',
  );
}

export const ClerkProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <ClerkProviderComponent
      tokenCache={tokenCache}
      publishableKey={publishableKey}
    >
      {children}
    </ClerkProviderComponent>
  );
};
