const { withAndroidManifest, withStringsXml } = require("expo/config-plugins");

const ASSET_STATEMENTS = JSON.stringify([
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "web", site: "https://petitannonces.fr" },
  },
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "web", site: "https://www.petitannonces.fr" },
  },
]);

module.exports = function withRelatedApps(config) {
  config = withStringsXml(config, (cfg) => {
    const resources = cfg.modResults.resources ?? (cfg.modResults.resources = {});
    const strings = Array.isArray(resources.string) ? resources.string : [];
    resources.string = strings.filter((item) => item?.$?.name !== "asset_statements");
    resources.string.push({ $: { name: "asset_statements", translatable: "false" }, _: ASSET_STATEMENTS });
    return cfg;
  });

  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    const metadata = Array.isArray(app["meta-data"]) ? app["meta-data"] : [];
    app["meta-data"] = metadata.filter((item) => item?.$?.["android:name"] !== "asset_statements");
    app["meta-data"].push({
      $: {
        "android:name": "asset_statements",
        "android:resource": "@string/asset_statements",
      },
    });
    return cfg;
  });
};
