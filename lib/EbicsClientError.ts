/**
 * Error codes raised by the client itself when an EBICS exchange is broken in a way the bank did
 * not report with a regular EBICS return code: the HTTP layer failed, the body is not an EBICS
 * response at all, or a mandatory protocol field is missing. They are deliberately string symbols
 * so they can never be confused with the bank's six-digit EBICS return codes.
 *
 * A genuine bank verdict (a well-formed response carrying e.g. `091005`) is NOT an error here — it
 * is returned as a normal result so callers can read `technicalCode` / `businessCode`.
 */
export const EbicsClientErrorCode = {
	/** The server answered with a non-200 HTTP status. EBICS responses are always sent with HTTP 200. */
	HTTP_STATUS: 'EBICS_CLIENT_HTTP_STATUS',
	/** The response body was empty. */
	EMPTY_RESPONSE: 'EBICS_CLIENT_EMPTY_RESPONSE',
	/** The response body is not well-formed XML. */
	MALFORMED_XML: 'EBICS_CLIENT_MALFORMED_XML',
	/** The response is XML (or HTML), but not an EBICS response document. */
	NON_EBICS_RESPONSE: 'EBICS_CLIENT_NON_EBICS_RESPONSE',
	/** The response is an EBICS document of a different protocol version than the request. */
	VERSION_MISMATCH: 'EBICS_CLIENT_VERSION_MISMATCH',
	/** The mandatory header (technical) or body (business) ReturnCode is missing. */
	MISSING_RETURN_CODE: 'EBICS_CLIENT_MISSING_RETURN_CODE',
	/** The bank accepted the initialisation but did not assign a TransactionID. */
	MISSING_TRANSACTION_ID: 'EBICS_CLIENT_MISSING_TRANSACTION_ID',
	/** A follow-up phase was answered for a different TransactionID than the one in progress. */
	TRANSACTION_ID_MISMATCH: 'EBICS_CLIENT_TRANSACTION_ID_MISMATCH',
	/**
	 * The bank did not answer within the configured timeout. `requestSent` tells whether the request
	 * body had been sent completely; if so, the bank may have processed it — for a transfer the
	 * outcome of the order is unknown.
	 */
	TIMEOUT: 'EBICS_CLIENT_TIMEOUT',
	/** The downloaded order data could not be decrypted or decompressed. The bank was asked to deliver it again. */
	ORDER_DATA_UNREADABLE: 'EBICS_CLIENT_ORDER_DATA_UNREADABLE',
	/** The segments of a download do not add up: numbering out of order or more segments than announced. */
	SEGMENT_MISMATCH: 'EBICS_CLIENT_SEGMENT_MISMATCH',
	/**
	 * The order data was downloaded and decrypted, but the positive receipt failed or the bank did
	 * not confirm it. The bank may already consider the data delivered: the error carries it in
	 * `orderData` — keep it.
	 */
	RECEIPT_FAILED: 'EBICS_CLIENT_RECEIPT_FAILED',
} as const;

export type EbicsClientErrorCode = (typeof EbicsClientErrorCode)[keyof typeof EbicsClientErrorCode];

/** The step of an EBICS transaction a request belongs to. Key management (INI/HIA/HPB) is a single initialisation step. */
export type EbicsTransactionPhase = 'initialisation' | 'transfer' | 'receipt';

export interface EbicsClientErrorDetails {
	phase?: EbicsTransactionPhase;
	orderType?: string;
	httpStatus?: number;
	contentType?: string;
	/** The raw response body, truncated to {@link MAX_RAW_RESPONSE_LENGTH} characters. */
	rawResponse?: string;
	technicalCode?: string;
	businessCode?: string;
	transactionId?: string;
	/** The segment (1-based) the failed request carried or asked for, in segmented transfers. */
	segmentNumber?: number;
	/** Total number of segments of the transaction, when known. */
	numSegments?: number;
	/** Timeouts only: whether the request body had been sent completely before the timeout hit. */
	requestSent?: boolean;
	/**
	 * {@link EbicsClientErrorCode.ORDER_DATA_UNREADABLE} / {@link EbicsClientErrorCode.SEGMENT_MISMATCH}:
	 * whether the ReceiptCode 1 asking the bank to deliver the data again went through.
	 */
	redeliveryRequested?: boolean;
	/**
	 * {@link EbicsClientErrorCode.RECEIPT_FAILED} only: the downloaded, decrypted order data. Not
	 * enumerable, so logging or serialising the error does not dump the statement.
	 */
	orderData?: Buffer;
	/** The underlying error, e.g. the decryption failure behind {@link EbicsClientErrorCode.ORDER_DATA_UNREADABLE}. */
	cause?: unknown;
}

/** Upper bound for the raw body kept on the error, so a large HTML error page cannot bloat logs. */
export const MAX_RAW_RESPONSE_LENGTH = 64 * 1024;

export default class EbicsClientError extends Error implements EbicsClientErrorDetails {
	override readonly name = 'EbicsClientError';
	readonly code: EbicsClientErrorCode;
	readonly phase?: EbicsTransactionPhase;
	readonly orderType?: string;
	readonly httpStatus?: number;
	readonly contentType?: string;
	readonly rawResponse?: string;
	readonly technicalCode?: string;
	readonly businessCode?: string;
	readonly transactionId?: string;
	readonly segmentNumber?: number;
	readonly numSegments?: number;
	readonly requestSent?: boolean;
	declare readonly orderData?: Buffer;
	/** Set once the client has tried to request redelivery; see {@link EbicsClientErrorDetails.redeliveryRequested}. */
	redeliveryRequested?: boolean;

	constructor(code: EbicsClientErrorCode, message: string, details: EbicsClientErrorDetails = {}) {
		const context = [
			details.orderType && `order ${details.orderType}`,
			details.phase && `phase ${details.phase}`,
			details.segmentNumber !== undefined && `segment ${details.segmentNumber}${details.numSegments ? `/${details.numSegments}` : ''}`,
			details.httpStatus !== undefined && `HTTP ${details.httpStatus}`,
		].filter(Boolean).join(', ');
		super(`${code}: ${message}${context ? ` (${context})` : ''}`, details.cause === undefined ? undefined : { cause: details.cause });

		this.code = code;
		this.phase = details.phase;
		this.orderType = details.orderType;
		this.httpStatus = details.httpStatus;
		this.contentType = details.contentType;
		this.rawResponse = details.rawResponse?.slice(0, MAX_RAW_RESPONSE_LENGTH);
		this.technicalCode = details.technicalCode;
		this.businessCode = details.businessCode;
		this.transactionId = details.transactionId;
		this.segmentNumber = details.segmentNumber;
		this.numSegments = details.numSegments;
		this.requestSent = details.requestSent;
		this.redeliveryRequested = details.redeliveryRequested;
		if (details.orderData !== undefined)
			Object.defineProperty(this, 'orderData', { value: details.orderData, enumerable: false, configurable: true });
	}
}
