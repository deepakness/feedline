const { withAppBuildGradle } = require('expo/config-plugins');

// Release builds ship one APK per CPU architecture instead of one fat APK.
// scripts/build-apk.sh opts in with -PfeedlineAbiSplits=true and lists the
// architectures in -PreactNativeArchitectures, so dev builds stay unaffected.
const MARKER = 'feedlineAbiSplits';

const SPLITS = `
    splits {
        abi {
            enable project.hasProperty('${MARKER}')
            reset()
            include(*((findProperty('reactNativeArchitectures') ?: 'arm64-v8a').split(',')))
            universalApk false
        }
    }
`;

const SIGNING_CONFIGS = /\n(\s*)signingConfigs\s*\{/;

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (cfg) => {
    const contents = cfg.modResults.contents;
    if (contents.includes(MARKER)) return cfg;
    if (!SIGNING_CONFIGS.test(contents)) {
      throw new Error('withAbiSplits: app/build.gradle no longer matches the Expo template; update the anchor.');
    }
    cfg.modResults.contents = contents.replace(SIGNING_CONFIGS, (match) => SPLITS.trimEnd() + match);
    return cfg;
  });
};
