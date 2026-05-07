import js2xmlparser from 'js2xmlparser';

import Crypto from '../../../crypto/Crypto.js';
import genericSerializer from './generic.js';

export default {
	productString: '' as string,
	rootName: '' as string,
	xmlOptions: undefined as any,
	xmlSchema: undefined as any,
	receipt: undefined as any,
	transfer: undefined as any,

	async use(order: any, client: any): Promise<any> {
		const keys = await client.keys();
		const ebicsAccount = {
			partnerId: client.partnerId,
			userId: client.userId,
			hostId: client.hostId,
		};
		const { orderDetails, transactionId } = order;
		const {
			rootName, xmlOptions, xmlSchema, receipt, transfer, productString,
		} = genericSerializer(client.hostId, transactionId);

		this.productString = productString;
		this.rootName = rootName;
		this.xmlOptions = xmlOptions;
		this.xmlSchema = xmlSchema;
		this.receipt = receipt;
		this.transfer = transfer;

		if (transactionId) return this.receipt();

		this.xmlSchema.header = {
			'@': { authenticate: true },
			static: {
				HostID: ebicsAccount.hostId,
				Nonce: Crypto.nonce(),
				Timestamp: Crypto.timestamp(),
				PartnerID: ebicsAccount.partnerId,
				UserID: ebicsAccount.userId,
				Product: {
					'@': { Language: 'en' },
					'#': productString,
				},
				OrderDetails: orderDetails,
				BankPubKeyDigests: {
					Authentication: {
						'@': { Version: 'X002', Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' },
						'#': Crypto.digestPublicKey(keys.bankX()!),
					},
					Encryption: {
						'@': { Version: 'E002', Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' },
						'#': Crypto.digestPublicKey(keys.bankE()!),
					},
				},
				SecurityMedium: '0000',
			},
			mutable: {
				TransactionPhase: 'Initialisation',
			},
		};

		return this;
	},

	toXML() {
		return js2xmlparser.parse(this.rootName, this.xmlSchema, this.xmlOptions);
	},
};
