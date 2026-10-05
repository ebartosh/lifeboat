import { address, AccountRole, type Address, type Instruction } from "@solana/kit";
import type { ChainAccount, LendingReader } from "../../core/accounts";
import { ProgramInterface } from "../../core/program-interface";
import { errorMessage } from "../../core/errors";
import idl from "./klend.idl.json" with { type: "json" };
import metadata from "./metadata.json" with { type: "json" };
import manifest from "./manifest.json" with { type: "json" };
import { ATA, CLOCK, FARMS, SCOPE, SYSVAR, TOKEN, ZERO, check, decode, mintState, support, tokenState, verifyOracle, verifyProgram, type ClockState } from "./accounts";
import type { LendingMarket, Obligation, Reserve, ReferrerTokenState } from "./state";

export type TokenDefinition = (typeof metadata.tokens)[number];
export type ReserveState = { address: Address; state: Reserve; token: TokenDefinition | undefined; oracleAgeSeconds: bigint | null; oracleFresh: boolean | null };
type RepaymentDependencies = { reserve: Address; source: "ata" | "native" };
type PositionLoadOptions = { additionalAccounts?: readonly Address[]; repayment?: RepaymentDependencies };
export type Position = {
  address: Address; wallet: Address; state: Obligation; market: LendingMarket; slot: bigint; clock: ClockState;
  reserves: Map<Address, ReserveState>; accounts: Map<Address, ChainAccount | null>;
  repayment?: RepaymentDependencies;
};
export type PositionStatus = { address: Address; position?: Position; reason?: string; repayments?: { token: string; reserve?: string; reason?: string }[] };
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const deposits = (o: Obligation) => o.deposits.filter(x => x.depositReserve !== ZERO);
export const borrows = (o: Obligation) => o.borrows.filter(x => x.borrowReserve !== ZERO);

function requiredFarms(reserve: Reserve, key: Address, repayment?: RepaymentDependencies): Address[] {
  return repayment ? (key === repayment.reserve ? [reserve.farmDebt] : []) : [reserve.farmCollateral, reserve.farmDebt];
}

export class KaminoAdapter {
  readonly metadata = metadata;
  readonly manifest = manifest;
  readonly programInterface = new ProgramInterface(idl);
  readonly programAddress = this.programInterface.programAddress;
  readonly marketAddress = address(metadata.markets[0]!.address);

  constructor() {
    check(metadata.programId === this.programAddress && metadata.version === idl.metadata.version, "bundle metadata does not match IDL");
    check(manifest.actions.every(action => this.programInterface.hasInstruction(action.instruction)), "manifest instruction missing from local IDL");
  }

  token(symbol: string): TokenDefinition {
    const tokens = metadata.tokens.filter(t => t.symbol.toUpperCase() === symbol.toUpperCase() || t.mint === symbol);
    check(tokens.length > 0, "supported tokens must come from the bundled reserve matrix");
    check(tokens.length === 1, "ambiguous token; choose a position reserve with --reserve");
    return tokens[0]!;
  }

  async operationToken(reader: LendingReader, wallet: Address, position: Address, action: "repay" | "withdraw", selector: string, reserve?: string): Promise<{ token: TokenDefinition; minSlot?: bigint } | null> {
    const candidates = metadata.tokens.filter(t => (t.symbol.toUpperCase() === selector.toUpperCase() || t.mint === selector)
      && (reserve === undefined || t.reserve === reserve));
    check(candidates.length > 0, "supported tokens/reserves must come from the bundled reserve matrix and match --token");
    if (candidates.length === 1) {
      check(candidates[0]![action], `reserve does not support ${action}`);
      return { token: candidates[0]! };
    }
    const snapshot = await reader.getAccounts([position]);
    const state = decode<Obligation>(this.programInterface, "Obligation", snapshot.accounts[0], this.programAddress);
    this.validateObligation(state, wallet, action === "repay" ? { reserve: this.programAddress, source: "ata" } : undefined);
    const keys = action === "repay" ? borrows(state).map(b => b.borrowReserve) : deposits(state).map(d => d.depositReserve);
    const active = candidates.filter(t => keys.includes(address(t.reserve)));
    check(active.length <= 1, `ambiguous token in position; use --reserve with one of: ${active.map(t => t.reserve).join(", ")}`);
    if (!active.length) return null;
    check(active[0]![action], `reserve does not support ${action}`);
    return { token: active[0]!, minSlot: snapshot.slot };
  }

  validateTokenSelection(state: Obligation, action: "repay" | "withdraw", selector: string): void {
    const keys = action === "repay" ? borrows(state).map(b => b.borrowReserve) : deposits(state).map(d => d.depositReserve);
    const active = metadata.tokens.filter(t => (t.symbol.toUpperCase() === selector.toUpperCase() || t.mint === selector)
      && keys.includes(address(t.reserve)));
    check(active.length <= 1, `ambiguous token in final position; use --reserve with one of: ${active.map(t => t.reserve).join(", ")}`);
  }

  async ata(wallet: Address, mint: Address): Promise<Address> {
    return this.programInterface.derivePda("ata", { owner: wallet, mint });
  }

  async getStatus(reader: LendingReader, wallet: Address): Promise<PositionStatus[]> {
    verifyProgram(await reader.getAccount(this.programAddress), "KLend");
    const discovered = await reader.getProgramAccounts(this.programAddress,
      this.programInterface.getAccountSize("Obligation"),
      [{ offset: this.programInterface.getAccountFieldOffset("Obligation", "owner"), bytes: wallet }]);
    const result: PositionStatus[] = [];
    for (const item of discovered.accounts) {
      try {
        const obligation = decode<Obligation>(this.programInterface, "Obligation", item.account, this.programAddress);
        check(obligation.owner === wallet, "RPC discovery returned a different owner's obligation");
        result.push({ address: item.address, position: await this.loadPosition(reader, wallet, item.address, discovered.slot) });
      } catch (error) {
        const repayments: { token: string; reserve?: string; reason?: string }[] = [];
        // Discovery is only used to select candidates; loadPosition re-reads and
        // validates the complete operation graph for each candidate.
        let debtKeys: Address[] = [];
        try { debtKeys = borrows(decode<Obligation>(this.programInterface, "Obligation", item.account, this.programAddress)).map(b => b.borrowReserve); }
        catch { /* Keep the original account/schema error. */ }
        for (const key of debtKeys.filter(key => !metadata.tokens.some(t => t.reserve === key))) {
          repayments.push({ token: `reserve ${key}`, reason: "unsupported debt reserve; only locally pinned main-market debt is supported" });
        }
        const candidates = metadata.tokens.filter(t => debtKeys.includes(address(t.reserve))).flatMap(token =>
          token.mint === WSOL_MINT ? [{ token, symbol: "WSOL" }, { token, symbol: "SOL" }] : [{ token, symbol: token.symbol }]);
        for (const { token, symbol } of candidates) {
          try {
            const p = await this.loadPosition(reader, wallet, item.address, discovered.slot, {
              repayment: { reserve: address(token.reserve), source: symbol === "SOL" ? "native" : "ata" },
            });
            if (!borrows(p.state).some(b => b.borrowReserve === token.reserve)) continue;
            const farm = p.reserves.get(address(token.reserve))!.state.farmDebt;
            check(farm === ZERO || p.accounts.get(await this.programInterface.derivePda("farmUser", { farm, obligation: item.address })), "required debt farm user is missing");
            repayments.push({ token: symbol, reserve: token.reserve });
          } catch (repayError) {
            repayments.push({ token: symbol, reserve: token.reserve, reason: errorMessage(repayError) });
          }
        }
        result.push({ address: item.address, reason: errorMessage(error), repayments });
      }
    }
    return result;
  }

  validateObligation(o: Obligation, wallet: Address, repayment?: RepaymentDependencies): void {
    check(o.owner === wallet && o.lendingMarket === this.marketAddress, "obligation owner or supported market mismatch");
    check(o.tag === 0n && o.elevationGroup === 0, "only vanilla positions outside elevation groups are supported");
    check(o.ownershipTransferState === 0 && o.pendingOwner === ZERO, "ownership transfer is unsupported");
    check(o.autodeleverageTargetLtvPct === 0 && o.autodeleverageMarginCallStartedTimestamp === 0n, "position is in autodeleverage mode");
    check(o.obligationOrders.every(x => x.conditionType === 0 && x.opportunityType === 0)
      && [o.headBorrowOrder, ...o.tailBorrowOrders].every(x => x.active === 0), "active obligation/borrow orders are unsupported");
    check((repayment || o.numOfObsoleteDepositReserves === 0) && o.numOfObsoleteBorrowReserves === 0, "obsolete reserves are unsupported");
    const ds = deposits(o), bs = borrows(o);
    check(new Set(ds.map(x => x.depositReserve)).size === ds.length && new Set(bs.map(x => x.borrowReserve)).size === bs.length, "duplicate position reserve");
    for (const key of [...(repayment ? [] : ds.map(x => x.depositReserve)), ...bs.map(x => x.borrowReserve)]) {
      check(metadata.tokens.some(t => t.reserve === key && (repayment ? t.repay : t.withdraw)), `unsupported reserve ${key}; check the bundled main-market reserve matrix`);
    }
    check(ds.every(x => x.depositedAmount > 0n) && bs.every(x => x.borrowedAmountSf > 0n), "invalid empty active position leg");
    check(bs.every(x => x.fixedTermBorrowRolloverConfig.autoRolloverEnabled === 0
      && x.fixedTermBorrowRolloverConfig.migrationToFixedEnabled === 0 && x.borrowedAmountAtExpiration === 0n), "fixed-term rollover positions are unsupported");
  }

  // A collateral-only reserve is a refresh dependency, never a transfer target.
  validatePositionReserve(r: Reserve, key: Address, obligation: Obligation, repayment?: RepaymentDependencies): TokenDefinition | undefined {
    if (!repayment || key === repayment.reserve || borrows(obligation).some(b => b.borrowReserve === key)) {
      return this.validateReserve(r, key, !repayment);
    }
    check(deposits(obligation).some(d => d.depositReserve === key), "reserve is not linked collateral");
    check(r.lendingMarket === this.marketAddress && r.version === 1n, "collateral reserve market/version mismatch");
    check(r.liquidity.tokenProgram === TOKEN && r.liquidity.mintPubkey !== ZERO && r.liquidity.mintDecimals <= 18n,
      "unsupported collateral token configuration");
    const c = r.config;
    check([0, 1, 2].includes(c.status) && c.emergencyMode === 0 && c.permissionedOps === 0n,
      "unsupported collateral reserve status/emergency/permissioning");
    check(c.loanToValuePct <= 100 && c.liquidationThresholdPct <= 100 && c.borrowFactorPct >= 100n,
      "invalid collateral risk configuration");
    // Keep identity checks for known reserves; unknown collateral comes only from
    // the wallet's decoded KLend obligation and is verified as a KLend Reserve.
    const token = metadata.tokens.find(t => t.reserve === key);
    if (token) check(r.liquidity.mintPubkey === token.mint && r.liquidity.mintDecimals === BigInt(token.decimals),
      "collateral reserve mint mismatch");
    return token;
  }

  validateReserve(r: Reserve, key: Address, requirePrices = true): TokenDefinition {
    const token = metadata.tokens.find(t => t.reserve === key);
    check(token && r.lendingMarket === this.marketAddress && r.version === 1n, "reserve market/version mismatch");
    check(requirePrices ? token.withdraw : token.repay, "reserve operation is outside the bundled support matrix");
    check(r.liquidity.mintPubkey === token.mint && r.liquidity.mintDecimals === BigInt(token.decimals)
      && r.liquidity.tokenProgram === TOKEN, "reserve mint or token program mismatch");
    for (const [name, actual] of [["liquidityVault", r.liquidity.supplyVault], ["collateralVault", r.collateral.supplyVault], ["collateralMint", r.collateral.mintPubkey]] as const) {
      check(actual === token[name], `invalid pinned ${name}`);
    }
    const c = r.config, i = c.tokenInfo;
    check(c.status === 0 && c.emergencyMode === 0 && c.permissionedOps === 0n, "inactive/emergency/permissioned reserve is unsupported");
    check(c.debtTermSeconds === 0n && c.debtMaturityTimestamp === 0n && c.earlyRepayRemainingInterestPct === 0, "fixed-term reserves are unsupported");
    check(c.autodeleverageEnabled === 0 && c.disableUsageAsCollOutsideEmode === 0, "unsupported reserve collateral restrictions");
    check(r.withdrawQueue.queuedCollateralAmount === 0n, "queued withdrawals are unsupported");
    check(c.loanToValuePct <= 100 && c.liquidationThresholdPct <= 100 && c.borrowFactorPct >= 100n, "invalid risk configuration");
    if (requirePrices) {
      check(i.pythConfiguration.price === ZERO && i.switchboardConfiguration.priceAggregator === ZERO
        && i.switchboardConfiguration.twapAggregator === ZERO && i.scopeConfiguration.priceFeed !== ZERO,
      "MVP requires Scope-only oracle configuration");
      check(i.blockPriceUsage === 0, "reserve price usage is blocked");
    }
    return token;
  }

  validateMarket(market: LendingMarket): void {
    check(market.version === 1n && market.emergencyMode === 0 && market.permissionedOps === 0n,
      "market version/emergency/permissioning is unsupported");
  }

  validateReserveDependencies(position: Position, key: Address, r: Reserve): void {
    const prior = position.reserves.get(key)!.state;
    check(r.liquidity.mintPubkey === prior.liquidity.mintPubkey
      && r.liquidity.mintDecimals === prior.liquidity.mintDecimals
      && r.liquidity.tokenProgram === prior.liquidity.tokenProgram
      && JSON.stringify(requiredFarms(r, key, position.repayment)) === JSON.stringify(requiredFarms(prior, key, position.repayment))
      && (position.repayment || (r.config.tokenInfo.scopeConfiguration.priceFeed === prior.config.tokenInfo.scopeConfiguration.priceFeed
      && JSON.stringify(r.config.tokenInfo.scopeConfiguration.priceChain) === JSON.stringify(prior.config.tokenInfo.scopeConfiguration.priceChain)
      && JSON.stringify(r.config.tokenInfo.scopeConfiguration.twapChain) === JSON.stringify(prior.config.tokenInfo.scopeConfiguration.twapChain))),
    "reserve dependency changed during simulation; reload before planning");
  }

  validateRefreshedPosition(position: Position, state: Obligation, reserves: Map<Address, ReserveState>): void {
    this.validateObligation(state, position.wallet, position.repayment);
    check(state.referrer === position.state.referrer, "position referrer changed during refresh; retry");
    const previousDeposits = deposits(position.state), currentDeposits = deposits(state);
    const previousBorrows = borrows(position.state), currentBorrows = borrows(state);
    check(currentDeposits.length === previousDeposits.length && currentBorrows.length === previousBorrows.length
      && currentDeposits.every((d, i) => d.depositReserve === previousDeposits[i]!.depositReserve && d.depositedAmount === previousDeposits[i]!.depositedAmount)
      && currentBorrows.every((b, i) => b.borrowReserve === previousBorrows[i]!.borrowReserve),
    "position changed during refresh; reload before planning");
    for (const [key, refreshed] of reserves) {
      const r = refreshed.state;
      this.validatePositionReserve(r, key, state, position.repayment);
      this.validateReserveDependencies(position, key, r);
    }
  }

  async loadPosition(reader: LendingReader, wallet: Address, key: Address, minSlot?: bigint, options: PositionLoadOptions = {}): Promise<Position> {
    const { repayment, additionalAccounts = [] } = options;
    const first = await reader.getAccounts([key], minSlot);
    const initial = decode<Obligation>(this.programInterface, "Obligation", first.accounts[0], this.programAddress);
    this.validateObligation(initial, wallet, repayment);
    const reserveKeys = [...new Set([...deposits(initial).map(x => x.depositReserve), ...borrows(initial).map(x => x.borrowReserve)])];
    const base = [key, this.marketAddress, CLOCK, this.programAddress, TOKEN, ...(!repayment ? [ATA, SCOPE] : []), FARMS, ...reserveKeys];
    const roots = await reader.getAccounts(base, first.slot);
    const rootMap = new Map(base.map((key, index) => [key, roots.accounts[index] ?? null]));
    const extra: Address[] = [];
    for (const reserveKey of reserveKeys) {
      const reserve = decode<Reserve>(this.programInterface, "Reserve", rootMap.get(reserveKey), this.programAddress);
      this.validatePositionReserve(reserve, reserveKey, initial, repayment);
      if (!repayment) extra.push(reserve.config.tokenInfo.scopeConfiguration.priceFeed);
      if (!repayment || reserveKey === repayment.reserve) {
        extra.push(reserve.liquidity.mintPubkey, reserve.liquidity.supplyVault);
        if (!repayment || repayment.source === "ata") extra.push(await this.ata(wallet, reserve.liquidity.mintPubkey));
      }
      if (!repayment) extra.push(reserve.collateral.mintPubkey, reserve.collateral.supplyVault);
      for (const farm of requiredFarms(reserve, reserveKey, repayment)) {
        if (farm !== ZERO) extra.push(farm, await this.programInterface.derivePda("farmUser", { farm, obligation: key }));
      }
      if (initial.referrer !== ZERO && borrows(initial).some(x => x.borrowReserve === reserveKey)) {
        extra.push(await this.programInterface.derivePda("referrerState", { referrer: initial.referrer, reserve: reserveKey }));
      }
    }
    // All balances, prices, position and reserve state used below come from one RPC bank.
    const keys = [...new Set([...base, ...extra, ...additionalAccounts])];
    const final = await reader.getAccounts(keys, roots.slot);
    check(final.accounts.length === keys.length, "incomplete RPC snapshot");
    const accounts = new Map(keys.map((key, index) => [key, final.accounts[index] ?? null]));
    verifyProgram(accounts.get(this.programAddress), "KLend");
    verifyProgram(accounts.get(TOKEN), "SPL Token", false);
    if (!repayment) verifyProgram(accounts.get(ATA), "Associated Token", false);
    if (!repayment) verifyProgram(accounts.get(SCOPE), "Scope");
    verifyProgram(accounts.get(FARMS), "Farms");
    const state = decode<Obligation>(this.programInterface, "Obligation", accounts.get(key), this.programAddress);
    this.validateObligation(state, wallet, repayment);
    const market = decode<LendingMarket>(this.programInterface, "LendingMarket", accounts.get(this.marketAddress), this.programAddress);
    this.validateMarket(market);
    const clock = decode<ClockState>(support, "Clock", accounts.get(CLOCK), SYSVAR);
    check(clock.unixTimestamp > 0n && clock.slot <= final.slot, "invalid RPC Clock");
    const authority = await this.programInterface.derivePda("marketAuthority", { market: this.marketAddress });
    const reserves = new Map<Address, ReserveState>();
    for (const reserveKey of new Set([...deposits(state).map(x => x.depositReserve), ...borrows(state).map(x => x.borrowReserve)])) {
      const reserve = decode<Reserve>(this.programInterface, "Reserve", accounts.get(reserveKey), this.programAddress);
      const token = this.validatePositionReserve(reserve, reserveKey, state, repayment);
      check(reserve.lastUpdate.slot <= clock.slot && state.lastUpdate.slot <= clock.slot, "state update slot is in the future");
      if (!repayment || reserveKey === repayment.reserve) {
        check(token, "unsupported operation reserve");
        mintState(accounts.get(reserve.liquidity.mintPubkey), token.decimals);
        const vault = tokenState(accounts.get(reserve.liquidity.supplyVault), reserve.liquidity.mintPubkey, authority);
        check(vault.amount >= reserve.liquidity.totalAvailableAmount, "reserve vault balance is below recorded liquidity");
        if (!repayment || repayment.source === "ata") {
          const ata = await this.ata(wallet, reserve.liquidity.mintPubkey);
          if (accounts.get(ata)) tokenState(accounts.get(ata), reserve.liquidity.mintPubkey, wallet);
        }
      }
      if (!repayment) {
        const collateralMint = mintState(accounts.get(reserve.collateral.mintPubkey), 6);
        check(collateralMint.mintAuthorityOption === 1 && collateralMint.mintAuthority === authority
          && collateralMint.supply <= reserve.collateral.mintTotalSupply, "collateral mint authority/supply mismatch");
        const collateralVault = tokenState(accounts.get(reserve.collateral.supplyVault), reserve.collateral.mintPubkey, authority);
        const deposited = deposits(state).find(d => d.depositReserve === reserveKey)?.depositedAmount ?? 0n;
        check(collateralVault.amount >= deposited, "collateral vault balance is below position deposit");
      }
      const oracle = repayment ? { ageSeconds: null, fresh: null }
        : verifyOracle(accounts.get(reserve.config.tokenInfo.scopeConfiguration.priceFeed), reserve, clock);
      for (const farm of requiredFarms(reserve, reserveKey, repayment)) {
        if (farm === ZERO) continue;
        const farmState = decode<{ delegateAuthority: Address; isFarmDelegated: number; isFarmFrozen: number }>(support, "FarmState", accounts.get(farm), FARMS);
        check(farmState.delegateAuthority === authority && farmState.isFarmDelegated === 1 && farmState.isFarmFrozen === 0, "invalid/frozen delegated farm");
        const farmUser = await this.programInterface.derivePda("farmUser", { farm, obligation: key });
        if (accounts.get(farmUser)) {
          const user = decode<{ farmState: Address; owner: Address; delegatee: Address; isFarmDelegated: number }>(support, "UserState", accounts.get(farmUser), FARMS);
          check(user.farmState === farm && user.owner === wallet && user.delegatee === key && user.isFarmDelegated === 1, "farm user authority/obligation mismatch");
        }
      }
      if (state.referrer !== ZERO && borrows(state).some(x => x.borrowReserve === reserveKey)) {
        const referrer = await this.programInterface.derivePda("referrerState", { referrer: state.referrer, reserve: reserveKey });
        const refState = decode<ReferrerTokenState>(this.programInterface, "ReferrerTokenState", accounts.get(referrer), this.programAddress);
        check(refState.referrer === state.referrer && refState.mint === reserve.liquidity.mintPubkey, "referrer state links mismatch");
      }
      reserves.set(reserveKey, { address: reserveKey, state: reserve, token, oracleAgeSeconds: oracle.ageSeconds, oracleFresh: oracle.fresh });
    }
    return { address: key, wallet, state, market, slot: final.slot, clock, reserves, accounts, ...(repayment ? { repayment } : {}) };
  }

  async refreshInstructions(position: Position): Promise<Instruction[]> {
    const result: Instruction[] = [];
    if (position.repayment) {
      const batch = await this.programInterface.buildInstruction("refreshReservesBatch", { skipPriceUpdates: true }, {});
      // With skipPriceUpdates=true the pinned handler consumes ONLY reserve/market pairs.
      result.push({ ...batch, accounts: [...position.reserves.keys()].flatMap(reserve =>
        metadata.repaymentRefresh.remainingAccountGroup.map(account => ({
          address: account.name === "reserve" ? reserve : this.marketAddress,
          role: account.writable ? AccountRole.WRITABLE : AccountRole.READONLY,
        }))) });
    } else for (const reserve of position.reserves.values()) {
      result.push(await this.programInterface.buildInstruction("refreshReserve", {}, {
        reserve: reserve.address, lendingMarket: this.marketAddress,
        pythOracle: this.programAddress, switchboardPriceOracle: this.programAddress,
        switchboardTwapOracle: this.programAddress, scopePrices: reserve.state.config.tokenInfo.scopeConfiguration.priceFeed,
      }));
    }
    const remaining = [...deposits(position.state).map(x => x.depositReserve), ...borrows(position.state).map(x => x.borrowReserve)];
    if (position.state.referrer !== ZERO) {
      for (const borrow of borrows(position.state)) remaining.push(await this.programInterface.derivePda("referrerState", {
        referrer: position.state.referrer, reserve: borrow.borrowReserve,
      }));
    }
    const instruction = await this.programInterface.buildInstruction("refreshObligation", {}, {
      lendingMarket: this.marketAddress, obligation: position.address,
    });
    result.push({ ...instruction, accounts: [...instruction.accounts!, ...remaining.map(address => ({ address, role: AccountRole.WRITABLE }))] });
    return result;
  }
}

