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
        tsconfig: {
          esModuleInterop: true,
        },
      },
    ],
  },
  transformIgnorePatterns: ["<rootDir>/node_modules/(?!node-fetch)"],
<<<<<<< HEAD
=======
  moduleNameMapper: {
    "node-fetch": "<rootDir>/src/tests/__mocks__/node-fetch.ts",
  },
>>>>>>> f661bbd (Gemini fixes)
  setupFilesAfterEnv: ["<rootDir>/src/tests/jest.setup.ts"],
  preset: "ts-jest",
  testEnvironment: "node",
};
