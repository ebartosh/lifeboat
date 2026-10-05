# ORE interface provenance

lifeboat-cli v0.1 uses a locally reconstructed, verified subset of the ORE program
interface. It is not an official ORE IDL.

## Source of truth

- Protocol: ORE
- Repository: <https://github.com/regolith-labs/ore>
- Commit: `70763fc80d6493302181bebdbf35b90c54f8f15c`
- ORE workspace version at that commit: `3.8.21`
- Verification date: `2026-08-22`
- Steel version used by ORE: `4.0.9`
- Program ID: `oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv`

The following files were inspected at the pinned commit:

- `api/src/lib.rs`
- `api/src/instruction.rs`
- `api/src/consts.rs`
- `api/src/sdk.rs`
- `api/src/state/mod.rs`
- `api/src/state/miner.rs`
- `program/src/claim_sol.rs`
- `api/idl.json`

Steel 4.0.9's published `instruction!`, `account!`, account deserialization,
account allocation, and `Numeric` implementations were also inspected to
verify serialization rather than infer it from ORE's JSON IDL.

## Interface note

### Program ID

`oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv`

The value comes from `declare_id!` in `api/src/lib.rs`. lifeboat-cli never accepts a
program ID from the command line or environment.

### ClaimSOL encoding

`OreInstruction::ClaimSOL` has the `u8` value `3`. `ClaimSOL` has no fields.
Steel 4.0.9's `instruction!` macro prefixes the bytemuck representation of the
argument structure with that one-byte value. Therefore the complete serialized
instruction data is exactly:

```text
03
```

### ClaimSOL accounts

In exact order:

| Account | Writable | Signer | Source |
| --- | --- | --- | --- |
| wallet signer | yes | yes | caller wallet |
| board | yes | no | PDA `['board']` |
| miner | yes | no | PDA `['miner', wallet]` |
| System Program | no | no | `11111111111111111111111111111111` |
| ORE program | no | no | bundled ORE program ID |

The board is writable in the authoritative Rust SDK (`AccountMeta::new`) and is
used as the signed writable account for ORE's event-log CPI. The repository's
`api/idl.json` marks it read-only, so that field was not copied into lifeboat-cli's
reconstruction.

### PDA derivation

- Board: `find_program_address([b"board"], ORE_PROGRAM_ID)`
- Miner: `find_program_address([b"miner", authority.to_bytes()], ORE_PROGRAM_ID)`

The source also records the board address as
`BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi`.

### Miner account layout used by status

Steel allocates an eight-byte zero-filled header and writes the account's `u8`
discriminator into its first byte. `OreAccount::Miner` is `103`, so the expected
header is `[103, 0, 0, 0, 0, 0, 0, 0]`.

The `#[repr(C)]` bytemuck body is 744 bytes; total account data is 752 bytes.
It contains, in source order, the authority, three scalar configuration fields,
three `[u64; 25]` arrays, round ID, a 16-byte Steel `Numeric`, and the reward and
lifetime scalar fields. `rewards_sol` is a little-endian `u64`; its byte location
is calculated from this schema by the Program Interface rather than hardcoded in
the ORE adapter.

## Local representation

`src/protocols/ore/ore.idl.json` is a deliberately small lifeboat-cli v0.1 subset using
Solana IDL specification 0.1.0. It describes only the `claimSol` instruction and
the `Miner`/`Numeric` types required by `status` and `claim-sol`. The ClaimORE
extension below adds a second instruction and Treasury. Steel's layouts
are represented with `serialization: "bytemuck"` and `repr: { "kind": "c" }`.

The file's own documentation records this provenance and its reconstructed,
non-official status. Runtime code loads it and uses it to derive PDAs, decode
Miner data, encode ClaimSOL, and assign instruction account roles.

## ClaimORE extension (verified 2026-09-27)

Verified against the same pinned commit `70763fc80d6493302181bebdbf35b90c54f8f15c`:

- [instruction definitions](https://github.com/regolith-labs/ore/blob/70763fc80d6493302181bebdbf35b90c54f8f15c/api/src/instruction.rs)
- [Rust SDK](https://github.com/regolith-labs/ore/blob/70763fc80d6493302181bebdbf35b90c54f8f15c/api/src/sdk.rs)
- [ClaimORE handler](https://github.com/regolith-labs/ore/blob/70763fc80d6493302181bebdbf35b90c54f8f15c/program/src/claim_ore.rs)
- [Miner reward arithmetic](https://github.com/regolith-labs/ore/blob/70763fc80d6493302181bebdbf35b90c54f8f15c/api/src/state/miner.rs)
- [Treasury layout](https://github.com/regolith-labs/ore/blob/70763fc80d6493302181bebdbf35b90c54f8f15c/api/src/state/treasury.rs), `state/mod.rs`, and `consts.rs`
- Published `steel` 4.0.9 crate, `src/numeric.rs`: Numeric is `[u8; 16]`,
  alignment 1, signed little-endian I80F48; `to_u64()` floors.

ClaimORE has discriminator `4` and one argument `bps: [u8; 8]` containing a
little-endian u64. lifeboat-cli always uses 10000 (100%); the complete payload is
`04 10 27 00 00 00 00 00 00`. There is no CLI partial-claim argument.
The handler accepts a legacy missing argument by defaulting to 10000, but
lifeboat-cli uses the explicit SDK format.

Accounts in exact Rust SDK order:

| Account | Writable | Signer | Source |
| --- | --- | --- | --- |
| signer | yes | yes | configured wallet |
| board | yes | no | ORE PDA `[b"board"]` |
| miner | yes | no | ORE PDA `[b"miner", wallet]` |
| mint | yes | no | `oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp` |
| recipient | yes | no | wallet's ORE ATA |
| treasury | yes | no | ORE PDA `[b"treasury"]` |
| treasuryTokens | yes | no | treasury's ORE ATA |
| systemProgram | no | no | `11111111111111111111111111111111` |
| tokenProgram | no | no | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| associatedTokenProgram | no | no | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |
| oreProgram | no | no | bundled ORE program ID |

Treasury is `45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG`; its derived PDA
must match that fixed address. Each ATA is derived under the Associated Token
Program with seeds `[owner, Token Program ID, ORE mint]`, including the off-curve
Treasury owner. Those addresses are supplied by the ORE adapter; the generic
Program Interface continues to derive only ORE PDAs.

The handler creates an empty/missing recipient ATA via CPI, with the wallet as
payer and owner; otherwise it validates the existing ATA. Hence lifeboat-cli uses
one instruction and retains the existing transaction executor unchanged.

Treasury has header `[104,0,0,0,0,0,0,0]` followed by `motherlode: u64`,
`miner_rewards_factor: Numeric`, `total_refined: u64`, `total_unclaimed: u64`.
The body is 40 bytes; the full account is 48 bytes. Both Treasury ownership and
the full schema/discriminator are checked before using a payout estimate.

For a full claim, with `F` denoting signed I80F48 raw bits:

1. Pending refined rewards = `floor(max(F_treasury - F_miner, 0) * rewards_ore / 2^48)`.
2. Refined withdrawal = `refined_ore + pending`; unrefined withdrawal = `rewards_ore`.
3. If the unrefined withdrawal is positive and `total_unclaimed - rewards_ore > 0`,
   the fee is `max(1, floor(rewards_ore / 10))`; otherwise it is zero.
4. Net payout = refined + unrefined - fee, in grams (10^11 grams per ORE).

The timestamp is updated but does not impose a cooldown. State reads are
estimates and can race other transactions; simulation and the on-chain handler
remain authoritative. Inconsistent local totals are rejected with a retry
message. No claim transaction was submitted as part of source verification.

Offline tests check payload bytes, account order/roles, ATA seeds, independent
Treasury bytes, pending reward rounding, fee boundaries and command execution
with mocked RPC. ATA absence/presence tests verify client orchestration; they
do not execute the Rust program. Optional RPC tests are read-only.
