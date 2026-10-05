import oreIdl from "./ore/ore.idl.json" with { type: "json" };
import oreManifestJson from "./ore/manifest.json" with { type: "json" };
import oreMetadataJson from "./ore/metadata.json" with { type: "json" };

import { VerificationError } from "../core/errors";
import { ProgramInterface } from "../core/program-interface";
import type { ManifestAction } from "../core/accounts";
import {
  OreAdapter,
  type OreManifest,
  type OreMetadata,
} from "./ore/adapter";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadOreManifest(value: unknown): OreManifest {
  if (
    !isRecord(value) ||
    value.protocol !== "ore" ||
    typeof value.displayName !== "string" ||
    value.displayName.length === 0 ||
    value.verified !== true ||
    !Array.isArray(value.actions)
  ) {
    throw new VerificationError("Bundled ORE semantic manifest is invalid");
  }
  const actions: ManifestAction[] = value.actions.map(rawAction => {
    if (
      !isRecord(rawAction) ||
      typeof rawAction.id !== "string" ||
      typeof rawAction.label !== "string" ||
      typeof rawAction.description !== "string" ||
      typeof rawAction.instruction !== "string"
    ) {
      throw new VerificationError("Bundled ORE semantic manifest contains an invalid action");
    }
    return {
      id: rawAction.id,
      label: rawAction.label,
      description: rawAction.description,
      instruction: rawAction.instruction,
    };
  });
  if (new Set(actions.map(action => action.id)).size !== actions.length) {
    throw new VerificationError("Bundled ORE semantic manifest contains duplicate action IDs");
  }
  return { protocol: "ore", displayName: value.displayName, verified: true, actions };
}

function loadOreMetadata(value: unknown): OreMetadata {
  if (
    !isRecord(value) ||
    value.protocol !== "ore" ||
    value.verified !== true ||
    value.interfaceStatus !== "locally-reconstructed" ||
    typeof value.programId !== "string" ||
    typeof value.sourceRepository !== "string" ||
    typeof value.sourceCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(value.sourceCommit) ||
    typeof value.verificationDate !== "string"
  ) {
    throw new VerificationError("Bundled ORE metadata is invalid");
  }
  return {
    protocol: "ore",
    programId: value.programId,
    verified: true,
    sourceRepository: value.sourceRepository,
    sourceCommit: value.sourceCommit,
    verificationDate: value.verificationDate,
    interfaceStatus: "locally-reconstructed",
  };
}

export function createOreAdapter(): OreAdapter {
  return new OreAdapter(
    loadOreManifest(oreManifestJson),
    loadOreMetadata(oreMetadataJson),
    new ProgramInterface(oreIdl),
  );
}