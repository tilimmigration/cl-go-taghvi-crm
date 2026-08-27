import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, loadConfig } from "../config.ts";

const REQUIRED_VARS = ["MONDAY_API_TOKEN", "MONDAY_LEADS_BOARD_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("loads config successfully when all required vars are set", () => {
  withEnv(
    {
      MONDAY_API_TOKEN: "token-123",
      MONDAY_LEADS_BOARD_ID: "111222333",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.mondayApiToken, "token-123");
      assert.equal(config.leadsBoardId, "111222333");
      assert.equal(config.mondayApiUrl, "https://api.monday.com/v2");
      assert.equal(config.webhookSharedSecret, undefined);
    },
  );
});

test("throws ConfigError naming every missing required variable", () => {
  withEnv(
    {
      MONDAY_API_TOKEN: undefined,
      MONDAY_LEADS_BOARD_ID: undefined,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        (err: unknown) => {
          assert.ok(err instanceof ConfigError);
          assert.match((err as Error).message, /MONDAY_API_TOKEN/);
          assert.match((err as Error).message, /MONDAY_LEADS_BOARD_ID/);
          return true;
        },
      );
    },
  );
});

test("optional MONDAY_WEBHOOK_SECRET and MONDAY_COLUMN_ID_MAP are picked up when set", () => {
  withEnv(
    {
      MONDAY_API_TOKEN: "token-123",
      MONDAY_LEADS_BOARD_ID: "111222333",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      MONDAY_WEBHOOK_SECRET: "shh",
      MONDAY_COLUMN_ID_MAP: '{"email":"email_9"}',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.webhookSharedSecret, "shh");
      assert.equal(config.columnIdMapJson, '{"email":"email_9"}');
    },
  );
});

for (const varName of REQUIRED_VARS) {
  test(`throws ConfigError when only ${varName} is missing`, () => {
    withEnv(
      {
        MONDAY_API_TOKEN: "token-123",
        MONDAY_LEADS_BOARD_ID: "111222333",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        [varName]: undefined,
      },
      () => {
        assert.throws(() => loadConfig(), ConfigError);
      },
    );
  });
}
