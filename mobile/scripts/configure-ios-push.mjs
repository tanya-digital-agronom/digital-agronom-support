import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "ios", "App", "App");
const delegatePath = join(appDir, "AppDelegate.swift");
const pbxPath = join(root, "ios", "App", "App.xcodeproj", "project.pbxproj");
try { await access(delegatePath); }
catch {
  console.log("iOS project not generated; skipping iOS push setup.");
  process.exit(0);
}
let delegate = await readFile(delegatePath, "utf8");
if (!delegate.includes("capacitorDidRegisterForRemoteNotifications")) {
  const insertion = [
    "",
    "  // Forward APNs registration events to @capacitor/push-notifications.",
    "  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {",
    "    NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)",
    "  }",
    "",
    "  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {",
    "    NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)",
    "  }",
    "",
  ].join("\n");
  const end = delegate.lastIndexOf("}");
  if (end < 0) throw new Error("AppDelegate.swift does not contain a class closing brace.");
  delegate = delegate.slice(0, end) + insertion + delegate.slice(end);
  await writeFile(delegatePath, delegate);
}

const entitlements = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0"><dict>',
  '<key>aps-environment</key><string>development</string>',
  '</dict></plist>',
  '',
].join("\n");
await writeFile(join(appDir, "App.entitlements"), entitlements);
let project = await readFile(pbxPath, "utf8");
if (!project.includes("CODE_SIGN_ENTITLEMENTS = App/App.entitlements;")) {
  let updated = 0;
  project = project.replace(
    /^(\s*)PRODUCT_BUNDLE_IDENTIFIER = ru\.digitalagronom\.support;/gm,
    (_, indent) => {
      updated++;
      return indent + "CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n" +
        indent + "PRODUCT_BUNDLE_IDENTIFIER = ru.digitalagronom.support;";
    },
  );
  if (!updated) {
    throw new Error("Cannot locate the app bundle identifier to set APNs entitlement.");
  }
  await writeFile(pbxPath, project);
}
console.log("✓ Capacitor AppDelegate forwards APNs token to the push plugin.");
console.log("✓ Development APNs entitlement configured. Enable push for the App ID in Apple Developer.");
