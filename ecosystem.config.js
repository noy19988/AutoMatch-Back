module.exports = {
  apps: [
    {
      name: "automatch",
      script: "./dist/app.js",
      env_production: {
        NODE_ENV: "production"
      }
    }
  ]
};
