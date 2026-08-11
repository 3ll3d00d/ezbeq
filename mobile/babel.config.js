module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated v4 moved its worklet compilation into a separate plugin; it must be listed
    // last (see https://docs.swmansion.com/react-native-reanimated/docs/guides/troubleshooting).
    plugins: ['react-native-worklets/plugin'],
  };
};
