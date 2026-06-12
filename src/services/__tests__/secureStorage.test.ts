import { secureStorage } from "../secureStorage";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const SecureStore = require("expo-secure-store");

describe("secureStorage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getItem", () => {
    it("returns the stored value", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("my-token");

      const result = await secureStorage.getItem("auth_token");
      expect(result).toBe("my-token");
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith("auth_token");
    });

    it("returns null when no value exists", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

      const result = await secureStorage.getItem("missing_key");
      expect(result).toBeNull();
    });

    it("returns null on error", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(
        new Error("native error"),
      );

      const result = await secureStorage.getItem("auth_token");
      expect(result).toBeNull();
    });
  });

  describe("setItem", () => {
    it("stores a value", async () => {
      (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);

      await secureStorage.setItem("auth_token", "new-token");
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        "auth_token",
        "new-token",
      );
    });
  });

  describe("removeItem", () => {
    it("deletes a value", async () => {
      (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);

      await secureStorage.removeItem("auth_token");
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("auth_token");
    });
  });
});
