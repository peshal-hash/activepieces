const { composePlugins, withNx } = require('@nx/webpack');
const IgnoreDynamicRequire = require('webpack-ignore-dynamic-require');

module.exports = composePlugins(withNx(), (config) => {
  config.plugins.push(new IgnoreDynamicRequire());
  config.ignoreWarnings = [
    ...(config.ignoreWarnings ?? []),
    (warning) => {
      const resource =
        warning.module && 'resource' in warning.module ? warning.module.resource : '';
      return (
        typeof resource === 'string' &&
        resource.includes('@modelcontextprotocol/sdk/dist/cjs/') &&
        typeof warning.message === 'string' &&
        warning.message.includes('Failed to parse source map')
      );
    },
  ];

  config.externals = {
    'isolated-vm': 'commonjs2 isolated-vm',
    'utf-8-validate': 'commonjs2 utf-8-validate',
    'bufferutil': 'commonjs2 bufferutil'
  };

  return config;
});
