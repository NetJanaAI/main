/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.jest.test.ts'],
    clearMocks: true,
    // Source files that import './x.js' (ESM style) resolve to the .ts file under ts-jest.
    moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
    transformIgnorePatterns: [
        'node_modules/(?!(double-metaphone)/)'
    ],
};
