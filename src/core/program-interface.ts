import {
  AccountRole,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";

import { VerificationError } from "./errors";

type IdlPrimitive = "bool" | "u8" | "u16" | "u32" | "u64" | "u128" | "i64" | "pubkey";
type IdlType =
  | IdlPrimitive
  | { array: [IdlType, number] }
  | { defined: { name: string } };

type IdlField = { name: string; type: IdlType };

type IdlSeed =
  | { kind: "const"; value: number[] }
  | { kind: "account"; path: string };

type IdlInstructionAccount = {
  name: string;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  pda?: { seeds: IdlSeed[] };
};

type IdlInstruction = {
  name: string;
  discriminator: number[];
  accounts: IdlInstructionAccount[];
  args: IdlField[];
};

type IdlAccount = { name: string; discriminator: number[] };

type IdlTypeDefinition = {
  name: string;
  serialization?: string;
  repr?: { kind: string };
  type: { kind: "struct"; fields: IdlField[] };
};

export type SolanaIdl = {
  address: string;
  metadata: { name: string; version: string; spec: string };
  instructions: IdlInstruction[];
  accounts?: IdlAccount[];
  types?: IdlTypeDefinition[];
  pdas?: Record<string, { program?: string; seeds: IdlSeed[] }>;
};

type DecodedValue = boolean | number | bigint | Address | DecodedValue[] | DecodedStruct;
export type DecodedStruct = { [field: string]: DecodedValue };

type TypeLayout = {
  alignment: number;
  size: number;
};

type StructFieldLayout = {
  field: IdlField;
  offset: number;
};

type StructLayout = TypeLayout & {
  fields: StructFieldLayout[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertByteArray(value: unknown, context: string): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new VerificationError(`${context} must be a non-empty byte array`);
  }
}

function alignTo(offset: number, alignment: number): number {
  return Math.ceil(offset / alignment) * alignment;
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new VerificationError(`${context} must be a non-empty string`);
  }
  return value;
}

export class ProgramInterface {
  readonly programAddress: Address;
  private readonly idl: SolanaIdl;
  private readonly instructions: ReadonlyMap<string, IdlInstruction>;
  private readonly accounts: ReadonlyMap<string, IdlAccount>;
  private readonly types: ReadonlyMap<string, IdlTypeDefinition>;

  constructor(value: unknown) {
    this.idl = this.validateIdl(value);
    this.programAddress = address(this.idl.address);
    this.instructions = new Map(this.idl.instructions.map(instruction => [instruction.name, instruction]));
    this.accounts = new Map((this.idl.accounts ?? []).map(accountDefinition => [accountDefinition.name, accountDefinition]));
    this.types = new Map((this.idl.types ?? []).map(typeDefinition => [typeDefinition.name, typeDefinition]));

    for (const accountDefinition of this.accounts.values()) {
      if (!this.types.has(accountDefinition.name)) {
        throw new VerificationError(`Account ${accountDefinition.name} has no matching type definition`);
      }
      this.getStructLayout(accountDefinition.name);
    }
  }

  hasInstruction(name: string): boolean {
    return this.instructions.has(name);
  }

  async derivePda(name: string, accounts: Readonly<Record<string, Address>>): Promise<Address> {
    const definition = this.idl.pdas?.[name];
    if (!definition) throw new VerificationError(`Unknown bundled PDA: ${name}`);
    const seeds = definition.seeds.map(seed => {
      if (seed.kind === "const") return new Uint8Array(seed.value);
      const value = accounts[seed.path];
      if (!value) throw new VerificationError(`PDA ${name} requires ${seed.path}`);
      return getAddressEncoder().encode(value);
    });
    return (await getProgramDerivedAddress({
      programAddress: definition.program === undefined ? this.programAddress : address(definition.program), seeds,
    }))[0];
  }

  encodeInstruction(name: string, args: Readonly<Record<string, unknown>>): Uint8Array {
    const instruction = this.requireInstruction(name);
    const argsLayout = this.getAnonymousStructLayout(instruction.args);
    const output = new Uint8Array(instruction.discriminator.length + argsLayout.size);
    output.set(instruction.discriminator, 0);
    this.encodeStructFields(output, instruction.discriminator.length, argsLayout, args, `instruction ${name}`);
    return output;
  }

  decodeAccount<T extends DecodedStruct = DecodedStruct>(name: string, data: Uint8Array): T {
    const accountDefinition = this.accounts.get(name);
    if (!accountDefinition) {
      throw new VerificationError(`Unknown account type: ${name}`);
    }

    const layout = this.getStructLayout(name);
    const expectedSize = accountDefinition.discriminator.length + layout.size;
    if (data.length !== expectedSize) {
      throw new VerificationError(
        `${name} account data has invalid length: expected ${expectedSize}, received ${data.length}`,
      );
    }
    for (let index = 0; index < accountDefinition.discriminator.length; index += 1) {
      if (data[index] !== accountDefinition.discriminator[index]) {
        throw new VerificationError(`${name} account discriminator does not match the verified interface`);
      }
    }

    return this.decodeStruct(data, accountDefinition.discriminator.length, name) as T;
  }

  getAccountSize(name: string): number {
    const accountDefinition = this.accounts.get(name);
    if (!accountDefinition) {
      throw new VerificationError(`Unknown account type: ${name}`);
    }
    return accountDefinition.discriminator.length + this.getStructLayout(name).size;
  }

  async deriveInstructionAccount(
    instructionName: string,
    accountName: string,
    suppliedAccounts: Readonly<Record<string, Address>>,
  ): Promise<Address> {
    const instruction = this.requireInstruction(instructionName);
    if (!instruction.accounts.some(accountDefinition => accountDefinition.name === accountName)) {
      throw new VerificationError(`Instruction ${instructionName} has no account named ${accountName}`);
    }
    return await this.resolveSingleInstructionAccount(instruction, accountName, suppliedAccounts, new Set());
  }

  async buildInstruction(
    name: string,
    args: Readonly<Record<string, unknown>>,
    suppliedAccounts: Readonly<Record<string, Address>>,
  ): Promise<Instruction> {
    const instruction = this.requireInstruction(name);
    const resolved = await this.resolveInstructionAccounts(name, suppliedAccounts);

    return {
      programAddress: this.programAddress,
      accounts: instruction.accounts.map(accountDefinition => ({
        address: resolved.get(accountDefinition.name)!,
        role: accountDefinition.optional && resolved.get(accountDefinition.name) === this.programAddress
          ? AccountRole.READONLY : this.getAccountRole(accountDefinition),
      })),
      data: this.encodeInstruction(name, args),
    };
  }

  getAccountFieldOffset(name: string, field: string): number {
    const account = this.accounts.get(name);
    const layout = this.getStructLayout(name).fields.find(item => item.field.name === field);
    if (!account || !layout) throw new VerificationError(`Unknown account field ${name}.${field}`);
    return account.discriminator.length + layout.offset;
  }

  private validateIdl(value: unknown): SolanaIdl {
    if (!isRecord(value)) {
      throw new VerificationError("Program interface must be a JSON object");
    }
    const programAddress = requireString(value.address, "IDL address");
    address(programAddress);

    if (!isRecord(value.metadata) || value.metadata.spec !== "0.1.0") {
      throw new VerificationError("Program interface must use Solana IDL specification 0.1.0");
    }
    requireString(value.metadata.name, "IDL metadata.name");
    requireString(value.metadata.version, "IDL metadata.version");
    if (value.pdas !== undefined) {
      if (!isRecord(value.pdas)) throw new VerificationError("IDL pdas must be an object");
      for (const [name, definition] of Object.entries(value.pdas)) {
        this.validatePda(definition, name);
        if (isRecord(definition) && definition.program !== undefined) address(requireString(definition.program, name));
      }
    }

    if (!Array.isArray(value.instructions) || value.instructions.length === 0) {
      throw new VerificationError("Program interface must declare at least one instruction");
    }
    for (const rawInstruction of value.instructions) {
      if (!isRecord(rawInstruction)) {
        throw new VerificationError("Invalid instruction definition");
      }
      requireString(rawInstruction.name, "Instruction name");
      assertByteArray(rawInstruction.discriminator, `Instruction ${rawInstruction.name} discriminator`);
      if (!Array.isArray(rawInstruction.accounts) || !Array.isArray(rawInstruction.args)) {
        throw new VerificationError(`Instruction ${rawInstruction.name} must declare accounts and args`);
      }
      for (const rawAccount of rawInstruction.accounts) {
        if (!isRecord(rawAccount)) {
          throw new VerificationError(`Instruction ${rawInstruction.name} contains an invalid account`);
        }
        requireString(rawAccount.name, "Instruction account name");
        if (rawAccount.address !== undefined) {
          address(requireString(rawAccount.address, `Account ${rawAccount.name} address`));
        }
        if (rawAccount.pda !== undefined) {
          this.validatePda(rawAccount.pda, String(rawAccount.name));
        }
      }
      for (const rawArgument of rawInstruction.args) {
        this.validateField(rawArgument, `Instruction ${rawInstruction.name} argument`);
      }
    }

    if (value.accounts !== undefined && !Array.isArray(value.accounts)) {
      throw new VerificationError("IDL accounts must be an array");
    }
    for (const rawAccount of (value.accounts ?? []) as unknown[]) {
      if (!isRecord(rawAccount)) {
        throw new VerificationError("Invalid account definition");
      }
      requireString(rawAccount.name, "Account type name");
      if (!Array.isArray(rawAccount.discriminator) || rawAccount.discriminator.length !== 0) {
        assertByteArray(rawAccount.discriminator, `Account ${rawAccount.name} discriminator`);
      }
    }

    if (value.types !== undefined && !Array.isArray(value.types)) {
      throw new VerificationError("IDL types must be an array");
    }
    for (const rawType of (value.types ?? []) as unknown[]) {
      if (!isRecord(rawType) || !isRecord(rawType.type)) {
        throw new VerificationError("Invalid type definition");
      }
      const typeName = requireString(rawType.name, "Type name");
      if (rawType.serialization !== "borsh" && (rawType.serialization !== "bytemuck" || !isRecord(rawType.repr) || rawType.repr.kind !== "c")) {
        throw new VerificationError(`Type ${typeName} must use bytemuck serialization and C representation`);
      }
      if (rawType.type.kind !== "struct" || !Array.isArray(rawType.type.fields)) {
        throw new VerificationError(`Type ${typeName} must be a struct`);
      }
      for (const field of rawType.type.fields) {
        this.validateField(field, `Type ${typeName} field`);
      }
    }

    return value as unknown as SolanaIdl;
  }

  private validatePda(value: unknown, accountName: string): void {
    if (!isRecord(value) || !Array.isArray(value.seeds) || value.seeds.length === 0) {
      throw new VerificationError(`Account ${accountName} has an invalid PDA declaration`);
    }
    for (const rawSeed of value.seeds) {
      if (!isRecord(rawSeed)) {
        throw new VerificationError(`Account ${accountName} has an invalid PDA seed`);
      }
      if (rawSeed.kind === "const") {
        assertByteArray(rawSeed.value, `Account ${accountName} constant PDA seed`);
      } else if (rawSeed.kind === "account") {
        requireString(rawSeed.path, `Account ${accountName} PDA account path`);
      } else {
        throw new VerificationError(`Account ${accountName} uses an unsupported PDA seed kind`);
      }
    }
  }

  private validateField(value: unknown, context: string): void {
    if (!isRecord(value)) {
      throw new VerificationError(`${context} is invalid`);
    }
    requireString(value.name, `${context} name`);
    this.validateType(value.type, `${context} ${value.name}`);
  }

  private validateType(value: unknown, context: string): void {
    if (value === "bool" || value === "u8" || value === "u16" || value === "u32" || value === "u64" || value === "u128" || value === "i64" || value === "pubkey") {
      return;
    }
    if (!isRecord(value)) {
      throw new VerificationError(`${context} has an unsupported type`);
    }
    if (Array.isArray(value.array) && value.array.length === 2) {
      this.validateType(value.array[0], context);
      if (!Number.isInteger(value.array[1]) || Number(value.array[1]) < 0) {
        throw new VerificationError(`${context} has an invalid array length`);
      }
      return;
    }
    if (isRecord(value.defined)) {
      requireString(value.defined.name, `${context} defined type name`);
      return;
    }
    throw new VerificationError(`${context} has an unsupported type`);
  }

  private requireInstruction(name: string): IdlInstruction {
    const instruction = this.instructions.get(name);
    if (!instruction) {
      throw new VerificationError(`Unknown instruction: ${name}`);
    }
    return instruction;
  }

  private getTypeLayout(type: IdlType): TypeLayout {
    if (type === "u8" || type === "bool") return { size: 1, alignment: 1 };
    if (type === "u16") return { size: 2, alignment: 2 };
    if (type === "u32") return { size: 4, alignment: 4 };
    if (type === "u128") return { size: 16, alignment: 8 };
    if (type === "u64" || type === "i64") return { size: 8, alignment: 8 };
    if (type === "pubkey") return { size: 32, alignment: 1 };
    if ("array" in type) {
      const item = this.getTypeLayout(type.array[0]);
      return { size: item.size * type.array[1], alignment: item.alignment };
    }
    return this.getStructLayout(type.defined.name);
  }

  private getAnonymousStructLayout(fields: IdlField[], packed = false): StructLayout {
    let offset = 0;
    let alignment = 1;
    const fieldLayouts: StructFieldLayout[] = [];
    for (const field of fields) {
      const fieldType = this.getTypeLayout(field.type);
      alignment = Math.max(alignment, packed ? 1 : fieldType.alignment);
      offset = alignTo(offset, packed ? 1 : fieldType.alignment);
      fieldLayouts.push({ field, offset });
      offset += fieldType.size;
    }
    return { fields: fieldLayouts, alignment, size: alignTo(offset, alignment) };
  }

  private getStructLayout(name: string): StructLayout {
    const definition = this.types.get(name);
    if (!definition) {
      throw new VerificationError(`Unknown defined type: ${name}`);
    }
    return this.getAnonymousStructLayout(definition.type.fields, definition.serialization === "borsh");
  }

  private decodeStruct(data: Uint8Array, baseOffset: number, name: string): DecodedStruct {
    const layout = this.getStructLayout(name);
    const result: DecodedStruct = {};
    for (const { field, offset } of layout.fields) {
      result[field.name] = this.decodeValue(data, baseOffset + offset, field.type);
    }
    return result;
  }

  private decodeValue(data: Uint8Array, offset: number, type: IdlType): DecodedValue {
    if (type === "bool") {
      if (data[offset] !== 0 && data[offset] !== 1) throw new VerificationError("Invalid bool encoding");
      return data[offset] === 1;
    }
    if (type === "u8") return data[offset]!;
    if (type === "u16") return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset, true);
    if (type === "u32") return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
    if (type === "u128") {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      return view.getBigUint64(offset, true) | (view.getBigUint64(offset + 8, true) << 64n);
    }
    if (type === "u64") return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
    if (type === "i64") return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(offset, true);
    if (type === "pubkey") return getAddressDecoder().decode(data.subarray(offset, offset + 32));
    if ("array" in type) {
      const itemLayout = this.getTypeLayout(type.array[0]);
      return Array.from({ length: type.array[1] }, (_, index) =>
        this.decodeValue(data, offset + index * itemLayout.size, type.array[0]),
      );
    }
    return this.decodeStruct(data, offset, type.defined.name);
  }

  private encodeStructFields(
    output: Uint8Array,
    baseOffset: number,
    layout: StructLayout,
    values: Readonly<Record<string, unknown>>,
    context: string,
  ): void {
    const expectedNames = new Set(layout.fields.map(({ field }) => field.name));
    for (const suppliedName of Object.keys(values)) {
      if (!expectedNames.has(suppliedName)) {
        throw new VerificationError(`${context} received unknown field ${suppliedName}`);
      }
    }
    for (const { field, offset } of layout.fields) {
      if (!(field.name in values)) {
        throw new VerificationError(`${context} is missing field ${field.name}`);
      }
      this.encodeValue(output, baseOffset + offset, field.type, values[field.name], `${context}.${field.name}`);
    }
  }

  private encodeValue(output: Uint8Array, offset: number, type: IdlType, value: unknown, context: string): void {
    if (type === "bool") {
      if (typeof value !== "boolean") throw new VerificationError(`${context} must be a boolean`);
      output[offset] = value ? 1 : 0;
      return;
    }
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
    if (type === "u8" || type === "u16" || type === "u32") {
      const bits = Number(type.slice(1));
      if (!Number.isInteger(value) || Number(value) < 0 || Number(value) >= 2 ** bits) {
        throw new VerificationError(`${context} must be a ${type}`);
      }
      if (type === "u8") output[offset] = Number(value);
      else if (type === "u16") view.setUint16(offset, Number(value), true);
      else view.setUint32(offset, Number(value), true);
      return;
    }
    if (type === "u64" || type === "i64" || type === "u128") {
      if (typeof value !== "bigint") {
        throw new VerificationError(`${context} must be a bigint`);
      }
      const bits = type === "u128" ? 128n : 64n;
      const min = type === "i64" ? -(1n << 63n) : 0n;
      const max = type === "i64" ? (1n << 63n) - 1n : (1n << bits) - 1n;
      if (value < min || value > max) throw new VerificationError(`${context} is outside ${type} range`);
      if (type === "u128") {
        view.setBigUint64(offset, value & ((1n << 64n) - 1n), true);
        view.setBigUint64(offset + 8, value >> 64n, true);
      } else if (type === "u64") view.setBigUint64(offset, value, true);
      else view.setBigInt64(offset, value, true);
      return;
    }
    if (type === "pubkey") {
      if (typeof value !== "string") {
        throw new VerificationError(`${context} must be an address`);
      }
      output.set(getAddressEncoder().encode(address(value)), offset);
      return;
    }
    if ("array" in type) {
      if (!Array.isArray(value) || value.length !== type.array[1]) {
        throw new VerificationError(`${context} must contain ${type.array[1]} elements`);
      }
      const itemLayout = this.getTypeLayout(type.array[0]);
      value.forEach((item, index) =>
        this.encodeValue(output, offset + index * itemLayout.size, type.array[0], item, `${context}[${index}]`),
      );
      return;
    }
    if (!isRecord(value)) {
      throw new VerificationError(`${context} must be an object`);
    }
    this.encodeStructFields(output, offset, this.getStructLayout(type.defined.name), value, context);
  }

  private async resolveInstructionAccounts(
    instructionName: string,
    suppliedAccounts: Readonly<Record<string, Address>>,
  ): Promise<Map<string, Address>> {
    const instruction = this.requireInstruction(instructionName);
    const declaredNames = new Set(instruction.accounts.map(accountDefinition => accountDefinition.name));
    for (const suppliedName of Object.keys(suppliedAccounts)) {
      if (!declaredNames.has(suppliedName)) {
        throw new VerificationError(`Instruction ${instructionName} received unknown account ${suppliedName}`);
      }
    }

    const resolved = new Map<string, Address>();
    for (const accountDefinition of instruction.accounts) {
      const supplied = suppliedAccounts[accountDefinition.name];
      const fixed = accountDefinition.address === undefined ? undefined : address(accountDefinition.address);
      let derived: Address | undefined;
      if (accountDefinition.pda) {
        const seeds = accountDefinition.pda.seeds.map(seed => {
          if (seed.kind === "const") return new Uint8Array(seed.value);
          const referenced = resolved.get(seed.path) ?? suppliedAccounts[seed.path];
          if (!referenced) {
            throw new VerificationError(
              `Cannot resolve PDA ${accountDefinition.name}: account seed ${seed.path} is unavailable`,
            );
          }
          return getAddressEncoder().encode(referenced);
        });
        [derived] = await getProgramDerivedAddress({ programAddress: this.programAddress, seeds });
      }

      if (fixed && derived && fixed !== derived) {
        throw new VerificationError(`Derived ${accountDefinition.name} PDA does not match its verified fixed address`);
      }
      const expected = derived ?? fixed;
      if (supplied && expected && supplied !== expected) {
        throw new VerificationError(`Supplied ${accountDefinition.name} does not match the verified interface`);
      }
      const result = supplied ?? expected;
      if (!result) {
        throw new VerificationError(`Instruction ${instructionName} requires account ${accountDefinition.name}`);
      }
      resolved.set(accountDefinition.name, result);
    }
    return resolved;
  }

  private async resolveSingleInstructionAccount(
    instruction: IdlInstruction,
    accountName: string,
    suppliedAccounts: Readonly<Record<string, Address>>,
    resolving: Set<string>,
  ): Promise<Address> {
    const accountDefinition = instruction.accounts.find(candidate => candidate.name === accountName);
    if (!accountDefinition) {
      throw new VerificationError(`Instruction ${instruction.name} has no account named ${accountName}`);
    }
    if (resolving.has(accountName)) {
      throw new VerificationError(`Instruction ${instruction.name} contains a cyclic PDA declaration`);
    }
    resolving.add(accountName);
    try {
      const supplied = suppliedAccounts[accountName];
      const fixed = accountDefinition.address === undefined ? undefined : address(accountDefinition.address);
      let derived: Address | undefined;
      if (accountDefinition.pda) {
        const seeds = [];
        for (const seed of accountDefinition.pda.seeds) {
          if (seed.kind === "const") {
            seeds.push(new Uint8Array(seed.value));
          } else {
            const referenced = suppliedAccounts[seed.path] ?? await this.resolveSingleInstructionAccount(
              instruction,
              seed.path,
              suppliedAccounts,
              resolving,
            );
            seeds.push(getAddressEncoder().encode(referenced));
          }
        }
        [derived] = await getProgramDerivedAddress({ programAddress: this.programAddress, seeds });
      }
      if (fixed && derived && fixed !== derived) {
        throw new VerificationError(`Derived ${accountName} PDA does not match its verified fixed address`);
      }
      const expected = derived ?? fixed;
      if (supplied && expected && supplied !== expected) {
        throw new VerificationError(`Supplied ${accountName} does not match the verified interface`);
      }
      const result = supplied ?? expected;
      if (!result) {
        throw new VerificationError(`Instruction ${instruction.name} requires account ${accountName}`);
      }
      return result;
    } finally {
      resolving.delete(accountName);
    }
  }

  private getAccountRole(accountDefinition: IdlInstructionAccount): AccountRole {
    if (accountDefinition.signer && accountDefinition.writable) return AccountRole.WRITABLE_SIGNER;
    if (accountDefinition.signer) return AccountRole.READONLY_SIGNER;
    if (accountDefinition.writable) return AccountRole.WRITABLE;
    return AccountRole.READONLY;
  }
}
