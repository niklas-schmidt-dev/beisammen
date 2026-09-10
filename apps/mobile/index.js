// Capture React Native's handler BEFORE expo-observe installs its own. Keep
// requires sequential: static imports would run before this capture.
const previousErrorHandler = global.ErrorUtils?.getGlobalHandler();
require('./src/features/observe/runtime').initializeObserve(previousErrorHandler);
require('expo-router/entry');
