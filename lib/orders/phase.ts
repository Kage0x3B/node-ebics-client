import EbicsClientError, { EbicsClientErrorCode } from '../EbicsClientError.js';

/**
 * Whether the order is a follow-up step (transfer / receipt) of an open transaction rather than its
 * initialisation. The client sets `order.phase` explicitly; the `transactionId` fallback only serves
 * callers that drive serializers directly. A follow-up without a TransactionID is refused instead of
 * silently turning into a second initialisation (which would never transfer the order data).
 */
export function isFollowUpPhase(order: { phase?: string; transactionId?: string; orderDetails?: Record<string, unknown> }): boolean {
	const followUp = order.phase ? order.phase !== 'initialisation' : !!order.transactionId;

	if (followUp && !order.transactionId)
		throw new EbicsClientError(
			EbicsClientErrorCode.MISSING_TRANSACTION_ID,
			`Cannot build the ${order.phase} request without the TransactionID of the open transaction`,
			{
				phase: order.phase as 'transfer' | 'receipt' | undefined,
				orderType: String(order.orderDetails?.['AdminOrderType'] ?? order.orderDetails?.['OrderType'] ?? 'UNKNOWN'),
			},
		);

	return followUp;
}
