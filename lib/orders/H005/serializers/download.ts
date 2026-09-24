import Crypto from '../../../crypto/Crypto.js';
import { isFollowUpPhase } from '../../phase.js';
import genericSerializer from './generic.js';

export default {
	async use(order: any, client: any): Promise<any> {
		const { orderDetails, transactionId } = order;
		const builder = genericSerializer(client.hostId, transactionId);

		if (isFollowUpPhase(order)) {
			if (order.phase === 'transfer')
				return builder.downloadTransfer(order.segmentNumber, !!order.lastSegment);

			return builder.receipt(order.receiptCode ?? 0);
		}

		const keys = await client.keys();
		const ebicsAccount = {
			partnerId: client.partnerId,
			userId: client.userId,
			hostId: client.hostId,
		};

		builder.xmlSchema.header = {
			'@': { authenticate: true },
			static: {
				HostID: ebicsAccount.hostId,
				Nonce: Crypto.nonce(),
				Timestamp: Crypto.timestamp(),
				PartnerID: ebicsAccount.partnerId,
				UserID: ebicsAccount.userId,
				Product: {
					'@': { Language: 'en' },
					'#': builder.productString,
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

		return builder;
	},
};
