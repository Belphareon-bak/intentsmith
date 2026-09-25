// IntentSmith local capability bootstrap must run before Theia frontend modules.
'use strict';
require('./intentsmith-local-http-bootstrap');
require('./src-gen/frontend/index');
