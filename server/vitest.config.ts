import { defineConfig } from "vitest/config";

// env.ts кидає помилку на імпорті без цих змінних; тести БД не торкаються.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SESSION_SECRET: "test-secret",
      TOKEN_ENC_KEY: "0".repeat(64),
    },
  },
});
