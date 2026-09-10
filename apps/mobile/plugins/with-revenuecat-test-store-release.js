/**
 * Lets the RevenueCat SDK run with a Test Store API key in Release-configured
 * builds. RevenueCat deliberately crashes Release builds that use a `test_`
 * key so a Test Store key can never ship to the App Store. Local device builds
 * for the "beisammen dev" app (`expo run:ios --configuration Release`, used by
 * the on-device e2e flow) are Release builds that still bill against the Test
 * Store, so they need RevenueCat's documented opt-out compilation flag.
 *
 * Only applied when `EXPO_PUBLIC_APP_ENV=development`; preview and production
 * builds keep the safeguard (and use real store keys anyway, see
 * src/features/billing/config.ts).
 */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# @generated begin revenuecat-test-store-release';
const SNIPPET = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      next unless target.name == 'RevenueCat'
      target.build_configurations.each do |config|
        next unless config.name == 'Release'
        flags = config.build_settings['OTHER_SWIFT_FLAGS'] || '$(inherited)'
        unless flags.include?('BYPASS_SIMULATED_STORE_RELEASE_CHECK')
          config.build_settings['OTHER_SWIFT_FLAGS'] = "#{flags} -D BYPASS_SIMULATED_STORE_RELEASE_CHECK"
        end
      end
    end
    # @generated end revenuecat-test-store-release
`;

/** @param {import('expo/config-plugins').ExportedConfig} config */
function withRevenueCatTestStoreRelease(config) {
  if (process.env.EXPO_PUBLIC_APP_ENV !== 'development') {
    return config;
  }

  return withDangerousMod(config, [
    'ios',
    (dangerousConfig) => {
      const podfilePath = path.join(dangerousConfig.modRequest.platformProjectRoot, 'Podfile');
      const podfile = fs.readFileSync(podfilePath, 'utf8');

      if (podfile.includes(MARKER)) {
        return dangerousConfig;
      }

      const anchor = 'post_install do |installer|';

      if (!podfile.includes(anchor)) {
        throw new Error(
          'with-revenuecat-test-store-release: Podfile has no post_install block to extend',
        );
      }

      fs.writeFileSync(podfilePath, podfile.replace(anchor, `${anchor}${SNIPPET}`));

      return dangerousConfig;
    },
  ]);
}

module.exports = withRevenueCatTestStoreRelease;
