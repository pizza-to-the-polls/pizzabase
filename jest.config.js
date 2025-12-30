module.exports = {
  clearMocks: true,
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
  moduleNameMapper: {
    "node-fetch": "<rootDir>/src/tests/__mocks__/node-fetch.ts",
  },
  setupFilesAfterEnv: ["<rootDir>/src/tests/jest.setup.ts"],
  preset: "ts-jest",
  testEnvironment: "node",
};
