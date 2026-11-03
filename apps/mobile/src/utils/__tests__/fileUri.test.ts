import { toFileUri } from "@/utils/fileUri";

describe("toFileUri", () => {
  it("prefixes bare absolute paths with the file scheme", () => {
    expect(toFileUri("/data/user/0/com.ekwe.app/cache/clip.m4a")).toBe(
      "file:///data/user/0/com.ekwe.app/cache/clip.m4a",
    );
  });

  it("leaves existing URIs untouched", () => {
    expect(toFileUri("file:///data/user/0/app/cache/clip.m4a")).toBe(
      "file:///data/user/0/app/cache/clip.m4a",
    );
    expect(toFileUri("content://media/external/audio/1")).toBe(
      "content://media/external/audio/1",
    );
    expect(toFileUri("https://cdn.example.com/clip.m4a")).toBe(
      "https://cdn.example.com/clip.m4a",
    );
  });

  it("returns undefined for missing values", () => {
    expect(toFileUri(undefined)).toBeUndefined();
    expect(toFileUri(null)).toBeUndefined();
    expect(toFileUri("")).toBeUndefined();
  });
});
