








import fs from "node:fs";
import path from "node:path";

const version = process.argv[2];
const notesFile = process.argv[3];

if (!version || !notesFile) {
  console.error("usage: append-changelog.mjs <version> <notes-file>");
  process.exit(1);
}

const changelogPath = path.resolve("CHANGELOG.md");
const body = fs.readFileSync(path.resolve(notesFile), "utf8").trim();

if (!body) {
  console.log("No release notes provided; skipping CHANGELOG.md update.");
  process.exit(0);
}

const date = new Date().toISOString().split("T")[0];
const entry = `## [${version}] - ${date}\n\n${body}\n`;
const markdown = fs.readFileSync(changelogPath, "utf8");

const releasedHeading = markdown.match(/^(##\s+\[(?![Uu]nreleased\])[^\n]*)/m);
if (releasedHeading) {
  const at = releasedHeading.index;
  fs.writeFileSync(changelogPath, markdown.slice(0, at) + entry + "\n" + markdown.slice(at));
} else {
  fs.writeFileSync(changelogPath, `${markdown.replace(/\s*$/, "")}\n\n${entry}\n`);
}
console.log(`Appended release entry for ${version} to CHANGELOG.md`);