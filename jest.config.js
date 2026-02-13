module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],
    modulePathIgnorePatterns: ['<rootDir>/.agent/'],
    testMatch: ['**/*.test.ts'],
    verbose: true,
    forceExit: true,
    clearMocks: true,
    resetMocks: false,
    restoreMocks: true,
};
