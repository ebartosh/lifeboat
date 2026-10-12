import { address, AccountRole, generateKeyPairSigner, type Transaction, type Instruction } from "@solana/kit";
import { borrows, deposits, WSOL_MINT } from "./adapter";
import { ZERO, check, decode, tokenState, support, verifyProgram } from "./accounts";
import type { Obligation } from "./state";
import { computeBudget, refreshPreview, operationFarms, validateSimulationSnapshot, type PreparationOptions, type OperationPlan } from "./operation-common";
import { fullRepaymentWrap, nativeSolInstructions, walletLamports, type NativeSolEstimate } from "./native-sol";
import { SF, U64_MAX, ceilDiv, debtSf, parseAmount } from "./math";

export async function prepareRepay(options: PreparationOptions): Promise<OperationPlan | null> {
  const { adapter, rpc, wallet } = options;
  const useSol = options.token.toUpperCase() === "SOL";
  const fromBalance = options.amount === "balance";
  check(!fromBalance || !useSol, "wallet balance repayment spends a token ATA; enter an amount or all for native SOL");
  const selection = await adapter.operationToken(rpc, wallet, options.position, "repay", useSol ? WSOL_MINT : options.token, options.reserve);
  if (!selection) return null;
  const { token } = selection;
  const parsed = options.amount === "all" || fromBalance ? null : parseAmount(options.amount, token.decimals);
  const temporary = useSol ? await generateKeyPairSigner() : undefined;
  const reserveKey = address(token.reserve);
  let position = await adapter.loadPosition(rpc, wallet, options.position, selection.minSlot, {
    repayment: { reserve: reserveKey, source: useSol ? "native" : "ata" },
    additionalAccounts: temporary ? [wallet, temporary.address, ZERO] : [],
  });
  if (options.reserve === undefined) adapter.validateTokenSelection(position.state, "repay", useSol ? WSOL_MINT : options.token);
  if (!borrows(position.state).some(x => x.borrowReserve === reserveKey)) return null;
  if (temporary) {
    verifyProgram(position.accounts.get(ZERO), "System", false);
    check(!position.accounts.get(temporary.address), "temporary WSOL account already exists");
    walletLamports(position.accounts.get(wallet));
  }
  // Native funding needs refreshed debt to size the temporary WSOL account.
  // An existing ATA needs only the refresh inside the complete transaction.
  if (temporary) position = await refreshPreview(adapter, rpc, wallet, position);
  const reserve = position.reserves.get(reserveKey)!.state;
  const recipient = temporary?.address ?? await adapter.ata(wallet, address(token.mint));
  const existing = position.accounts.get(recipient);
  const balance = existing ? tokenState(existing, address(token.mint), wallet).amount : 0n;
  // Kamino settles min(debt, amount), so offering the whole ATA balance never overpays.
  if (fromBalance) check(balance > 0n, `insufficient ${token.symbol} in wallet ATA; the balance is zero`);
  const requested = fromBalance ? balance : parsed;
  const setup: Instruction[] = [computeBudget()];
  const farms = await operationFarms(adapter, position, reserve.farmDebt);
  let nativeSol: NativeSolEstimate | undefined;
  let closeTemporary: Instruction | undefined;
  const debt = borrows(position.state).find(x => x.borrowReserve === reserveKey)!;
  const owed = ceilDiv(temporary ? debt.borrowedAmountSf : debtSf(debt, reserve), SF);
  const estimate = requested === null || requested > owed ? owed : requested;
  if (estimate === 0n) return null;
  if (temporary) {
    const wrap = requested ?? fullRepaymentWrap(debt.borrowedAmountSf, reserve);
    const rent = await rpc.getMinimumBalanceForRentExemption(support.getAccountSize("TokenAccount"));
    nativeSol = { wrap, buffer: requested === null ? wrap - owed : 0n, rent };
    const native = await nativeSolInstructions(wallet, temporary, address(token.mint), wrap, rent);
    setup.push(...native.setup);
    closeTemporary = native.close;
  } else check(existing && balance >= estimate, `insufficient ${token.symbol} in wallet ATA; fund it before repayment${token.symbol === "WSOL" ? " or use --token SOL to wrap native SOL" : ""}`);
  const repay = await adapter.programInterface.buildInstruction("repayObligationLiquidityV2", { liquidityAmount: requested ?? U64_MAX }, {
    owner: wallet, obligation: position.address, lendingMarket: adapter.marketAddress,
    repayReserve: reserveKey, reserveLiquidityMint: address(token.mint),
    reserveDestinationLiquidity: reserve.liquidity.supplyVault, userSourceLiquidity: recipient, ...farms,
  });
  // In eMode KLend lowers each collateral reserve's group debt tracker, so it
  // consumes every active deposit reserve, in obligation order, as writable.
  const groupDeposits = position.state.elevationGroup === 0 ? []
    : deposits(position.state).map(d => ({ address: d.depositReserve, role: AccountRole.WRITABLE }));
  const operation = { ...repay, accounts: [...repay.accounts!, ...groupDeposits] };
  const instructions = [...setup, ...await adapter.refreshInstructions(position), operation, ...(closeTemporary ? [closeTemporary] : [])];
  const reserveKeys = [...position.reserves.keys()];
  const simulationAccounts = [position.address, recipient, adapter.marketAddress, ...reserveKeys,
    ...(temporary ? [wallet] : [])];
  let simulatedEstimate = estimate;
  return {
    instructions, simulationAccounts, get estimate() { return simulatedEstimate; }, token: useSol ? "SOL" : token.symbol,
    decimals: token.decimals, reserve: reserveKey, recipient, createsAta: false,
    ...(temporary ? { additionalSigners: [temporary] } : {}),
    ...(nativeSol ? { nativeSol, beforeSimulation: async (transaction: Transaction) => {
      const fee = await rpc.getTransactionFee(transaction);
      check(fee !== null && fee >= 0n, "RPC could not estimate the SOL transaction fee; blockhash may have expired");
      nativeSol.fee = fee;
      const available = walletLamports(position.accounts.get(wallet));
      check(available >= nativeSol.wrap, "insufficient SOL for wrapping the requested amount");
      check(available >= nativeSol.wrap + nativeSol.rent, "insufficient SOL for wrapping plus temporary account rent");
      check(available >= nativeSol.wrap + nativeSol.rent + fee, "insufficient SOL for wrapping, temporary account rent and transaction fee");
    } } : {}),
    validateSimulation(result) {
      const accounts = validateSimulationSnapshot(adapter, position, simulationAccounts, result);
      const tokenAfter = nativeSol ? undefined : tokenState(accounts[1], address(token.mint), wallet);
      const postAccount = accounts[0];
      const closed = postAccount == null || (postAccount.owner === ZERO && postAccount.data.length === 0);
      check(!closed, "repayment unexpectedly closed the obligation");
      const post = decode<Obligation>(adapter.programInterface, "Obligation", postAccount, adapter.programAddress);
      adapter.validateObligation(post, wallet, position.repayment);
      const beforeDeposits = deposits(position.state), afterDeposits = deposits(post);
      check(afterDeposits.length === beforeDeposits.length && afterDeposits.every((d, i) =>
        d.depositReserve === beforeDeposits[i]!.depositReserve && d.depositedAmount === beforeDeposits[i]!.depositedAmount),
      "simulated repayment changed collateral");
      check(post.owner === wallet && post.lendingMarket === adapter.marketAddress, "simulated repayment changed position ownership");
      const remainder = borrows(post).find(x => x.borrowReserve === reserveKey)?.borrowedAmountSf ?? 0n;
      check(requested !== null || remainder === 0n, "full repayment left residual debt");
      if (nativeSol) {
        const temporaryAfter = accounts[1];
        check(temporaryAfter === null || (temporaryAfter?.owner === ZERO && temporaryAfter.data.length === 0
          && temporaryAfter.lamports === 0n && !temporaryAfter.executable), "temporary WSOL account was not closed in simulation");
        check(nativeSol.fee !== undefined, "SOL transaction fee was not checked before simulation");
        const before = walletLamports(position.accounts.get(wallet));
        const after = walletLamports(accounts.at(-1));
        const debit = before - after - nativeSol.fee;
        check(debit > 0n && debit <= nativeSol.wrap, "unexpected simulated SOL debit or missing rent/refund");
        // Do not compare the shared reserve vault with the earlier snapshot:
        // unrelated users can change it between reads and simulation. The fixed
        // CloseAccount destination and zero-lamport closure enforce the refund.
        const debtBefore = borrows(position.state).find(x => x.borrowReserve === reserveKey)!.borrowedAmountSf;
        check(remainder < debtBefore && debtBefore - remainder <= debit * SF, "simulated SOL repayment did not reduce debt consistently");
        check(debit >= estimate && (requested === null || debit <= requested), "unexpected simulated SOL repayment amount");
        nativeSol.debit = debit;
        nativeSol.refund = nativeSol.wrap - debit + nativeSol.rent;
      } else {
        check(tokenAfter!.amount < balance && (requested === null || balance - tokenAfter!.amount <= requested), "unexpected simulated repayment debit");
        const debtBefore = debtSf(debt, reserve);
        check(remainder < debtBefore && debtBefore - remainder <= (balance - tokenAfter!.amount) * SF,
          "simulated repayment did not reduce debt consistently");
        simulatedEstimate = balance - tokenAfter!.amount;
      }
    },
  };
}

