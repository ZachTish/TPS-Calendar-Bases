import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const buildDir = path.join(rootDir, "build");

const assets = ["main.js", "manifest.json", "styles.css"];

for (const asset of assets) {
  const srcInBuild = path.join(buildDir, asset);
  const destInRoot = path.join(rootDir, asset);
  const srcInRoot = path.join(rootDir, asset);
  const destInBuild = path.join(buildDir, asset);

  if (fs.existsSync(srcInBuild)) {
    fs.copyFileSync(srcInBuild, destInRoot);
    console.log(`✓ Copied ${asset} from build to root`);
  }

  if (fs.existsSync(srcInRoot)) {
    fs.copyFileSync(srcInRoot, destInBuild);
    console.log(`✓ Copied ${asset} from root to build`);
  }
}

console.log("\n✅ Plugin files copied to root for BRAT compatibility.");
