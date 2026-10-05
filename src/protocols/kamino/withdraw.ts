import { address, type Address, type Instruction } from "@solana/kit";
import { borrows, deposits, type Position } from "./adapter";
import { ZERO, check, decode, tokenState } from "./accounts";
import type { Obligation } from "./state";
import { computeBudget, refreshPreview, operationFarms, validateSimulationSnapshot, type PreparationOptions, type OperationPlan } from "./operation-common";
import { ProgramInterface } from "../../core/program-interface";
import { SF, U64_MAX, ceilDiv, collateralForAmount, parseAmount, redeemAmount, remainingWithdrawalCap } from "./math";
import ataIdl from "./ata.idl.json" with { type: "json" };

const ataInterface = new ProgramInterface(ataIdl);

function maxCollateral(position: Position, reserveKey: Address): bigint {
  const deposit = deposits(position.state).find(x => x.depositReserve === reserveKey)!;
  if (borrows(position.state).length === 0) return deposit.depositedAmount;
  const config = position.reserves.get(reserveKey)!.state.config;
  const available = position.state.allowedBorrowValueSf - position.state.borrowFactorAdjustedDebtValueSf;
  if (available <= 0n) return 0n;
  const maxValue = config.loanToValuePct === 0 ? deposit.marketValueSf : available * 100n / BigInt(config.loanToValuePct);
  const value = maxValue < deposit.marketValueSf ? maxValue : deposit.marketValueSf;
  check(deposit.marketValueSf > 0n, "zero collateral market value");
  let amount = (value * SF / deposit.marketValueSf) * deposit.depositedAmount / SF;
  // An explicit amount uses a ceil withdrawal ratio in KLend. Stay inside that bound.
  if (amount > 0n && deposit.marketValueSf * ceilDiv(amount * SF, deposit.depositedAmount) / SF > maxValue) amount -= 1n;
  return amount;
}

export async function prepareWithdraw(options: PreparationOptions): Promise<OperationPlan | null> {
  const { adapter, rpc, wallet } = options;
  check(options.token.toUpperCase() !== "SOL", "SOL is supported only for repay; withdraw uses a bundled token's ATA");
  const selection = await adapter.operationToken(rpc, wallet, options.position, "withdraw", options.token, options.reserve);
  if (!selection) return null;
  const { token } = selection;
  const requested = options.amount === "all" ? null : parseAmount(options.amount, token.decimals);
  let position = await adapter.loadPosition(rpc, wallet, options.position, selection.minSlot);
  if (options.reserve === undefined) adapter.validateTokenSelection(position.state, "withdraw", options.token);
  const reserveKey = address(token.reserve);
  if (!deposits(position.state).some(x => x.depositReserve === reserveKey)) return null;
  position = await refreshPreview(adapter, rpc, wallet, position);
  const reserve = position.reserves.get(reserveKey)!.state;
  const recipient = await adapter.ata(wallet, address(token.mint));
  const existing = position.accounts.get(recipient);
  const balance = existing ? tokenState(existing, address(token.mint), wallet).amount : 0n;
  const createsAta = !existing;
  const setup: Instruction[] = [computeBudget()];
  if (createsAta) setup.push(await ataInterface.buildInstruction("createIdempotent", {}, {
    payer: wallet, owner: wallet, mint: address(token.mint), ata: recipient,
  }));
  const farms = await operationFarms(adapter, position, reserve.farmCollateral);
  const deposit = deposits(position.state).find(x => x.depositReserve === reserveKey)!;
  const cap = remainingWithdrawalCap(reserve.config.depositWithdrawalCap, position.clock.unixTimestamp);
  const max = maxCollateral(position, reserveKey);
  let collateralAmount = requested === null ? max : collateralForAmount(requested, reserve);
  check(collateralAmount > 0n && collateralAmount <= deposit.depositedAmount && collateralAmount <= max,
    "withdrawal exceeds available collateral or the remaining position's maximum LTV");
  // 'all' on a debt-free position means all its collateral; it fails if liquidity is insufficient.
  // With debt it means the largest locally permitted amount, capped by available liquidity.
  if (requested === null && borrows(position.state).length > 0) {
    const available = cap < reserve.liquidity.totalAvailableAmount ? cap : reserve.liquidity.totalAvailableAmount;
    let liquidCap = collateralForAmount(available + 1n, reserve) - 1n;
    if (liquidCap < 0n) liquidCap = 0n;
    if (liquidCap < collateralAmount) collateralAmount = liquidCap;
  }
  const estimate = redeemAmount(collateralAmount, reserve);
  check(estimate > 0n && estimate <= reserve.liquidity.totalAvailableAmount, "insufficient reserve liquidity or withdrawal rounds to zero");
  check(estimate <= cap, "reserve withdrawal cap would be exceeded; retry after its interval resets");
  const operation = await adapter.programInterface.buildInstruction("withdrawObligationCollateralAndRedeemReserveCollateralV2", {
    collateralAmount: requested === null && borrows(position.state).length === 0 ? U64_MAX : collateralAmount,
  }, {
    owner: wallet, obligation: position.address, lendingMarket: adapter.marketAddress,
    withdrawReserve: reserveKey, reserveLiquidityMint: address(token.mint),
    reserveSourceCollateral: reserve.collateral.supplyVault, reserveCollateralMint: reserve.collateral.mintPubkey,
    reserveLiquiditySupply: reserve.liquidity.supplyVault, userDestinationLiquidity: recipient, ...farms,
  });
  const instructions = [...setup, ...await adapter.refreshInstructions(position), operation];
  const simulationAccounts = [position.address, recipient, adapter.marketAddress, ...position.reserves.keys()];
  return {
    instructions, simulationAccounts, estimate, token: token.symbol,
    decimals: token.decimals, reserve: reserveKey, recipient, createsAta, collateralAmount,
    validateSimulation(result) {
      const accounts = validateSimulationSnapshot(adapter, position, simulationAccounts, result);
      const tokenAfter = tokenState(accounts[1], address(token.mint), wallet);
      const postAccount = accounts[0];
      // Closing an empty obligation returns a missing or empty System-owned account.
      const closed = postAccount == null || (postAccount.owner === ZERO && postAccount.data.length === 0);
      check(tokenAfter.amount > balance, "withdrawal produces no token payout");
      if (closed) check(borrows(position.state).length === 0 && deposits(position.state).length === 1, "unexpected closure of a nonempty position");
      else {
        const post = decode<Obligation>(adapter.programInterface, "Obligation", postAccount, adapter.programAddress);
        adapter.validateObligation(post, wallet);
        check(post.owner === wallet && post.lendingMarket === adapter.marketAddress, "simulated withdrawal changed position ownership");
        const before = deposits(position.state).find(x => x.depositReserve === reserveKey)!.depositedAmount;
        const after = deposits(post).find(x => x.depositReserve === reserveKey)?.depositedAmount ?? 0n;
        check(after < before && before - after <= collateralAmount, "unexpected simulated collateral debit");
      }
    },
  };
}

