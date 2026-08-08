module.exports = {
  clearMocks: true,
  // CRITICAL: single worker so all test files share the same Node process.
  // The DB connection is a module singleton → stays alive across all tests.
  // This mirrors Lambda's "never close" behavior.
  maxWorkers: 1,
  roots: ["<rootDir>/src", "<rootDir>/src/tests"],
  testMatch: [
    "**/__tests__/**/*.+(ts|tsx|js)",
    "**/?(*.)+(spec|test).+(ts|tsx|js)",
    "**/?(*.)+(spec|test).+(ts|tsx|js)",
    "**/**/?(*.)+(spec|test).+(ts|tsx|js)",
  ],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
    // Transform uuid ESM .js files through ts-jest to convert export → module.exports
    "^.+\\.js$": [
      "ts-jest",
      {
        tsconfig: {
          ...require("./tsconfig.json"),
          allowJs: true,
        },
      },
    ],
  },
  // Don't ignore uuid in node_modules — it's ESM-only and needs transformation
  transformIgnorePatterns: ["node_modules/(?!(uuid)/)"],
  setupFilesAfterEnv: ["<rootDir>/src/tests/jest.setup.ts"],
  preset: "ts-jest",
  testEnvironment: "node",
};
