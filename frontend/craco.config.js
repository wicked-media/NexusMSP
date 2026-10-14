// craco.config.js
const path = require("path");
// React Scripts already loads supported .env files. Keep the direct load optional
// so pnpm installs do not need to hoist this transitive dependency for local start.
try {
  require("dotenv").config();
} catch (err) {
  if (err.code !== "MODULE_NOT_FOUND") throw err;
}

// Environment variable overrides
const config = {
  enableHealthCheck: process.env.ENABLE_HEALTH_CHECK === "true",
};

// Conditionally load health check modules only if enabled
let WebpackHealthPlugin;
let setupHealthEndpoints;
let healthPluginInstance;

if (config.enableHealthCheck) {
  WebpackHealthPlugin = require("./plugins/health-check/webpack-health-plugin");
  setupHealthEndpoints = require("./plugins/health-check/health-endpoints");
  healthPluginInstance = new WebpackHealthPlugin();
}

let webpackConfig = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    configure: (webpackConfig) => {

      // Add ignored patterns to reduce watched directories
        webpackConfig.watchOptions = {
          ...webpackConfig.watchOptions,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/public/**',
        ],
      };

      // Add health check plugin to webpack if enabled
      if (config.enableHealthCheck && healthPluginInstance) {
        webpackConfig.plugins.push(healthPluginInstance);
      }
      return webpackConfig;
    },
  },
};

webpackConfig.devServer = (devServerConfig) => {
  // Nexus uses browser-history routes for every workspace.  Explicitly retain
  // CRA's SPA fallback after applying the custom proxy configuration so a
  // refresh or deep link such as /login is served by React rather than 404ing.
  devServerConfig.historyApiFallback = {
    ...(typeof devServerConfig.historyApiFallback === "object" ? devServerConfig.historyApiFallback : {}),
    disableDotRule: true,
  };

  // In the sandboxed full-stack preview the browser reaches the app through a
  // single origin, so same-origin /api calls are forwarded to the FastAPI
  // backend started by scripts/dev-stack.sh. NEXUS_PROXY_TARGET overrides the
  // target when the API runs elsewhere.
  devServerConfig.proxy = {
    "/api": {
      target: process.env.NEXUS_PROXY_TARGET || "http://127.0.0.1:8000",
      changeOrigin: true,
      secure: false,
    },
    ...(devServerConfig.proxy || {}),
  };

  // Add health check endpoints if enabled
  if (config.enableHealthCheck && setupHealthEndpoints && healthPluginInstance) {
    const originalSetupMiddlewares = devServerConfig.setupMiddlewares;

    devServerConfig.setupMiddlewares = (middlewares, devServer) => {
      // Call original setup if exists
      if (originalSetupMiddlewares) {
        middlewares = originalSetupMiddlewares(middlewares, devServer);
      }

      // Setup health endpoints
      setupHealthEndpoints(devServer, healthPluginInstance);

      return middlewares;
    };
  }

  return devServerConfig;
};

// Jest reaches `@/...` through the jsconfig paths, but the Babel module resolver only
// rewrites file targets: a directory import such as `@/components/design-system`
// survives to Jest unmapped and fails, even though webpack resolves it against the
// directory's index.jsx. That made every workspace importing a directory alias
// impossible to unit-test. Mapping the alias for Jest as well closes the gap.
webpackConfig.jest = {
  configure: (jestConfig) => {
    const existing = Array.isArray(jestConfig.moduleNameMapper)
      ? Object.fromEntries(jestConfig.moduleNameMapper)
      : { ...(jestConfig.moduleNameMapper || {}) };
    jestConfig.moduleNameMapper = { ...existing, "^@/(.*)$": "<rootDir>/src/$1" };
    return jestConfig;
  },
};

module.exports = webpackConfig;
