// Dev fallback secrets are public in the repo, so they may only be used in development and test.
export {};

const SECRET_VARS = ['HMAC_SECRET', 'API_KEY_SECRET', 'CREDENTIAL_ENCRYPTION_KEY'];
const saved = { ...process.env };

function load(nodeEnv: string | undefined) {
    jest.resetModules();
    process.env = { ...saved };
    for (const v of SECRET_VARS) delete process.env[v];
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    return {
        secrets: require('../secrets') as typeof import('../secrets'),
        vault: require('../credentialVault') as typeof import('../credentialVault'),
    };
}

afterAll(() => { process.env = saved; });

describe.each([[undefined], ['staging'], ['production']])('NODE_ENV=%s with no secrets set', (nodeEnv) => {
    it('refuses every dev fallback', () => {
        const { secrets, vault } = load(nodeEnv);
        expect(() => secrets.getHmacSecret()).toThrow(/HMAC_SECRET/);
        expect(() => secrets.getApiKeySecret()).toThrow(/API_KEY_SECRET/);
        expect(() => secrets.getEncryptionKey()).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
        expect(() => vault.encryptCredential('x')).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
    });
});

describe.each([['development'], ['test']])('NODE_ENV=%s with no secrets set', (nodeEnv) => {
    it('uses working dev fallbacks', () => {
        const { secrets, vault } = load(nodeEnv);
        expect(secrets.getHmacSecret()).toBeTruthy();
        expect(secrets.getApiKeySecret()).toBeTruthy();
        expect(secrets.getEncryptionKey()).toHaveLength(32);
        expect(vault.decryptCredential(vault.encryptCredential('hello'))).toBe('hello');
    });
});

describe('configured secrets', () => {
    it('are used in any environment', () => {
        const { secrets, vault } = load('staging');
        process.env.HMAC_SECRET = 'h'.repeat(40);
        process.env.API_KEY_SECRET = 'k'.repeat(40);
        process.env.CREDENTIAL_ENCRYPTION_KEY = 'ab'.repeat(32);
        expect(secrets.getHmacSecret()).toBe('h'.repeat(40));
        expect(secrets.getApiKeySecret()).toBe('k'.repeat(40));
        expect(vault.decryptCredential(vault.encryptCredential('hello'))).toBe('hello');
    });

    it('still reject a known placeholder HMAC secret outside development', () => {
        const { secrets } = load('staging');
        process.env.HMAC_SECRET = secrets.DEV_HMAC_SECRET;
        expect(() => secrets.getHmacSecret()).toThrow(/HMAC_SECRET/);
    });
});
