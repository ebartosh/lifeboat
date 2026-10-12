// Signs release builds with the private Lifeboat key when its Gradle properties are set
// (normally in ~/.gradle/gradle.properties, never in the repository). Without them, release
// keeps the template's public debug key, which is acceptable only for local testing.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// lifeboat-release-signing';
const PROPERTY = "findProperty('LIFEBOAT_RELEASE_STORE_FILE')";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;
    if (gradle.includes(MARKER)) return mod;

    const releaseType = /(buildTypes \{[\s\S]*?release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/;
    if (!releaseType.test(gradle)) throw new Error('with-release-signing: release signingConfig not found');
    gradle = gradle.replace(releaseType, `$1signingConfig ${PROPERTY} ? signingConfigs.release : signingConfigs.debug`);

    const signingConfigs = /signingConfigs \{\n/;
    if (!signingConfigs.test(gradle)) throw new Error('with-release-signing: signingConfigs block not found');
    gradle = gradle.replace(signingConfigs, `signingConfigs {
        ${MARKER}
        if (${PROPERTY}) {
            release {
                storeFile file(findProperty('LIFEBOAT_RELEASE_STORE_FILE'))
                storePassword findProperty('LIFEBOAT_RELEASE_STORE_PASSWORD')
                keyAlias findProperty('LIFEBOAT_RELEASE_KEY_ALIAS')
                keyPassword findProperty('LIFEBOAT_RELEASE_KEY_PASSWORD')
            }
        }
`);

    mod.modResults.contents = gradle;
    return mod;
  });
};
