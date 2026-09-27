// IntentSmith local capability bootstrap must run before Theia frontend modules.
'use strict';
require('./intentsmith-local-http-bootstrap');
// Select a renderer before Theia evaluates any UI extension. An explicit
// preference wins; private preview launches opt into Studio 2 on first start.
let studioMode = 'classic';
try {
  const savedMode = window.localStorage.getItem('intentsmith-studio-ui-mode');
  if (savedMode === 'studio2' ||
      (savedMode !== 'classic' && window.electronIntentSmith?.preferStudio2Preview?.() === true)) {
    studioMode = 'studio2';
  }
} catch (_) { /* local storage may be unavailable */ }
window.__intentsmithStudioMode = studioMode;
document.documentElement.dataset.intentsmithStudioMode = studioMode;
require('./src-gen/frontend/index');
