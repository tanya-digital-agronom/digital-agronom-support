import { access, copyFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "firebase", "google-services.json");
const nativeDir = join(root, "android", "app");
const target = join(nativeDir, "google-services.json");
const client = JSON.parse(await readFile(source, "utf8"));
const capacitor = JSON.parse(await readFile(join(root, "capacitor.config.json"), "utf8"));
const packageName = capacitor.appId;
if (client.project_info?.project_id !== "agronom-ec8b7" ||
    !client.client?.some(item => item.client_info?.android_client_info?.package_name === packageName)) {
  throw new Error("Firebase project/package mismatch, Android configuration was not copied.");
}
try {
  await access(nativeDir);
} catch {
  console.log("Android project not generated yet; Firebase config will be copied after Capacitor project initialization.");
  process.exit(0);
}
await copyFile(source, target);
console.log("Firebase Android client config added for", packageName,
  "using project", client.project_info.project_id);
