process.env.NODE_ENV ??= "test";
process.env.AUTH_MODE ??= "mock";
process.env.DATABASE_URL ??= "file:./test.db";
process.env.ISSUER ??= "http://localhost:3000";
process.env.PUBLIC_BASE_URL ??= "http://localhost:3000";
process.env.JWT_PRIVATE_KEY_PATH ??= "./keys/test-private.pem";
process.env.JWT_PUBLIC_KEY_PATH ??= "./keys/test-public.pem";
