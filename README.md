<p align="center">
	<img src="assets/logo.png" width="300px" height="auto"/>
</p>
<h1 align="center">node-ebics-client</h1>

<p align="center">
<a href="https://www.npmjs.com/package/@kage0x3b/ebics-client" title="npm version">
<img alt="@kage0x3b/ebics-client" src="https://img.shields.io/npm/v/@kage0x3b/ebics-client">
</a>
<a href="https://snyk.io/test/github/Kage0x3B/node-ebics-client" title="Known Vulnerabilities">
<img src="https://snyk.io/test/github/Kage0x3B/node-ebics-client/badge.svg" alt="Known Vulnerabilities">
</a>
<a href="LICENSE" title="MIT"><img alt="MIT" src="https://img.shields.io/github/license/node-ebics/node-ebics-client"></a>
</p>

> **Maintained fork.** Combines several open upstream PRs — H005 (EBICS 3.0) order types (H3K key management, HVE view-orders), certificate-based bank letters, H005 bank-key parsing and other fixes — plus a full TypeScript rewrite. Requires Node.js 22+.

Pure Node.js (>= 22) implementation of [EBICS](https://en.wikipedia.org/wiki/Electronic_Banking_Internet_Communication_Standard) (Electronic Banking Internet Communication).

The client is aimed to be 100% [ISO 20022](https://www.iso20022.org) compliant, and supports the complete initializations process (INI, HIA, HPB orders) and HTML letter generation.

## Usage

For examples on how to use this library, take a look at the [examples](https://github.com/node-ebics/node-ebics-client/tree/master/examples).

### Initialization

1. Create a configuration (see [example configs](https://github.com/node-ebics/node-ebics-client/tree/master/examples/config)) with the EBICS credentials you received from your bank and name it in this schema: `config.<environment>.<bank>[.<entity>].json` (the entity is optional).

    - The fields `url`, `partnerId`, `userId`, `hostId` are provided by your bank.
    - The `passphrase` is used to encrypt the keys file, which will be stored at the `storageLocation`.
    - The `bankName` and `bankShortName` are used internally for creating files and identifying the bank to you.
    - The `languageCode` is used when creating the Initialization Letter and can be either `de`, `en`, or `fr`.
    - You can chose any environment, bank and, optionally, entity name. Entities are useful if you have multiple EBICS users for the same bank account.

2. Run `pnpm tsx examples/initialize.ts <environment> <bank> [entity]` to generate your key pair and perform the INI and HIA orders (ie. send the public keys to your bank)
   The generated keys are stored in the file specified in your config and encrypted with the specified passphrase.
3. Run `pnpm tsx examples/bankLetter.ts <environment> <bank> [entity]` to generate the Initialization Letter
4. Print the letter, sign it and send it to your bank. Wait for them to activate your EBICS account.
5. Download the bank keys by running `pnpm tsx examples/save-bank-keys.ts <environment> <bank> [entity]`

If all these steps were executed successfully, you can now do all things EBICS, like fetching bank statements by running `pnpm tsx examples/send-sta-order.ts <environment> <bank> [entity]`, or actually use this library in your custom banking applications.

### Transport and large orders

Every EBICS request is one isolated HTTP exchange: the client never retries a request (a retry would replay the same Nonce and TransactionID), never follows redirects (a `3xx` is reported as `EBICS_CLIENT_HTTP_STATUS`) and does not keep idle connections alive. Retry at the application level with a new `client.send()`.

> **Behaviour change in 6.0.0:** earlier versions retried once on HTTP 408/429/502/503/504/521/522/524, followed redirects, reused keep-alive connections and had no timeout. A custom `agent` whose protocol does not match `url` used to be replaced silently by a built-in keep-alive agent; it is now rejected (`ERR_INVALID_PROTOCOL`).

| Client option | Default | Meaning |
|---|---|---|
| `timeout` | `60000` | Milliseconds to wait for the answer to one request; `0` disables it |
| `agent` | agent without keep-alive | Custom `http.Agent` / `https.Agent` matching the protocol of `url` |
| `segmentSize` | `1048576` (1 MB) | Maximum size of one upload order data segment (base64); a multiple of 4, at most 1 MB |

Order data larger than one segment is split and transferred segment by segment, in both directions. A download is acknowledged with `ReceiptCode 0` only after all its segments were decrypted and decompressed. If the data is unreadable or its segments do not add up, the client answers `ReceiptCode 1` so the bank delivers the data again (`error.redeliveryRequested` tells whether that went through). If the exchange breaks or the bank rejects a segment, no receipt is sent; the transaction times out at the bank and the data stays available.

### Results

Every result carries the bank's verdict (`technicalCode`, `businessCode` and their texts) plus:

| Field | Meaning |
|---|---|
| `orderId` | OrderID assigned by the bank (uploads: from the last answer naming one), `''` if none |
| `transactionId` | TransactionID of the EBICS transaction |
| `phase` | The step whose verdict is reported: `'initialisation'`, `'transfer'` or `'receipt'` |
| `numSegments` | Number of order data segments, when the transaction carried order data |
| `segmentNumber` | Uploads: last segment sent; on a rejected transfer (both directions): the rejected segment |
| `receiptCode` | Downloads: `0` once the data was read and the bank confirmed the receipt; absent if no receipt was sent |
| `transactionAborted` | `true` for codes with which the bank ends the transaction (`061101` EBICS_TX_RECOVERY_SYNC, `091101`, `091102`, `091104`, `091105`, `011101`). The client does not resume transactions: send the order again, which starts over with a new initialisation |

HPB accepts bank keys both as X.509 certificates (`ds:X509Data`) and as bare RSA keys (`PubKeyValue/ds:RSAKeyValue`).

### Error handling

`client.send()` distinguishes two kinds of failure:

- **Bank verdicts** — a well-formed EBICS response carrying a non-`000000` return code (e.g. `091005`, `090005`) is **returned** as a normal result. Check `technicalCode` / `businessCode`. For uploads, `phase` tells you whether the bank rejected the initialisation (`'initialisation'`, no order data was transferred) or the transfer (`'transfer'`); for a segmented transfer, `segmentNumber` / `numSegments` name the rejected segment (later segments were not sent). A download whose transfer the bank rejects comes back with `phase: 'transfer'`, the rejected `segmentNumber` and an empty `orderData`; no receipt is sent, so the data stays available.
- **Broken exchanges** — anything that is not a valid EBICS answer **throws** an `EbicsClientError` with a string `code` (never a six-digit EBICS code), plus `phase`, `orderType`, `httpStatus`, `contentType`, the (truncated) `rawResponse`, in segmented transfers `segmentNumber` / `numSegments`, for timeouts `requestSent`, and the underlying error as `cause` where one exists:

| `code` | Meaning |
|---|---|
| `EBICS_CLIENT_HTTP_STATUS` | Non-200 HTTP status (e.g. a proxy/WAF error page) |
| `EBICS_CLIENT_EMPTY_RESPONSE` | Empty response body |
| `EBICS_CLIENT_MALFORMED_XML` | Body is not well-formed XML |
| `EBICS_CLIENT_NON_EBICS_RESPONSE` | XML/HTML that is not an EBICS response |
| `EBICS_CLIENT_VERSION_MISMATCH` | EBICS response of another protocol version (e.g. H004 to an H005 request) |
| `EBICS_CLIENT_MISSING_RETURN_CODE` | Mandatory header or body `ReturnCode` missing |
| `EBICS_CLIENT_MISSING_TRANSACTION_ID` | Initialisation accepted without a `TransactionID` — the order data was **not** sent |
| `EBICS_CLIENT_TRANSACTION_ID_MISMATCH` | A transfer/receipt answer names a different transaction |
| `EBICS_CLIENT_TIMEOUT` | No answer within `timeout`. `requestSent` tells whether the request body was sent completely — after a sent transfer the outcome of the order is **unknown** |
| `EBICS_CLIENT_ORDER_DATA_UNREADABLE` | Downloaded order data could not be decrypted or decompressed. The client sent `ReceiptCode 1`, so the bank delivers the data again (see `redeliveryRequested`) |
| `EBICS_CLIENT_SEGMENT_MISMATCH` | Download segments out of order, or more/fewer than the bank announced. The client sent `ReceiptCode 1` |
| `EBICS_CLIENT_RECEIPT_FAILED` | The download was read, but the positive receipt failed or the bank did not confirm it. The bank may already consider the data delivered, so the error carries it in `orderData` (not enumerable, so it is not logged with the error) — keep it |

Transport errors of the HTTP layer itself (e.g. `ECONNRESET`, `ECONNREFUSED`) are thrown as they are.

```ts
import { EbicsClientError, EbicsClientErrorCode } from '@kage0x3b/ebics-client';

try {
	const result = await client.send(order);
	if (result.technicalCode !== '000000' || result.businessCode !== '000000') {
		// the bank rejected the order
	}
} catch (error) {
	if (error instanceof EbicsClientError && error.code === EbicsClientErrorCode.HTTP_STATUS) {
		console.error(error.httpStatus, error.rawResponse);
	}
	throw error;
}
```

## Supported Banks

The client is currently tested and verified to work with the following banks:

-   [Credit Suisse (Schweiz) AG](https://www.credit-suisse.com/ch/en.html)
-   [Zürcher Kantonalbank](https://www.zkb.ch/en/lg/ew.html)
-   [Raiffeisen Schweiz](https://www.raiffeisen.ch/rch/de.html)
-   [BW Bank](https://www.bw-bank.de/de/home.html)
-   [Bank GPB International S.A.](https://gazprombank.lu/e-banking)
-   [Bank GPB AO](https://gazprombank.ru/)
-   [J.P. Morgan](https://www.jpmorgan.com/)

## Inspiration

The basic concept of this library was inspired by the [EPICS](https://github.com/railslove/epics) library from the Railslove Team.

## Copyright

Copyright: Dimitar Nanov, 2019-2022.
Licensed under the [MIT](LICENSE) license.
