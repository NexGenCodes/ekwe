module.exports = {
  "*.{ts,tsx}": ["eslint --max-warnings 0 --fix --no-warn-ignored", "prettier --write"],
  "*.{json,md}": ["prettier --write"],
};
