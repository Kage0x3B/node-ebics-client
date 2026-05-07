import genericDownload from './generic-download.js';
import type { PredefinedDownloadFunctionH005 } from './types.js';

const EOP: PredefinedDownloadFunctionH005 = (options) => genericDownload({
	serviceName: 'EOP',
	msgName: 'camt.053',
	containerType: 'ZIP',
	...options,
});

export default EOP;
