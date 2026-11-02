import { updateWafIpSet } from "./waf";

// `mockSend` is referenced from the hoisted jest.mock factory below. Jest only
// allows out-of-scope references whose name begins with "mock"; the closure is
// safe because it is only read when `send` runs during a test.
const mockSend = jest.fn();

jest.mock("@aws-sdk/client-wafv2", () => {
  return {
    WAFV2Client: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => mockSend(...args),
    })),
    // Echo the args plus a `kind` tag so tests (and mockSend implementations)
    // can tell which command was sent.
    GetIPSetCommand: jest
      .fn()
      .mockImplementation((args: Record<string, unknown>) => ({
        ...args,
        kind: "get",
      })),
    UpdateIPSetCommand: jest
      .fn()
      .mockImplementation((args: Record<string, unknown>) => ({
        ...args,
        kind: "update",
      })),
  };
});

jest.mock("./notifyBugsnag", () => ({
  notifyBugsnag: jest.fn(),
}));

import { notifyBugsnag } from "./notifyBugsnag";
import { GetIPSetCommand, UpdateIPSetCommand } from "@aws-sdk/client-wafv2";

const MockNotifyBugsnag = notifyBugsnag as unknown as jest.Mock;
const MockGetIPSetCommand = GetIPSetCommand as unknown as jest.Mock;
const MockUpdateIPSetCommand = UpdateIPSetCommand as unknown as jest.Mock;

// The live prod IP set ARN (shape matches what parseIpSetArn must handle).
const IPSET_ARN =
  "arn:aws:wafv2:us-west-2:320802729995" +
  ":regional/ipset/ptp-blocked-ips/da0493ec-7c55-4082-8d4d-f080f41a468b";

const ipSetState = (addresses: string[], lockToken = "lock-1") => ({
  // Real GetIPSet response shape: LockToken sits on the response itself,
  // not inside IPSet.
  IPSet: { Addresses: addresses },
  LockToken: lockToken,
});

/** mockSend implementation driven by which command object it receives. */
const withIpSet = (addresses: string[], lockToken = "lock-1") => {
  mockSend.mockImplementation(async (command: { kind?: string }) => {
    if (command.kind === "get") return ipSetState(addresses, lockToken);
    return {};
  });
};

const sentGets = () =>
  mockSend.mock.calls.filter(
    ([cmd]) => (cmd as { kind?: string }).kind === "get",
  );
const sentUpdates = () =>
  mockSend.mock.calls.filter(
    ([cmd]) => (cmd as { kind?: string }).kind === "update",
  );

describe("updateWafIpSet", () => {
  const originalArn = process.env.WAF_BLOCKED_IPSET_ARN;

  beforeEach(() => {
    mockSend.mockReset().mockResolvedValue({});
    MockNotifyBugsnag.mockReset();
    MockGetIPSetCommand.mockClear();
    MockUpdateIPSetCommand.mockClear();
  });

  afterAll(() => {
    if (originalArn === undefined) {
      delete process.env.WAF_BLOCKED_IPSET_ARN;
    } else {
      process.env.WAF_BLOCKED_IPSET_ARN = originalArn;
    }
  });

  describe("when WAF_BLOCKED_IPSET_ARN is unset", () => {
    beforeEach(() => {
      delete process.env.WAF_BLOCKED_IPSET_ARN;
    });

    it("skips the WAF path entirely for ADD", async () => {
      await expect(updateWafIpSet("192.0.2.1", "ADD")).resolves.toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("skips the WAF path entirely for REMOVE", async () => {
      await expect(updateWafIpSet("192.0.2.1", "REMOVE")).resolves.toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("when WAF_BLOCKED_IPSET_ARN is set", () => {
    beforeEach(() => {
      process.env.WAF_BLOCKED_IPSET_ARN = IPSET_ARN;
      withIpSet(["12.6.172.226/32", "70.131.25.58/32"]);
    });

    it("adds a normalized raw IP as a /32 CIDR", async () => {
      await expect(updateWafIpSet("192.0.2.50", "ADD")).resolves.toBe(true);

      expect(sentGets()).toHaveLength(1);
      expect(MockGetIPSetCommand).toHaveBeenCalledWith({
        Name: "ptp-blocked-ips",
        Scope: "REGIONAL",
        Id: "da0493ec-7c55-4082-8d4d-f080f41a468b",
      });
      expect(sentUpdates()).toHaveLength(1);
      expect(MockUpdateIPSetCommand).toHaveBeenCalledWith({
        Name: "ptp-blocked-ips",
        Scope: "REGIONAL",
        Id: "da0493ec-7c55-4082-8d4d-f080f41a468b",
        LockToken: "lock-1",
        Addresses: ["12.6.172.226/32", "70.131.25.58/32", "192.0.2.50/32"],
      });
    });

    it("normalizes mapped-IPv6 forms to the same CIDR", async () => {
      await expect(updateWafIpSet("::ffff:192.0.2.51", "ADD")).resolves.toBe(
        true,
      );
      expect(MockUpdateIPSetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Addresses: expect.arrayContaining(["192.0.2.51/32"]),
        }),
      );
    });

    it("is a no-op when the IP is already in the set", async () => {
      await expect(updateWafIpSet("70.131.25.58", "ADD")).resolves.toBe(true);
      expect(sentGets()).toHaveLength(1);
      expect(sentUpdates()).toHaveLength(0);
    });

    it("removes an IP from the set", async () => {
      await expect(updateWafIpSet("12.6.172.226", "REMOVE")).resolves.toBe(
        true,
      );
      expect(MockUpdateIPSetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Addresses: ["70.131.25.58/32"],
        }),
      );
    });

    it("is a no-op when removing an IP that is not in the set", async () => {
      await expect(updateWafIpSet("192.0.2.99", "REMOVE")).resolves.toBe(true);
      expect(sentUpdates()).toHaveLength(0);
    });

    it("returns false and sends nothing for an unparseable IP", async () => {
      await expect(updateWafIpSet("not-an-ip", "ADD")).resolves.toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("retries with a fresh LockToken on lock conflicts", async () => {
      const lockError = new Error(
        "AWS WAFv2 Error Type: WAFOptimisticLockException",
      );
      lockError.name = "WAFOptimisticLockException";
      let getCalls = 0;
      let updateAttempts = 0;
      mockSend.mockImplementation(async (command: { kind?: string }) => {
        if (command.kind === "get") {
          getCalls += 1;
          return getCalls === 1
            ? ipSetState(["70.131.25.58/32"], "stale-lock")
            : ipSetState(["70.131.25.58/32"], "fresh-lock");
        }
        // The first update (against the stale token) loses the race; the
        // retry with the refreshed token succeeds.
        updateAttempts += 1;
        if (updateAttempts === 1) throw lockError;
        return {};
      });

      await expect(updateWafIpSet("192.0.2.60", "ADD")).resolves.toBe(true);
      expect(sentGets().length).toBeGreaterThanOrEqual(2);
      const updateCalls = sentUpdates();
      expect(updateCalls.length).toBe(2);
      // Second attempt used the refreshed token.
      expect(updateCalls[1][0]).toMatchObject({ LockToken: "fresh-lock" });
    });

    it("does not fail the caller when the WAF API errors", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockSend.mockRejectedValue(new Error("Network error"));

      await expect(updateWafIpSet("192.0.2.70", "ADD")).resolves.toBe(false);

      expect(MockNotifyBugsnag).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledTimes(1);
      consoleErrorSpy.mockRestore();
    });

    it("logs errors without ever writing the raw IP to the console", async () => {
      const logged: unknown[] = [];
      const spy = jest
        .spyOn(console, "error")
        .mockImplementation((message?: unknown, ...rest: unknown[]) => {
          logged.push(message, ...rest);
        });
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const consoleLogSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});
      mockSend.mockRejectedValue(new Error("AccessDenied"));

      try {
        await updateWafIpSet("203.0.113.77", "ADD");
      } finally {
        spy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }

      const serialized = JSON.stringify(logged);
      expect(serialized).not.toContain("203.0.113.77");
      expect(serialized).toContain("AccessDenied");
    });

    it("notifies Bugsnag when the ARN is unparseable", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      process.env.WAF_BLOCKED_IPSET_ARN = "not-a-waf-arn";

      try {
        await expect(updateWafIpSet("192.0.2.80", "ADD")).resolves.toBe(false);
      } finally {
        consoleErrorSpy.mockRestore();
      }

      expect(mockSend).not.toHaveBeenCalled();
      expect(MockNotifyBugsnag).toHaveBeenCalledTimes(1);
    });
  });
});
