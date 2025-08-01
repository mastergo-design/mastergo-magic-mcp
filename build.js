#!/usr/bin/env node

const esbuild = require("esbuild");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Ensure the dist directory exists
if (!fs.existsSync("dist")) {
  fs.mkdirSync("dist");
}

// Recursively delete a directory
function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach((file) => {
      const curPath = path.join(dirPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        // Recursively delete subdirectories
        removeDir(curPath);
      } else {
        // Delete the file
        fs.unlinkSync(curPath);
      }
    });
    // Delete the directory itself
    fs.rmdirSync(dirPath);
  }
}

async function build() {
  try {
    console.log("🚀 Starting the build process...");

    // Clean up old build files
    console.log("🧹 Cleaning up old build files...");
    if (fs.existsSync("dist")) {
      // First delete the dist directory
      removeDir("dist");
      // Re-create the dist directory
      fs.mkdirSync("dist");
    }

    // Use esbuild to bundle all code into a single file
    console.log("📦 Using esbuild to bundle all code into a single file...");
    await esbuild.build({
      entryPoints: ["src/index.ts"],
      bundle: true,
      platform: "node",
      target: "node16",
      outfile: "dist/index.js",
      minify: true,
      sourcemap: false,
      format: "cjs",
      // Exclude only node built-in modules to ensure all third-party dependencies are bundled
      external: [
        "path",
        "fs",
        "child_process",
        "http",
        "https",
        "util",
        "os",
        "stream",
        "zlib",
        "events",
        "buffer",
        "crypto",
        "net",
        "dns",
        "tls",
        "url",
        "querystring",
        "assert",
      ],
      // Ensure all modules are correctly resolved
      resolveExtensions: [".ts", ".js", ".json", ".node"],
      // Ensure all dependencies are correctly loaded
      loader: {
        ".ts": "ts",
        ".js": "js",
        ".json": "json",
        ".node": "file",
        ".md": "text",
      },
      // Define environment variables
      define: {
        "process.env.NODE_ENV": '"production"',
      },
      // Enable tree shaking
      treeShaking: true,
    });

    // Verify if only one file is generated
    console.log("🔍 Verifying the build output...");
    const files = fs.readdirSync("dist");
    if (files.length > 1 || (files.length === 1 && files[0] !== "index.js")) {
      console.warn(
        "⚠️ Warning: The build produced multiple files, not a single file"
      );
      console.warn("📁 File list:", files);
    } else {
      console.log(
        "✅ Verification successful: All code has been bundled into a single file"
      );
    }

    // The file header is already in the source file, no need to add it again
    console.log(
      "✅ The source file already includes the shebang, no need to add it again"
    );

    // Add executable permissions
    console.log("🔑 Adding executable permissions...");
    fs.chmodSync("dist/index.js", "755");

    // Display file size
    const stats = fs.statSync("dist/index.js");
    const fileSizeInKB = (stats.size / 1024).toFixed(2);
    console.log(`📦 Build output size: ${fileSizeInKB} KB`);

    console.log("✅ Build successful！");
    console.log("📦 Executable file located at: dist/index.js");

    console.log("🚀 You can publish the package using the following command:");
    console.log("   npm publish");
    console.log("");
    console.log("🔧 Or you can test locally using the following command:");
    console.log(
      "   node dist/index.js --token=YOUR_TOKEN [--url=API_URL] [--rule=RULE_NAME] [--debug]"
    );
  } catch (error) {
    console.error("❌ Build failed:", error);
    process.exit(1);
  }
}

build();
