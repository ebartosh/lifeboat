import { prepareRepay } from "./repay";
import { prepareWithdraw } from "./withdraw";
import type { OperationPlan, PreparationOptions } from "./operation-common";

export type { KaminoRpc, OperationPlan } from "./operation-common";
export { prepareRepay, prepareWithdraw };

export function prepareOperation(options: PreparationOptions & { action: "repay" | "withdraw" }): Promise<OperationPlan | null> {
  return options.action === "repay" ? prepareRepay(options) : prepareWithdraw(options);
}

