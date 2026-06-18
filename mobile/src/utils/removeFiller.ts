export const removeFillerWords = (
  text: string,
  fillerWords: string[],
): string => {
  let result = text;
  for (const filler of fillerWords) {
    const regex = new RegExp(`\\b${filler}\\b[,\\s]*`, "gi");
    result = result.replace(regex, " ");
  }
  return result.replace(/\s+/g, " ").trim();
};
