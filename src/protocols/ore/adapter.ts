import { getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from "@solana/kit";

import { VerificationError } from "../../core/errors";
import { ProgramInterface, type DecodedStruct } from "../../core/program-interface";

import type { AccountReader, ManifestAction } from "../../core/accounts";
export type { AccountReader, ChainAccount, ManifestAction } from "../../core/accounts";

export type OreManifest = {
  protocol: "ore";
  displayName: string;
  verified: true;
  actions: ManifestAction[];
};

export type OreMetadata = {
  protocol: "ore";
  programId: string;
  verified: true;
  sourceRepository: string;
  sourceCommit: string;
  verificationDate: string;
  interfaceStatus: "locally-reconstructed";
};

export type MinerPosition = {
  address: Address;
  authority: Address;
  rewardsSol: bigint;
  rewardsOre: bigint;
  refinedOre: bigint;
  rewardsFactor: bigint;
  lastClaimOreAt: bigint;
  decoded: DecodedStruct;
};

export type OreStatus = {
  wallet: Address;
  minerAddress: Address;
  miner: MinerPosition | null;
};

export class OreAdapter {
  readonly programAddress: Address;
  readonly manifest: OreManifest;
  readonly metadata: OreMetadata;
  readonly programInterface: ProgramInterface;
  readonly claimSolAction: ManifestAction;
  readonly claimOreAction: ManifestAction;

  constructor(manifest: OreManifest, metadata: OreMetadata, programInterface: ProgramInterface) {
    this.manifest = manifest;
    this.metadata = metadata;
    this.programInterface = programInterface;
    this.programAddress = programInterface.programAddress;

    if (!manifest.verified || !metadata.verified || metadata.interfaceStatus !== "locally-reconstructed") {
      throw new VerificationError("ORE protocol bundle is not marked as locally verified");
    }
    if (manifest.protocol !== "ore" || metadata.protocol !== manifest.protocol) {
      throw new VerificationError("ORE protocol bundle identifiers do not agree");
    }
    if (metadata.programId !== this.programAddress) {
      throw new VerificationError("ORE metadata program ID does not match the bundled interface");
    }

    const action = manifest.actions.find(candidate => candidate.id === "claim-sol");
    if (!action || !this.programInterface.hasInstruction(action.instruction)) {
      throw new VerificationError("ORE manifest claim-sol action is not backed by the bundled interface");
    }
    this.claimSolAction = action;
    const oreAction = manifest.actions.find(candidate => candidate.id === "claim-ore");
    if (!oreAction || !this.programInterface.hasInstruction(oreAction.instruction)) {
      throw new VerificationError("ORE manifest claim-ore action is not backed by the bundled interface");
    }
    this.claimOreAction = oreAction;
  }

  async getMinerAddress(wallet: Address): Promise<Address> {
    return await this.programInterface.deriveInstructionAccount("claimSol", "miner", { signer: wallet });
  }

  async getBoardAddress(): Promise<Address> {
    return await this.programInterface.deriveInstructionAccount("claimSol", "board", {});
  }

  async getStatus(reader: AccountReader, wallet: Address): Promise<OreStatus> {
    await this.verifyProgram(reader);
    const minerAddress = await this.getMinerAddress(wallet);
    const minerAccount = await reader.getAccount(minerAddress);
    if (minerAccount === null) {
      return { wallet, minerAddress, miner: null };
    }
    if (minerAccount.owner !== this.programAddress) {
      throw new VerificationError("ORE Miner account is not owned by the verified ORE program");
    }

    const decoded = this.programInterface.decodeAccount("Miner", minerAccount.data);
    const authority = decoded.authority;
    const rewardsSol = decoded.rewardsSol;
    if (typeof authority !== "string" || authority !== wallet) {
      throw new VerificationError("ORE Miner account authority does not match the configured wallet");
    }
    if (typeof rewardsSol !== "bigint") {
      throw new VerificationError("ORE Miner rewardsSol field did not decode as a u64");
    }

    return {
      wallet,
      minerAddress,
      miner: {
        address: minerAddress, authority, rewardsSol, decoded,
        rewardsOre: requireBigInt(decoded, "rewardsOre"),
        refinedOre: requireBigInt(decoded, "refinedOre"),
        rewardsFactor: numericBits(decoded.rewardsFactor),
        lastClaimOreAt: requireBigInt(decoded, "lastClaimOreAt"),
      },
    };
  }

  async buildClaimSolInstruction(wallet: Address): Promise<Instruction> {
    return await this.programInterface.buildInstruction(this.claimSolAction.instruction, {}, { signer: wallet });
  }

  async getTreasuryAddress(): Promise<Address> {
    return await this.programInterface.deriveInstructionAccount("claimOre", "treasury", {});
  }

  async getOreTokenAddress(owner: Address): Promise<Address> {
    const resolve = (name: string) => this.programInterface.deriveInstructionAccount("claimOre", name, {});
    const [mint, tokenProgram, associatedTokenProgram] = await Promise.all([
      resolve("mint"), resolve("tokenProgram"), resolve("associatedTokenProgram"),
    ]);
    const encoder = getAddressEncoder();
    const [ata] = await getProgramDerivedAddress({
      programAddress: associatedTokenProgram,
      seeds: [encoder.encode(owner), encoder.encode(tokenProgram), encoder.encode(mint)],
    });
    return ata;
  }

  async buildClaimOreInstruction(wallet: Address): Promise<Instruction> {
    const treasury = await this.getTreasuryAddress();
    const [recipient, treasuryTokens] = await Promise.all([
      this.getOreTokenAddress(wallet), this.getOreTokenAddress(treasury),
    ]);
    // ClaimORE takes a little-endian u64 byte array. Always claim 100% (10000 bps).
    const bps = new Uint8Array(8);
    new DataView(bps.buffer).setBigUint64(0, 10_000n, true);
    return await this.programInterface.buildInstruction(this.claimOreAction.instruction,
      { bps: Array.from(bps) }, { signer: wallet, recipient, treasuryTokens });
  }

  async getOreClaimEstimate(reader: AccountReader, miner: MinerPosition): Promise<OreClaimEstimate> {
    const account = await reader.getAccount(await this.getTreasuryAddress());
    if (!account || account.owner !== this.programAddress || account.executable) {
      throw new VerificationError("ORE Treasury account is missing or has invalid ownership/type");
    }
    const treasury = this.programInterface.decodeAccount("Treasury", account.data);
    return estimateOreClaim(miner, {
      rewardsFactor: numericBits(treasury.minerRewardsFactor),
      totalUnclaimed: requireBigInt(treasury, "totalUnclaimed"),
      totalRefined: requireBigInt(treasury, "totalRefined"),
    });
  }

  private async verifyProgram(reader: AccountReader): Promise<void> {
    const program = await reader.getAccount(this.programAddress);
    if (program === null) {
      throw new VerificationError("Verified ORE program account was not found on the configured RPC cluster");
    }
    if (!program.executable) {
      throw new VerificationError("Verified ORE program account is not executable");
    }
  }
}

export type OreClaimEstimate = { refined: bigint; unrefined: bigint; fee: bigint; amount: bigint };

function requireBigInt(value: DecodedStruct, field: string): bigint {
  const result = value[field];
  if (typeof result !== "bigint") throw new VerificationError(`ORE ${field} did not decode as an integer`);
  return result;
}

function numericBits(value: DecodedStruct[string] | undefined): bigint {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.bits)
    || value.bits.length !== 16 || value.bits.some(byte => typeof byte !== "number")) {
    throw new VerificationError("ORE Numeric did not decode as 16 bytes");
  }
  let bits = 0n;
  for (let i = 15; i >= 0; i -= 1) bits = (bits << 8n) | BigInt(value.bits[i] as number);
  return BigInt.asIntN(128, bits);
}

// Mirrors Miner::update_rewards / claim_ore at the pinned ORE commit, for 10000 bps.
export function estimateOreClaim(
  miner: Pick<MinerPosition, "rewardsOre" | "refinedOre" | "rewardsFactor">,
  treasury: { rewardsFactor: bigint; totalUnclaimed: bigint; totalRefined: bigint },
): OreClaimEstimate {
  const delta = treasury.rewardsFactor > miner.rewardsFactor ? treasury.rewardsFactor - miner.rewardsFactor : 0n;
  const refined = miner.refinedOre + ((delta * miner.rewardsOre) >> 48n);
  const unrefined = miner.rewardsOre;
  if (treasury.totalUnclaimed < unrefined || treasury.totalRefined < refined
    || refined + unrefined > (1n << 64n) - 1n) {
    throw new VerificationError("ORE reward state is inconsistent; refresh and retry");
  }
  const fee = unrefined > 0n && treasury.totalUnclaimed > unrefined
    ? (unrefined / 10n > 0n ? unrefined / 10n : 1n) : 0n;
  return { refined, unrefined, fee, amount: refined + unrefined - fee };
}
