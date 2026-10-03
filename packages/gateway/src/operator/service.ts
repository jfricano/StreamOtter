import { StreamOtterError, type Gateway, type OperatorApi } from "@streamotter/contracts";
import { getGatewayInternals } from "../runtime/gateway.ts";

/** The operator service of a running gateway with failure handling (ADR-15C §1). */
export function getGatewayOperator(gateway: Gateway): OperatorApi {
  const operator = getGatewayInternals(gateway).operator();
  if (operator === null) {
    throw new StreamOtterError("UNSUPPORTED_CAPABILITY", { message: "This gateway has no failure handling configured, so it has no operator service." });
  }
  return operator;
}
