import { DOMParser } from '@xmldom/xmldom';

import EbicsClientError, { EbicsClientErrorCode, type EbicsClientErrorDetails } from '../EbicsClientError.js';

/** Root elements a bank may answer an EBICS request with. */
const EBICS_RESPONSE_ROOTS = new Set(['ebicsResponse', 'ebicsKeyManagementResponse']);
const EBICS_NAMESPACE_PATTERN = /^urn:org:ebics:H\d{3}$/;

export interface RawEbicsResponse {
	body: string;
	httpStatus?: number;
	contentType?: string;
}

/**
 * Reject everything that is not a structurally valid EBICS response of the requested version,
 * BEFORE the version-specific parser runs. The parsers read fields via namespaced XPath and return
 * `''` for anything they cannot find, so an HTML error page from a proxy or an answer in another
 * EBICS version would otherwise surface as a response whose every field is empty.
 */
export function assertEbicsResponse(
	version: string,
	raw: RawEbicsResponse,
	context: Pick<EbicsClientErrorDetails, 'phase' | 'orderType'>,
): void {
	const details: EbicsClientErrorDetails = {
		...context,
		httpStatus: raw.httpStatus,
		contentType: raw.contentType,
		rawResponse: raw.body,
	};

	if (raw.httpStatus !== undefined && raw.httpStatus !== 200)
		throw new EbicsClientError(EbicsClientErrorCode.HTTP_STATUS, `Server answered with HTTP ${raw.httpStatus} instead of an EBICS response`, details);

	if (!raw.body.trim())
		throw new EbicsClientError(EbicsClientErrorCode.EMPTY_RESPONSE, 'Server answered with an empty body', details);

	const parseErrors: string[] = [];
	const doc = new DOMParser({
		errorHandler: {
			warning: () => {},
			error: (message: string) => parseErrors.push(message),
			fatalError: (message: string) => parseErrors.push(message),
		},
	}).parseFromString(raw.body, 'text/xml');

	if (parseErrors.length)
		throw new EbicsClientError(EbicsClientErrorCode.MALFORMED_XML, `Response is not well-formed XML: ${parseErrors[0]!.trim()}`, details);

	const root = doc?.documentElement;
	if (!root)
		throw new EbicsClientError(EbicsClientErrorCode.NON_EBICS_RESPONSE, 'Response has no XML root element', details);

	const rootName = root.localName ?? root.nodeName;
	const namespace = root.namespaceURI ?? '';
	const expectedNamespace = `urn:org:ebics:${version.toUpperCase()}`;

	if (EBICS_NAMESPACE_PATTERN.test(namespace) && namespace !== expectedNamespace)
		throw new EbicsClientError(
			EbicsClientErrorCode.VERSION_MISMATCH,
			`Expected a ${version.toUpperCase()} response, got <${rootName}> in namespace ${namespace}`,
			details,
		);

	if (!EBICS_RESPONSE_ROOTS.has(rootName) || namespace !== expectedNamespace)
		throw new EbicsClientError(
			EbicsClientErrorCode.NON_EBICS_RESPONSE,
			`Expected an EBICS response, got <${rootName}>${namespace ? ` in namespace ${namespace}` : ''}`,
			details,
		);
}

/**
 * Both the header (technical) and body (business) ReturnCode are mandatory in every EBICS
 * response, key management included. A response without them cannot be classified as accepted.
 */
export function assertReturnCodes(
	codes: { technicalCode: string; businessCode: string },
	raw: RawEbicsResponse,
	context: Pick<EbicsClientErrorDetails, 'phase' | 'orderType'>,
): void {
	const missing = [!codes.technicalCode && 'header', !codes.businessCode && 'body'].filter(Boolean);
	if (!missing.length) return;

	throw new EbicsClientError(
		EbicsClientErrorCode.MISSING_RETURN_CODE,
		`Response carries no ${missing.join(' or ')} ReturnCode`,
		{
			...context,
			httpStatus: raw.httpStatus,
			contentType: raw.contentType,
			rawResponse: raw.body,
			technicalCode: codes.technicalCode || undefined,
			businessCode: codes.businessCode || undefined,
		},
	);
}
