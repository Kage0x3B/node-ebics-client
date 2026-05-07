import genericDownload from './generic-download.js';
import type { PredefinedDownloadFunctionH005 } from './types.js';

const PSR: PredefinedDownloadFunctionH005 = (options) => genericDownload({
	serviceName: 'PSR',
	msgName: 'pain.002',
	...options,
});

export default PSR;
