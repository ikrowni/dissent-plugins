// Guards for the co-ownership handshake, run against an in-memory `storage` with the
// host's swap semantics. The module is also checked end to end through
// dissent-core's plugin-module-check before it is signed.
import { describe, it, expect, beforeEach, vi } from "vitest";

// The real SDK is copied in from dissent-core at build time (build.sh), so it is not in
// the tree; stand in for its `storage` with the host's swap semantics.
const store = vi.hoisted(() => new Map());
vi.mock("./sdk/server-sdk.js", () => ({ storage: {
  get: (k) => (store.has(k) ? structuredClone(store.get(k)) : null),
  set: (k, v) => { store.set(k, structuredClone(v)); },
  swap: (k, fn, { fallback } = {}) => {
    const next = fn(store.has(k) ? structuredClone(store.get(k)) : fallback);
    store.set(k, structuredClone(next));
    return next;
  },
} }));

const { inviteCoOwner, acceptCoOwnerInvite, requestCoOwnership, removeCoOwner } = await import("./ops-coowners.js");
const { getLeague } = await import("./ops-league.js");

const LG = "lg1";
const as = (userId) => ({ userId, scheduled: false });
const teams = () => store.get(`fl:${LG}:teams`);

beforeEach(() => {
  store.clear();
  store.set(`fl:${LG}:meta`, { settings: {}, season: 2026, commissioners: ["commish"] });
  store.set(`fl:${LG}:teams`, {
    t1: { id: "t1", name: "Owls", ownerId: "alice", coOwners: [], coOwnerRequests: [], coOwnerLabels: {} },
    t2: { id: "t2", name: "Hawks", ownerId: "carol", coOwners: [], coOwnerRequests: [], coOwnerLabels: {} },
  });
});

const invite = (by, userId, extra = {}) => inviteCoOwner({ p: as(by), payload: { leagueId: LG, teamId: "t1", userId, label: userId, ...extra } });
const accept = (who, accept = true) => acceptCoOwnerInvite({ p: as(who), payload: { leagueId: LG, teamId: "t1", accept } });

describe("owner-initiated co-ownership", () => {
  it("invite then accept makes a co-owner, labelled, with the offer gone", () => {
    expect(invite("alice", "bob").outcome).toBe("invited");
    expect(teams().t1.coOwnerInvites[0]).toMatchObject({ userId: "bob", by: "alice" });
    expect(accept("bob").outcome).toBe("accepted");
    expect(teams().t1.coOwners).toEqual(["bob"]);
    expect(teams().t1.coOwnerInvites).toEqual([]);
    expect(teams().t1.coOwnerLabels.bob).toBe("bob");
  });

  it("a co-owner cannot invite an accomplice", () => {
    invite("alice", "bob"); accept("bob");
    expect(() => invite("bob", "mallory")).toThrow(/only the owner/);
  });

  it("nobody accepts on somebody else's behalf — the subject is the caller", () => {
    invite("alice", "bob");
    expect(() => accept("alice")).toThrow(/no invite/);
    expect(teams().t1.coOwners).toEqual([]);
  });

  it("an accept with no invite is refused", () => {
    expect(() => accept("bob")).toThrow(/no invite/);
  });

  it("someone who manages a team cannot be invited", () => {
    expect(() => invite("alice", "carol")).toThrow(/already manages team t2/);
  });

  it("eligibility is re-checked at accept: joining a team in between blocks it", () => {
    invite("alice", "bob");
    store.set(`fl:${LG}:teams`, { ...teams(), t3: { id: "t3", ownerId: "bob", coOwners: [] } });
    expect(() => accept("bob")).toThrow(/already manage team t3/);
  });

  it("a fourth co-owner is refused, at invite and at accept", () => {
    const full = { ...teams().t1, coOwners: ["x", "y", "z"] };
    store.set(`fl:${LG}:teams`, { ...teams(), t1: full });
    expect(() => invite("alice", "bob")).toThrow(/at most 3/);
    store.set(`fl:${LG}:teams`, { ...teams(), t1: { ...full, coOwnerInvites: [{ userId: "bob", label: "", at: 0, by: "alice" }] } });
    expect(() => accept("bob")).toThrow(/at most 3/);
  });

  it("a sixth pending invite is refused; a duplicate is not a second one", () => {
    for (const u of ["a", "b", "c", "d", "e"]) invite("alice", u);
    expect(invite("alice", "a").outcome).toBe("already-invited");
    expect(() => invite("alice", "f")).toThrow(/too many pending invites/);
  });

  it("the owner cannot invite themselves", () => {
    expect(() => invite("alice", "alice")).toThrow(/already own/);
  });

  it("decline and withdraw both remove the offer", () => {
    invite("alice", "bob");
    expect(accept("bob", false).outcome).toBe("declined");
    expect(teams().t1.coOwnerInvites).toEqual([]);
    invite("alice", "bob");
    expect(invite("alice", "bob", { withdraw: true }).outcome).toBe("withdrawn");
    expect(teams().t1.coOwnerInvites).toEqual([]);
  });

  it("accepting also clears the same person's standing request", () => {
    requestCoOwnership({ p: as("bob"), payload: { leagueId: LG, teamId: "t1", label: "bob" } });
    invite("alice", "bob");
    accept("bob");
    expect(teams().t1.coOwnerRequests).toEqual([]);
  });

  it("a co-owner who came by invite can still leave by themselves", () => {
    invite("alice", "bob"); accept("bob");
    expect(removeCoOwner({ p: as("bob"), payload: { leagueId: LG, teamId: "t1" } }).outcome).toBe("removed");
  });
});

describe("an invite is private", () => {
  const seen = (who) => getLeague({ p: as(who), payload: { leagueId: LG } }).teams.t1.coOwnerInvites;
  it("the owner, a commissioner and the invitee see it; an unrelated member does not", () => {
    invite("alice", "bob");
    expect(seen("alice")).toHaveLength(1);
    expect(seen("commish")).toHaveLength(1);
    expect(seen("bob")).toHaveLength(1);
    expect(seen("mallory")).toEqual([]);
  });
});
