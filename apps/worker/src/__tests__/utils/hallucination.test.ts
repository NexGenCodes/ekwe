import { describe, expect, test } from "vitest";
import { isHallucination } from "@/utils/hallucination";

describe("isHallucination", () => {
  test("empty text is hallucination", () => {
    expect(isHallucination("")).toBe(true);
    expect(isHallucination("   ")).toBe(true);
  });

  test('"thanks for watching" pattern', () => {
    expect(isHallucination("Thanks for watching")).toBe(true);
    expect(isHallucination("thank you for watching")).toBe(true);
  });

  test("subscribe pattern", () => {
    expect(isHallucination("Please subscribe")).toBe(true);
    expect(isHallucination("like and subscribe")).toBe(true);
  });

  test("bracket patterns", () => {
    expect(isHallucination("[Music]")).toBe(true);
    expect(isHallucination("[Applause]")).toBe(true);
  });

  test("single pronoun/article", () => {
    expect(isHallucination("you")).toBe(true);
    expect(isHallucination("the")).toBe(true);
    expect(isHallucination("i")).toBe(true);
  });

  test("repeated phrase", () => {
    expect(isHallucination("abcdeabcdeabcde")).toBe(true);
  });

  test("repeated longer block", () => {
    expect(
      isHallucination(
        "thankyouforwatchingthankyouforwatchingthankyouforwatching",
      ),
    ).toBe(true);
  });

  test("repeated block shorter than 5 chars is not flagged", () => {
    expect(isHallucination("abcdabcdabcd")).toBe(false);
  });

  test("large near-miss transcript is not flagged (no quadratic blowup)", () => {
    const nearMiss = Array.from({ length: 6000 }, (_, i) => `word${i}`).join(
      " ",
    );
    expect(isHallucination(nearMiss)).toBe(false);
  });

  test("WPS too high", () => {
    const words = Array.from({ length: 35 }, (_, i) => `word${i}`).join(" ");
    expect(isHallucination(words, 5000)).toBe(true);
  });

  test("WPS too low for >3 words", () => {
    expect(isHallucination("hello how are you", 30000)).toBe(true);
  });

  test("normal speech passes", () => {
    expect(
      isHallucination("hello how are you today i am doing great", 5000),
    ).toBe(false);
  });

  test("normal text without duration passes", () => {
    expect(isHallucination("This is a perfectly normal sentence.")).toBe(false);
  });

  test("short text without duration passes", () => {
    expect(isHallucination("hello")).toBe(false);
  });
});
