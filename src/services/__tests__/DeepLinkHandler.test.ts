import * as Linking from 'expo-linking';
import { DeepLinkHandler, DeepLinkPayload } from 'src/services/DeepLinkHandler';

jest.mock('expo-linking');

// Define typed mock helper for extra methods added in setup
interface LinkingMock {
  _resetListeners: () => void;
  _dispatchUrl: (url: string) => void;
  parse: jest.Mock;
}

const linkingMock = Linking as unknown as LinkingMock;

describe('DeepLinkHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    DeepLinkHandler._resetForTesting();
    linkingMock._resetListeners();
  });

  it('correctly parses an ekwe://share URI', async () => {
    const unsub = DeepLinkHandler.initialise();

    // Simulate incoming link
    const promise = new Promise<DeepLinkPayload>((resolve) => {
      DeepLinkHandler.subscribe((payload) => {
        resolve(payload);
      });
    });

    // Helper added in jest.setup.js
    linkingMock._dispatchUrl('ekwe://share?uri=content://test.mp3');

    const result = await promise;
    expect(result.type).toBe('share');
    expect(result.uri).toBe('content://test.mp3');

    unsub();
  });

  it('handles invalid URIs without crashing', () => {
    DeepLinkHandler.initialise();
    linkingMock.parse.mockReturnValueOnce({ hostname: 'other' });
    expect(() => {
      linkingMock._dispatchUrl('ekwe://other');
    }).not.toThrow();
  });

  it('consumes pending payload once', async () => {
    DeepLinkHandler.initialise();

    // Dispatch while no active subscribers
    linkingMock._dispatchUrl('ekwe://share?uri=test2.mp3');

    const pending1 = DeepLinkHandler.consumePendingPayload();
    expect(pending1).toEqual({
      type: 'share',
      uri: 'test2.mp3',
      sourceApp: null,
    });

    const pending2 = DeepLinkHandler.consumePendingPayload();
    expect(pending2).toBeNull();
  });

  it('unsubscribes cleanly', () => {
    DeepLinkHandler.initialise();
    const cb = jest.fn();
    const unsub = DeepLinkHandler.subscribe(cb);
    unsub();
    linkingMock._dispatchUrl('ekwe://share?uri=test.mp3');
    expect(cb).not.toHaveBeenCalled();
    const pending = DeepLinkHandler.consumePendingPayload();
    expect(pending).not.toBeNull();
  });
});
