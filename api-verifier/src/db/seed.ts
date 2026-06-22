import { inArray } from "drizzle-orm";
import { db, pool } from "./client.js";
import {
  type NewVerificationRow,
  verifications,
  wasms,
} from "./schema.js";

/** A 64-hex demo wasm hash built by repeating a byte, e.g. "11".repeat(32). */
const hash = (byte: string) => byte.repeat(32);

export const DEMO_HASHES = {
  verified: hash("11"),
  outOfBand: hash("22"),
  twoVerifiers: hash("33"),
  unverified: hash("44"),
  pending: hash("55"),
  declined: hash("66"),
} as const;

interface SeedWasm {
  wasmHash: string;
  state: "settled" | "pending" | "declined";
  updatedAt: Date;
  verifications: Omit<NewVerificationRow, "wasmHash">[];
}

const SEED: SeedWasm[] = [
  // 200 OK — verified, single verifier with full SEP-58 metadata.
  {
    wasmHash: DEMO_HASHES.verified,
    state: "settled",
    updatedAt: new Date("2026-06-04T12:05:00Z"),
    verifications: [
      {
        verifierName: "Example Verification Service",
        verifierUrl: "https://verify.example.com",
        verifierLogoUrl: {
          light: "https://verify.example.com/logo.png",
          dark: "https://verify.example.com/logo-dark.png",
        },
        status: "verified",
        bldimg:
          "docker.io/stellar/stellar-cli@sha256:1f2e3d4c5b6a79887766554433221100ffeeddccbbaa99887766554433221100",
        bldopt: ["--manifest-path=contracts/foo/Cargo.toml", "--optimize"],
        sourceRepo: "https://github.com/user/my-contract",
        sourceRev: "abc1234567890abcdef1234567890abcdef12345",
        processedAt: new Date("2026-06-04T12:00:00Z"),
        resultsUrls: [
          "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
          "ar://AbCdEf0123456789AbCdEf0123456789AbCdEf0123456789ABC",
        ],
      },
    ],
  },
  // 200 OK — out-of-band verified.
  {
    wasmHash: DEMO_HASHES.outOfBand,
    state: "settled",
    updatedAt: new Date("2026-06-04T12:00:00Z"),
    verifications: [
      {
        verifierName: "Example Verification Service",
        status: "verified",
        outOfBand: true,
        processedAt: new Date("2026-06-04T12:00:00Z"),
      },
    ],
  },
  // 200 OK — two verifiers that disagree (verified + mismatched).
  {
    wasmHash: DEMO_HASHES.twoVerifiers,
    state: "settled",
    updatedAt: new Date("2026-06-04T13:00:00Z"),
    verifications: [
      {
        verifierName: "Verifier A",
        verifierUrl: "https://a.example.com",
        status: "verified",
        sourceRepo: "https://github.com/user/my-contract",
        sourceRev: "abc1234567890abcdef1234567890abcdef12345",
        processedAt: new Date("2026-06-04T12:00:00Z"),
      },
      {
        verifierName: "Verifier B",
        verifierUrl: "https://b.example.com",
        status: "mismatched",
        sourceRepo: "https://github.com/user/my-contract",
        sourceRev: "abc1234567890abcdef1234567890abcdef12345",
        rebuiltHash:
          "999888777666555444333222111000fedcba9876543210fedcba9876543210fe",
        processedAt: new Date("2026-06-04T13:00:00Z"),
      },
    ],
  },
  // 200 OK — settled unverified.
  {
    wasmHash: DEMO_HASHES.unverified,
    state: "settled",
    updatedAt: new Date("2026-06-04T12:00:00Z"),
    verifications: [
      { verifierName: "Example Verification Service", status: "unverified" },
    ],
  },
  // 202 Accepted — enqueued / in progress (same body as settled unverified).
  {
    wasmHash: DEMO_HASHES.pending,
    state: "pending",
    updatedAt: new Date("2026-06-04T12:00:00Z"),
    verifications: [
      { verifierName: "Example Verification Service", status: "unverified" },
    ],
  },
  // 404 Not Found — service declines to produce a result (no verifications).
  {
    wasmHash: DEMO_HASHES.declined,
    state: "declined",
    updatedAt: new Date("2026-06-04T12:00:00Z"),
    verifications: [],
  },
];

async function seed() {
  const allHashes = SEED.map((s) => s.wasmHash);

  await db.transaction(async (tx) => {
    // Idempotent: clear demo rows first (cascade removes their verifications).
    await tx.delete(wasms).where(inArray(wasms.wasmHash, allHashes));

    for (const entry of SEED) {
      await tx.insert(wasms).values({
        wasmHash: entry.wasmHash,
        state: entry.state,
        updatedAt: entry.updatedAt,
      });
      if (entry.verifications.length > 0) {
        await tx.insert(verifications).values(
          entry.verifications.map((v) => ({ ...v, wasmHash: entry.wasmHash })),
        );
      }
    }
  });

  console.log("Seeded demo wasm hashes:");
  for (const [scenario, h] of Object.entries(DEMO_HASHES)) {
    console.log(`  ${scenario.padEnd(13)} ${h}`);
  }
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
