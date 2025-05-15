#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Get arguments
const args = process.argv.slice(2);
// Attempt to get token from environment variable first
let token = process.env.TOKEN || "";
let baseUrl = "http://localhost:3000";
let debug = false;
// Array to collect rules
let rules = [];

// Parse arguments
for (let i = 0; i < args.length; i++) {
  // Only parse --token if token is not already set by environment variable
  if (
    args[i] === "--token" &&
    i + 1 < args.length &&
    !process.env.MG_MCP_TOKEN
  ) {
    token = args[i + 1];
    i++;
  } else if (args[i].startsWith("--token=") && !process.env.MG_MCP_TOKEN) {
    token = args[i].split("=")[1];
  } else if (args[i] === "--url" && i + 1 < args.length) {
    baseUrl = args[i + 1];
    i++;
  } else if (args[i].startsWith("--url=")) {
    baseUrl = args[i].split("=")[1];
  } else if (args[i] === "--debug") {
    debug = true;
    // Add support for --rule parameter
  } else if (args[i] === "--rule" && i + 1 < args.length) {
    rules.push(args[i + 1]);
    i++;
  } else if (args[i].startsWith("--rule=")) {
    rules.push(args[i].split("=")[1]);
  }
}

// Check required arguments
if (!token) {
  console.error("Error: Missing MasterGo API Token.");
  console.error(
    "Please set the MG_MCP_TOKEN environment variable or use the --token argument."
  );
  console.error(
    "Usage: npx mastergo-magic-mcp --token=YOUR_TOKEN [--url=API_URL] [--rule=RULE_NAME]"
  );
  console.error("Use --help or -h for more information");
  process.exit(1);
}

// Set environment variables
const env = {
  ...process.env,
  MASTERGO_API_TOKEN: token,
  API_BASE_URL: baseUrl,
  DEBUG: debug ? "true" : "false",
  // Add RULES environment variable as stringified array
  RULES: JSON.stringify(rules),
};

// Get package path
const packageDir = path.resolve(__dirname, "../dist");
const indexPath = path.join(packageDir, "index.js");

// Check if file exists
if (!fs.existsSync(indexPath)) {
  console.error(
    "Error: Executable file not found. Please ensure the package is correctly installed."
  );
  process.exit(1);
}

if (debug) {
  console.log("Debug information:");
  console.log(`Package path: ${indexPath}`);
  console.log(
    `Token source: ${process.env.MG_MCP_TOKEN ? "environment variable (MG_MCP_TOKEN)" : "command-line argument"}`
  );
  console.log(`Token: ${token ? "set" : "not set"}`);
  console.log(`API URL: ${baseUrl}`);
  console.log(`Rules: ${rules.length > 0 ? rules.join(", ") : "none"}`);
  console.log(`Debug mode: ${debug ? "enabled" : "disabled"}`);
}

try {
  // Directly run the compiled file
  if (debug) {
    console.log("Using node to run the compiled code...");
  }

  // Directly use node to run the file, passing environment variables
  const child = spawn("node", [indexPath], {
    env: env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error("Startup error:", error);
    if (debug) {
      console.error("Detailed error information:", error.stack);
    }
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code || 0);
  });
} catch (error) {
  console.error("Runtime error:", error);
  if (debug) {
    console.error("Detailed error information:", error.stack);
  }
  process.exit(1);
}
