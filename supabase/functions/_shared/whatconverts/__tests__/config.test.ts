import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWhatConvertsConfig, WhatConvertsConfigError } from "../config.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("throws, naming BOTH missing vars, when token and secret are absent", () => {
  withEnv({ WHATCONVERTS_API_TOKEN: undefined, WHATCONVERTS_API_SECRET: undefined }, () => {
    assert.throws(
      () => loadWhatConvertsConfig(),
      (e: unknown) => {
        assert.ok(e instanceof WhatConvertsConfigError);
        assert.match((e as Error).message, /WHATCONVERTS_API_TOKEN/);
        assert.match((e as Error).message, /WHATCONVERTS_API_SECRET/);
        return true;
      },
    );
  });
});

test("defaults apiUrl and timeout when only credentials are set", () => {
  withEnv(
    { WHATCONVERTS_API_TOKEN: "t", WHATCONVERTS_API_SECRET: "s", WHATCONVERTS_API_URL: undefined, WHATCONVERTS_TIMEOUT_MS: undefined },
    () => {
      const c = loadWhatConvertsConfig();
      assert.equal(c.apiUrl, "https://app.whatconverts.com/api/v1");
      assert.equal(c.timeoutMs, 15000);
      assert.equal(c.apiToken, "t");
      assert.equal(c.apiSecret, "s");
    },
  );
});

test("honors a custom apiUrl (trailing slash stripped) and timeout", () => {
  withEnv(
    {
      WHATCONVERTS_API_TOKEN: "t",
      WHATCONVERTS_API_SECRET: "s",
      WHATCONVERTS_API_URL: "https://app.whatconverts.com/api/v1/",
      WHATCONVERTS_TIMEOUT_MS: "3000",
    },
    () => {
      const c = loadWhatConvertsConfig();
      assert.equal(c.apiUrl, "https://app.whatconverts.com/api/v1", "trailing slash should be stripped");
      assert.equal(c.timeoutMs, 3000);
    },
  );
});

test("ignores a non-positive / non-numeric timeout and uses the default", () => {
  withEnv(
    { WHATCONVERTS_API_TOKEN: "t", WHATCONVERTS_API_SECRET: "s", WHATCONVERTS_TIMEOUT_MS: "not-a-number" },
    () => {
      assert.equal(loadWhatConvertsConfig().timeoutMs, 15000);
    },
  );
});
