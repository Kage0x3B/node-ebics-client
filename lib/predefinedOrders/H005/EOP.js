'use strict';

const genericDownload = require('./generic-download');

module.exports = options => genericDownload({
	serviceName: 'EOP',
	msgName: 'camt.053',
	containerType: 'ZIP',
	...options,
});
